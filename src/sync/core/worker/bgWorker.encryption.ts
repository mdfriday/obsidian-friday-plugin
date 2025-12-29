// Foreground part of offloaded encryptions

import { startWorker, tasks } from "./bgWorker.ts";
import { type EncryptHKDFProcessItem } from "./universalTypes.ts";
import { type EncryptProcessItem } from "./universalTypes.ts";
import { type EncryptHKDFArguments } from "./universalTypes.ts";
import { type EncryptArguments } from "./universalTypes.ts";

/**
 * Offloads encryption to a web worker.
 * @param data The data to be encrypted.
 * @returns A promise that resolves with the encryption result.
 */
export function encryptionOnWorker(data: Omit<EncryptArguments, "key">) {
    const process = startWorker(data);
    return (async () => {
        const ret = await process.task.promise;
        process.finalize();
        return ret;
    })();
}

/**
 * Offloads HKDF encryption to a web worker.
 * @param data The data to be encrypted.
 * @returns A promise that resolves with the encryption result.
 */
export function encryptionHKDFOnWorker(data: Omit<EncryptHKDFArguments, "key">) {
    const process = startWorker(data);
    return (async () => {
        const ret = await process.task.promise;
        process.finalize();
        return ret;
    })();
}

/**
 * Handles the encryption callbacks
 * @param process The process item associated with the task.
 * @param data The data to be processed.
 */
export function handleTaskEncrypt(process: EncryptProcessItem | EncryptHKDFProcessItem, data: any) {
    const key = data.key as number;
    const task = process.task;
    if ("result" in data) {
        task.resolve(data.result);
    } else {
        if (data.error) {
            task.reject(data.error);
        } else {
            task.reject(new Error("Unknown error in background encryption"));
        }
    }
    tasks.delete(key);
}
