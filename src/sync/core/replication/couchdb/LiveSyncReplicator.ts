import {
    type EntryDoc,
    type EntryMilestoneInfo,
    VER,
    MILESTONE_DOCID,
    type DatabaseConnectingStatus,
    type ChunkVersionRange,
    type RemoteDBSettings,
    type EntryLeaf,
    REPLICATION_BUSY_TIMEOUT,
    LOG_LEVEL_INFO,
    LOG_LEVEL_NOTICE,
    LOG_LEVEL_VERBOSE,
    DEVICE_ID_PREFERRED,
    TweakValuesTemplate,
    type DocumentID,
    type TweakValues,
    type CouchDBCredentials,
    type SyncParameters,
    type DatabaseEntry,
    DOCID_SYNC_PARAMETERS,
    DEFAULT_SYNC_PARAMETERS,
    ProtocolVersions,
    type NodeData,
    type DeviceInfo,
} from "../../common/types.ts";
import {
    resolveWithIgnoreKnownError,
    globalConcurrencyController,
    extractObject,
    wrapException,
    sizeToHumanReadable,
    arrayToChunkedArray,
    parseHeaderValues,
} from "../../common/utils.ts";
import { Logger } from "../../common/logger.ts";
import { checkRemoteVersion, countCompromisedChunks } from "../../pouchdb/negotiation.ts";
import { preprocessOutgoing } from "../../pouchdb/encryption.ts";

import { ensureDatabaseIsCompatible } from "../../pouchdb/LiveSyncDBFunctions.ts";
import {
    LiveSyncAbstractReplicator,
    type LiveSyncReplicatorEnv,
    type RemoteDBStatus,
} from "../LiveSyncAbstractReplicator.ts";
import { serialized, shareRunningResult } from "octagonal-wheels/concurrency/lock";
import { Semaphore } from "octagonal-wheels/concurrency/semaphore";
import { Trench } from "octagonal-wheels/memory/memutil";
import { promiseWithResolver } from "octagonal-wheels/promises";
import { Inbox, NOT_AVAILABLE } from "octagonal-wheels/bureau/Inbox";
import { $msg } from "../../common/i18n.ts";
import {
    clearHandlers,
    createSyncParamsHanderForServer,
    SyncParamsFetchError,
    SyncParamsNotFoundError,
    SyncParamsUpdateError,
} from "../SyncParamsHandler.ts";
import type { ServiceHub } from "../../services/ServiceHub.ts";

const currentVersionRange: ChunkVersionRange = {
    min: 0,
    max: 2400,
    current: 2,
};

const selectorOnDemandPull = { selector: { type: { $ne: "leaf" } } };

// eslint-disable-next-line
type EventParamArray<T extends {}> =
    | ["change", PouchDB.Replication.SyncResult<T>]
    | ["change", PouchDB.Replication.ReplicationResult<T>]
    | ["active"]
    | ["complete", PouchDB.Replication.SyncResultComplete<T>]
    | ["complete", PouchDB.Replication.ReplicationResultComplete<T>]
    | ["error", any]
    | ["denied", any]
    | ["paused", any]
    | ["finally"];

async function* genReplication(
    s: PouchDB.Replication.Sync<EntryDoc> | PouchDB.Replication.Replication<EntryDoc>,
    signal: AbortSignal
) {
    const inbox = new Inbox<EventParamArray<EntryDoc>>(10000);
    const push = function (e: EventParamArray<EntryDoc>) {
        void serialized("replicationResult", async () => {
            if (signal.aborted) {
                return;
            }
            if (!inbox.isDisposed) {
                await inbox.post(e);
            } else {
                Logger("Inbox is disposed", LOG_LEVEL_VERBOSE);
            }
        });
    };

    //@ts-ignore
    void s.on("complete", (result) => push(["complete", result]));
    //@ts-ignore
    void s.on("change", (result) => push(["change", result]));
    void s.on("active", () => push(["active"]));
    void s.on("denied", (err) => push(["denied", err]));
    void s.on("error", (err) => push(["error", err]));
    void s.on("paused", (err) => push(["paused", err]));
    void s.then(() => push(["finally"])).catch(() => push(["finally"]));
    const abortSymbol = Symbol("abort");
    const abortPromise = promiseWithResolver<typeof abortSymbol>();

    signal.addEventListener("abort", () => {
        abortPromise.resolve(abortSymbol);
    });

    try {
        while (!inbox.isDisposed && !signal.aborted) {
            const r = await inbox.pick(undefined, [abortPromise.promise] as Promise<typeof abortSymbol>[]);
            if (r === NOT_AVAILABLE) {
                break;
            }
            yield r;
        }
    } catch (ex) {
        if (ex instanceof Error && ex.name == "AbortError") {
            Logger(`Replication aborted`, LOG_LEVEL_VERBOSE);
        } else {
            throw ex;
        }
    } finally {
        s.cancel();
        inbox.dispose();
    }
}

export interface LiveSyncCouchDBReplicatorEnv extends LiveSyncReplicatorEnv {
    services: ServiceHub;
    // $$getSimpleStore<T>(kind: string): SimpleStore<T>;
}

export class LiveSyncCouchDBReplicator extends LiveSyncAbstractReplicator {
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

    env: LiveSyncCouchDBReplicatorEnv;
    isMobile() {
        return this.env.services.API.isMobile();
    }

    constructor(env: LiveSyncCouchDBReplicatorEnv) {
        super(env);
        this.env = env;
        // initialize local node information.
        void this.initializeDatabaseForReplication();
        this.env.getDatabase().on("close", () => {
            this.closeReplication();
        });
    }

    getInitialSyncParameters(setting: RemoteDBSettings): Promise<SyncParameters> {
        // TODO: Switch to select protocolVersion based on the setting.
        return Promise.resolve({
            ...DEFAULT_SYNC_PARAMETERS,
            protocolVersion: ProtocolVersions.ADVANCED_E2EE,
        } satisfies SyncParameters);
    }

    async getSyncParameters(setting: RemoteDBSettings): Promise<SyncParameters> {
        try {
            const downloadedSyncParams = await this.fetchRemoteDocument<SyncParameters>(setting, DOCID_SYNC_PARAMETERS);
            if (!downloadedSyncParams) {
                throw new SyncParamsNotFoundError(`Sync parameters not found on remote server`);
            }
            return downloadedSyncParams;
        } catch (ex) {
            Logger(`Could not retrieve remote sync parameters`, LOG_LEVEL_INFO);
            throw SyncParamsFetchError.fromError(ex);
        }
    }
    async putSyncParameters(setting: RemoteDBSettings, params: SyncParameters): Promise<boolean> {
        try {
            const ret = await this.putRemoteDocument<SyncParameters>(setting, params);
            if (ret.ok) {
                return true;
            } else {
                throw new SyncParamsUpdateError(`Could not store remote sync parameters: ${JSON.stringify(ret)}`);
            }
        } catch (ex) {
            Logger(`Could not store remote sync parameters`, LOG_LEVEL_INFO);
            throw SyncParamsUpdateError.fromError(ex);
        }
    }

