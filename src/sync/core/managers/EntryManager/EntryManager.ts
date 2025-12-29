import { Logger, LOG_LEVEL_NOTICE, LOG_LEVEL_VERBOSE } from "octagonal-wheels/common/logger";
import { serialized } from "octagonal-wheels/concurrency/lock_v2";
import {
    type EntryDoc,
    type RemoteDBSettings,
    type DocumentID,
    type EntryHasPath,
    type FilePathWithPrefix,
    type FilePath,
    IDPrefixes,
    type LoadedEntry,
    type EntryDocResponse,
    type EntryBase,
    type MetaEntry,
    type NoteEntry,
    type EntryLeaf,
    RemoteTypes,
    LEAF_WAIT_TIMEOUT,
    LEAF_WAIT_TIMEOUT_SEQUENTIAL_REPLICATOR,
    LEAF_WAIT_ONLY_REMOTE,
    type SavingEntry,
    type PlainEntry,
    type NewEntry,
    REMOTE_COUCHDB,
} from "../../common/types.ts";
import { getFileRegExp, createTextBlob, isTextBlob } from "../../common/utils.ts";
import type { ContentSplitter } from "../../ContentSplitter/ContentSplitters.ts";
import type { GeneratedChunk } from "../../pouchdb/LiveSyncLocalDB.ts";
import { isErrorOfMissingDoc } from "../../pouchdb/utils_couchdb.ts";
import { stripAllPrefixes } from "../../string_and_binary/path.ts";
import type { ChunkFetcher } from "../ChunkFetcher.ts";
import type { ChunkManager, ChunkWriteOptions } from "../ChunkManager.ts";
import type { HashManager } from "../HashManager/HashManager.ts";
import type { ChangeManager } from "../ChangeManager.ts";

export interface EntryManagerOptions {
    hashManager: HashManager;
    chunkFetcher: ChunkFetcher;
    changeManager: ChangeManager<EntryDoc>;
    chunkManager: ChunkManager;
    splitter: ContentSplitter;

    database: PouchDB.Database<EntryDoc>;
    settings: RemoteDBSettings;
    $$id2path(id: DocumentID, entry: EntryHasPath, stripPrefix?: boolean): FilePathWithPrefix;
    $$path2id(filename: FilePathWithPrefix | FilePath, prefix?: string): Promise<DocumentID>;
}

export class EntryManager {
    options: EntryManagerOptions;
    constructor(options: EntryManagerOptions) {
        this.options = options;
    }
    get localDatabase(): PouchDB.Database<EntryDoc> {
        return this.options.database;
    }
    get hashManager(): HashManager {
        return this.options.hashManager;
    }
    get chunkManager(): ChunkManager {
        return this.options.chunkManager;
    }
    get chunkFetcher(): ChunkFetcher {
        return this.options.chunkFetcher;
    }
    get splitter(): ContentSplitter {
        return this.options.splitter;
    }
    get settings(): RemoteDBSettings {
        return this.options.settings;
    }
    id2path(id: DocumentID, entry: EntryHasPath, stripPrefix?: boolean): FilePathWithPrefix {
        return this.options.$$id2path(id, entry, stripPrefix);
    }
    async path2id(filename: FilePathWithPrefix | FilePath, prefix?: string): Promise<DocumentID> {
        return await this.options.$$path2id(filename, prefix);
    }

    get isOnDemandChunkEnabled() {
        if (this.settings.remoteType !== REMOTE_COUCHDB) {
            return false;
        }
        if (this.settings.useOnlyLocalChunk) {
            return false;
        }
        return true;
    }

