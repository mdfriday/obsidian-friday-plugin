import type { SavingEntry } from "../common/types";
import type { ContentSplitterOptions } from "./ContentSplitter";
import { ContentSplitterCore, type ContentSplitterBase } from "./ContentSplitterBase";
import { ContentSplitterRabinKarp } from "./ContentSplitterRabinKarp";
import { ContentSplitterV1 } from "./ContentSplitterV1";
import { ContentSplitterV2 } from "./ContentSplitterV2";

const ContentSplitters = [ContentSplitterV1, ContentSplitterV2, ContentSplitterRabinKarp];
/**
 * ContentSplitter class that manages the active content splitter based on the provided settings.
 */
export class ContentSplitter extends ContentSplitterCore {
    _activeSplitter!: ContentSplitterBase;
    constructor(options: ContentSplitterOptions) {
        super(options);
    }
    initialise(options: ContentSplitterOptions): Promise<boolean> {
        for (const Splitter of ContentSplitters) {
            if (Splitter.isAvailableFor(options)) {
                this._activeSplitter = new Splitter(options);
                break;
            }
        }
        if (!this._activeSplitter) {
            // Mostly this should not happen, but if no splitter is available, throw an error
            throw new Error(`ContentSplitter: No available splitter for settings!!`);
        }
        return this._activeSplitter.initialise(options);
    }
    async splitContent(
        entry: SavingEntry
    ): Promise<AsyncGenerator<string, void, unknown> | Generator<string, void, unknown>> {
        await this.initialised;
        return this._activeSplitter.splitContent(entry);
    }
}
