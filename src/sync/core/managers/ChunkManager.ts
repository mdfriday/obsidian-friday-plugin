import { FallbackWeakRef } from "octagonal-wheels/common/polyfill";
import { LOG_LEVEL_VERBOSE, Logger } from "../common/logger.ts";
import { promiseWithResolver, type PromiseWithResolvers } from "octagonal-wheels/promises";
import { LiveSyncError, LiveSyncFatalError } from "../common/LSError.ts";
import type { DocumentID, EntryDoc, EntryLeaf } from "../common/types.ts";
import type { ChangeManager } from "./ChangeManager.ts";
import { EVENT_MISSING_CHUNK_REMOTE, EVENT_MISSING_CHUNKS } from "./ChunkFetcher.ts";

export type ChunkManagerOptions = {
    database: PouchDB.Database<EntryDoc>;
    changeManager: ChangeManager<EntryDoc>;
    maxCacheSize?: number; // Maximum cache size
};
const DEFAULT_MAX_CACHE_SIZE = 100000; // Default cache size (Even if still lower, cached values will be purged by GC).
export type ChunkReadOptions = {
    skipCache?: boolean; // Skip cache when reading
    timeout?: number; // Timeout in milliseconds
    preventRemoteRequest?: boolean; // Prevent dispatching missing chunks event
};
export type ChunkWriteOptions = {
    skipCache?: boolean; // Skip cache when writing
    force?: boolean;
};

export const HotPackProcessResults = {
    OK: true,
    FAILED: false,
    FALLBACK: Symbol("fallback"), // Fallback if hot pack fails
} as const;
export type HotPackProcessResult = (typeof HotPackProcessResults)[keyof typeof HotPackProcessResults];

function buildChunkMap<T extends EntryLeaf>(chunks: T[]): Map<DocumentID, T> {
    const map = new Map<DocumentID, T>();
    for (const chunk of chunks) {
        map.set(chunk._id, chunk);
    }
    return map;
}
const DEFAULT_TIMEOUT = 15000; // Default timeout in milliseconds (15 seconds)

export type WriteResult = {
    result: boolean;
    processed: {
        cached: number; // Number of chunks processed in cache
        hotPack: number; // Number of chunks processed in hot pack
        written: number; // Number of chunks processed in database
        duplicated: number; // Number of chunks duplicated
    };
};

function withTimeout<T>(proc: Promise<T>, timeout: number, onTimedOut: () => T): Promise<T> {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
            resolve(onTimedOut()); // Call onTimedOut if a timeout occurs
        }, timeout);
        proc.then(resolve)
            .catch(reject)
            .finally(() => {
                clearTimeout(timer);
            });
    });
}

function getError(error: any) {
    if (error instanceof Error) {
        return error;
    }
    if ("error" in error && error.error instanceof Error) {
        return error.error;
    }
    return undefined;
}

function isMissingError(error: any): boolean {
    if ("status" in error && error.status === 404) {
        return true; // Treat 404 error as missing
    }
    if ("error" in error && error.error === "not_found") {
        return true; // Treat PouchDB not_found error as missing
    }
    // When the result is passed as is
    if ("error" in error) {
        return isMissingError(error.error);
    }
    return false;
}

function isChunkDoc(doc: any): doc is EntryLeaf {
    return doc && typeof doc._id === "string" && doc.type === "leaf";
}

export const EVENT_CHUNK_FETCHED = "chunkFetched"; // Event for chunk arrival

export type ChunkManagerEventMap = {
    [EVENT_MISSING_CHUNK_REMOTE]: DocumentID; // Event for missing chunk
    [EVENT_MISSING_CHUNKS]: DocumentID[]; // Event for multiple missing chunks
    [EVENT_CHUNK_FETCHED]: EntryLeaf; // Event for chunk arrival
};
/**
 * ChunkManager class that manages chunk operations such as reading, writing, and caching.
 * Still-larger file so it will be also be fine to split this class into multiple files in the future.
 */
export class ChunkManager {
    options: ChunkManagerOptions;
    eventTarget: EventTarget = new EventTarget();

