import { APIBase, type IInitOptions } from "../base/APIBase";
export const EVENT_BROWSER_INFO_SUPPLIED = "browser-info-supplied";

export type BrowserInitOption = IInitOptions<{
    vaultName: string;
    manifestVersion?: string;
    packageVersion?: string;
}>;
export class BrowserAPIBase extends APIBase<BrowserInitOption> {}

declare global {
    interface LSEvents {
        [EVENT_BROWSER_INFO_SUPPLIED]: BrowserInitOption;
    }
}
