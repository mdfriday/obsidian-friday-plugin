import {
    type EntryDoc,
    type DatabaseConnectingStatus,
    type RemoteDBSettings,
    type BucketSyncSetting,
    type ObsidianLiveSyncSettings,
    type EntryLeaf,
    type EntryNodeInfo,
    NODEINFO_DOCID,
    type TweakValues,
    type NodeData,
} from "../common/types.ts";

import type { ReactiveSource } from "octagonal-wheels/dataobject/reactive";
import { LOG_LEVEL_INFO, LOG_LEVEL_NOTICE, LOG_LEVEL_VERBOSE, Logger } from "../common/logger.ts";
import { resolveWithIgnoreKnownError, type SimpleStore } from "../common/utils.ts";
import type { KeyValueDatabase } from "../interfaces/KeyValueDatabase.ts";
import { arrayBufferToBase64Single } from "../string_and_binary/convert.ts";
import type { ServiceHub } from "../services/ServiceHub.ts";
import { $msg } from "../common/i18n.ts";

export type SaltCheckResult = {
    ok: boolean;
    message?: string;
    needsFetch: boolean;
};

export type ReplicationCallback = (e: PouchDB.Core.ExistingDocument<EntryDoc>[]) => Promise<void> | void;
export type ReplicationStat = {
    sent: number;
    arrived: number;
    maxPullSeq: number;
    maxPushSeq: number;
    lastSyncPullSeq: number;
    lastSyncPushSeq: number;
    syncStatus: DatabaseConnectingStatus;
};
export interface LiveSyncReplicatorEnv {
    services: ServiceHub;
    getDatabase(): PouchDB.Database<EntryDoc>;

    getSettings(): RemoteDBSettings & BucketSyncSetting & Pick<ObsidianLiveSyncSettings, "remoteType">;
    // $$isMobile(): boolean;
    // $$parseReplicationResult: ReplicationCallback;
    replicationStat: ReactiveSource<ReplicationStat>;
    kvDB: KeyValueDatabase;
    simpleStore: SimpleStore<any>;
}

export type RemoteDBStatus = {
    [key: string]: any;
    estimatedSize?: number;
};

export abstract class LiveSyncAbstractReplicator {
    syncStatus: DatabaseConnectingStatus = "NOT_CONNECTED";
    docArrived = 0;
    docSent = 0;

    lastSyncPullSeq = 0;
    maxPullSeq = 0;
    lastSyncPushSeq = 0;
    maxPushSeq = 0;
    controller?: AbortController;
    // localDatabase: PouchDB.Database<EntryDoc>;
    originalSetting!: RemoteDBSettings;
    nodeid = "";
    remoteLocked = false;
    remoteCleaned = false;
    remoteLockedAndDeviceNotAccepted = false;
    tweakSettingsMismatched = false;
    preferredTweakValue?: TweakValues;

    abstract getReplicationPBKDF2Salt(setting: RemoteDBSettings, refresh?: boolean): Promise<Uint8Array<ArrayBuffer>>;
    async ensurePBKDF2Salt(
        setting: RemoteDBSettings,
        showMessage: boolean = false,
        useCache: boolean = true
    ): Promise<boolean> {
        // Checking salt
        try {
            const hash = await this.getReplicationPBKDF2Salt(setting, !useCache);
            if (hash.length == 0) {
                throw new Error("PBKDF2 salt (Security Seed) is empty");
            }
            Logger(`PBKDF2 salt (Security Seed): ${await arrayBufferToBase64Single(hash)}`, LOG_LEVEL_VERBOSE);
            return true;
        } catch (ex) {
            const level = showMessage ? LOG_LEVEL_NOTICE : LOG_LEVEL_INFO;
            Logger(`Failed to obtain PBKDF2 salt (Security Seed) for replication`, level);
            Logger(ex, LOG_LEVEL_VERBOSE);
            return false;
        }
    }

    /**
     * Get the storage key for the known salt of a specific database.
     * @param dbName The name of the database.
     * @returns The storage key.
     */
    protected _getKnownSaltKey(dbName: string): string {
        return `known_salt_${dbName}`;
    }

    /**
     * Check if the remote database's PBKDF2 salt has changed since last sync.
     * This is used to detect remote database resets.
     * @param setting The remote database settings.
     * @returns The result of the salt check.
     */
    async checkSaltConsistency(setting: RemoteDBSettings): Promise<SaltCheckResult> {
        const saltKey = this._getKnownSaltKey(setting.couchDB_DBNAME);
        const saltStore = this.env.services.database.openSimpleStore<string>("friday-sync-salt");

        try {
            // Force refresh to get the latest salt from remote
            const remoteSalt = await this.getReplicationPBKDF2Salt(setting, true);
            const remoteSaltBase64 = await arrayBufferToBase64Single(remoteSalt);

            // Get the stored salt from last successful sync
            const storedSalt = await saltStore.get(saltKey);

            // First time sync - no stored salt yet
            if (!storedSalt) {
                Logger(`First sync detected, storing initial salt`, LOG_LEVEL_VERBOSE);
                await saltStore.set(saltKey, remoteSaltBase64);
                return { ok: true, needsFetch: false };
            }

            // Compare salts
            if (storedSalt !== remoteSaltBase64) {
                Logger(`Salt mismatch detected! Stored: ${storedSalt.substring(0, 16)}..., Remote: ${remoteSaltBase64.substring(0, 16)}...`, LOG_LEVEL_INFO);
                return {
                    ok: false,
                    message: $msg("fridaySync.saltChanged.message"),
                    needsFetch: true,
                };
            }

            Logger(`Salt consistency check passed`, LOG_LEVEL_VERBOSE);
            return { ok: true, needsFetch: false };
        } catch (ex) {
            Logger($msg("fridaySync.saltCheck.failed"), LOG_LEVEL_VERBOSE);
            Logger(ex, LOG_LEVEL_VERBOSE);
            // Check failure should not block sync - let subsequent operations handle errors
            return { ok: true, needsFetch: false };
        }
    }