    isTargetFile(filenameSrc: string) {
        const file = filenameSrc.startsWith("i:") ? filenameSrc.substring(2) : filenameSrc;
        if (file.startsWith("ix:")) return true;
        if (file.startsWith("ps:")) return true;
        if (file.includes(":")) {
            return false;
        }
        if (this.settings.syncOnlyRegEx) {
            const syncOnly = getFileRegExp(this.settings, "syncOnlyRegEx");
            if (syncOnly.length > 0 && !syncOnly.some((e) => e.test(file))) return false;
        }
        if (this.settings.syncIgnoreRegEx) {
            const syncIgnore = getFileRegExp(this.settings, "syncIgnoreRegEx");
            if (syncIgnore.some((e) => e.test(file))) return false;
        }
        return true;
    }

    async prepareChunk(piece: string): Promise<GeneratedChunk> {
        const cachedChunkId = this.chunkManager.getChunkIDFromCache(piece);
        if (cachedChunkId !== false) {
            return { isNew: false, id: cachedChunkId, piece: piece };
        }

        // Generate a new chunk ID based on the piece and the hashed passphrase.
        const chunkId = (await this.hashManager.computeHash(piece)) as DocumentID;
        return { isNew: true, id: `${IDPrefixes.Chunk}${chunkId}` as DocumentID, piece: piece };
    }

