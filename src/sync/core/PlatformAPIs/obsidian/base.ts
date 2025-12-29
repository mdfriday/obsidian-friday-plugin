import { App } from "obsidian";
import { APIBase, type IInitOptions } from "../base/APIBase";
export const EVENT_APP_SUPPLIED = "app-supplied";

declare global {
    interface LSEvents {
        [EVENT_APP_SUPPLIED]: App;
    }
}
export type ObsidianInitOptions = IInitOptions<{
    app: App;
}>;
export class ObsidianAPIBase extends APIBase<ObsidianInitOptions> {
    app: App;
    constructor(options: ObsidianInitOptions) {
        super();
        this.app = options.app;
    }
}
