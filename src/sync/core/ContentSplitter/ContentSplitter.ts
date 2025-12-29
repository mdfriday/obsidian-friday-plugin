/**
 * Content-Splitter for Self-hosted LiveSync.
 * Splits content into manageable chunks for efficient storage and synchronisation.
 */
import { type FilePathWithPrefix, type RemoteDBSettings } from "../common/types.ts";

/**
 * ContentSplitter interface for splitting content into chunks.
 */
export type SplitOptions = {
    blob: Blob;
    path: FilePathWithPrefix;
    pieceSize: number;
    plainSplit: boolean;
    minimumChunkSize: number;
    useWorker: boolean;
    useSegmenter: boolean;
};

/**
 * The maximum size, in bytes, of a document to be processed by the content splitter in the foreground.
 */
export const MAX_CHUNKS_SIZE_ON_UI = 1024;

/**
 * Options for the content splitter.
 */
export type ContentSplitterOptions = {
    settings: RemoteDBSettings;
};