    override async getReplicationPBKDF2Salt(
        setting: RemoteDBSettings,
        refresh?: boolean
    ): Promise<Uint8Array<ArrayBuffer>> {
        const server = `${setting.couchDB_URI}/${setting.couchDB_DBNAME}`;
        const manager = createSyncParamsHanderForServer(server, {
            put: (params: SyncParameters) => this.putSyncParameters(setting, params),
            get: () => this.getSyncParameters(setting),
            create: () => this.getInitialSyncParameters(setting),
        });
        return await manager.getPBKDF2Salt(refresh);
    }

    // eslint-disable-next-line require-await
    async migrate(from: number, to: number): Promise<boolean> {
        Logger(`Database updated from ${from} to ${to}`, LOG_LEVEL_NOTICE);
        // no op now,
        return Promise.resolve(true);
    }

    terminateSync() {
        if (!this.controller) {
            return;
        }
        this.controller.abort();
        this.controller = undefined;
    }

    async openReplication(
        setting: RemoteDBSettings,
        keepAlive: boolean,
        showResult: boolean,
        ignoreCleanLock: boolean
    ) {
        await this.initializeDatabaseForReplication();
        if (keepAlive) {
            void this.openContinuousReplication(setting, showResult, false);
        } else {
            return this.openOneShotReplication(setting, showResult, false, "sync", ignoreCleanLock);
        }
    }
    replicationActivated(showResult: boolean) {
        this.syncStatus = "CONNECTED";
        this.updateInfo();
        Logger("Replication activated", showResult ? LOG_LEVEL_NOTICE : LOG_LEVEL_INFO, "sync");
    }
    async replicationChangeDetected(
        e: PouchDB.Replication.SyncResult<EntryDoc>,
        showResult: boolean,
        docSentOnStart: number,
        docArrivedOnStart: number
    ) {
        try {
            if (e.direction == "pull") {
                await this.env.services.replication.parseSynchroniseResult(e.change.docs);
                this.docArrived += e.change.docs.length;
            } else {
                this.docSent += e.change.docs.length;
            }
            if (showResult) {
                const maxPullSeq = this.maxPullSeq;
                const maxPushSeq = this.maxPushSeq;
                const lastSyncPullSeq = this.lastSyncPullSeq;
                const lastSyncPushSeq = this.lastSyncPushSeq;
                const pushLast =
                    lastSyncPushSeq == 0
                        ? ""
                        : lastSyncPushSeq >= maxPushSeq
                          ? " (LIVE)"
                          : ` (${maxPushSeq - lastSyncPushSeq})`;
                const pullLast =
                    lastSyncPullSeq == 0
                        ? ""
                        : lastSyncPullSeq >= maxPullSeq
                          ? " (LIVE)"
                          : ` (${maxPullSeq - lastSyncPullSeq})`;
                Logger(
                    `↑${this.docSent - docSentOnStart}${pushLast} ↓${this.docArrived - docArrivedOnStart}${pullLast}`,
                    LOG_LEVEL_NOTICE,
                    "sync"
                );
            }
            this.updateInfo();
        } catch (ex) {
            Logger("Replication callback error", LOG_LEVEL_NOTICE, "sync");
            Logger(ex, LOG_LEVEL_VERBOSE);
            //
        }
    }
    replicationCompleted(showResult: boolean) {
        this.syncStatus = "COMPLETED";
        this.updateInfo();
        Logger("Replication completed", showResult ? LOG_LEVEL_NOTICE : LOG_LEVEL_INFO, showResult ? "sync" : "");
        this.terminateSync();
    }
    replicationDenied(e: any) {
        this.syncStatus = "ERRORED";
        this.updateInfo();
        this.terminateSync();
        Logger("Replication denied", LOG_LEVEL_NOTICE, "sync");
        Logger(e, LOG_LEVEL_VERBOSE);
    }
    replicationErrored(e: any) {
        this.syncStatus = "ERRORED";
        this.terminateSync();
        this.updateInfo();
        Logger("Replication error", LOG_LEVEL_NOTICE, "sync");
        Logger(e, LOG_LEVEL_VERBOSE);
    }
    replicationPaused() {
        this.syncStatus = "PAUSED";
        this.updateInfo();
        Logger("Replication paused", LOG_LEVEL_VERBOSE, "sync");
    }

    async processSync(
        syncHandler: PouchDB.Replication.Sync<EntryDoc> | PouchDB.Replication.Replication<EntryDoc>,
        showResult: boolean,
        docSentOnStart: number,
        docArrivedOnStart: number,
        syncMode: "sync" | "pullOnly" | "pushOnly",
        retrying: boolean,
        reportCancelledAsDone = true
    ): Promise<"DONE" | "NEED_RETRY" | "NEED_RESURRECT" | "FAILED" | "CANCELLED"> {
        const controller = new AbortController();
        if (this.controller) {
            this.controller.abort();
        }
        this.controller = controller;
        const gen = genReplication(syncHandler, controller.signal);
        try {
            for await (const [type, e] of gen) {
                // Pacing replication.
                const releaser = await globalConcurrencyController.tryAcquire(1, REPLICATION_BUSY_TIMEOUT);
                if (releaser === false) {
                    Logger("Replication stopped for busy.", showResult ? LOG_LEVEL_NOTICE : LOG_LEVEL_INFO, "sync");
                    return "FAILED";
                }
                releaser();
                switch (type) {
                    case "change":
                        if ("direction" in e) {
                            if (e.direction == "pull") {
                                this.lastSyncPullSeq = Number(`${e.change.last_seq}`.split("-")[0]);
                            } else {
                                this.lastSyncPushSeq = Number(`${e.change.last_seq}`.split("-")[0]);
                            }
                            await this.replicationChangeDetected(e, showResult, docSentOnStart, docArrivedOnStart);
                        } else {
                            if (syncMode == "pullOnly") {
                                this.lastSyncPullSeq = Number(`${e.last_seq}`.split("-")[0]);
                                await this.replicationChangeDetected(
                                    { direction: "pull", change: e },
                                    showResult,
                                    docSentOnStart,
                                    docArrivedOnStart
                                );
                            } else if (syncMode == "pushOnly") {
                                this.lastSyncPushSeq = Number(`${e.last_seq}`.split("-")[0]);
                                this.updateInfo();
                                await this.replicationChangeDetected(
                                    { direction: "push", change: e },
                                    showResult,
                                    docSentOnStart,
                                    docArrivedOnStart
                                );
                            }
                        }
                        if (retrying) {
                            if (
                                this.docSent - docSentOnStart + (this.docArrived - docArrivedOnStart) >
                                this.originalSetting.batch_size * 2
                            ) {
                                return "NEED_RESURRECT";
                            }
                        }
                        break;
                    case "complete":
                        this.replicationCompleted(showResult);
                        return "DONE";
                    case "active":
                        this.replicationActivated(showResult);
                        break;
                    case "denied":
                        this.replicationDenied(e);
                        return "FAILED";
                    case "error":
                        this.replicationErrored(e);
                        Logger("Replication stopped.", showResult ? LOG_LEVEL_NOTICE : LOG_LEVEL_INFO, "sync");
                        if (this.env.services.API.isLastPostFailedDueToPayloadSize()) {
                            if (e && e?.status == 413) {
                                Logger(
                                    `Something went wrong during synchronisation. Please check the log!`,
                                    LOG_LEVEL_NOTICE
                                );
                                return "FAILED";
                            }
                            return "NEED_RETRY";
                            // Duplicate settings for smaller batch.
                        } else {
                            Logger("Replication error", LOG_LEVEL_NOTICE, "sync");
                            Logger(e, LOG_LEVEL_VERBOSE);
                        }
                        return "FAILED";
                    case "paused":
                        this.replicationPaused();
                        break;
                    case "finally":
                        break;
                    default:
                        Logger(`Unexpected synchronization status:${JSON.stringify(e)}`);
                }
            }
            if (reportCancelledAsDone) {
                return "DONE";
            }
            return "CANCELLED";
        } catch (ex) {
            Logger(`Unexpected synchronization exception`);
            Logger(ex, LOG_LEVEL_VERBOSE);
            return "FAILED";
        } finally {
            this.terminateSync();
            this.controller = undefined;
        }
    }

