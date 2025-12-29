import {
    type EntryDoc,
    type EntryLeaf,
    type Credential,
    VERSIONING_DOCID,
    type RemoteDBSettings,
    type DocumentID,
    type FilePathWithPrefix,
    type FilePath,
    type DatabaseEntry,
    LOG_LEVEL_NOTICE,
    LOG_LEVEL_VERBOSE,
    type LoadedEntry,
    type MetaEntry,
    type SavingEntry,
    type diff_result_leaf,
    SuffixDatabaseName,
} from "../common/types.ts";
import { Logger } from "../common/logger.ts";
import { isErrorOfMissingDoc } from "./utils_couchdb.ts";

import { EVENT_CHUNK_FETCHED } from "../managers/ChunkManager.ts";
import { eventHub } from "../hub/hub.ts";
import { FallbackWeakRef } from "octagonal-wheels/common/polyfill";
import type { LiveSyncManagers } from "../managers/LiveSyncManagers.ts";
import type { AutoMergeResult } from "../managers/ConflictManager.ts";
import type { ServiceHub } from "../services/ServiceHub.ts";

export const REMOTE_CHUNK_FETCHED = "remote-chunk-fetched";
export type REMOTE_CHUNK_FETCHED = typeof REMOTE_CHUNK_FETCHED;
declare global {
    interface LSEvents {
        [REMOTE_CHUNK_FETCHED]: EntryLeaf;
    }
}

export type ChunkRetrievalResultSuccess = { _id: DocumentID; data: string; type: "leaf" };
export type ChunkRetrievalResultError = { _id: DocumentID; error: string };
export type ChunkRetrievalResult = ChunkRetrievalResultSuccess | ChunkRetrievalResultError;
export interface LiveSyncLocalDBEnv {
    // $$id2path(id: DocumentID, entry: EntryHasPath, stripPrefix?: boolean): FilePathWithPrefix;
    // $$path2id(filename: FilePathWithPrefix | FilePath, prefix?: string): Promise<DocumentID>;
    // $$createPouchDBInstance<T extends object>(
    //     name?: string,
    //     options?: PouchDB.Configuration.DatabaseConfiguration
    // ): PouchDB.Database<T>;

    // $allOnDBUnload(db: LiveSyncLocalDB): void;
    // $allOnDBClose(db: LiveSyncLocalDB): void;
    // $everyOnInitializeDatabase(db: LiveSyncLocalDB): Promise<boolean>;
    // $everyOnResetDatabase(db: LiveSyncLocalDB): Promise<boolean>;
    // $$getReplicator: () => LiveSyncAbstractReplicator;
    getSettings(): RemoteDBSettings;
    managers: LiveSyncManagers;
    services: ServiceHub;
}

export function getNoFromRev(rev: string) {
    if (!rev) return 0;
    return parseInt(rev.split("-")[0]);
}

export type GeneratedChunk = {
    isNew: boolean;
    id: DocumentID;
    piece: string;
};

export class LiveSyncLocalDB {
    auth: Credential;
    dbname: string;
    settings!: RemoteDBSettings;
    localDatabase!: PouchDB.Database<EntryDoc>;
    get managers() {
        return this.env.managers;
    }

    isReady = false;

    needScanning = false;

    env: LiveSyncLocalDBEnv;

    clearCaches() {
        this.managers.clearCaches();
    }

    async _prepareHashFunctions() {
        await this.managers?.prepareHashFunction();
    }

    onunload() {
        //this.kvDB.close();
        void this.env.services.databaseEvents.onUnloadDatabase(this);
        this.localDatabase.removeAllListeners();
    }

    refreshSettings() {
        const settings = this.env.getSettings();
        this.settings = settings;
        void this._prepareHashFunctions();
    }

