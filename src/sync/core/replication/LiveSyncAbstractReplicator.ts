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
            Logger(ex);
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