    get changeManager(): ChangeManager<EntryDoc> {
        return this.options.changeManager;
    }
    get database(): PouchDB.Database<EntryDoc> {
        return this.options.database;
    }
    maxCacheSize: number = DEFAULT_MAX_CACHE_SIZE; // Maximum cache size
    caches: Map<DocumentID, FallbackWeakRef<EntryLeaf>> = new Map(); // Map for cache

    addListener<K extends keyof ChunkManagerEventMap>(
        type: K,
        listener: (this: ChunkManager, ev: ChunkManagerEventMap[K]) => any,
        options?: boolean | AddEventListenerOptions
    ): () => void {
        const callback = (ev: CustomEvent<ChunkManagerEventMap[K]>) => {
            listener.call(this, ev.detail);
        };
        this.eventTarget.addEventListener(type, callback as EventListener, options);
        return () => {
            this.eventTarget.removeEventListener(type, callback as EventListener, options);
        };
    }
    emitEvent<K extends keyof ChunkManagerEventMap>(type: K, detail: ChunkManagerEventMap[K]): void {
        const event = new CustomEvent(type, { detail });
        this.eventTarget.dispatchEvent(event);
    }

    waitingMap = new Map<
        DocumentID,
        {
            resolver: PromiseWithResolvers<EntryLeaf | false>;
        }
    >(); // Queue for pending reads

    allocCount = 0; // Count of allocated chunks
    derefCount = 0; // Count of dereferenced chunks
    clearCaches() {
        this.caches.clear();
        this.allocCount = 0; // Reset allocation count
        this.derefCount = 0; // Reset dereference count
    }

    getCachedChunk(id: DocumentID): EntryLeaf | false {
        if (!this.caches.has(id)) {
            return false;
        }
        const weakRef = this.caches.get(id);
        if (weakRef) {
            const cachedChunk = weakRef.deref();
            if (cachedChunk) {
                return cachedChunk;
            } else {
                this.derefCount++;
                this.deleteCachedChunk(id);
                return false;
            }
        }
        return false;
    }

    getChunkIDFromCache(data: string): DocumentID | false {
        for (const [id, weakRef] of this.caches) {
            const chunk = weakRef.deref();
            if (chunk) {
                if (chunk.data === data) {
                    return id; // Return the ID if the data matches
                }
            } else {
                this.derefCount++;
                this.deleteCachedChunk(id); // Remove if deref failed
            }
        }
        return false; // Not found in cache
    }

    cacheChunk(chunk: EntryLeaf): void {
        if (this.getCachedChunk(chunk._id)) {
            // If already in cache, do not cache again
            this.reorderChunk(chunk._id);
            return;
        }
        this.caches.set(chunk._id, new FallbackWeakRef(chunk));
        this.allocCount++;
        // Limit cache size
        const maxCacheSize = this.maxCacheSize ?? DEFAULT_MAX_CACHE_SIZE;
        if (this.caches.size > maxCacheSize) {
            do {
                // If the cache size exceeds the limit, delete the first element
                const firstKey = this.caches.keys().next().value;
                if (firstKey) {
                    this.caches.delete(firstKey);
                }
            } while (this.caches.size > maxCacheSize);
        }
    }
    reorderChunk(id: DocumentID): void {
        const chunk = this.getCachedChunk(id);
        if (chunk) {
            this.caches.delete(id); // Remove once
            this.caches.set(id, new FallbackWeakRef(chunk)); // Add again
        }
    }

    deleteCachedChunk(id: DocumentID): void {
        if (this.caches.has(id)) {
            this.caches.delete(id);
        }
    }

    _enqueueWaiting(id: DocumentID, timeout: number): Promise<EntryLeaf | false> {
        const previous = this.waitingMap.get(id);
        if (previous) {
            // If already waiting for this ID, do not overwrite
            return previous.resolver.promise;
        }
        const resolver = promiseWithResolver<EntryLeaf | false>();
        this.waitingMap.set(id, { resolver });
        // Set timeout and wait for the promise to resolve
        return withTimeout(resolver.promise, timeout, () => {
            const current = this.waitingMap.get(id);
            if (current && current.resolver === resolver) {
                // If still waiting for this ID, delete it
                this.waitingMap.delete(id);
            }
            return false; // Return false if timed out
        });
    }