    getEmptyMaxEntry(remoteID: number) {
        return {
            _id: `_local/max_seq_on_chunk-${remoteID}`,
            maxSeq: 0 as number | string,
            remoteID: remoteID,
            seqStatusMap: {} as Record<number, boolean>,
            _rev: undefined as string | undefined,
        };
    }

    async getLastTransferredSeqOfChunks(
        localDB: PouchDB.Database,
        remoteID: number
    ): Promise<ReturnType<typeof this.getEmptyMaxEntry>> {
        const prevMax = {
            _id: `_local/max_seq_on_chunk-${remoteID}`,
            maxSeq: 0 as number | string,
            remoteID: remoteID,
            seqStatusMap: {} as Record<number, boolean>,
            _rev: undefined as string | undefined,
        };
        const previous_max_seq_on_chunk = await wrapException(() => localDB.get<typeof prevMax>(prevMax._id));
        if (previous_max_seq_on_chunk instanceof Error) {
            return prevMax;
        }
        return previous_max_seq_on_chunk;
    }
    async updateMaxTransferredSeqOnChunks(
        localDB: PouchDB.Database,
        remoteID: number,
        seqStatusMap: Record<number, boolean>
    ): Promise<ReturnType<typeof this.getEmptyMaxEntry>> {
        const newMax = {
            _id: "_local/max_seq_on_chunk",
            maxSeq: 0,
            remoteID: remoteID,
            seqStatusMap: seqStatusMap,
            _rev: undefined as string | undefined,
        };
        const seqs = Object.keys(seqStatusMap).map((e) => Number(e));
        let maxSeq = 0;
        for (const seq of seqs) {
            if (!seqStatusMap[seq]) {
                break;
            }
            maxSeq = seq;
        }
        Logger(`Updating max seq on chunk to ${maxSeq}`, LOG_LEVEL_VERBOSE);
        newMax.maxSeq = maxSeq;
        const previous_max_seq_on_chunk = await wrapException(() => localDB.get<typeof newMax>(newMax._id));
        if (previous_max_seq_on_chunk instanceof Error) {
            delete newMax._rev;
        } else {
            newMax._rev = previous_max_seq_on_chunk._rev;
            newMax.seqStatusMap = { ...previous_max_seq_on_chunk.seqStatusMap, ...seqStatusMap };
        }
        await wrapException(() => localDB.put(newMax));
        return newMax;
    }

