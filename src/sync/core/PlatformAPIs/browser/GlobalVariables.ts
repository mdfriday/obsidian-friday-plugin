import { setGlobalVariablesInstance, GlobalVariablesBase } from "../base/GlobalVariables.ts";
import type { BrowserInitOption } from "../browser/base.ts";

export class GlobalVariables extends GlobalVariablesBase<BrowserInitOption, Globals> {
    constructor() {
        super();
    }
}

const instance = new GlobalVariables();
setGlobalVariablesInstance(instance);
export { getGlobalVariablesInstance } from "../base/GlobalVariables.ts";
