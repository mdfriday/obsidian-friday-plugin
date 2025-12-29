import { ChunkAlgorithms } from "../common/types";
import { splitPieces2 } from "../string_and_binary/chunks";
import { splitPieces2Worker } from "../worker/bgWorker";
import type { ContentSplitterOptions, SplitOptions } from "./ContentSplitter";
import { ContentSplitterBase } from "./ContentSplitterBase";

/**
 * Legacy content splitter for version 1.
 */
export class ContentSplitterV1 extends ContentSplitterBase {
    static isAvailableFor(setting: ContentSplitterOptions): boolean {
        return (
            setting.settings.chunkSplitterVersion === ChunkAlgorithms.V1 || setting.settings.chunkSplitterVersion === ""
        );
    }
    async processSplit(
        options: SplitOptions
    ): Promise<AsyncGenerator<string, void, unknown> | Generator<string, void, unknown>> {
        if (options.useWorker) {
            return splitPieces2Worker(
                options.blob,
                options.pieceSize,
                options.plainSplit,
                options.minimumChunkSize,
                options.path,
                options.useSegmenter
            )();
        } else {
            return (
                await splitPieces2(
                    options.blob,
                    options.pieceSize,
                    options.plainSplit,
                    options.minimumChunkSize,
                    options.path,
                    options.useSegmenter
                )
            )();
        }
    }
}