    // No longer used. Kept only for troubleshooting.
    async sendChunks(
        setting: RemoteDBSettings,
        remoteDB: PouchDB.Database<EntryDoc> | undefined,
        showResult: boolean,
        fromSeq?: number | string
    ) {
        const trench = new Trench(
            this.env.services.database.openSimpleStore<{
                seq: string | number;
                doc: PouchDB.Core.ExistingDocument<EntryDoc & PouchDB.Core.ChangesMeta> | undefined;
                id: DocumentID;
            }>("sc-"),
            false
        );
        await trench.eraseAllEphemerals();
        if (!remoteDB) {
            const d = await this.connectRemoteCouchDBWithSetting(setting, this.isMobile(), true);
            if (typeof d === "string") {
                Logger(
                    $msg("liveSyncReplicator.couldNotConnectToRemoteDb", { d }),
                    showResult ? LOG_LEVEL_NOTICE : LOG_LEVEL_INFO,
                    "fetch"
                );
                return false;
            }
            remoteDB = d.db;
        }
        // To create salt
        await this.checkReplicationConnectivity(setting, false, false, false, false);
        Logger(`Bulk sending chunks to remote database...`, showResult ? LOG_LEVEL_NOTICE : LOG_LEVEL_INFO, "fetch");
        const remoteMilestone = await remoteDB.get(MILESTONE_DOCID);
        const remoteID = (remoteMilestone as any)?.created;
        const localDB = this.env.getDatabase();
        const te = new TextEncoder();
        Logger(
            $msg("liveSyncReplicator.checkingLastSyncPoint"),
            showResult ? LOG_LEVEL_NOTICE : LOG_LEVEL_INFO,
            "fetch"
        );
        this.syncStatus = "CONNECTED";
        const limitOneBatch = 250;

        // 1. Collecting all chunks to send and store them into the trench with the sequence number.
        const prev = await this.getLastTransferredSeqOfChunks(localDB, remoteID);
        const seq = fromSeq ?? prev.maxSeq;
        const localScannedDocs = [] as { id: DocumentID; seq: number }[];
        // const docsToCheck = [] as typeof localScannedDocs;
        const sentMap = {} as Record<number, boolean>;
        const diffChunks = localDB
            .changes({
                since: seq as number,
                live: false,
                include_docs: true,
                return_docs: false,
                selector: { type: "leaf" },
                // limit: limitOneBatch,
            })
            .on("change", (e) => {
                const numSeq = Number(e.seq);
                if (prev.seqStatusMap[numSeq]) {
                    return;
                }
                localScannedDocs.push({ id: e.id as DocumentID, seq: Number(e.seq) });
            });
        await diffChunks;

        localScannedDocs.sort((a, b) => a.seq - b.seq);
        const idSeqMap = Object.fromEntries(localScannedDocs.map((e) => [e.id, e.seq]));
        for (const checkDocs of arrayToChunkedArray(localScannedDocs, limitOneBatch)) {
            const remoteDocs = await remoteDB.allDocs({ keys: checkDocs.map((e) => e.id), include_docs: false });
            const remoteDocMap = Object.fromEntries(
                remoteDocs.rows.map((e) => [e.key, "error" in e ? e.error : e.value])
            );
            const sendDocs = checkDocs.filter((e) => remoteDocMap[e.id] == "not_found");
            const sentDocs = checkDocs.filter((e) => remoteDocMap[e.id] != "not_found");
            sendDocs.forEach((e) => (sentMap[e.seq] = false));
            sentDocs.forEach((e) => (sentMap[e.seq] = true));
            const sendDocsMap = Object.fromEntries(sendDocs.map((e) => [e.id, e.seq]));
            if (sendDocs.length > 0) {
                const localDocs = await localDB.allDocs({ keys: sendDocs.map((e) => e.id), include_docs: true });
                await trench.queue(
                    "send-chunks",
                    localDocs.rows
                        .filter((e) => "id" in e)
                        .map((e) => ({ seq: sendDocsMap[e.id], doc: e.doc, id: e.id }))
                );
            }
        }

        // console.dir(sendAllDocs);
        let bulkDocs: EntryLeaf[] = [];
        let bulkDocsSizeBytes = 0;
        let bulkDocsSizeCount = 0;
        let maxSeq = 0 as number | string;
        const maxBatchSizeBytes = setting.sendChunksBulkMaxSize * 1024 * 1024;
        const maxBatchSizeCount = 200;

        const semaphore = Semaphore(4);
        let sendingDocs = 0;
        let sentDocsCount = 0;

        const sendChunks = async (bulkDocs: EntryLeaf[], bulkDocsSize: number, seq: number | string) => {
            Logger(
                `Sending ${bulkDocs.length} (${bulkDocsSize} => ${sizeToHumanReadable(bulkDocsSize)} in plain) chunks to remote database...`,
                LOG_LEVEL_VERBOSE
            );
            const releaser = await semaphore.acquire(1);
            sendingDocs += bulkDocs.length;
            Logger(
                `↑ Uploading chunks \n${sendingDocs}/(${sentDocsCount} done)`,
                showResult ? LOG_LEVEL_NOTICE : LOG_LEVEL_INFO,
                "send"
            );
            try {
                const uploadBulkDocTasks = bulkDocs.map((e) => preprocessOutgoing(e));
                const uploadBulkDocs = (await Promise.all(uploadBulkDocTasks)) as EntryLeaf[];
                await remoteDB.bulkDocs(uploadBulkDocs, { new_edits: false });
                uploadBulkDocs.forEach((e) => (sentMap[idSeqMap[e._id]] = true));
                await this.updateMaxTransferredSeqOnChunks(localDB, remoteID, sentMap);
                sentDocsCount += bulkDocs.length;
                Logger(
                    `↑ Uploading chunks \n${sendingDocs}/(${sentDocsCount} done)`,
                    showResult ? LOG_LEVEL_NOTICE : LOG_LEVEL_INFO,
                    "send"
                );
            } catch (ex) {
                Logger("Bulk sending failed.", showResult ? LOG_LEVEL_NOTICE : LOG_LEVEL_INFO, "send");
                Logger(ex, LOG_LEVEL_VERBOSE);
                return false;
            } finally {
                releaser();
            }
            return true;
        };

        const tasks = [] as Promise<any>[];
        do {
            const nowSendChunks = await trench.dequeue<
                {
                    seq: string | number;
                    doc: PouchDB.Core.ExistingDocument<EntryDoc & PouchDB.Core.ChangesMeta> | undefined;
                    id: DocumentID;
                }[]
            >("send-chunks");
            if (!nowSendChunks || nowSendChunks.length == 0) {
                break;
            }
            for (const chunk of nowSendChunks) {
                const jsonLength = te.encode(JSON.stringify(chunk.doc)).byteLength + 32; // (Not sure but means overhead);
                if (
                    (bulkDocsSizeBytes + jsonLength > maxBatchSizeBytes || bulkDocsSizeCount + 1 > maxBatchSizeCount) &&
                    bulkDocs.length > 0
                ) {
                    tasks.push(sendChunks([...bulkDocs], bulkDocsSizeBytes, maxSeq));
                    bulkDocs = [];
                    bulkDocsSizeBytes = 0;
                    bulkDocsSizeCount = 0;
                }
                bulkDocs.push(chunk.doc as EntryLeaf);
                maxSeq = chunk.seq;
                bulkDocsSizeBytes += jsonLength;
                bulkDocsSizeCount += 1;
            }
            if (bulkDocs.length > 0) {
                tasks.push(sendChunks([...bulkDocs], bulkDocsSizeBytes, maxSeq));
            }
            const results = await Promise.all(
                tasks.map(async (e) => {
                    try {
                        await e;
                    } catch (ex) {
                        Logger("Bulk sending failed.", showResult ? LOG_LEVEL_NOTICE : LOG_LEVEL_INFO, "send");
                        Logger(ex, LOG_LEVEL_VERBOSE);
                        return false;
                    }
                })
            );
            if (results.some((e) => e === false)) {
                return false;
            }
        } while (true);
        // Logger(`${sendAllDocs.length} chunks Uploaded`, showResult ? LOG_LEVEL_NOTICE : LOG_LEVEL_INFO, "send");
        return true;
    }

    async openOneShotReplication(
        setting: RemoteDBSettings,
        showResult: boolean,
        retrying: boolean,
        syncMode: "sync" | "pullOnly" | "pushOnly",
        ignoreCleanLock = false
    ): Promise<boolean> {
        if ((await this.ensurePBKDF2Salt(setting, showResult, !retrying)) === false) {
            return false;
        }
        const next = await shareRunningResult("oneShotReplication", async () => {
            if (this.controller) {
                Logger(
                    $msg("liveSyncReplicator.replicationInProgress"),
                    showResult ? LOG_LEVEL_NOTICE : LOG_LEVEL_INFO,
                    "sync"
                );
                return false;
            }
            const localDB = this.env.getDatabase();
            Logger($msg("liveSyncReplicator.oneShotSyncBegin", { syncMode }));
            const ret = await this.checkReplicationConnectivity(setting, false, retrying, showResult, ignoreCleanLock);
            if (ret === false) {
                Logger(
                    $msg("liveSyncReplicator.couldNotConnectToServer"),
                    showResult ? LOG_LEVEL_NOTICE : LOG_LEVEL_INFO,
                    "sync"
                );
                return false;
            }
            this.maxPullSeq = Number(`${ret.info.update_seq}`.split("-")[0]);
            this.maxPushSeq = Number(`${(await localDB.info()).update_seq}`.split("-")[0]);
            if (showResult) {
                Logger($msg("liveSyncReplicator.checkingLastSyncPoint"), LOG_LEVEL_NOTICE, "sync");
            }
            const { db, syncOptionBase } = ret;
            this.syncStatus = "STARTED";
            this.updateInfo();
            const docArrivedOnStart = this.docArrived;
            const docSentOnStart = this.docSent;
            if (!retrying) {
                // If initial replication, save setting to rollback
                this.originalSetting = setting;
            }
            this.terminateSync();
            const syncHandler: PouchDB.Replication.Sync<EntryDoc> | PouchDB.Replication.Replication<EntryDoc> =
                syncMode == "sync"
                    ? localDB.sync(db, { ...syncOptionBase })
                    : syncMode == "pullOnly"
                      ? localDB.replicate.from(db, {
                            ...syncOptionBase,
                            ...(setting.readChunksOnline ? selectorOnDemandPull : {}),
                        })
                      : syncMode == "pushOnly"
                        ? localDB.replicate.to(db, { ...syncOptionBase })
                        : (undefined as never);
            const syncResult = await this.processSync(
                syncHandler,
                showResult,
                docSentOnStart,
                docArrivedOnStart,
                syncMode,
                retrying,
                false
            );
            if (syncResult == "DONE") {
                return true;
            }
            if (syncResult == "CANCELLED") {
                return false;
            }
            if (syncResult == "FAILED") {
                return false;
            }
            if (syncResult == "NEED_RESURRECT") {
                this.terminateSync();
                return async () =>
                    await this.openOneShotReplication(
                        this.originalSetting,
                        showResult,
                        false,
                        syncMode,
                        ignoreCleanLock
                    );
            }
            if (syncResult == "NEED_RETRY") {
                const tempSetting: RemoteDBSettings = JSON.parse(JSON.stringify(setting));
                tempSetting.batch_size = Math.ceil(tempSetting.batch_size / 2) + 2;
                tempSetting.batches_limit = Math.ceil(tempSetting.batches_limit / 2) + 2;
                if (tempSetting.batch_size <= 5 && tempSetting.batches_limit <= 5) {
                    Logger(
                        $msg("liveSyncReplicator.cantReplicateLowerValue"),
                        showResult ? LOG_LEVEL_NOTICE : LOG_LEVEL_INFO
                    );
                    return false;
                } else {
                    Logger(
                        $msg("liveSyncReplicator.retryLowerBatchSize", {
                            batch_size: tempSetting.batch_size.toString(),
                            batches_limit: tempSetting.batches_limit.toString(),
                        }),
                        showResult ? LOG_LEVEL_NOTICE : LOG_LEVEL_INFO
                    );
                    return async () =>
                        await this.openOneShotReplication(tempSetting, showResult, true, syncMode, ignoreCleanLock);
                }
            }
            return false;
        });
        if (typeof next === "boolean") {
            return next;
        }
        return await next();
    }

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
    replicateAllToServer(setting: RemoteDBSettings, showingNotice?: boolean) {
        return this.openOneShotReplication(setting, showingNotice ?? false, false, "pushOnly");
    }

