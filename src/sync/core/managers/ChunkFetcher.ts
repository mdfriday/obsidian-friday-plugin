import { delay } from "octagonal-wheels/promises";
import { unique } from "octagonal-wheels/collection";
import { LOG_LEVEL_VERBOSE, Logger } from "../common/logger.ts";
import { DEFAULT_SETTINGS, type DocumentID, type EntryLeaf, type RemoteDBSettings } from "../common/types.ts";

import type { LiveSyncAbstractReplicator } from "../replication/LiveSyncAbstractReplicator.ts";

import { EVENT_CHUNK_FETCHED, type ChunkManager } from "./ChunkManager.ts";

export const EVENT_MISSING_CHUNKS = "missingChunks";
export const EVENT_MISSING_CHUNK_REMOTE = "missingChunkRemote";

export type ChunkFetcherOptions = {
    settings: RemoteDBSettings;
    chunkManager: ChunkManager;
    getActiveReplicator: () => LiveSyncAbstractReplicator;
};
const BATCH_SIZE = 100; // Number of chunks to fetch in one request

export class ChunkFetcher {
    options: ChunkFetcherOptions;
    get chunkManager(): ChunkManager {
        return this.options.chunkManager;
    }

    queue = [] as DocumentID[];

    get interval(): number {
        return (
            this.options.settings.minimumIntervalOfReadChunksOnline ||
            DEFAULT_SETTINGS.minimumIntervalOfReadChunksOnline
        );
    }

    get concurrency(): number {
        return this.options.settings.concurrencyOfReadChunksOnline || DEFAULT_SETTINGS.concurrencyOfReadChunksOnline;
    }

    abort: AbortController = new AbortController();
    constructor(options: ChunkFetcherOptions) {
        this.options = options;
        // TODO: Confirm whether this is correctly dereferenced upon instance re-creation. EventTarget may handle this safely.
        this.chunkManager.addListener(EVENT_MISSING_CHUNKS, this.onEventHandler, {
            signal: this.abort.signal,
        });
    }
    destroy(): void {
        this.abort.abort(); // Abort any ongoing requests.
        this.queue = []; // Clear the queue.
    }
    onEventHandler = this.onEvent.bind(this);

    onEvent(ids: DocumentID[]): void {
        this.queue = unique([...this.queue, ...ids]);
        if (this.canRequestMore()) {
            setTimeout(() => void this.requestMissingChunks(), 1);
        }
    }

    /**
     * Processing requests
     */
    currentProcessing = 0;
    /**
     * Time of the last request to the remote server.
     * This is used to manage the interval between requests.
     * Even if concurrency allows, every start of a request will ensure that the interval is respected.
     */
    previousRequestTime = 0;

    canRequestMore(): boolean {
        return this.currentProcessing < this.concurrency && this.queue.length > 0;
    }

    async requestMissingChunks(): Promise<void> {
        if (!this.canRequestMore()) {
            return; // Do not proceed if the concurrency limit is reached or the queue is empty.
        }
        try {
            // Logger(`Requesting missing chunks: ${this.queue.join(", ")}`);
            this.currentProcessing++;
            const requestIDs = this.queue.splice(0, BATCH_SIZE);
            const now = Date.now();
            const timeSinceLastRequest = now - this.previousRequestTime;
            this.previousRequestTime = now;
            const timeToWait = Math.max(this.interval - timeSinceLastRequest, 0);
            if (timeToWait > 0) await delay(timeToWait);
            const replicator = this.options.getActiveReplicator();
            if (!replicator) {
                Logger("No active replicator was found to request missing chunks.");
                return;
            }
            // Request the replicator to fetch the missing chunks.
            const fetched = await replicator.fetchRemoteChunks(requestIDs, false);
            if (!fetched) {
                Logger(`No chunks were found for the following IDs: ${requestIDs.join(", ")}`);
                for (const chunkID of requestIDs) {
                    this.chunkManager.emitEvent(EVENT_MISSING_CHUNK_REMOTE, chunkID);
                }
                return;
            }
            // Validate fetched chunks (Now I am wondering why it happened...)
            function isValidChunk(chunk: Partial<EntryLeaf>): chunk is EntryLeaf {
                return chunk && typeof chunk?._id === "string" && typeof chunk?.data === "string";
            }
            const chunks = fetched.filter((chunk) => isValidChunk(chunk));
            if (chunks.length !== fetched.length) {
                Logger(
                    `Some fetched chunks are invalid and will be ignored: (${fetched.length - chunks.length} / ${fetched.length}).`,
                    LOG_LEVEL_VERBOSE
                );
                for (const chunk of fetched) {
                    if (!isValidChunk(chunk)) {
                        Logger(`Invalid chunk: ${JSON.stringify(chunk)}`, LOG_LEVEL_VERBOSE);
                    }
                }
            }
            if (chunks.length === 0) {
                Logger(`No valid chunks were found for the following IDs: ${requestIDs.join(", ")}`);
            }
            const missingIDs = requestIDs.filter((id) => !chunks.some((chunk) => chunk._id === id));
            try {
                if (chunks.length === 0) {
                    return;
                }
                Logger(`Writing fetched chunks (${chunks.length}) to the database...`);
                const result = await this.chunkManager.write(
                    chunks,
                    {
                        skipCache: true,
                        force: true, // Force writing to ensure the chunks with existing _rev.
                    },
                    "ChunkFetcher" as DocumentID
                );
                if (result.result === true) {
                    // Successfully written to the database
                    Logger(`Fetched chunks were stored successfully: ${chunks.length}`, LOG_LEVEL_VERBOSE);
                } else {
                    Logger(
                        `Fetched chunks could not be stored: ${chunks.map((chunk) => chunk._id).join(", ")}`,
                        LOG_LEVEL_VERBOSE
                    );
                }
            } catch (error) {
                Logger(`An error occurred while storing fetched chunks: ${error}`, LOG_LEVEL_VERBOSE);
            } finally {
                // Emitting fetched chunks and missing IDs regardless of write success (just only refetch will be triggered).
                for (const chunk of chunks) {
                    this.chunkManager.emitEvent(EVENT_CHUNK_FETCHED, chunk);
                }
                for (const chunkID of missingIDs) {
                    this.chunkManager.emitEvent(EVENT_MISSING_CHUNK_REMOTE, chunkID);
                }
            }
            // The queue is cleared after requesting.
        } finally {
            this.currentProcessing--;
            this.previousRequestTime = Date.now();
            if (this.queue.length > 0) {
                // If there are remaining items in the queue, trigger the next process.
                // Use setTimeout to release the call stack once.
                setTimeout(() => void this.requestMissingChunks(), 0);
            }
        }
    }
}