    onChunkArrived(doc: EntryLeaf, deleted: boolean = false): void {
        const id = doc._id;
        if (this.waitingMap.has(id)) {
            const queue = this.waitingMap.get(id)!;
            this.waitingMap.delete(id);
            if (doc._deleted || deleted) {
                queue.resolver.resolve(false); // Return false if deleted
            } else {
                queue.resolver.resolve(doc); // Return the chunk
                this.cacheChunk(doc); // Add to cache
            }
        } else {
            // Logger(`Chunk ${id} arrived but no waiting queue found.`, LOG_LEVEL_VERBOSE);
        }
    }
    onChunkArrivedHandler = this.onChunkArrived.bind(this);
    onChange(change: PouchDB.Core.ChangesResponseChange<EntryLeaf>): void {
        const doc = change.doc;
        if (!doc || !doc._id) {
            return; // Ignore invalid documents
        }

        if (doc.type !== "leaf") {
            return; // Ignore if not a chunk document
        }
        this.onChunkArrived(doc, change.deleted); // Handle chunk arrival
    }
    onChangeHandler = this.onChange.bind(this);

    onMissingChunkRemote(id: DocumentID): void {
        // Handle the case where the chunk is not found remotely
        if (this.waitingMap.has(id)) {
            const queue = this.waitingMap.get(id)!;
            this.waitingMap.delete(id);
            queue.resolver.resolve(false); // Return false if the chunk is not found
        }
    }
    onMissingChunkRemoteHandler = this.onMissingChunkRemote.bind(this);

    abort: AbortController = new AbortController();
    changeHandler: ReturnType<typeof this.changeManager.addCallback>;
    initialised = Promise.resolve();
    async _initialise() {
        // Initialisation logic

        Logger("ChunkManager initialised", LOG_LEVEL_VERBOSE);
        // TODO: Add chunkpack
        return await Promise.resolve();
    }
    constructor(options: ChunkManagerOptions) {
        this.options = options;
        this.caches = new Map();
        this.changeHandler = this.changeManager.addCallback(this.onChangeHandler);
        this.addListener(EVENT_CHUNK_FETCHED, this.onChunkArrivedHandler, { signal: this.abort.signal });
        this.addListener(EVENT_MISSING_CHUNK_REMOTE, this.onMissingChunkRemoteHandler, { signal: this.abort.signal });
        this.initialised = this._initialise(); // Initialise chunk manager
    }

    destroy(): void {
        this.abort.abort(); // Abort any ongoing requests
        this.changeHandler(); // Remove change handler
        this.caches.clear(); // Clear cache
        this.waitingMap.clear(); // Clear pending queue
    }

    async readSingle(id: DocumentID, options: ChunkReadOptions): Promise<EntryLeaf | false> {
        // Read a single chunk
        if (!options.skipCache) {
            const cachedChunk = this.getCachedChunk(id);
            if (cachedChunk) {
                this.reorderChunk(id); // Update cache order
                return cachedChunk; // Return from cache
            }
        }
        // If not found in cache, get from the database
        try {
            const result = await this.database.get(id);
            if (result && isChunkDoc(result)) {
                // If found, save to cache
                this.cacheChunk(result);
                return result;
            }
        } catch (error) {
            if (!isMissingError(error)) {
                // Treat non-missing errors as fatal
                throw new LiveSyncError(`Failed to read chunk ${id}`, { status: 404, cause: error });
            }
        }
        // If reached here, the chunk was not found
        // If a timeout is set, wait for the chunk to arrive
        const timeout = options.timeout ?? DEFAULT_TIMEOUT;
        if (timeout > 0) {
            const ret = this._enqueueWaiting(id, timeout);
            if (!options.preventRemoteRequest) {
                this.emitEvent(EVENT_MISSING_CHUNKS, [id]); // Emit an event for the missing chunk
            }
            return ret;
        }
        // If no timeout, return false immediately
        return false;
    }