    replicateAllFromServer(setting: RemoteDBSettings, showingNotice?: boolean) {
        return this.openOneShotReplication(setting, showingNotice ?? false, false, "pullOnly");
    }

    async checkReplicationConnectivity(
        setting: RemoteDBSettings,
        keepAlive: boolean,
        skipCheck: boolean,
        showResult: boolean,
        ignoreCleanLock = false
    ) {
        if (setting.versionUpFlash != "") {
            Logger($msg("Replicator.Message.VersionUpFlash"), LOG_LEVEL_NOTICE);
            return false;
        }
        const uri = setting.couchDB_URI + (setting.couchDB_DBNAME == "" ? "" : "/" + setting.couchDB_DBNAME);
        if (this.controller) {
            Logger("Another replication running.");
            return false;
        }

        const dbRet = await this.connectRemoteCouchDBWithSetting(setting, this.isMobile(), true);
        if (typeof dbRet === "string") {
            Logger(
                $msg("liveSyncReplicator.couldNotConnectToURI", { uri, dbRet }),
                showResult ? LOG_LEVEL_NOTICE : LOG_LEVEL_INFO
            );
            return false;
        }
        if (!skipCheck) {
            if (!(await checkRemoteVersion(dbRet.db, this.migrate.bind(this), VER))) {
                Logger($msg("liveSyncReplicator.remoteDbCorrupted"), LOG_LEVEL_NOTICE);
                return false;
            }
            this.remoteCleaned = false;
            this.remoteLocked = false;
            this.remoteLockedAndDeviceNotAccepted = false;
            this.tweakSettingsMismatched = false;
            this.preferredTweakValue = undefined;
            const progress = `${dbRet.info.update_seq}`;
            const info = {
                app_version: this.env.services.API.getAppVersion(),
                plugin_version: this.env.services.API.getPluginVersion(),
                vault_name: this.env.services.vault.vaultName(),
                device_name: this.env.services.vault.getVaultName(),
                progress: progress,
            } satisfies DeviceInfo;

            const ensure = await ensureDatabaseIsCompatible(dbRet.db, setting, this.nodeid, currentVersionRange, info);
            if (ensure == "INCOMPATIBLE") {
                Logger(
                    "The remote database has no compatibility with the running version. Please upgrade the plugin.",
                    LOG_LEVEL_NOTICE
                );
                return false;
            } else if (ensure == "NODE_LOCKED") {
                Logger(
                    "The remote database has been rebuilt or corrupted since we have synchronized last time. Fetch rebuilt DB, explicit unlocking or chunk clean-up is required.",
                    LOG_LEVEL_NOTICE
                );
                this.remoteLockedAndDeviceNotAccepted = true;
                this.remoteLocked = true;
                return false;
            } else if (ensure == "LOCKED") {
                this.remoteLocked = true;
            } else if (ensure == "NODE_CLEANED") {
                if (ignoreCleanLock) {
                    this.remoteLocked = true;
                } else {
                    Logger(
                        "The remote database has been cleaned up. Fetch rebuilt DB, explicit unlocking or chunk clean-up is required.",
                        LOG_LEVEL_NOTICE
                    );
                    this.remoteLockedAndDeviceNotAccepted = true;
                    this.remoteLocked = true;
                    this.remoteCleaned = true;
                    return false;
                }
            } else if (ensure == "OK") {
                // NO OP: FOR NARROWING TYPE
            } else if (ensure[0] == "MISMATCHED") {
                Logger(
                    `Configuration mismatching between the clients has been detected. This can be harmful or extra capacity consumption. We have to make these value unified.`,
                    LOG_LEVEL_NOTICE
                );
                this.tweakSettingsMismatched = true;
                this.preferredTweakValue = ensure[1];
                return false;
            }
        }
        const syncOptionBase: PouchDB.Replication.SyncOptions = {
            batches_limit: setting.batches_limit,
            batch_size: setting.batch_size,
        };
        syncOptionBase.push = {};

        if (setting.readChunksOnline) {
            syncOptionBase.pull = { ...selectorOnDemandPull };
        }
        const syncOption: PouchDB.Replication.SyncOptions = keepAlive
            ? { live: true, retry: true, heartbeat: setting.useTimeouts ? false : 30000, ...syncOptionBase }
            : { ...syncOptionBase };
        return { db: dbRet.db, info: dbRet.info, syncOptionBase, syncOption };
    }