    async getDBEntryMeta(
        path: FilePathWithPrefix | FilePath,
        opt?: PouchDB.Core.GetOptions,
        includeDeleted = false
    ): Promise<false | LoadedEntry> {
        // safety valve
        if (!this.isTargetFile(path)) {
            return false;
        }
        const id = await this.path2id(path);
        try {
            let obj: EntryDocResponse | null = null;
            if (opt) {
                obj = await this.localDatabase.get(id, opt);
            } else {
                obj = await this.localDatabase.get(id);
            }
            const deleted = (obj as any)?.deleted ?? obj._deleted ?? undefined;
            if (!includeDeleted && deleted) return false;
            if (obj.type && obj.type == "leaf") {
                //do nothing for leaf;
                return false;
            }

            // retrieve metadata only
            if (!obj.type || (obj.type && obj.type == "notes") || obj.type == "newnote" || obj.type == "plain") {
                const note = obj as EntryBase;
                let children: string[] = [];
                let type: "plain" | "newnote" = "plain";
                if (obj.type == "newnote" || obj.type == "plain") {
                    children = obj.children;
                    type = obj.type;
                }
                const doc: LoadedEntry & PouchDB.Core.IdMeta & PouchDB.Core.GetMeta = {
                    data: "",
                    _id: (note as EntryDoc)._id,
                    path: path,
                    ctime: note.ctime,
                    mtime: note.mtime,
                    size: note.size,
                    // _deleted: obj._deleted,
                    _rev: obj._rev,
                    _conflicts: obj._conflicts,
                    children: children,
                    datatype: type,
                    deleted: deleted,
                    type: type,
                    eden: "eden" in obj ? obj.eden : {},
                };
                return doc;
            }
        } catch (ex: any) {
            if (isErrorOfMissingDoc(ex)) {
                return false;
            }
            throw ex;
        }
        return false;
    }
    async getDBEntry(
        path: FilePathWithPrefix | FilePath,
        opt?: PouchDB.Core.GetOptions,
        dump = false,
        waitForReady = true,
        includeDeleted = false
    ): Promise<false | LoadedEntry> {
        const meta = await this.getDBEntryMeta(path, opt, includeDeleted);
        if (meta) {
            return await this.getDBEntryFromMeta(meta, dump, waitForReady);
        } else {
            return false;
        }
    }
    async getDBEntryFromMeta(
        meta: LoadedEntry | MetaEntry,
        dump = false,
        waitForReady = true
    ): Promise<false | LoadedEntry> {
        const filename = this.id2path(meta._id, meta);
        if (!this.isTargetFile(filename)) {
            return false;
        }
        const dispFilename = stripAllPrefixes(filename);
        const deleted = meta.deleted ?? meta._deleted ?? undefined;
        if (!meta.type || (meta.type && meta.type == "notes")) {
            const note = meta as NoteEntry;
            const doc: LoadedEntry & PouchDB.Core.IdMeta = {
                data: note.data,
                path: note.path,
                _id: note._id,
                ctime: note.ctime,
                mtime: note.mtime,
                size: note.size,
                // _deleted: obj._deleted,
                _rev: meta._rev,
                _conflicts: meta._conflicts,
                children: [],
                datatype: "newnote",
                deleted: deleted,
                type: "newnote",
                eden: "eden" in meta ? meta.eden : {},
            };
            if (dump) {
                Logger(`--Old fashioned document--`);
                Logger(doc);
            }

            return doc;
            // simple note
        }
        if (meta.type == "newnote" || meta.type == "plain") {
            if (dump) {
                const conflicts = await this.localDatabase.get(meta._id, {
                    rev: meta._rev,
                    conflicts: true,
                    revs_info: true,
                });
                Logger("-- Conflicts --");
                Logger(conflicts._conflicts ?? "No conflicts");
                Logger("-- Revs info -- ");
                Logger(conflicts._revs_info);
            }
            // search children
            try {
                if (dump) {
                    Logger(`--Bare document--`);
                    Logger(meta);
                }

                // Reading `Eden` for legacy support.
                // It will be removed in the future.
                let edenChunks: Record<string, EntryLeaf> = {};
                if (meta.eden && Object.keys(meta.eden).length > 0) {
                    const chunks = Object.entries(meta.eden).map(([id, data]) => ({
                        _id: id as DocumentID,
                        data: data.data,
                        type: "leaf",
                    })) as EntryLeaf[];
                    edenChunks = Object.fromEntries(chunks.map((e) => [e._id, e]));
                }

                const isChunksCorrectedIncrementally = this.settings.remoteType !== RemoteTypes.REMOTE_MINIO;
                const isNetworkEnabled =
                    this.isOnDemandChunkEnabled && this.settings.remoteType !== RemoteTypes.REMOTE_MINIO;
                const timeout = waitForReady
                    ? isChunksCorrectedIncrementally
                        ? LEAF_WAIT_TIMEOUT
                        : LEAF_WAIT_TIMEOUT_SEQUENTIAL_REPLICATOR
                    : isNetworkEnabled
                      ? LEAF_WAIT_ONLY_REMOTE
                      : 0;

                const childrenKeys = [...meta.children] as DocumentID[];
                const chunks = await this.chunkManager.read(
                    childrenKeys,
                    {
                        skipCache: false,
                        timeout: timeout,
                        preventRemoteRequest: !isNetworkEnabled,
                    },
                    edenChunks
                );

                if (chunks.some((e) => e === false)) {
                    // TODO EXACT MESSAGE
                    throw new Error("Load failed");
                }

                const doc: LoadedEntry & PouchDB.Core.IdMeta = {
                    data: (chunks as EntryLeaf[]).map((e) => e.data),
                    path: meta.path,
                    _id: meta._id,
                    ctime: meta.ctime,
                    mtime: meta.mtime,
                    size: meta.size,
                    _rev: meta._rev,
                    children: meta.children,
                    datatype: meta.type,
                    _conflicts: meta._conflicts,
                    eden: meta.eden,
                    deleted: deleted,
                    type: meta.type,
                };
                if (dump) {
                    Logger(`--Loaded Document--`);
                    Logger(doc);
                }
                return doc;
            } catch (ex: any) {
                if (isErrorOfMissingDoc(ex)) {
                    Logger(
                        `Missing document content!, could not read ${dispFilename}(${meta._id.substring(0, 8)}) from database.`,
                        LOG_LEVEL_NOTICE
                    );
                    return false;
                }
                Logger(
                    `Something went wrong on reading ${dispFilename}(${meta._id.substring(0, 8)}) from database:`,
                    LOG_LEVEL_NOTICE
                );
                Logger(ex);
            }
        }
        return false;
    }