    _readFromCache(readIds: Set<DocumentID>, resultMap: Map<DocumentID, false | EntryLeaf>) {
        const cachedChunks = [...readIds].map((id) => this.getCachedChunk(id)).filter((chunk) => chunk !== false);
        for (const chunk of cachedChunks) {
            this.reorderChunk(chunk._id); // Update cache order
            resultMap.set(chunk._id, chunk); // Add to the result map from cache
            readIds.delete(chunk._id);
        }
    }
    async _readFromDatabase(readIds: Set<DocumentID>, resultMap: Map<DocumentID, false | EntryLeaf>) {
        const results = await this.database.allDocs({ keys: [...readIds], include_docs: true });
        for (const row of results.rows) {
            if ("doc" in row && row.doc) {
                const chunk = row.doc as EntryLeaf;
                resultMap.set(chunk._id, chunk); // Add to the result map from the database
                readIds.delete(chunk._id); // Remove from IDs to read
                this.cacheChunk(chunk); // Add to cache
            } else if (!isMissingError(row)) {
                // Throw for non-missing errors
                throw new LiveSyncError(`Failed to read chunk ${row.key}`, { status: 404, cause: getError(row) });
            }
        }
    }
    async _waitForArrival(
        options: ChunkReadOptions,
        readIds: Set<DocumentID>,
        resultMap: Map<DocumentID, false | EntryLeaf>
    ) {
        const timeout = options.timeout ?? DEFAULT_TIMEOUT;
        if (timeout > 0) {
            // If a timeout is set, return a promise that waits until the timeout
            const tasks = [...readIds].map((id) => {
                // Add to the pending map
                return this._enqueueWaiting(id, timeout);
            });
            if (!options.preventRemoteRequest) {
                this.emitEvent(EVENT_MISSING_CHUNKS, [...readIds]); // Emit an event for the missing chunks
            }
            const results = await Promise.all(tasks);
            for (const chunk of results) {
                if (chunk) {
                    resultMap.set(chunk._id, chunk);
                    readIds.delete(chunk._id); // Remove from IDs to read
                    this.cacheChunk(chunk);
                }
            }
        }
    }
    _readPreloadedChunks(
        preloadedChunks: Record<DocumentID, EntryLeaf>,
        readIds: Set<DocumentID>,
        resultMap: Map<DocumentID, false | EntryLeaf>
    ) {
        // If preloaded chunks are provided, add them to the result map
        for (const [id, chunk] of Object.entries(preloadedChunks) as [DocumentID, EntryLeaf][]) {
            if (isChunkDoc(chunk)) {
                this.cacheChunk(chunk); // Cache the preloaded chunk
                resultMap.set(id, chunk); // Add to the result map
                readIds.delete(id); // Remove from IDs to read
            }
        }
    }

    async read(
        ids: DocumentID[],
        options: ChunkReadOptions,
        preloadedChunks?: Record<DocumentID, EntryLeaf>
    ): Promise<(EntryLeaf | false)[]> {
        // This method must preserve order, including duplicates
        const order = [...ids];
        // Result map
        const resultMap = new Map<DocumentID, EntryLeaf | false>(ids.map((id) => [id, false]));
        const readIds = new Set([...resultMap.keys()]); // List of IDs to read (no duplicate reads)

        if (preloadedChunks) {
            // If preloaded chunks are provided, add them to the result map
            this._readPreloadedChunks(preloadedChunks, readIds, resultMap);
        }

        if (!options.skipCache) {
            // Read from cache
            this._readFromCache(readIds, resultMap);
        }
        if (readIds.size > 0) {
            // Read from database
            await this._readFromDatabase(readIds, resultMap);
        }
        if (readIds.size > 0) {
            // If IDs remain, wait for arrival
            await this._waitForArrival(options, readIds, resultMap);
        }
        // Return results in original order
        return order.map((id) => resultMap.get(id) || false) as (EntryLeaf | false)[];
    }

