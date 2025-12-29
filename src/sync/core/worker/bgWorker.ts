// Foreground part of Worker-off-loaded functions

import { promiseWithResolver } from "octagonal-wheels/promises.js";
import { eventHub } from "../hub/hub.ts";
//@ts-ignore
import WorkerX from "./bg.worker.ts?worker";
import { EVENT_PLATFORM_UNLOADED } from "../PlatformAPIs/base/APIBase.ts";
import { info, LOG_KIND_ERROR } from "octagonal-wheels/common/logger.js";
import { encryptionOnWorker, encryptionHKDFOnWorker, handleTaskEncrypt } from "./bgWorker.encryption.ts";
import { _splitPieces2Worker, handleTaskSplit } from "./bgWorker.splitting.ts";
import type {
    EncryptArguments,
    EncryptHKDFArguments,
    EncryptHKDFProcessItem,
    EncryptProcessItem,
    ProcessItem,
    SplitArguments,
    SplitProcessItem,
} from "./universalTypes.ts";

export type WorkerInstance = {
    worker: Worker;
    processing: number;
};

export function splitPieces2Worker(
    dataSrc: Blob,
    pieceSize: number,
    plainSplit: boolean,
    minimumChunkSize: number,
    filename?: string,
    useSegmenter?: boolean
) {
    return _splitPieces2Worker(dataSrc, pieceSize, plainSplit, minimumChunkSize, filename, 1, useSegmenter ?? false);
}
export function splitPieces2WorkerV2(
    dataSrc: Blob,
    pieceSize: number,
    plainSplit: boolean,
    minimumChunkSize: number,
    filename?: string,
    useSegmenter?: boolean
) {
    return _splitPieces2Worker(dataSrc, pieceSize, plainSplit, minimumChunkSize, filename, 2, useSegmenter ?? false);
}
export function splitPieces2WorkerRabinKarp(
    dataSrc: Blob,
    pieceSize: number,
    plainSplit: boolean,
    minimumChunkSize: number,
    filename?: string,
    useSegmenter?: boolean
) {
    return _splitPieces2Worker(dataSrc, pieceSize, plainSplit, minimumChunkSize, filename, 3, useSegmenter ?? false);
}

export function encryptWorker(input: string, passphrase: string, autoCalculateIterations: boolean): Promise<string> {
    return encryptionOnWorker({ type: "encrypt", input, passphrase, autoCalculateIterations });
}

export function decryptWorker(input: string, passphrase: string, autoCalculateIterations: boolean) {
    return encryptionOnWorker({ type: "decrypt", input, passphrase, autoCalculateIterations });
}

export function encryptHKDFWorker(
    input: string,
    passphrase: string,
    pbkdf2Salt: Uint8Array<ArrayBuffer>
): Promise<string> {
    return encryptionHKDFOnWorker({ type: "encryptHKDF", input, passphrase, pbkdf2Salt });
}

export function decryptHKDFWorker(
    input: string,
    passphrase: string,
    pbkdf2Salt: Uint8Array<ArrayBuffer>
): Promise<string> {
    return encryptionHKDFOnWorker({ type: "decryptHKDF", input, passphrase, pbkdf2Salt });
}

export const tasks = new Map<number, ProcessItem>();

function initialiseWorkers() {
    const maxConcurrency = ~~((navigator.hardwareConcurrency || 8) / 2);
    return Array.from(
        { length: maxConcurrency },
        () =>
            ({
                // @ts-ignore
                worker: WorkerX() as Worker,
                processing: 0,
            }) as WorkerInstance
    );
}

const workers: WorkerInstance[] = initialiseWorkers();

let key = 0;
let roundRobinIdx = 0;

function nextWorker() {
    if (workers === undefined || workers.length === 0) {
        throw new Error("No available workers");
    }
    const inst = workers[roundRobinIdx];
    roundRobinIdx = (roundRobinIdx + 1) % workers.length;
    return inst;
}

export function startWorker(data: Omit<EncryptHKDFArguments, "key">): EncryptHKDFProcessItem;
export function startWorker(data: Omit<EncryptArguments, "key">): EncryptProcessItem;
export function startWorker(data: Omit<SplitArguments, "key">): SplitProcessItem;
export function startWorker(data: Omit<EncryptArguments | SplitArguments | EncryptHKDFArguments, "key">): ProcessItem {
    const _key = key++;
    const inst = nextWorker();
    const promise = promiseWithResolver<any>();
    const item: ProcessItem = {
        key: _key,
        task: promise,
        type: data.type,
        finalize: () => {
            inst.processing--;
        },
    };
    tasks.set(_key, item);
    inst.processing++;
    inst.worker.postMessage({
        data: { ...data, key: _key },
    });
    return item;
}

export function terminateWorker() {
    for (const inst of workers) {
        inst.worker.terminate();
    }
    // isTerminated = true;
}
initialiseWorkers();
for (const inst of workers) {
    inst.worker.onmessage = ({ data }) => {
        const key = data.key as number;
        // debugger;
        const process = tasks.get(key);
        if (!process) {
            info(`Invalid key ${key} of background processing`, LOG_KIND_ERROR);
            return;
        }
        if (process.type === "split") {
            handleTaskSplit(process, data);
        } else if (process.type === "encrypt" || process.type === "decrypt") {
            handleTaskEncrypt(process, data);
        } else if (process.type === "encryptHKDF" || process.type === "decryptHKDF") {
            handleTaskEncrypt(process, data);
        } else {
            info("Invalid response type" + process);
        }
    };
    inst.worker.onerror = () => {
        inst.worker.terminate();
        workers.splice(workers.indexOf(inst), 1);
    };
}

eventHub.on(EVENT_PLATFORM_UNLOADED, () => {
    terminateWorker();
});
