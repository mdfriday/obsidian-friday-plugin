/**
 * The API for manipulating files stored in the CouchDB by Self-hosted LiveSync or its families.
 */

import { addPrefix, id2path_base, path2id_base, stripAllPrefixes } from "../string_and_binary/path.ts";
import {
    type DocumentID,
    type FilePathWithPrefix,
    type EntryHasPath,
    type FilePath,
    type EntryDoc,
    type NewEntry,
    type PlainEntry,
    type LoadedEntry,
    DEFAULT_SETTINGS,
    type HashAlgorithm,
    type RemoteDBSettings,
    type ChunkSplitterVersion,
    type SyncParameters,
    DEFAULT_SYNC_PARAMETERS,
    ProtocolVersions,
    DOCID_SYNC_PARAMETERS,
    type E2EEAlgorithm,
    E2EEAlgorithms,
} from "../common/types.ts";

import { PouchDB } from "../pouchdb/pouchdb-http.ts";
import { LiveSyncLocalDB, type LiveSyncLocalDBEnv } from "../pouchdb/LiveSyncLocalDB.ts";
import { isErrorOfMissingDoc } from "../pouchdb/utils_couchdb.ts";
import { replicationFilter } from "../pouchdb/compress.ts";
import { disableEncryption } from "../pouchdb/encryption.ts";
import { enableEncryption } from "../pouchdb/encryption.ts";
import {
    LEVEL_INFO,
    LEVEL_VERBOSE,
    LOG_LEVEL_INFO,
    LOG_LEVEL_NOTICE,
    LOG_LEVEL_VERBOSE,
    Logger,
} from "octagonal-wheels/common/logger";
import { createBlob, determineTypeFromBlob } from "../common/utils.ts";
import { promiseWithResolvers } from "octagonal-wheels/promises";
import {
    createSyncParamsHanderForServer,
    SyncParamsFetchError,
    SyncParamsNotFoundError,
    SyncParamsUpdateError,
} from "../replication/SyncParamsHandler.ts";
import { LiveSyncManagers } from "../managers/LiveSyncManagers.ts";
import { InjectableServiceHub } from "../services/InjectableServices.ts";
import { ConfigServiceBrowserCompat, UIServiceStub } from "../services/Services.ts";
export type DirectFileManipulatorOptions = {
    url: string;
    username: string;
    password: string;
    passphrase: string | undefined;
    database: string;
    obfuscatePassphrase: string | undefined;
    useDynamicIterationCount?: boolean;
    customChunkSize?: number;
    minimumChunkSize?: number;
    hashAlg?: HashAlgorithm;
    useEden?: boolean;
    maxChunksInEden?: number;
    maxTotalLengthInEden?: number;
    maxAgeInEden?: number;
    /**
     * @deprecated use chunkSplitterVersion instead.
     */
    enableChunkSplitterV2?: boolean;
    enableCompression?: boolean;
    handleFilenameCaseSensitive?: boolean;
    doNotUseFixedRevisionForChunks?: boolean;
    chunkSplitterVersion?: ChunkSplitterVersion;
    E2EEAlgorithm?: E2EEAlgorithm;
};

export type ReadyEntry = (NewEntry | PlainEntry) & { data: string[] };
export type MetaEntry = (NewEntry | PlainEntry) & { children: string[] };

function isNoteEntry(doc: EntryDoc | false): doc is NewEntry | PlainEntry {
    if (!doc) return false;
    return doc.type == "newnote" || doc.type == "plain";
}
function isReadyEntry(doc: EntryDoc | false): doc is ReadyEntry {
    if (!doc) return false;
    return "data" in doc;
}
// function isMetaEntry(doc: EntryDoc | false): doc is MetaEntry {
//     if (!doc) return false;
//     return "children" in doc;
// }

export type FileInfo = {
    ctime: number;
    mtime: number;
    size: number;
};

export type EnumerateConditions = {
    startKey?: string;
    endKey?: string;
    ids?: string[];
    metaOnly: boolean;
};
export class DirectFileManipulator implements LiveSyncLocalDBEnv {
    liveSyncLocalDB: LiveSyncLocalDB;
    managers: LiveSyncManagers;

