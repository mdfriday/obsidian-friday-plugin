import { EVENT_APP_SUPPLIED, ObsidianAPIBase, type ObsidianInitOptions } from "./base";
import type { IEnvironment as IEnvironment } from "../interfaces";
import { Platform, type App } from "obsidian";
import { eventHub } from "../../hub/hub";
import { setEnvironmentInstance } from "../Environment";

let webcrypto: Crypto;
export function getWebCrypto() {
    if (webcrypto) {
        return Promise.resolve(webcrypto);
    }
    if (globalThis.crypto) {
        webcrypto = globalThis.crypto;
        return Promise.resolve(webcrypto);
    } else {
        throw new Error("WebCrypto not available");
    }
}
export function getPlatformName() {
    if (Platform.isAndroidApp) {
        return "android-app";
    } else if (Platform.isIosApp) {
        return "ios";
    } else if (Platform.isMacOS) {
        return "macos";
    } else if (Platform.isMobileApp) {
        return "mobile-app";
    } else if (Platform.isMobile) {
        return "mobile";
    } else if (Platform.isSafari) {
        return "safari";
    } else if (Platform.isDesktop) {
        return "desktop";
    } else if (Platform.isDesktopApp) {
        return "desktop-app";
    } else {
        return "unknown-obsidian";
    }
}

export declare const PACKAGE_VERSION: string;
export declare const MANIFEST_VERSION: string;

export class Environment extends ObsidianAPIBase implements IEnvironment<ObsidianInitOptions> {
    override async onInit(): Promise<void> {
        this.crypto = await getWebCrypto();
    }
    crypto!: Crypto;
    getPlatformName(): string {
        return getPlatformName();
    }
    getPackageVersion(): string {
        const packageVersion: string = `${PACKAGE_VERSION}` || "0.0.0";
        return packageVersion;
    }
    getManifestVersion(): string {
        const manifestVersion: string = `${MANIFEST_VERSION}` || "0.0.0";
        return manifestVersion;
    }
    getVaultName(): string {
        return this.app.vault.getName();
    }
}

eventHub.onceEvent(EVENT_APP_SUPPLIED, (app: App) => {
    const platformAPI = new Environment({ app });
    void platformAPI.onInit().then(() => setEnvironmentInstance(platformAPI));
});
