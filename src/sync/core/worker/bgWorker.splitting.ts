// Foreground part of Content-Splitter

import { LOG_LEVEL_VERBOSE, Logger } from "../common/logger.ts";
import { startWorker } from "./bgWorker.ts";
import { type SplitProcessItem } from "./universalTypes";

const SYMBOL_USED = Symbol("used");
const SYMBOL_END_OF_DATA = Symbol("endOfData");
type SYMBOL_USED = typeof SYMBOL_USED;
type SYMBOL_END_OF_DATA = typeof SYMBOL_END_OF_DATA;

const workerStreams = new Map<number, TransformStream<string | null, string | null>>();
const writers = new Map<number, WritableStreamDefaultWriter<string | null>>();

const responseBuf = new Map<number, Map<number, string | SYMBOL_USED | SYMBOL_END_OF_DATA>>();

let writerPromise = Promise.resolve(); // Just process serialiser

/**
 * Splits data into pieces using a worker.
 * @param dataSrc The source data to be split.
 * @param pieceSize The size of each piece.
 * @param plainSplit Whether to use plain splitting.
 * @param minimumChunkSize The minimum size of each chunk.
 * @param filename The name of the file being processed.
 * @param splitVersion The version of the splitting algorithm to use.
 * @param useSegmenter Whether to use a segmenter (only works on splitVersion:2)
 * @returns A generator that yields the split pieces.
 */
export function _splitPieces2Worker(
    dataSrc: Blob,
    pieceSize: number,
    plainSplit: boolean,
    minimumChunkSize: number,
    filename: string | undefined,
    splitVersion: 1 | 2 | 3,
    useSegmenter: boolean
) {
    // Prepare the worker, since here, handleTaskSplit can be called.
    // Do not use asynchronous call until setting the writers.
    const process = startWorker({
        type: "split",
        dataSrc,
        pieceSize,
        plainSplit,
        minimumChunkSize,
        filename,
        useSegmenter,
        splitVersion,
    });
    const _key = process.key;
    const stream = new TransformStream<string | null, string>({
        transform: (chunk, controller) => {
            // If chunk is null, it means the end of data, so we should terminate the stream
            if (chunk === null) {
                controller.terminate();
                return;
            }
            // While chunk has arrived, we can process it on the reader
            controller.enqueue(chunk);
        },
        flush: () => {},
    });

    // Register the stream and its reader/writer
    workerStreams.set(_key, stream);
    const readable = stream.readable;
    const reader = readable.getReader();
    const writer = stream.writable.getWriter();
    // Lock the writer for this stream
    writers.set(_key, writer);
    // Okay, we are ready to respond, create the generator function.
    return async function* () {
        try {
            let done = false;
            do {
                // Reading from the stream (I am so happy on iOS 14.5+).
                const results = await reader.read();
                done = results.done;
                if (done) {
                    break;
                }
                yield results.value!; // results.value is never null here
            } while (!done);
        } catch (ex) {
            Logger(`Error in worker stream for key ${_key}`);
            Logger(ex, LOG_LEVEL_VERBOSE);
            throw ex;
        } finally {
            // Tearing down.
            process.finalize();
            workerStreams.delete(_key);
            writers.delete(_key);
        }
    };
}

/**
 * Handles the splitting callback from the worker.
 * @param process the splitting process item
 * @param data the data received from the worker
 */
export function handleTaskSplit(process: SplitProcessItem, data: any) {
    // Data key means the unique identifier for the splitting task
    const key = data.key as number;

    if (!("result" in data)) {
        responseBuf.delete(key);
        const reportError = data.error || new Error("Unknown error in background splitting");
        writerPromise = writerPromise.then(async () => {
            const writer = writers.get(key);
            if (writer) {
                await writer.abort(reportError);
            }
        });
    }
    let thisBuf = responseBuf.get(key);
    if (!thisBuf) {
        thisBuf = new Map<number, string | SYMBOL_USED | SYMBOL_END_OF_DATA>();
        responseBuf.set(key, thisBuf);
    }

    const seq = data.seq as number;
    thisBuf.set(seq, data.result === null ? SYMBOL_END_OF_DATA : data.result);
    responseBuf.set(key, thisBuf);

    const keys = Array.from(thisBuf.keys()).sort((a, b) => a - b);
    const max = keys[keys.length - 1];
    for (let i = 0; i <= max; i++) {
        const result = thisBuf.get(i);
        if (result === undefined) {
            // Some intermediate results have not arrived yet
            break;
        }
        if (result === SYMBOL_USED) {
            // If marked as used, we can proceed to the next item
            continue;
        }

        // -- Results until `i` are fulfilled
        // Mark as used
        thisBuf.set(i, SYMBOL_USED);
        responseBuf.set(key, thisBuf);
        writerPromise = writerPromise.then(async () => {
            // Sending NULL for end of data causes the stream to close, no need to call close()
            const writer = writers.get(key);
            if (!writer) {
                throw new Error(`Invalid writer for key ${key} in background splitting`);
            }
            await writer.write(result === SYMBOL_END_OF_DATA ? null : result);
        });
    }
}
