import type { Confirm } from "../interfaces/Confirm.ts";
import { getConfirmInstance } from "./Confirm.ts";
import { getEnvironmentInstance } from "./Environment.ts";
import type { IEnvironment, IGlobalVariables, ISimpleStoreAPI } from "./interfaces.ts";
import { getSimpleStoreInstance } from "./base/SimpleStore.ts";
import { getGlobalVariablesInstance } from "./base/GlobalVariables.ts";

// TypeScript's interface is open to extension, so we can add our own properties to it on your own projects.
declare global {
    export interface Globals {
        hello: { world: string };
    }
}

export type Synchronised = {
    confirm: Confirm;
    environment: IEnvironment;
    simpleStoreAPI: ISimpleStoreAPI<any>;
    globalVariables: IGlobalVariables<Globals>;
};

export async function Synchromesh(): Promise<Synchronised> {
    const instances = await Promise.all([
        getConfirmInstance(),
        getEnvironmentInstance(),
        getSimpleStoreInstance(),
        getGlobalVariablesInstance<Globals>(),
    ]);
    const [confirm, environment, simpleStoreAPI, globalVariables] = instances;
    return { confirm, environment, simpleStoreAPI, globalVariables };
}
