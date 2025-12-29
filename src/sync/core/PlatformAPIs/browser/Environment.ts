import { EVENT_BROWSER_INFO_SUPPLIED, BrowserAPIBase, type BrowserInitOption } from "./base";
import type { IEnvironment as IEnvironment } from "../interfaces";
import { eventHub } from "../../hub/hub";
import { setEnvironmentInstance } from "../Environment";

let webcrypto: Crypto;
export async function getWebCrypto() {
    if (webcrypto) {
        return webcrypto;
    }
    if (globalThis.crypto) {
        webcrypto = globalThis.crypto;
        return webcrypto;
    } else {
        const module = await import("node:crypto");
        webcrypto = module.webcrypto as Crypto;
        return webcrypto;
    }
}
export function getPlatformName() {
    return "web-browser-shim";
}

export declare const PACKAGE_VERSION: string;
export declare const MANIFEST_VERSION: string;

export class Environment extends BrowserAPIBase implements IEnvironment<BrowserInitOption> {
    _vaultName: string;
    _manifestVersion: string;
    _packageVersion: string;
    constructor(opt: BrowserInitOption) {
        super();
        this._vaultName = opt.vaultName;
        this._manifestVersion = opt.manifestVersion || `${MANIFEST_VERSION}` || "0.0.0";
        this._packageVersion = opt.packageVersion || `${PACKAGE_VERSION}` || "0.0.0";
    }
    override async onInit(): Promise<void> {
        this.crypto = await getWebCrypto();
    }
    crypto!: Crypto;
    getPackageVersion(): string {
        return this._packageVersion;
    }
    getManifestVersion(): string {
        return this._manifestVersion;
    }
    getVaultName(): string {
        return this._vaultName;
    }
    getPlatformName(): string {
        return "web-browser-shim";
    }
}

eventHub.onceEvent(EVENT_BROWSER_INFO_SUPPLIED, (info) => {
    const platformAPI = new Environment(info);
    void platformAPI.onInit().then(() => setEnvironmentInstance(platformAPI));
});