    async openContinuousReplication(
        setting: RemoteDBSettings,
        showResult: boolean,
        retrying: boolean
    ): Promise<boolean> {
        const next = await shareRunningResult("continuousReplication", async () => {
            if (this.controller) {
                Logger(
                    $msg("liveSyncReplicator.replicationInProgress"),
                    showResult ? LOG_LEVEL_NOTICE : LOG_LEVEL_INFO
                );
                return false;
            }
            const localDB = this.env.getDatabase();
            Logger($msg("liveSyncReplicator.beforeLiveSync"));
            if (await this.openOneShotReplication(setting, showResult, false, "pullOnly")) {
                Logger($msg("liveSyncReplicator.liveSyncBegin"));
                const ret = await this.checkReplicationConnectivity(setting, true, true, showResult);
                if (ret === false) {
                    Logger(
                        $msg("liveSyncReplicator.couldNotConnectToServer"),
                        showResult ? LOG_LEVEL_NOTICE : LOG_LEVEL_INFO
                    );
                    return false;
                }
                if (showResult) {
                    Logger($msg("liveSyncReplicator.checkingLastSyncPoint"), LOG_LEVEL_NOTICE, "sync");
                }
                const { db, syncOption } = ret;
                this.syncStatus = "STARTED";
                this.maxPullSeq = Number(`${ret.info.update_seq}`.split("-")[0]);
                this.maxPushSeq = Number(`${(await localDB.info()).update_seq}`.split("-")[0]);
                this.updateInfo();
                const docArrivedOnStart = this.docArrived;
                const docSentOnStart = this.docSent;
                if (!retrying) {
                    //TODO if successfully saved, roll back org setting.
                    this.originalSetting = setting;
                }
                this.terminateSync();
                const syncHandler = localDB.sync<EntryDoc>(db, {
                    ...syncOption,
                });
                const syncMode = "sync";
                const syncResult = await this.processSync(
                    syncHandler,
                    showResult,
                    docSentOnStart,
                    docArrivedOnStart,
                    syncMode,
                    retrying
                );

                if (syncResult == "DONE") {
                    return true;
                }
                if (syncResult == "FAILED") {
                    return false;
                }
                if (syncResult == "NEED_RESURRECT") {
                    this.terminateSync();
                    return async () => await this.openContinuousReplication(this.originalSetting, showResult, false);
                }
                if (syncResult == "NEED_RETRY") {
                    const tempSetting: RemoteDBSettings = JSON.parse(JSON.stringify(setting));
                    tempSetting.batch_size = Math.ceil(tempSetting.batch_size / 2) + 2;
                    tempSetting.batches_limit = Math.ceil(tempSetting.batches_limit / 2) + 2;
                    if (tempSetting.batch_size <= 5 && tempSetting.batches_limit <= 5) {
                        Logger(
                            $msg("liveSyncReplicator.cantReplicateLowerValue"),
                            showResult ? LOG_LEVEL_NOTICE : LOG_LEVEL_INFO
                        );
                        return false;
                    } else {
                        Logger(
                            $msg("liveSyncReplicator.retryLowerBatchSize", {
                                batch_size: tempSetting.batch_size.toString(),
                                batches_limit: tempSetting.batches_limit.toString(),
                            }),
                            showResult ? LOG_LEVEL_NOTICE : LOG_LEVEL_INFO
                        );
                        return async () => await this.openContinuousReplication(tempSetting, showResult, true);
                    }
                }
            }
            return false;
        });
        if (typeof next === "boolean") {
            return next;
        }
        return await next();
    }

    closeReplication() {
        if (!this.controller) {
            return;
        }
        this.controller.abort();
        this.controller = undefined;
        this.syncStatus = "CLOSED";
        Logger($msg("liveSyncReplicator.replicationClosed"));
        this.updateInfo();
    }

    async tryResetRemoteDatabase(setting: RemoteDBSettings) {
        this.closeReplication();
        const con = await this.connectRemoteCouchDBWithSetting(setting, this.isMobile(), true);
        if (typeof con == "string") return;
        try {
            await con.db.destroy();
            Logger($msg("liveSyncReplicator.remoteDbDestroyed"), LOG_LEVEL_NOTICE);
            await this.tryCreateRemoteDatabase(setting);
        } catch (ex) {
            Logger($msg("liveSyncReplicator.remoteDbDestroyError"), LOG_LEVEL_NOTICE);
            Logger(ex, LOG_LEVEL_NOTICE);
        }
        // Recreate salt
        clearHandlers();
        await this.ensurePBKDF2Salt(setting, true, false);
    }
    async tryCreateRemoteDatabase(setting: RemoteDBSettings) {
        this.closeReplication();
        const con2 = await this.connectRemoteCouchDBWithSetting(setting, this.isMobile(), true);

        if (typeof con2 === "string") return;
        // Recreate salt
        clearHandlers();
        await this.ensurePBKDF2Salt(setting, true, false);
        Logger($msg("liveSyncReplicator.remoteDbCreatedOrConnected"), LOG_LEVEL_NOTICE);
    }
    async markRemoteLocked(setting: RemoteDBSettings, locked: boolean, lockByClean: boolean) {
        const uri = setting.couchDB_URI + (setting.couchDB_DBNAME == "" ? "" : "/" + setting.couchDB_DBNAME);
        const dbRet = await this.connectRemoteCouchDBWithSetting(setting, this.isMobile(), true);
        if (typeof dbRet === "string") {
            Logger($msg("liveSyncReplicator.couldNotConnectToURI", { uri, dbRet }), LOG_LEVEL_NOTICE);
            return;
        }

        if (!(await checkRemoteVersion(dbRet.db, this.migrate.bind(this), VER))) {
            Logger($msg("liveSyncReplicator.remoteDbCorrupted"), LOG_LEVEL_NOTICE);
            return;
        }
        const defInitPoint: EntryMilestoneInfo = {
            _id: MILESTONE_DOCID,
            type: "milestoneinfo",
            created: (new Date() as any) / 1,
            locked: locked,
            cleaned: lockByClean,
            accepted_nodes: [this.nodeid],
            node_chunk_info: { [this.nodeid]: currentVersionRange },
            node_info: {},
            tweak_values: {},
        };

        const remoteMilestone: EntryMilestoneInfo = {
            ...defInitPoint,
            ...(await resolveWithIgnoreKnownError(dbRet.db.get(MILESTONE_DOCID), defInitPoint)),
        };
        remoteMilestone.node_chunk_info = { ...defInitPoint.node_chunk_info, ...remoteMilestone.node_chunk_info };
        remoteMilestone.accepted_nodes = [this.nodeid];
        remoteMilestone.locked = locked;
        remoteMilestone.cleaned = remoteMilestone.cleaned || lockByClean;
        if (locked) {
            Logger($msg("liveSyncReplicator.lockRemoteDb"), LOG_LEVEL_NOTICE);
        } else {
            Logger($msg("liveSyncReplicator.unlockRemoteDb"), LOG_LEVEL_NOTICE);
        }
        await dbRet.db.put(remoteMilestone);
    }
    async markRemoteResolved(setting: RemoteDBSettings) {
        const uri = setting.couchDB_URI + (setting.couchDB_DBNAME == "" ? "" : "/" + setting.couchDB_DBNAME);
        const dbRet = await this.connectRemoteCouchDBWithSetting(setting, this.isMobile(), true);
        if (typeof dbRet === "string") {
            Logger($msg("liveSyncReplicator.couldNotConnectToURI", { uri, dbRet }), LOG_LEVEL_NOTICE);
            return;
        }

        if (!(await checkRemoteVersion(dbRet.db, this.migrate.bind(this), VER))) {
            Logger($msg("liveSyncReplicator.remoteDbCorrupted"), LOG_LEVEL_NOTICE);
            return;
        }
        const defInitPoint: EntryMilestoneInfo = {
            _id: MILESTONE_DOCID,
            type: "milestoneinfo",
            created: (new Date() as any) / 1,
            locked: false,
            accepted_nodes: [this.nodeid],
            node_info: {},
            node_chunk_info: { [this.nodeid]: currentVersionRange },
            tweak_values: {},
        };
        // check local database hash status and remote replicate hash status
        const remoteMilestone: EntryMilestoneInfo = {
            ...defInitPoint,
            ...(await resolveWithIgnoreKnownError(dbRet.db.get(MILESTONE_DOCID), defInitPoint)),
        };
        remoteMilestone.node_chunk_info = { ...defInitPoint.node_chunk_info, ...remoteMilestone.node_chunk_info };
        remoteMilestone.accepted_nodes = Array.from(new Set([...remoteMilestone.accepted_nodes, this.nodeid]));
        Logger($msg("liveSyncReplicator.markDeviceResolved"), LOG_LEVEL_NOTICE);
        const result = await dbRet.db.put(remoteMilestone);
        if (result.ok) {
            Logger($msg("liveSyncReplicator.remoteDbMarkedResolved"), LOG_LEVEL_VERBOSE);
        } else {
            Logger($msg("liveSyncReplicator.couldNotMarkResolveRemoteDb"), LOG_LEVEL_NOTICE);
        }
    }