    options: DirectFileManipulatorOptions;
    ready = promiseWithResolvers<void>();
    services = new InjectableServiceHub({
        ui: new UIServiceStub(),
        config: new ConfigServiceBrowserCompat(),
    });
    constructor(options: DirectFileManipulatorOptions) {
        this.options = options;
        const getDB = () => this.liveSyncLocalDB.localDatabase;
        const getSettings = () => this.settings;
        this.managers = new LiveSyncManagers({
            get database() {
                return getDB();
            },
            getActiveReplicator: () =>
                // Note: this function will throw an error due to lacking that in this implementation.
                this.services.replicator.getActiveReplicator()!,
            id2path: this.$$id2path.bind(this),
            path2id: this.$$path2id.bind(this),
            get settings() {
                return getSettings();
            },
        });
        this.services.path.handleId2Path(this.$$id2path.bind(this));
        this.services.path.handlePath2Id(this.$$path2id.bind(this));
        this.services.database.handleCreatePouchDBInstance(this.$$createPouchDBInstance.bind(this));
        this.services.databaseEvents.handleOnDatabaseInitialisation(this.$everyOnInitializeDatabase.bind(this));
        this.liveSyncLocalDB = new LiveSyncLocalDB(this.options.url, this);
        void this.liveSyncLocalDB.initializeDatabase().then(() => {
            this.ready.resolve();
            this.liveSyncLocalDB.refreshSettings();
        });
    }

