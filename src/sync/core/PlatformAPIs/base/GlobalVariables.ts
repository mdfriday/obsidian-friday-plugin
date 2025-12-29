import { isObjectDifferent } from "octagonal-wheels/object";
import type { IGlobalVariables } from "../interfaces.ts";
import { APIBase } from "./APIBase.ts";
import { promiseWithResolver } from "octagonal-wheels/promises";
// import type { Globals } from "../Synchromesh.ts";

export abstract class GlobalVariablesBase<T extends object, U extends Globals>
    extends APIBase<T>
    implements IGlobalVariables<U>
{
    _buffer = new Map<string, any>();

    _onChangeCallbacks = new Map<string, WeakRef<(value: any) => void>[]>();

    handleStateUpdate(key: string, value: any): void {
        const previousValue = this._buffer.get(key);
        const hasChanged = isObjectDifferent(previousValue, value);
        if (!hasChanged) {
            return;
        }
        this._buffer.set(key, value);

        const callback = this._onChangeCallbacks.get(key);
        if (callback) {
            const callbacks = callback.map((cb) => [cb, cb.deref()] as const);
            const filteredCallbacks = callbacks.filter((cb) => cb[1] !== undefined);
            if (filteredCallbacks.length === 0) {
                this._onChangeCallbacks.delete(key);
            } else {
                this._onChangeCallbacks.set(
                    key,
                    filteredCallbacks.map((cb) => cb[0])
                );
            }
            const promises = filteredCallbacks.map((cb) =>
                new Promise(() => cb[1]?.(value))
                    .then(() => {})
                    .catch((e) => {
                        console.error(`Error in callback for key ${key}:`, e);
                    })
            );
            void Promise.all(promises);
        }
    }

    addCallback<K extends keyof U>(key: K, callback: (value: U[K]) => void): void {
        const existingCallbacks = this._onChangeCallbacks.get(key as string) || [];
        existingCallbacks.push(new WeakRef(callback));
        this._onChangeCallbacks.set(key as string, existingCallbacks);
    }

    set<K extends keyof U>(key: K, value: U[K]): void {
        this.handleStateUpdate(key as string, value);
    }

    get<K extends keyof U>(key: K): U[K] | undefined {
        const value = this._buffer.get(key as string);
        if (value !== undefined) {
            return value;
        } else {
            return undefined;
        }
    }

    delete<K extends keyof U>(key: K): void {
        this.handleStateUpdate(key as string, undefined);
        this._buffer.delete(key as string);
        this._onChangeCallbacks.delete(key as string);
    }

    has<K extends keyof U>(key: K): boolean {
        return this._buffer.has(key as string);
    }

    update<K extends keyof U>(key: K, value: Partial<U[K]>): void {
        const currentValue = this._buffer.get(key as string) || {};
        const newValue = { ...currentValue, ...value };
        this.handleStateUpdate(key as string, newValue);
    }

    watch<K extends keyof U>(key: K, callback: (value: U[K]) => void): void {
        this.addCallback(key, callback);
    }

    unwatch<K extends keyof U>(key: K, callback: (value: U[K]) => void): void {
        const existingCallbacks = this._onChangeCallbacks.get(key as string) || [];
        const index = existingCallbacks.findIndex((cb) => cb.deref() === callback);
        if (index !== -1) {
            existingCallbacks.splice(index, 1);
            this._onChangeCallbacks.set(key as string, existingCallbacks);
        }
    }

    unwatchAll<K extends keyof U>(key: K): void {
        this._onChangeCallbacks.delete(key as string);
    }

    waitForCondition<K extends keyof U>(key: K, condition: (value: U[K]) => boolean): Promise<U[K] | undefined> {
        const task = promiseWithResolver<U[K] | undefined>();
        const callback = (value: U[K]) => {
            if (condition(value)) {
                task.resolve(value);
                this.unwatch(key, callback);
            }
        };
        this.watch(key, callback);
        return task.promise;
    }
}

let _instance: IGlobalVariables<Globals> | undefined = undefined;
const p = promiseWithResolver<IGlobalVariables<Globals>>();
export function setGlobalVariablesInstance<T extends Globals>(instance: IGlobalVariables<T>) {
    if (!_instance) {
        _instance = instance;
        p.resolve(instance);
    } else {
        _instance = instance;
    }
}

export function getGlobalVariablesInstance<T extends Globals>(): Promise<IGlobalVariables<T>> {
    if (!_instance) {
        return p.promise as Promise<IGlobalVariables<T>>;
    } else {
        return Promise.resolve(_instance) as Promise<IGlobalVariables<T>>;
    }
}