    connectRemoteCouchDBWithSetting(
        settings: RemoteDBSettings,
        isMobile: boolean,
        performSetup: boolean = false,
        skipInfo: boolean = false
    ) {
        if (settings.encrypt && settings.passphrase == "" && !settings.permitEmptyPassphrase) {
            return "Empty passphrases cannot be used without explicit permission";
        }
        const customHeaders = parseHeaderValues(settings.couchDB_CustomHeaders);
        const auth = (
            settings.useJWT
                ? {
                      jwtAlgorithm: settings.jwtAlgorithm,
                      jwtKey: settings.jwtKey,
                      jwtExpDuration: settings.jwtExpDuration,
                      jwtKid: settings.jwtKid,
                      jwtSub: settings.jwtSub,
                      type: "jwt",
                  }
                : {
                      username: settings.couchDB_USER,
                      password: settings.couchDB_PASSWORD,
                      type: "basic",
                  }
        ) satisfies CouchDBCredentials;
        return this.env.services.remote.connect(
            settings.couchDB_URI + (settings.couchDB_DBNAME == "" ? "" : "/" + settings.couchDB_DBNAME),
            auth,
            settings.disableRequestURI || isMobile,
            settings.encrypt ? settings.passphrase : settings.encrypt,
            settings.useDynamicIterationCount,
            performSetup,
            skipInfo,
            settings.enableCompression,
            customHeaders,
            settings.useRequestAPI,
            async () => await this.getReplicationPBKDF2Salt(settings)
        );
    }
    async _ensureConnection<T extends DatabaseEntry>(settings: RemoteDBSettings) {
        const ret = await this.connectRemoteCouchDBWithSetting(settings, this.isMobile(), false, true);
        if (typeof ret === "string") {
            throw new Error(`${$msg("liveSyncReplicator.couldNotConnectToServer")}:${ret}`);
        }
        return ret.db as unknown as PouchDB.Database<T>;
    }

    /**
     * Fetch a document from the remote database directly.
     * @param settings RemoteDBSettings for the connection.
     * @param id Document ID to fetch.
     * @param db Optional PouchDB instance to use. If provided, it will use this instance instead of creating a new connection (then settings will be ignored).
     * @returns The fetched document or false if the document does not exist.
     * @throws {Error} Other errors that may occur during the fetch operation.
     */
    async fetchRemoteDocument<T extends DatabaseEntry>(
        settings: RemoteDBSettings,
        id: string,
        db?: PouchDB.Database<T>
    ): Promise<T | false> {
        try {
            const connDB = db ?? (await this._ensureConnection(settings));
            return await connDB.get(id);
        } catch (ex: any) {
            if ("status" in ex && ex.status == 404) {
                return false;
            }
            throw ex;
        }
    }
    /**
     * Puts a document to the remote database directly
     * @param settings RemoteDBSettings for the connection.
     * @param doc Document to put.
     * @param db Optional PouchDB instance to use. If provided, it will use this instance instead of creating a new connection (then settings will be ignored).
     * @returns Response from the remote database or false if an error occurred.
     * @throws {Error} If the document could not be put.
     */
    async putRemoteDocument<T extends DatabaseEntry>(
        settings: RemoteDBSettings,
        doc: T,
        db?: PouchDB.Database<T>
    ): Promise<PouchDB.Core.Response> {
        const connDB = db ?? (await this._ensureConnection(settings));
        return await connDB.put(doc);
    }

    async fetchRemoteChunks(missingChunks: string[], showResult: boolean): Promise<false | EntryLeaf[]> {
        const ret = await this.connectRemoteCouchDBWithSetting(this.env.getSettings(), this.isMobile(), false, true);
        if (typeof ret === "string") {
            Logger(
                `${$msg("liveSyncReplicator.couldNotConnectToServer")} ${ret} `,
                showResult ? LOG_LEVEL_NOTICE : LOG_LEVEL_INFO,
                "fetch"
            );
            return false;
        }
        const remoteChunks = await ret.db.allDocs({ keys: missingChunks, include_docs: true });
        if (remoteChunks.rows.some((e: any) => "error" in e)) {
            Logger(
                `Some chunks are not exists both on remote and local database.`,
                showResult ? LOG_LEVEL_NOTICE : LOG_LEVEL_INFO,
                "fetch"
            );
            Logger(`Missing chunks: ${missingChunks.join(",")}`, LOG_LEVEL_VERBOSE);
            Logger(
                `Error chunks: ${remoteChunks.rows
                    .filter((e: any) => "error" in e)
                    .map((e: any) => e.key)
                    .join(",")}`,
                LOG_LEVEL_VERBOSE
            );
            return false;
        }

        const remoteChunkItems = remoteChunks.rows.map((e: any) => e.doc as EntryLeaf);
        return remoteChunkItems;
    }

    async tryConnectRemote(setting: RemoteDBSettings, showResult: boolean = true): Promise<boolean> {
        const db = await this.connectRemoteCouchDBWithSetting(setting, this.isMobile(), true);
        if (typeof db === "string") {
            Logger(
                $msg("liveSyncReplicator.couldNotConnectTo", {
                    uri: setting.couchDB_URI,
                    name: setting.couchDB_DBNAME,
                    db,
                }),
                LOG_LEVEL_NOTICE
            );
            return false;
        }
        Logger(`Connected to ${db.info.db_name} successfully`, LOG_LEVEL_NOTICE);
        return true;
    }

