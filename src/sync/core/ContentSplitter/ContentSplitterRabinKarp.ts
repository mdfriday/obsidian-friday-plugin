import { ChunkAlgorithms } from "../common/types.ts";
import { splitPiecesRabinKarp } from "../string_and_binary/chunks.ts";
import { splitPieces2WorkerRabinKarp } from "../worker/bgWorker.ts";
import type { ContentSplitterOptions, SplitOptions } from "./ContentSplitter.ts";
import { ContentSplitterBase } from "./ContentSplitterBase.ts";
/**
 * Rabin-Karp content splitter for efficient chunking
 */
export class ContentSplitterRabinKarp extends ContentSplitterBase {
    static isAvailableFor(setting: ContentSplitterOptions): boolean {
        return setting.settings.chunkSplitterVersion === ChunkAlgorithms.RabinKarp;
    }
    async processSplit(
        options: SplitOptions
    ): Promise<AsyncGenerator<string, void, unknown> | Generator<string, void, unknown>> {
        if (options.useWorker) {
            return splitPieces2WorkerRabinKarp(
                options.blob,
                options.pieceSize,
                options.plainSplit,
                options.minimumChunkSize,
                options.path
            )();
        } else {
            return (
                await splitPiecesRabinKarp(
                    options.blob,
                    options.pieceSize,
                    options.plainSplit,
                    options.minimumChunkSize,
                    options.path
                )
            )();
        }
    }
}
