import { MAX_DOC_SIZE_BIN, ChunkAlgorithms, type SavingEntry } from "../common/types.ts";
import { createTextBlob } from "../common/utils.ts";
import { shouldSplitAsPlainText } from "../string_and_binary/path.ts";
import { type ContentSplitterOptions, type SplitOptions, MAX_CHUNKS_SIZE_ON_UI } from "./ContentSplitter.ts";

export abstract class ContentSplitterCore {
    /**
     * Options for the content splitter.
     * These settings include the chunk splitter version and other configurations.
     */
    options: ContentSplitterOptions;
    /**
     * Task for initialising the content splitter.
     * This ensures that the splitter is initialised before any operations are performed.
     */
    initialised: Promise<boolean> | undefined;

    /**
     * Constructor for the content splitter core.
     * @param params Content splitter options
     */
    constructor(params: ContentSplitterOptions) {
        this.options = params;
        this.initialised = this.initialise(params);
    }

    /**
     * Initialise the content splitter with the provided options.
     * @param options Content splitter options
     */
    abstract initialise(options: ContentSplitterOptions): Promise<boolean>;

    /**
     * Split the content of the loaded entry into chunks.
     * @param entry The loaded entry to be split into chunks
     */
    abstract splitContent(
        entry: SavingEntry
    ): Promise<AsyncGenerator<string, void, unknown> | Generator<string, void, unknown>>;
}

export abstract class ContentSplitterBase extends ContentSplitterCore {
    initialise(_options: ContentSplitterOptions): Promise<boolean> {
        return Promise.resolve(true); // Default implementation, should be overridden
    }

    /**
     * Check whether the content splitter is available for the given settings.
     * @param setting Content splitter options
     * @returns True if the content splitter is available; false otherwise
     */
    static isAvailableFor(setting: ContentSplitterOptions): boolean {
        return false; // Default implementation, should be overridden
    }

    /**
     * Process the content and split it into chunks.
     * @param options Blob content to be split into chunks
     */
    abstract processSplit(
        options: SplitOptions
    ): Promise<AsyncGenerator<string, void, unknown> | Generator<string, void, unknown>>;

    getParamsFor(entry: SavingEntry): SplitOptions {
        const maxChunkSize = Math.floor(MAX_DOC_SIZE_BIN * ((this.options.settings.customChunkSize || 0) * 1 + 1));
        const pieceSize = maxChunkSize;

        const minimumChunkSize = this.options.settings.minimumChunkSize;
        const path = entry.path;

        const plainSplit = shouldSplitAsPlainText(path);
        const maxSize = MAX_CHUNKS_SIZE_ON_UI;
        const blob = entry.data instanceof Blob ? entry.data : createTextBlob(entry.data);
        let useWorker = true;
        if (this.options.settings.disableWorkerForGeneratingChunks) {
            useWorker = false;
        }
        if (useWorker && this.options.settings.processSmallFilesInUIThread) {
            if (blob.size <= maxSize) {
                useWorker = false;
            }
        }
        const useSegmenter = this.options.settings.chunkSplitterVersion === ChunkAlgorithms.V2Segmenter;
        return {
            blob,
            path,
            pieceSize,
            plainSplit,
            minimumChunkSize,
            useWorker,
            useSegmenter,
        };
    }

    /**
     * Split the content of the loaded entry into chunks.
     * This method waits for the initialisation task to complete before proceeding.
     * @param entry The loaded entry to be split into chunks
     * @returns A generator that yields the split chunks
     */
    async splitContent(
        entry: SavingEntry
    ): Promise<AsyncGenerator<string, void, unknown> | Generator<string, void, unknown>> {
        await this.initialised;
        const options = this.getParamsFor(entry);
        const generator = await this.processSplit(options);
        return generator;
    }
}
