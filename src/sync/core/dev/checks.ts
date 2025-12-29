import { LOG_LEVEL_VERBOSE, Logger } from "octagonal-wheels/common/logger";

type InstanceHaveOnBindFunction = {
    onBindFunction: (core: any, services: any) => void;
} & Record<string, any>;

export function __$checkInstanceBinding<T extends InstanceHaveOnBindFunction>(instance: T) {
    const thisName = instance.constructor.name;
    const functions = [] as string[];
    for (const key of Object.getOwnPropertyNames(Object.getPrototypeOf(instance))) {
        if (key.startsWith("_") && !key.startsWith("__")) {
            const method = instance[key];
            if (typeof method === "function") {
                // console.warn(`${thisName}.${key}`);
                functions.push(`${thisName}.${key}`);
            }
        }
    }
    const onBindFunctionStr = instance.onBindFunction.toString();
    const functionsOnBindFunction = [];
    const functionsOnBindFunctionMatch = onBindFunctionStr.match(/this\.(_[a-zA-Z0-9_]+)/g);
    if (functionsOnBindFunctionMatch) {
        functionsOnBindFunction.push(
            ...functionsOnBindFunctionMatch.map((f) => `${thisName}.${f.replace(/this\./, "")}`)
        );
    }
    const setOfThisFunctions = new Set(functions);
    const setOfOnBindFunctions = new Set(functionsOnBindFunction);
    const setAll = new Set([...setOfThisFunctions, ...setOfOnBindFunctions]);
    const missingInThis = [...setAll].filter((e) => !setOfThisFunctions.has(e));
    const missingInOnBind = [...setAll].filter((e) => !setOfOnBindFunctions.has(e));
    if (missingInThis.length > 0) {
        Logger(`[${thisName}] ⚠️ Missing functions in this: ${missingInThis.join(", ")}`);
    }
    if (missingInOnBind.length > 0) {
        Logger(`[${thisName}] ⚠️ Missing functions in onBindFunction: ${missingInOnBind.join(", ")}`);
    }
    if (missingInThis.length == 0 && missingInOnBind.length == 0) {
        Logger(`[${thisName}] All functions are properly bound`, LOG_LEVEL_VERBOSE);
    }
}
