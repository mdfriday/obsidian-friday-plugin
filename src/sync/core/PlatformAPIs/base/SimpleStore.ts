import { promiseWithResolver } from "octagonal-wheels/promises";
import type { SimpleStoreBase, SimpleStore } from "octagonal-wheels/databases/SimpleStoreBase";
import type { ISimpleStoreAPI } from "../interfaces.ts";
import { getEnvironmentInstance } from "../Environment";
import { APIBase } from "../base/APIBase.ts";

export abstract class PlatformSimpleStore extends APIBase<object> implements ISimpleStoreAPI<object> {
    abstract initBackend(param: string): SimpleStoreBase<any>;

    _backendStore!: SimpleStoreBase<any>;

    override async onInit() {
        // After the environment is supplied, we can get the vault name
        // Hence, we can create a simple store for the vault
        const app = (await getEnvironmentInstance()).getVaultName();
        this._backendStore = this.initBackend(`${app}-simple-store`);
        this._isReady = true;
    }
    override async onDisposed(): Promise<void> {
        this._isDisposed = true;
        await this._backendStore.close();
    }

    getSimpleStore<T>(kind: string): SimpleStore<T> {
        const prefix = `${kind}-`;
        return {
            get: async (key: string): Promise<T> => {
                return await this._backendStore.get(`${prefix}${key}`);
            },
            set: async (key: string, value: T): Promise<void> => {
                await this._backendStore.set(`${prefix}${key}`, value);
            },
            delete: async (key: string): Promise<void> => {
                await this._backendStore.delete(`${prefix}${key}`);
            },
            keys: async (
                from: string | undefined,
                to: string | undefined,
                count?: number | undefined
            ): Promise<string[]> => {
                const ret = (this._backendStore as SimpleStoreBase<T>).keys(
                    `${prefix}${from || ""}`,
                    `${prefix}${to || ""}`,
                    count
                );
                return (
                    (await ret)
                        // .map((e) => e.toString() as string)
                        .filter((e) => e.startsWith(prefix))
                        .map((e) => e.substring(prefix.length))
                );
            },
        };
    }

    async dropSimpleStore(kind: string): Promise<void> {
        const usedKeys = await this._backendStore.keys(`${kind}-`, `${kind}-\uffff`);
        for (const k of usedKeys) {
            await this._backendStore.delete(k);
        }
    }
}

let instance: ISimpleStoreAPI | undefined = undefined;
const p = promiseWithResolver<ISimpleStoreAPI>();
export function setSimpleStoreInstance(store: ISimpleStoreAPI) {
    if (!instance) {
        instance = store;
        p.resolve(store);
    } else {
        instance = store;
    }
}
export function getSimpleStoreInstance(): Promise<PlatformSimpleStore> {
    if (!instance) {
        return p.promise as Promise<PlatformSimpleStore>;
    } else {
        return Promise.resolve(instance) as Promise<PlatformSimpleStore>;
    }
}