    offRemoteChunkFetchedHandler?: ReturnType<typeof eventHub.onEvent>;
    constructor(dbname: string, env: LiveSyncLocalDBEnv) {
        this.auth = {
            username: "",
            password: "",
        };
        this.dbname = dbname;
        this.env = env;
        this.refreshSettings();
    }

    async close() {
        Logger("Database closed (by close)");
        this.isReady = false;
        this.offRemoteChunkFetchedHandler?.();
        if (this.localDatabase != null) {
            await this.localDatabase.close();
        }
        await this.env.services.databaseEvents.onUnloadDatabase(this);
    }

    onNewLeaf(chunk: EntryLeaf) {
        this.managers.chunkManager?.emitEvent(EVENT_CHUNK_FETCHED, chunk);
    }

    async initializeDatabase(): Promise<boolean> {
        await this._prepareHashFunctions();
        if (this.localDatabase != null) await this.localDatabase.close();
        //@ts-ignore
        this.localDatabase = null;

        this.localDatabase = this.env.services.database.createPouchDBInstance<EntryDoc>(
            this.dbname + SuffixDatabaseName,
            {
                auto_compaction: false,
                revs_limit: 100,
                deterministic_revs: true,
            }
        );
        if (!(await this.env.services.databaseEvents.onDatabaseInitialisation(this))) {
            Logger("Initializing Database has been failed on some module", LOG_LEVEL_NOTICE);
            // TODO ask for continue or disable all.
            // return false;
        }
        Logger("Opening Database...");
        Logger("Database info", LOG_LEVEL_VERBOSE);
        Logger(await this.localDatabase.info(), LOG_LEVEL_VERBOSE);
        await this.managers.initManagers();
        this.localDatabase.on("close", () => {
            Logger("Database closed.");
            this.isReady = false;
            this.localDatabase.removeAllListeners();
            this.env.services.replicator.getActiveReplicator()?.closeReplication();
            void this.managers.teardownManagers();
        });
        const _instance = new FallbackWeakRef(this);
        const unload = eventHub.onEvent(REMOTE_CHUNK_FETCHED, (chunk: EntryLeaf) => {
            if (_instance.deref() == null) {
                unload();
            }
            _instance.deref()?.onNewLeaf(chunk);
        });
        this.offRemoteChunkFetchedHandler = unload;
        this.isReady = true;
        Logger("Database is now ready.");
        return true;
    }

