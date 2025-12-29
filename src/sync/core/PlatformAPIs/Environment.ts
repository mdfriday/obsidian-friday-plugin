import { promiseWithResolver } from "octagonal-wheels/promises";
import { eventHub } from "../hub/hub.ts";
import { EVENT_PLATFORM_UNLOADED } from "./base/APIBase.ts";
import type { IEnvironment } from "./interfaces.ts";

eventHub.onceEvent(EVENT_PLATFORM_UNLOADED, () => {
    instance = undefined;
    p.resolve(undefined!);
});

let instance: IEnvironment | undefined = undefined;
const p = promiseWithResolver<IEnvironment>();
export function setEnvironmentInstance(env: IEnvironment) {
    if (!instance) {
        instance = env;
        p.resolve(env);
    } else {
        instance = env;
    }
}
export function getEnvironmentInstance<T extends object = object>(): Promise<IEnvironment<T>> {
    if (!instance) {
        return p.promise as Promise<IEnvironment<T>>;
    } else {
        return Promise.resolve(instance) as Promise<IEnvironment<T>>;
    }
}