    /**
     * Update the stored salt after a successful sync or fetch operation.
     * @param setting The remote database settings.
     */
    async updateStoredSalt(setting: RemoteDBSettings): Promise<void> {
        try {
            const saltKey = this._getKnownSaltKey(setting.couchDB_DBNAME);
            const saltStore = this.env.services.database.openSimpleStore<string>("friday-sync-salt");
            const remoteSalt = await this.getReplicationPBKDF2Salt(setting, false);
            const remoteSaltBase64 = await arrayBufferToBase64Single(remoteSalt);
            await saltStore.set(saltKey, remoteSaltBase64);
            Logger(`Stored salt updated successfully`, LOG_LEVEL_VERBOSE);
        } catch (ex) {
            Logger(`Failed to update stored salt`, LOG_LEVEL_VERBOSE);
            Logger(ex, LOG_LEVEL_VERBOSE);
        }
    }

    /**
     * Clear the stored salt. Call this after "Fetch from Server" to accept new salt.
     * @param setting The remote database settings.
     */
    async clearStoredSalt(setting: RemoteDBSettings): Promise<void> {
        try {
            const saltKey = this._getKnownSaltKey(setting.couchDB_DBNAME);
            const saltStore = this.env.services.database.openSimpleStore<string>("friday-sync-salt");
            await saltStore.delete(saltKey);
            Logger(`Stored salt cleared`, LOG_LEVEL_VERBOSE);
        } catch (ex) {
            Logger(`Failed to clear stored salt`, LOG_LEVEL_VERBOSE);
            Logger(ex, LOG_LEVEL_VERBOSE);
        }
    }
    env: LiveSyncReplicatorEnv;
    async initializeDatabaseForReplication(): Promise<boolean> {
        const db = this.env.getDatabase();
        try {
            const nodeinfo: EntryNodeInfo = await resolveWithIgnoreKnownError<EntryNodeInfo>(db.get(NODEINFO_DOCID), {
                _id: NODEINFO_DOCID,
                type: "nodeinfo",
                nodeid: "",
                v20220607: true,
            });
            if (nodeinfo.nodeid == "") {
                nodeinfo.nodeid = Math.random().toString(36).slice(-10);
                await db.put(nodeinfo);
            }

            this.nodeid = nodeinfo.nodeid;
            return true;
        } catch (ex) {
            Logger(ex, LOG_LEVEL_VERBOSE);
        }
        return false;
    }

    constructor(env: LiveSyncReplicatorEnv) {
        this.env = env;
        // initialize local node information.
    }

    abstract terminateSync(): void;

    abstract openReplication(
        setting: RemoteDBSettings,
        keepAlive: boolean,
        showResult: boolean,
        ignoreCleanLock: boolean
    ): Promise<void | boolean>;

    updateInfo: () => void = () => {
        this.env.replicationStat.value = {
            sent: this.docSent,
            arrived: this.docArrived,
            maxPullSeq: this.maxPullSeq,
            maxPushSeq: this.maxPushSeq,
            lastSyncPullSeq: this.lastSyncPullSeq,
            lastSyncPushSeq: this.lastSyncPushSeq,
            syncStatus: this.syncStatus,
        };
    };

    abstract tryConnectRemote(setting: RemoteDBSettings, showResult?: boolean): Promise<boolean>;
    abstract replicateAllToServer(
        setting: RemoteDBSettings,
        showingNotice?: boolean,
        sendChunksInBulkDisabled?: boolean
    ): Promise<boolean>;
    abstract replicateAllFromServer(setting: RemoteDBSettings, showingNotice?: boolean): Promise<boolean>;
    abstract closeReplication(): void;

    abstract tryResetRemoteDatabase(setting: RemoteDBSettings): Promise<void>;
    abstract tryCreateRemoteDatabase(setting: RemoteDBSettings): Promise<void>;

    abstract markRemoteLocked(setting: RemoteDBSettings, locked: boolean, lockByClean: boolean): Promise<void>;
    abstract markRemoteResolved(setting: RemoteDBSettings): Promise<void>;
    abstract resetRemoteTweakSettings(setting: RemoteDBSettings): Promise<void>;
    abstract setPreferredRemoteTweakSettings(setting: RemoteDBSettings): Promise<void>;

    abstract fetchRemoteChunks(missingChunks: string[], showResult: boolean): Promise<false | EntryLeaf[]>;

    abstract getRemoteStatus(setting: RemoteDBSettings): Promise<false | RemoteDBStatus>;
    abstract getRemotePreferredTweakValues(setting: RemoteDBSettings): Promise<false | TweakValues>;

    abstract countCompromisedChunks(setting?: RemoteDBSettings): Promise<number | boolean>;

    abstract getConnectedDeviceList(
        setting?: RemoteDBSettings
    ): Promise<false | { node_info: Record<string, NodeData>; accepted_nodes: string[] }>;
}