    /**
     * Retrieve all used and existing chunks in the database.
     * @param includeDeleted  include deleted chunks in the result.
     * @returns {used: Set<string>, existing: Map<string, EntryLeaf>} used: Set of chunk ids that are used in the database. existing: Map of chunk id and EntryLeaf that are existing in the database.
     */
    async allChunks(includeDeleted = false): Promise<{
        used: Set<string>;
        existing: Map<string, EntryLeaf>;
    }> {
        const used = new Set<string>();
        const existing = new Map<string, EntryLeaf>();
        let since = 0 as string | number;
        do {
            const changes = await this.localDatabase.changes({
                since: since,
                limit: 100,
                include_docs: true,
                conflicts: true,
                style: includeDeleted ? "all_docs" : "main_only",
            });
            if (changes.results.length == 0) {
                break;
            }
            for (const change of changes.results) {
                // console.log(`${change.seq}: ${change.id} ${change.deleted ? "deleted" : ""}`);
                const doc = change.doc as EntryDoc | EntryLeaf;
                if (doc.type == "leaf") {
                    if (doc._deleted) {
                        if (!includeDeleted) {
                            continue;
                        }
                    }
                    existing.set(doc._id, doc);
                }
                if ("children" in doc) {
                    if (change.deleted) {
                        if (!doc._conflicts || doc._conflicts.length == 0) {
                            continue;
                        }
                    }
                    doc.children.forEach((e: string) => used.add(e));
                    if (doc._conflicts) {
                        const revs = await this.localDatabase.get(doc._id, { revs: true, revs_info: true });
                        const mineRevInfo = revs._revs_info || [];
                        // Collect all revs that should be kept.
                        // (All revs that are conflicted and its history before the maximum not conflicted rev).
                        const keepRevs = new Set<string>();
                        for (const conflict of doc._conflicts) {
                            const conflictedRevs = await this.localDatabase.get(doc._id, {
                                rev: conflict,
                                revs: true,
                                revs_info: true,
                            });
                            const conflictedRevInfo = conflictedRevs._revs_info || [];
                            const diffRevs = mineRevInfo.filter(
                                (e) => !conflictedRevInfo.some((f) => f.rev == e.rev && f.status == e.status)
                            );
                            const diffRevs2 = conflictedRevInfo.filter(
                                (e) => !mineRevInfo.some((f) => f.rev == e.rev && f.status == e.status)
                            );
                            const diffRevs3 = diffRevs.concat(diffRevs2);
                            const sameRevs = mineRevInfo
                                .filter((e) => conflictedRevInfo.some((f) => f.rev == e.rev && f.status == e.status))
                                .filter((e) => e.status == "available")
                                .sort((a, b) => getNoFromRev(b.rev) - getNoFromRev(a.rev));
                            const sameRevsTop = sameRevs.length > 0 ? [sameRevs[0].rev] : [];
                            const keepRevList = [
                                ...diffRevs3.filter((e) => e.status == "available").map((e) => e.rev),
                                ...sameRevsTop,
                            ];
                            keepRevList.forEach((e) => keepRevs.add(e));
                        }
                        const detail = await this.localDatabase.bulkGet<EntryDoc>({
                            docs: [...keepRevs.values()].map((e) => ({ id: doc._id, rev: e })),
                        });
                        for (const e of detail.results) {
                            if ("docs" in e) {
                                const docs = e.docs;
                                for (const doc of docs) {
                                    if ("ok" in doc) {
                                        if ("children" in doc.ok) {
                                            doc.ok.children.forEach((e: string) => used.add(e));
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
            since = changes.results[changes.results.length - 1].seq;
        } while (true);
        return { used, existing };
    }

    async resetDatabase() {
        await this.managers.teardownManagers();
        this.env.services.replicator.getActiveReplicator()?.closeReplication();
        if (!(await this.env.services.databaseEvents.onResetDatabase(this))) {
            Logger("Database reset has been prevented or failed on some modules.", LOG_LEVEL_NOTICE);
            return false;
        }
        Logger("Database closed for reset Database.");
        this.isReady = false;
        await this.localDatabase.destroy();
        //@ts-ignore
        this.localDatabase = null;
        await this.initializeDatabase();
        Logger("Local Database Reset", LOG_LEVEL_NOTICE);
        return true;
    }

    async *findEntries(
        startKey: string,
        endKey: string,
        opt:
            | PouchDB.Core.AllDocsWithKeyOptions
            | PouchDB.Core.AllDocsOptions
            | PouchDB.Core.AllDocsWithKeysOptions
            | PouchDB.Core.AllDocsWithinRangeOptions
    ) {
        const pageLimit = 100;
        let nextKey = startKey;
        if (endKey == "") endKey = "\u{10ffff}";
        let req = this.allDocsRaw({ limit: pageLimit, startkey: nextKey, endkey: endKey, include_docs: true, ...opt });
        do {
            const docs = await req;
            if (docs.rows.length === 0) {
                break;
            }
            nextKey = `${docs.rows[docs.rows.length - 1].id}`;
            req = this.allDocsRaw({
                limit: pageLimit,
                skip: 1,
                startkey: nextKey,
                endkey: endKey,
                include_docs: true,
                ...opt,
            });
            for (const row of docs.rows) {
                const doc = row.doc;
                //@ts-ignore: non null by include_docs
                if (!("type" in doc)) {
                    continue;
                }
                if (doc.type == "newnote" || doc.type == "plain") {
                    yield doc;
                }
            }
        } while (nextKey != "");
    }
    async *findAllDocs(
        opt?:
            | PouchDB.Core.AllDocsWithKeyOptions
            | PouchDB.Core.AllDocsOptions
            | PouchDB.Core.AllDocsWithKeysOptions
            | PouchDB.Core.AllDocsWithinRangeOptions
    ) {
        const targets = [
            () => this.findEntries("", "_", opt ?? {}),
            () => this.findEntries("_\u{10ffff}", "h:", opt ?? {}),
            () => this.findEntries(`h:\u{10ffff}`, "", opt ?? {}),
        ];
        for (const targetFun of targets) {
            yield* targetFun();
        }
    }
    async *findEntryNames(
        startKey: string,
        endKey: string,
        opt:
            | PouchDB.Core.AllDocsWithKeyOptions
            | PouchDB.Core.AllDocsOptions
            | PouchDB.Core.AllDocsWithKeysOptions
            | PouchDB.Core.AllDocsWithinRangeOptions
    ) {
        const pageLimit = 100;
        let nextKey = startKey;
        if (endKey == "") endKey = "\u{10ffff}";
        let req = this.allDocsRaw({ limit: pageLimit, startkey: nextKey, endkey: endKey, ...opt });
        do {
            const docs = await req;
            if (docs.rows.length == 0) {
                nextKey = "";
                break;
            }
            nextKey = `${docs.rows[docs.rows.length - 1].key}`;
            req = this.allDocsRaw({ limit: pageLimit, skip: 1, startkey: nextKey, endkey: endKey, ...opt });
            for (const row of docs.rows) {
                yield row.id;
            }
        } while (nextKey != "");
    }
    async *findAllDocNames(
        opt?:
            | PouchDB.Core.AllDocsWithKeyOptions
            | PouchDB.Core.AllDocsOptions
            | PouchDB.Core.AllDocsWithKeysOptions
            | PouchDB.Core.AllDocsWithinRangeOptions
    ) {
        const targets = [
            () => this.findEntryNames("", "_", opt ?? {}),
            () => this.findEntryNames("_\u{10ffff}", "h:", opt ?? {}),
            () => this.findEntryNames(`h:\u{10ffff}`, "i:", opt ?? {}),
            () => this.findEntryNames(`i:\u{10ffff}`, "ix:", opt ?? {}),
            () => this.findEntryNames(`ix:\u{10ffff}`, "ps:", opt ?? {}),
            () => this.findEntryNames(`ps:\u{10ffff}`, "", opt ?? {}),
        ];
        for (const targetFun of targets) {
            const target = targetFun();
            for await (const f of target) {
                if (f.startsWith("_")) continue;
                if (f == VERSIONING_DOCID) continue;
                yield f;
            }
        }
    }
    async *findAllNormalDocs(
        opt?:
            | PouchDB.Core.AllDocsWithKeyOptions
            | PouchDB.Core.AllDocsOptions
            | PouchDB.Core.AllDocsWithKeysOptions
            | PouchDB.Core.AllDocsWithinRangeOptions
    ) {
        const targets = [
            () => this.findEntries("", "_", opt ?? {}),
            () => this.findEntries("_\u{10ffff}", "h:", opt ?? {}),
            () => this.findEntries(`h:\u{10ffff}`, "i:", opt ?? {}),
            () => this.findEntries(`i:\u{10ffff}`, "ix:", opt ?? {}),
            () => this.findEntries(`ix:\u{10ffff}`, "ps:", opt ?? {}),
            () => this.findEntries(`ps:\u{10ffff}`, "", opt ?? {}),
        ];
        for (const targetFun of targets) {
            const target = targetFun();
            for await (const f of target) {
                if (f._id.startsWith("_")) continue;
                if (f.type != "newnote" && f.type != "plain") continue;
                yield f;
            }
        }
    }

    async removeRevision(docId: DocumentID, revision: string): Promise<boolean> {
        try {
            const doc = await this.localDatabase.get(docId, { rev: revision });
            doc._deleted = true;
            await this.localDatabase.put(doc);
            return true;
        } catch (ex) {
            if (isErrorOfMissingDoc(ex)) {
                Logger(`Remove revision: Missing target revision, ${docId}-${revision}`, LOG_LEVEL_VERBOSE);
            }
        }
        return false;
    }

    getRaw<T extends EntryDoc>(
        docId: DocumentID,
        options?: PouchDB.Core.GetOptions
    ): Promise<T & PouchDB.Core.IdMeta & PouchDB.Core.GetMeta> {
        return this.localDatabase.get<T>(docId, options || {});
    }

    removeRaw(docId: DocumentID, revision: string, options?: PouchDB.Core.Options): Promise<PouchDB.Core.Response> {
        return this.localDatabase.remove(docId, revision, options || {});
    }

    putRaw<T extends EntryDoc>(doc: T, options?: PouchDB.Core.PutOptions): Promise<PouchDB.Core.Response> {
        return this.localDatabase.put(doc, options || {});
    }

    allDocsRaw<T extends EntryDoc | DatabaseEntry>(
        options?:
            | PouchDB.Core.AllDocsWithKeyOptions
            | PouchDB.Core.AllDocsWithKeysOptions
            | PouchDB.Core.AllDocsWithinRangeOptions
            | PouchDB.Core.AllDocsOptions
    ): Promise<PouchDB.Core.AllDocsResponse<T>> {
        return this.localDatabase.allDocs<T>(options);
    }

    bulkDocsRaw<T extends EntryDoc>(
        docs: Array<PouchDB.Core.PutDocument<T>>,
        options?: PouchDB.Core.BulkDocsOptions
    ): Promise<Array<PouchDB.Core.Response | PouchDB.Core.Error>> {
        return this.localDatabase.bulkDocs(docs, options || {});
    }

    // For compatibility
    isTargetFile(filenameSrc: string) {
        return this.managers.entryManager.isTargetFile(filenameSrc);
    }
    async getDBEntryMeta(
        path: FilePathWithPrefix | FilePath,
        opt?: PouchDB.Core.GetOptions,
        includeDeleted = false
    ): Promise<false | LoadedEntry> {
        return await this.managers.entryManager.getDBEntryMeta(path, opt, includeDeleted);
    }

    async getDBEntry(
        path: FilePathWithPrefix | FilePath,
        opt?: PouchDB.Core.GetOptions,
        dump = false,
        waitForReady = true,
        includeDeleted = false
    ): Promise<false | LoadedEntry> {
        return await this.managers.entryManager.getDBEntry(path, opt, dump, waitForReady, includeDeleted);
    }
    async getDBEntryFromMeta(
        meta: LoadedEntry | MetaEntry,
        dump = false,
        waitForReady = true
    ): Promise<false | LoadedEntry> {
        return await this.managers.entryManager.getDBEntryFromMeta(meta, dump, waitForReady);
    }
    async deleteDBEntry(path: FilePathWithPrefix | FilePath, opt?: PouchDB.Core.GetOptions): Promise<boolean> {
        return await this.managers.entryManager.deleteDBEntry(path, opt);
    }
    async putDBEntry(note: SavingEntry, onlyChunks?: boolean) {
        return await this.managers.entryManager.putDBEntry(note, onlyChunks);
    }

    async getConflictedDoc(path: FilePathWithPrefix, rev: string): Promise<false | diff_result_leaf> {
        return await this.managers.conflictManager.getConflictedDoc(path, rev);
    }
    async tryAutoMerge(path: FilePathWithPrefix, enableMarkdownAutoMerge: boolean): AutoMergeResult {
        return await this.managers.conflictManager.tryAutoMerge(path, enableMarkdownAutoMerge);
    }
}