    async deleteDBEntry(path: FilePathWithPrefix | FilePath, opt?: PouchDB.Core.GetOptions): Promise<boolean> {
        // safety valve
        if (!this.isTargetFile(path)) {
            return false;
        }
        const id = await this.path2id(path);
        try {
            return (
                (await serialized("file:" + path, async () => {
                    let obj: EntryDocResponse | null = null;
                    if (opt) {
                        obj = await this.localDatabase.get(id, opt);
                    } else {
                        obj = await this.localDatabase.get(id);
                    }
                    const revDeletion = opt && ("rev" in opt ? opt.rev : "") != "";

                    if (obj.type && obj.type == "leaf") {
                        //do nothing for leaf;
                        return false;
                    }
                    //Check it out and fix docs to regular case
                    if (!obj.type || (obj.type && obj.type == "notes")) {
                        obj._deleted = true;
                        const r = await this.localDatabase.put(obj, { force: !revDeletion });
                        Logger(`Entry removed:${path} (${obj._id.substring(0, 8)}-${r.rev})`);
                        return true;

                        // simple note
                    }
                    if (obj.type == "newnote" || obj.type == "plain") {
                        if (revDeletion) {
                            obj._deleted = true;
                        } else {
                            obj.deleted = true;
                            obj.mtime = Date.now();
                            if (this.settings.deleteMetadataOfDeletedFiles) {
                                obj._deleted = true;
                            }
                        }
                        const r = await this.localDatabase.put(obj, { force: !revDeletion });

                        Logger(`Entry removed:${path} (${obj._id.substring(0, 8)}-${r.rev})`);
                        return true;
                    } else {
                        return false;
                    }
                })) ?? false
            );
        } catch (ex: any) {
            if (isErrorOfMissingDoc(ex)) {
                return false;
            }
            throw ex;
        }
    }