    async write(chunks: EntryLeaf[], options: ChunkWriteOptions, origin: DocumentID): Promise<WriteResult> {
        let storeChunks = chunks;
        // Save chunks
        const writeResult: WriteResult = {
            result: true,
            processed: {
                cached: 0,
                hotPack: 0,
                written: 0,
                duplicated: 0,
            },
        };

        // TODO: Implement hot pack processing
        // --- Check hot pack
        // if (!options.skipHotPack) {
        //     // Hot pack is special processing
        //     const hotPackResult = await this.writeHotPack(storeChunks, origin, options);
        //     if (hotPackResult.result) {
        //         return {
        //             result: hotPackResult.result,
        //             processed: {
        //                 cached: 0,
        //                 hotPack: storeChunks.length,
        //                 written: hotPackResult.hotChunkWritten,
        //                 duplicated: hotPackResult.skipOnStableExist
        //             },
        //         }

        //     }
        //     // Fallback returns to this process
        // }

        const total = storeChunks.length;
        // --- Check cache
        if (!options.skipCache) {
            storeChunks = storeChunks.filter((chunk) => {
                const cached = this.getCachedChunk(chunk._id);
                if (cached) {
                    this.reorderChunk(chunk._id); // Update cache order
                    return false; // Do not save if already in cache
                }
                return true; // Save
            });
        }
        const afterPhase1 = storeChunks.length;
        writeResult.processed.cached = total - afterPhase1;

        // Chunks already cached are excluded
        if (storeChunks.length === 0) {
            return writeResult; // Success if there is nothing to save
        }
        // -- Save to the database
        const result = await this.database.bulkDocs(storeChunks, { new_edits: !options?.force });
        const failed = result.filter((res) => "error" in res) as PouchDB.Core.Error[];
        if (failed.some((res) => res.status !== 409)) {
            // Throw if there is any error other than 409
            throw new LiveSyncError(`Failed to write chunks: ${failed.map((res) => res.error).join(", ")}`, {
                status: 500,
            });
        }

        // If only 409, check contents
        const conflictedChunkIDs = failed
            .filter((res) => typeof res.id === "string")
            .map((res) => res.id as DocumentID);
        if (conflictedChunkIDs.length > 0) {
            writeResult.processed.duplicated = conflictedChunkIDs.length;
            const conflictedChunks = (await this.read(conflictedChunkIDs, { skipCache: false, timeout: 0 })).filter(
                (chunk) => chunk !== false
            );
            const originalChunks = buildChunkMap(chunks);
            for (const chunk of conflictedChunks) {
                const originalChunk = originalChunks.get(chunk._id);
                if (originalChunk && originalChunk.data === chunk.data) {
                    // This is safe
                    this.cacheChunk(chunk); // Add to cache
                } else {
                    // If a conflict occurs, throw an error and remove the cache as the read cannot be trusted
                    this.deleteCachedChunk(chunk._id);
                    throw new LiveSyncFatalError(
                        `Inconsistent chunk data for ${chunk._id}: local data differs from remote data. This is a fatal error.`
                    );
                }
            }
        }
        const writeCount = result.length - failed.length; // Number of chunks written
        writeResult.processed.written = writeCount;
        // -- If successful, save to cache
        for (const chunk of storeChunks) {
            this.cacheChunk(chunk); // Add to cache
        }
        return writeResult; // Success
    }

    concurrentTransactions = 0;

    stabilised = Promise.resolve();
    async transaction<T>(callback: () => Promise<T>): Promise<T> {
        // Start transaction
        await this.initialised;
        await this.stabilised; // Wait for the previous stabilisation to complete
        this.concurrentTransactions++;
        try {
            const result = await callback();
            return result;
        } finally {
            this.concurrentTransactions--;
            if (this.concurrentTransactions === 0) {
                Logger(`All transactions completed. Performing stabilisation.`, LOG_LEVEL_VERBOSE);
                // If no transactions are in progress, stabilise the managed cache
                await this._stabilise(); // Stabilise cache
            } else {
                Logger(`Transaction completed. Remaining: ${this.concurrentTransactions}`, LOG_LEVEL_VERBOSE);
            }
        }
    }
    async _stabilise() {
        const pr = promiseWithResolver<void>();
        this.stabilised = pr.promise;
        try {
            await this.__stabilise();
        } finally {
            pr.resolve(); // Resolve stabilisation promise
        }
    }
    __stabilise() {
        // Called when idle, can be used to process hot pack or other tasks
        // TODO: Implement hot pack processing
        return Promise.resolve(); // Placeholder for future implementation
    }
}