    async resetRemoteTweakSettings(setting: RemoteDBSettings): Promise<void> {
        const uri = setting.couchDB_URI + (setting.couchDB_DBNAME == "" ? "" : "/" + setting.couchDB_DBNAME);
        const dbRet = await this.connectRemoteCouchDBWithSetting(setting, this.isMobile(), true);
        if (typeof dbRet === "string") {
            Logger($msg("liveSyncReplicator.couldNotConnectToURI", { uri, dbRet }), LOG_LEVEL_NOTICE);
            return;
        }

        if (!(await checkRemoteVersion(dbRet.db, this.migrate.bind(this), VER))) {
            Logger($msg("liveSyncReplicator.remoteDbCorrupted"), LOG_LEVEL_NOTICE);
            return;
        }
        // check local database hash status and remote replicate hash status
        try {
            const remoteMilestone = (await dbRet.db.get(MILESTONE_DOCID)) as EntryMilestoneInfo;
            remoteMilestone.tweak_values = {};
            await dbRet.db.put(remoteMilestone);
            Logger(`tweak values on the remote database have been cleared`, LOG_LEVEL_VERBOSE);
        } catch (ex) {
            // While trying unlocking and not exist on the remote, it is not normal.
            Logger(`Could not retrieve remote milestone`, LOG_LEVEL_NOTICE);
            throw ex;
        }
    }

    async setPreferredRemoteTweakSettings(setting: RemoteDBSettings): Promise<void> {
        const uri = setting.couchDB_URI + (setting.couchDB_DBNAME == "" ? "" : "/" + setting.couchDB_DBNAME);
        const dbRet = await this.connectRemoteCouchDBWithSetting(setting, this.isMobile(), true);
        if (typeof dbRet === "string") {
            Logger($msg("liveSyncReplicator.couldNotConnectToURI", { uri, dbRet }), LOG_LEVEL_NOTICE);
            return;
        }

        if (!(await checkRemoteVersion(dbRet.db, this.migrate.bind(this), VER))) {
            Logger($msg("liveSyncReplicator.remoteDbCorrupted"), LOG_LEVEL_NOTICE);
            return;
        }
        // check local database hash status and remote replicate hash status
        try {
            const remoteMilestone = (await dbRet.db.get(MILESTONE_DOCID)) as EntryMilestoneInfo;
            remoteMilestone.tweak_values[DEVICE_ID_PREFERRED] = extractObject(TweakValuesTemplate, { ...setting });
            await dbRet.db.put(remoteMilestone);
            Logger(`Preferred tweak values has been registered`, LOG_LEVEL_VERBOSE);
        } catch (ex) {
            // While trying unlocking and not exist on the remote, it is not normal.
            Logger(`Could not retrieve remote milestone`, LOG_LEVEL_NOTICE);
            throw ex;
        }
    }

    async getRemotePreferredTweakValues(setting: RemoteDBSettings): Promise<TweakValues | false> {
        const uri = setting.couchDB_URI + (setting.couchDB_DBNAME == "" ? "" : "/" + setting.couchDB_DBNAME);
        const dbRet = await this.connectRemoteCouchDBWithSetting(setting, this.isMobile(), true);
        if (typeof dbRet === "string") {
            Logger($msg("liveSyncReplicator.couldNotConnectToURI", { uri, dbRet }), LOG_LEVEL_NOTICE);
            return false;
        }
        if (!(await checkRemoteVersion(dbRet.db, this.migrate.bind(this), VER))) {
            Logger($msg("liveSyncReplicator.remoteDbCorrupted"), LOG_LEVEL_NOTICE);
            return false;
        }
        // check local database hash status and remote replicate hash status
        try {
            const remoteMilestone = (await dbRet.db.get(MILESTONE_DOCID)) as EntryMilestoneInfo;
            if (!remoteMilestone) throw new Error("Remote milestone not found");
            return remoteMilestone?.tweak_values?.[DEVICE_ID_PREFERRED] || false;
        } catch (ex) {
            // While trying unlocking and not exist on the remote, it is not normal.
            Logger(`Could not retrieve remote milestone`, LOG_LEVEL_NOTICE);
            Logger(ex, LOG_LEVEL_VERBOSE);
            return false;
        }
    }

    async compactRemote(setting: RemoteDBSettings): Promise<boolean> {
        const uri = setting.couchDB_URI + (setting.couchDB_DBNAME == "" ? "" : "/" + setting.couchDB_DBNAME);
        const dbRet = await this.connectRemoteCouchDBWithSetting(setting, this.isMobile(), true);
        if (typeof dbRet === "string") {
            Logger($msg("liveSyncReplicator.couldNotConnectToURI", { uri, dbRet }), LOG_LEVEL_NOTICE);
            return false;
        }

        const ret = await dbRet.db.compact({ interval: 1000 });
        return ret.ok;
    }

    async getRemoteStatus(setting: RemoteDBSettings): Promise<RemoteDBStatus | false> {
        const dbRet = await this.connectRemoteCouchDBWithSetting(setting, this.isMobile(), true);
        if (typeof dbRet === "string") {
            const uri = setting.couchDB_URI + (setting.couchDB_DBNAME == "" ? "" : "/" + setting.couchDB_DBNAME);
            Logger($msg("liveSyncReplicator.couldNotConnectToURI", { uri, dbRet }), LOG_LEVEL_NOTICE);
            return false;
        }
        const info = await dbRet.db.info();
        return {
            ...info,
            estimatedSize: (info as any)?.sizes?.file || 0,
        };
    }

    async countCompromisedChunks(setting: RemoteDBSettings = this.env.getSettings()): Promise<number | boolean> {
        const dbRet = await this.connectRemoteCouchDBWithSetting(setting, this.isMobile(), true);
        if (typeof dbRet === "string") {
            const uri = setting.couchDB_URI + (setting.couchDB_DBNAME == "" ? "" : "/" + setting.couchDB_DBNAME);
            Logger($msg("liveSyncReplicator.couldNotConnectToURI", { uri, dbRet }), LOG_LEVEL_NOTICE);
            return false;
        }
        const compromised = await countCompromisedChunks(dbRet.db);
        return compromised;
    }

    async getConnectedDeviceList(
        setting: RemoteDBSettings = this.env.getSettings()
    ): Promise<false | { node_info: Record<string, NodeData>; accepted_nodes: string[] }> {
        const dbRet = await this.connectRemoteCouchDBWithSetting(setting, this.isMobile(), true);
        if (typeof dbRet === "string") {
            const uri = setting.couchDB_URI + (setting.couchDB_DBNAME == "" ? "" : "/" + setting.couchDB_DBNAME);
            Logger($msg("liveSyncReplicator.couldNotConnectToURI", { uri, dbRet }), LOG_LEVEL_NOTICE);
            return false;
        }
        const milestoneDoc = await dbRet.db.get(MILESTONE_DOCID);
        if (!milestoneDoc) {
            Logger("Could not retrieve remote milestone", LOG_LEVEL_NOTICE);
            return false;
        }
        const nodeInfo = (milestoneDoc as EntryMilestoneInfo).node_info;
        const acceptedNodes = (milestoneDoc as EntryMilestoneInfo).accepted_nodes || [];
        return { node_info: nodeInfo, accepted_nodes: acceptedNodes };
    }
}