    $$id2path(id: DocumentID, entry?: EntryHasPath, stripPrefix?: boolean): FilePathWithPrefix {
        const path = id2path_base(id, entry);
        if (stripPrefix) {
            return stripAllPrefixes(path);
        }
        return path;
    }
    async $$path2id(filename: FilePathWithPrefix | FilePath, prefix?: string): Promise<DocumentID> {
        const fileName = prefix ? addPrefix(filename, prefix) : filename;
        const id = await path2id_base(
            fileName,
            this.options.obfuscatePassphrase ?? false,
            !this.options.handleFilenameCaseSensitive
        );
        return id;
    }
    $$createPouchDBInstance<T extends object>(
        _name?: string,
        _options?: PouchDB.Configuration.DatabaseConfiguration
    ): PouchDB.Database<T> {
        return new PouchDB(this.options.url + "/" + this.options.database, {
            auth: { username: this.options.username, password: this.options.password },
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
            const downloadedSyncParams = await this.rawGet<SyncParameters>(DOCID_SYNC_PARAMETERS);
            if (!downloadedSyncParams) {
                throw new SyncParamsNotFoundError(`Sync parameters have not been found in the database.`);
            }
            return downloadedSyncParams;
        } catch (ex) {
            Logger(`Could not retrieve remote sync parameters`, LOG_LEVEL_INFO);
            throw SyncParamsFetchError.fromError(ex);
        }
    }
    async putSyncParameters(setting: RemoteDBSettings, params: SyncParameters): Promise<boolean> {
        try {
            const ret = await this.liveSyncLocalDB.putRaw(params as unknown as EntryDoc);
            if (ret.ok) {
                return true;
            }
            throw new SyncParamsUpdateError(`Could not store remote sync parameters`);
        } catch (ex) {
            Logger(`Could not store remote sync parameters`, LOG_LEVEL_INFO);
            throw SyncParamsUpdateError.fromError(ex);
        }
    }
    async getReplicationPBKDF2Salt(setting: RemoteDBSettings, refresh?: boolean): Promise<Uint8Array<ArrayBuffer>> {
        const server = `${setting.couchDB_URI}/${setting.couchDB_DBNAME}`;
        const manager = createSyncParamsHanderForServer(server, {
            put: (params: SyncParameters) => this.putSyncParameters(setting, params),
            get: () => this.getSyncParameters(setting),
            create: () => this.getInitialSyncParameters(setting),
        });
        return await manager.getPBKDF2Salt(refresh);
    }
    $everyOnInitializeDatabase(db: LiveSyncLocalDB): Promise<boolean> {
        replicationFilter(db.localDatabase, this.options.enableCompression ?? false);
        disableEncryption();
        if (this.options.passphrase && typeof this.options.passphrase === "string") {
            enableEncryption(
                db.localDatabase,
                this.options.passphrase,
                this.options.useDynamicIterationCount ?? false,
                false,
                async () => await this.getReplicationPBKDF2Salt(this.getSettings()),
                this.options.E2EEAlgorithm ?? E2EEAlgorithms.V2
            );
        }
        return Promise.resolve(true);
    }

    getSettings(): RemoteDBSettings {
        return this.settings;
    }
    async close() {
        await this.liveSyncLocalDB.close();
        return this.liveSyncLocalDB.onunload();
    }
    async path2id(filename: FilePathWithPrefix | FilePath, prefix?: string): Promise<DocumentID> {
        const fileName = prefix ? addPrefix(filename, prefix) : filename;
        const id = await path2id_base(
            fileName,
            this.options.obfuscatePassphrase ?? false,
            !this.options.handleFilenameCaseSensitive
        );
        return id;
    }

    get settings() {
        const retObj: RemoteDBSettings = {
            ...DEFAULT_SETTINGS,
            ...{
                minimumChunkSize: this.options.minimumChunkSize ?? DEFAULT_SETTINGS.minimumChunkSize,
                encrypt: this.options.passphrase ? true : false,
                passphrase: this.options.passphrase ?? "",
                deleteMetadataOfDeletedFiles: DEFAULT_SETTINGS.deleteMetadataOfDeletedFiles,
                customChunkSize: this.options.customChunkSize ?? DEFAULT_SETTINGS.customChunkSize,
                doNotPaceReplication: DEFAULT_SETTINGS.doNotPaceReplication,
                hashAlg: this.options.hashAlg ?? DEFAULT_SETTINGS.hashAlg,
                useEden: this.options.useEden ?? DEFAULT_SETTINGS.useEden,
                maxChunksInEden: this.options.maxChunksInEden ?? DEFAULT_SETTINGS.maxChunksInEden,
                maxTotalLengthInEden: this.options.maxTotalLengthInEden ?? DEFAULT_SETTINGS.maxTotalLengthInEden,
                maxAgeInEden: this.options.maxAgeInEden ?? DEFAULT_SETTINGS.maxAgeInEden,
                enableChunkSplitterV2: this.options.enableChunkSplitterV2 ?? DEFAULT_SETTINGS.enableChunkSplitterV2,
                chunkSplitterVersion: this.options.chunkSplitterVersion ?? DEFAULT_SETTINGS.chunkSplitterVersion,
                disableWorkerForGeneratingChunks: true,
                processSmallFilesInUIThread: true,
                doNotUseFixedRevisionForChunks:
                    this.options.doNotUseFixedRevisionForChunks ?? DEFAULT_SETTINGS.doNotUseFixedRevisionForChunks,
                couchDB_URI: this.options.url,
                couchDB_DBNAME: this.options.database,
                couchDB_USER: this.options.username,
                couchDB_PASSWORD: this.options.password,
                accessKey: "",
                secretKey: "",
                bucket: "",
                region: "",
                endpoint: "",
                enableCompression: this.options.enableCompression ?? DEFAULT_SETTINGS.enableCompression,
                handleFilenameCaseSensitive:
                    this.options.handleFilenameCaseSensitive ?? DEFAULT_SETTINGS.handleFilenameCaseSensitive,
                E2EEAlgorithm: this.options.E2EEAlgorithm ?? E2EEAlgorithms.V2,
            },
        };
        return retObj;
    }

    /**
     * Get specific document from the Remote Database by path.
     * @param path
     * @param metaOnly if it has been enabled, the note does not contains the content.
     * @returns
     */
    async get(path: FilePathWithPrefix, metaOnly = false) {
        if (metaOnly) {
            return await this.liveSyncLocalDB.getDBEntryMeta(path);
        } else {
            return await this.liveSyncLocalDB.getDBEntry(path);
        }
    }

    /**
     * Get specific document from the Remote Database by ID.
     * @param path
     * @param metaOnly if it has been enabled, the note does not contains the content.
     * @returns
     */
    async getById(id: string, metaOnly = false): Promise<false | MetaEntry | ReadyEntry> {
        // TODO: TREAT FOR CONFLICTED FILES or OLD REVISIONS.
        // Logger(`GET: START: ${id}`, LOG_LEVEL_VERBOSE)
        const meta = await this.liveSyncLocalDB.getRaw(id as DocumentID);
        if (!isNoteEntry(meta)) return false;
        if (metaOnly) {
            // Logger(`GET: DONE (METAONLY): ${id}`, LOG_LEVEL_INFO)
            return meta;
        }
        return this.getByMeta(meta);
    }
    async getByMeta(doc: MetaEntry): Promise<ReadyEntry> {
        const docX = await this.liveSyncLocalDB.getDBEntryFromMeta(doc as LoadedEntry);
        if (!isReadyEntry(docX)) {
            throw new Error(`Corrupted document: ${doc.path}`);
        }
        return docX;
    }

    async rawGet<T>(id: DocumentID): Promise<false | T> {
        try {
            const doc = await this.liveSyncLocalDB.getRaw(id);
            return doc as T;
        } catch (ex) {
            if (isErrorOfMissingDoc(ex)) {
                return false;
            }
            throw ex;
        }
    }

    /**
     * Put a note to the remote database
     * @param path
     * @param data
     * @param info
     * @param type
     * @returns
     */
    async put(path: string, data: string[] | Blob, info: FileInfo, _type: "newnote" | "plain" = "plain") {
        const id = await this.path2id(path as FilePathWithPrefix);
        const saveData = data instanceof Blob ? data : createBlob(data);
        const datatype = determineTypeFromBlob(saveData);
        const putDoc = {
            _id: id,
            path: path as FilePathWithPrefix,
            data: saveData,
            ctime: info.ctime,
            mtime: info.mtime,
            size: info.size,
            type: datatype,
            eden: {},
            children: [] as string[],
            datatype: datatype,
        };
        Logger(`PUT: UPLOADING: ${path}`, LOG_LEVEL_VERBOSE);
        const ret = await this.liveSyncLocalDB.putDBEntry(putDoc);
        if (ret) {
            Logger(`PUT: DONE: ${path}`, LOG_LEVEL_INFO);
            return true;
        } else {
            Logger(`PUT: FAILED: ${path}`, LOG_LEVEL_NOTICE);
            return false;
        }
    }

    async delete(path: string) {
        Logger(`DELETE: START: ${path}`, LOG_LEVEL_VERBOSE);
        const ret = await this.liveSyncLocalDB.deleteDBEntry(path as FilePathWithPrefix);
        if (ret) {
            Logger(`DELETE: DONE: ${path}`, LOG_LEVEL_INFO);
            return true;
        } else {
            Logger(`DELETE: FAILED: ${path}`, LOG_LEVEL_INFO);
            return false;
        }
    }
    // Untested
    async *enumerate(_cond: EnumerateConditions) {
        //TODO
        // const param = {} as Record<string, string>;
        // if (cond.startKey) param.startkey = cond.startKey;
        // if (cond.endKey) param.endkey = cond.endKey;
        // if (cond.ids) param.keys = JSON.stringify(cond.ids);
        // let key = cond.startKey;
        // do {
        //     const result = await this._fetchJson(["_all_docs"], {}, "get", { ...param, include_docs: true, startkey: key, limit: 100 });
        //     if (!result.rows || result.rows.length == 0) {
        //         break;
        //     }
        //     //there are some result
        //     for (const v of result.rows) {
        //         const doc = v.doc;
        //         if (cond.metaOnly) {
        //             yield await doc;
        //         } else {
        //             yield await this.getByMeta(doc);
        //         }
        //         key = doc._id + "\u{10ffff}"
        //     }
        // } while (true);
        // return;
    }
    async *_enumerate(startKey: string, endKey: string, opt: { metaOnly: boolean }) {
        if (opt.metaOnly) return this.liveSyncLocalDB.findEntries(startKey, endKey, {});
        for await (const f of this.liveSyncLocalDB.findEntries(startKey, endKey, {})) {
            yield await this.getByMeta(f);
        }
    }
    async *enumerateAllNormalDocs(opt: { metaOnly: boolean }) {
        // const opt = {};
        const targets = [
            this._enumerate("", "h:", opt),
            this._enumerate(`h:\u{10ffff}`, "i:", opt),
            this._enumerate(`i:\u{10ffff}`, "ix:", opt),
            this._enumerate(`ix:\u{10ffff}`, "ps:", opt),
            this._enumerate(`ps:\u{10ffff}`, "\u{10ffff}", opt),
        ];
        for (const target of targets) {
            for await (const f of target) {
                yield f;
            }
        }
    }

    watching = false;
    // _abortController?: AbortController;
    changes: PouchDB.Core.Changes<EntryDoc> | undefined;
    since = "";

    beginWatch(
        callback: (doc: ReadyEntry, seq?: string | number) => Promise<any> | void,
        checkIsInterested?: (doc: MetaEntry) => boolean
    ) {
        if (this.watching) return false;
        this.watching = true;
        this.changes = this.liveSyncLocalDB.localDatabase
            .changes({
                include_docs: true,
                since: this.since,
                selector: {
                    type: { $ne: "leaf" },
                },
                live: true,
            })
            .on("change", async (change: any) => {
                const doc = change.doc;
                if (!doc) {
                    return;
                }
                if (!isNoteEntry(doc)) {
                    return;
                }
                if (checkIsInterested) {
                    if (!checkIsInterested(doc)) {
                        Logger(`WATCH: SKIP ${doc.path}: OUT OF TARGET FOLDER`, LOG_LEVEL_VERBOSE, "watch");
                        return;
                    }
                }
                Logger(`WATCH: PROCESSING: ${doc.path}`, LEVEL_VERBOSE, "watch");
                const docX = await this.getByMeta(doc);
                try {
                    await callback(docX, change.seq);
                    Logger(`WATCH: PROCESS DONE: ${doc.path}`, LEVEL_INFO, "watch");
                } catch (ex) {
                    Logger(`WATCH: PROCESS FAILED`, LEVEL_INFO, "watch");
                    Logger(ex, LEVEL_VERBOSE, "watch");
                }
            })
            .on("complete", () => {
                Logger(`WATCH: FINISHED`, LEVEL_INFO, "watch");
                this.watching = false;
                this.changes = undefined;
            })
            .on("error", (err: Error) => {
                Logger(`WATCH: ERROR: `, LEVEL_INFO, "watch");
                Logger(err, LEVEL_VERBOSE, "watch");
                if (this.watching) {
                    Logger(`WATCH: CONNECTION HAS BEEN CLOSED, RECONNECTING...`, LEVEL_INFO, "watch");
                    this.watching = false;
                    this.changes = undefined;
                    setTimeout(() => {
                        this.beginWatch(callback, checkIsInterested);
                    }, 10000);
                } else {
                    Logger(`WATCH: CONNECTION HAS BEEN CLOSED.`, LEVEL_INFO, "watch");
                }
            });
    }
    endWatch() {
        if (this.changes) {
            Logger(`WATCH: CANCELLING PROCESS.`, LEVEL_INFO, "watch");
            this.changes.cancel();
            Logger(`WATCH: CANCELLING SIGNAL HAS BEEN SENT.`, LEVEL_INFO, "watch");
        }
    }
    async followUpdates(
        callback: (doc: ReadyEntry, seq?: string | number) => Promise<any> | void,
        checkIsInterested?: (doc: MetaEntry) => boolean
    ) {
        try {
            if (this.since == "") {
                this.since = "0";
            }
            Logger(`FOLLOW: START: (since:${this.since})`, LEVEL_INFO, "followUpdates");
            const last = await this.liveSyncLocalDB.localDatabase
                .changes({
                    include_docs: true,
                    since: this.since,
                    filter: "replicate/pull",
                    live: false,
                })
                .on("change", async (change) => {
                    const doc = change.doc;
                    if (!doc) {
                        return;
                    }
                    if (!isNoteEntry(doc)) {
                        return;
                    }
                    if (checkIsInterested) {
                        if (!checkIsInterested(doc)) {
                            Logger(`FOLLOW: SKIP ${doc._id}: OUT OF TARGET FOLDER`, LOG_LEVEL_VERBOSE, "watch");
                            return;
                        }
                    }
                    Logger(`FOLLOW: PROCESSING: ${doc.path}`, LEVEL_VERBOSE, "watch");
                    const docX = await this.getByMeta(doc);
                    try {
                        await callback(docX, change.seq);
                        Logger(`FOLLOW: PROCESS DONE: ${doc.path}`, LEVEL_INFO, "watch");
                    } catch (ex) {
                        Logger(`FOLLOW: PROCESS FAILED`, LEVEL_INFO, "watch");
                        Logger(ex, LEVEL_VERBOSE, "watch");
                    }
                })
                .on("complete", () => {
                    Logger(`FOLLOW: FINISHED AT ${this.since}`, LEVEL_INFO, "watch");
                    this.watching = false;
                    this.changes = undefined;
                })
                .on("error", (err) => {
                    Logger(`FOLLOW: ERROR at ${this.since}: ${err}`, LEVEL_INFO, "watch");
                });
            return last.last_seq;
        } catch (e) {
            Logger(`FOLLOW: ERROR: ${e}`, LEVEL_INFO, "watch");
        }
        return this.since;
    }
}