    async putDBEntry(note: SavingEntry, onlyChunks?: boolean) {
        //safety valve
        const filename = this.id2path(note._id, note);
        const dispFilename = stripAllPrefixes(filename);

        //prepare eden
        if (!note.eden) note.eden = {};

        if (!this.isTargetFile(filename)) {
            Logger(`File skipped:${dispFilename}`, LOG_LEVEL_VERBOSE);
            return false;
        }

        // Set datatype again for modified datatype.
        const data = note.data instanceof Blob ? note.data : createTextBlob(note.data);
        note.data = data;
        note.type = isTextBlob(data) ? "plain" : "newnote";
        note.datatype = note.type;

        await this.splitter.initialised;

        // TODO: Pack chunks in a single file for performance.
        const result = await this.chunkManager.transaction(async () => {
            let bufferedChunk = [] as EntryLeaf[];
            let bufferedSize = 0;

            let writeCount = 0;
            let newCount = 0;
            let cachedCount = 0;
            let resultCachedCount = 0;
            let duplicatedCount = 0;
            let totalWritingCount = 0;
            let createChunkCount = 0;
            // If total size of current buffered chunks exceeds this, they will be flushed to the database to avoid memory extravagance.
            const MAX_WRITE_SIZE = 1000 * 1024 * 2; // 2MB
            const chunks: DocumentID[] = [];

            let writeChars = 0;
            const flushBufferedChunks = async () => {
                if (bufferedChunk.length === 0) {
                    Logger(`No chunks to flush for ${dispFilename}`, LOG_LEVEL_VERBOSE);
                    return true;
                }
                const writeBuf = [...bufferedChunk];
                bufferedSize = 0;
                bufferedChunk = [];
                const result = await this.chunkManager.write(
                    writeBuf,
                    {
                        skipCache: false,
                        timeout: 0,
                    } as ChunkWriteOptions,
                    note._id
                );
                if (result.result === false) {
                    Logger(`Failed to write buffered chunks for ${dispFilename}`, LOG_LEVEL_NOTICE);
                    return false;
                }
                totalWritingCount++;
                writeCount += result.processed.written;
                resultCachedCount += result.processed.cached;
                duplicatedCount += result.processed.duplicated;
                writeChars += writeBuf.map((e) => e.data.length).reduce((a, b) => a + b, 0);
                // chunks.push(...writeBuf.map((e) => e._id));
                Logger(`Flushed ${writeBuf.length} (${writeChars}) chunks for ${dispFilename}`, LOG_LEVEL_VERBOSE);
                return true;
            };
            const flushIfNeeded = async () => {
                if (bufferedSize > MAX_WRITE_SIZE) {
                    if (!(await flushBufferedChunks())) {
                        Logger(`Failed to flush buffered chunks for ${dispFilename}`, LOG_LEVEL_NOTICE);
                        return false;
                    }
                }
                return true;
            };
            const addBuffer = async (id: DocumentID, data: string) => {
                const chunk = {
                    _id: id,
                    data: data,
                    type: "leaf",
                } as const;
                bufferedChunk.push(chunk);
                chunks.push(chunk._id);
                bufferedSize += chunk.data.length;
                return await flushIfNeeded();
            };
            const pieces = await this.splitter.splitContent(note);
            let totalChunkCount = 0;
            try {
                for await (const piece of pieces) {
                    totalChunkCount++;
                    if (piece.length === 0) {
                        continue;
                    }
                    createChunkCount++;
                    const chunk = await this.prepareChunk(piece);
                    cachedCount += chunk.isNew ? 0 : 1;
                    newCount += chunk.isNew ? 1 : 0;
                    if (!(await addBuffer(chunk.id, chunk.piece))) {
                        return false;
                    }
                }
            } catch (ex) {
                Logger(`Error processing pieces for ${dispFilename}`);
                Logger(ex, LOG_LEVEL_VERBOSE);
                return false;
            }
            if (!(await flushBufferedChunks())) {
                return false;
            }

            const dataSize = note.data.size;
            const stats = `(✨: ${newCount}, 🗃️: ${cachedCount} (${resultCachedCount}) / 🗄️: ${writeCount}, ♻:${duplicatedCount})`;
            Logger(
                `Chunks processed for ${dispFilename} (${dataSize}): 📚:${totalChunkCount} (${createChunkCount}) , 📥:${totalWritingCount} ${stats}`,
                LOG_LEVEL_VERBOSE
            );

            if (dataSize > 0 && totalWritingCount === 0) {
                Logger(
                    `No data to save in ${dispFilename}!! This document may be corrupted in the local database! Please back it up immediately, and report an issue!`,
                    LOG_LEVEL_NOTICE
                );
            }

            if (onlyChunks) {
                return {
                    id: note._id,
                    ok: true,
                    rev: "dummy",
                };
            }

            const newDoc: PlainEntry | NewEntry = {
                children: chunks,
                _id: note._id,
                path: note.path,
                ctime: note.ctime,
                mtime: note.mtime,
                size: note.size,
                type: note.datatype,
                eden: {},
            };

            return (
                (await serialized("file:" + filename, async () => {
                    try {
                        const old = await this.localDatabase.get(newDoc._id);
                        newDoc._rev = old._rev;
                    } catch (ex: any) {
                        if (isErrorOfMissingDoc(ex)) {
                            // NO OP/
                        } else {
                            throw ex;
                        }
                    }
                    const r = await this.localDatabase.put<PlainEntry | NewEntry>(newDoc, { force: true });
                    if (r.ok) {
                        return r;
                    } else {
                        return false;
                    }
                })) ?? false
            );
        });
        if (result === false) {
            Logger(`Failed to write document ${dispFilename}`, LOG_LEVEL_NOTICE);
            return false;
        }
        Logger(`Document saved: ${dispFilename} (${result.id.substring(0, 8)}-${result.rev})`, LOG_LEVEL_VERBOSE);
        return result;
    }
}
