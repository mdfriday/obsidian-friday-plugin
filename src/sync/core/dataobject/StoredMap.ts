import type { SimpleStore } from "octagonal-wheels/databases/SimpleStoreBase";

export class StoredMapLike<U> {
    _store: SimpleStore<U>;
    _cache: Map<string, U> = new Map();
    _prefix: string = "";
    constructor(store: SimpleStore<Awaited<U>>, prefix: string = "") {
        this._store = store;
    }
    addPrefix(key: string) {
        return `${this._prefix}-${key}`;
    }

    async get(key: string): Promise<U | undefined> {
        if (this._cache.has(key)) return this._cache.get(key);
        const value = (await this._store.get(this.addPrefix(key))) as U | undefined;
        if (value !== undefined) {
            this._cache.set(key, value);
        }
        return value;
    }
    async set(key: string, value: U) {
        try {
            const ret = await this._store.set(this.addPrefix(key), value);
            // Prevent cache poisoning
            this._cache.set(key, value);
            return ret;
        } catch (e) {
            this._cache.delete(key);
            throw e;
        }
    }
    async delete(key: string) {
        try {
            const ret = await this._store.delete(this.addPrefix(key));
            this._cache.delete(key);
            return ret;
        } catch (e) {
            this._cache.delete(key);
            throw e;
        }
    }
    async has(key: string) {
        if (this._cache.has(key)) return true;
        const e = await this._store.keys(this.addPrefix(key), key);
        return e.length > 0;
    }
}
