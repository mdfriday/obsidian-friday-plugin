/// <reference lib="webworker" />
// Background section for functions offloaded to the Worker.
// This module is solely responsible for orchestration.
// Please do not export any function from this file, as it may cause unexpected situations.

import type { SplitArguments } from "./universalTypes.ts";
import type { EncryptArguments } from "./universalTypes.ts";
import { processSplit } from "./bg.worker.splitting.ts";
import { processEncryption } from "./bg.worker.encryption.ts";

self.onmessage = (e: MessageEvent) => {
    const data = e.data.data as SplitArguments | EncryptArguments;
    if (data.type === "split") {
        return processSplit(data);
    } else if (data.type === "encrypt" || data.type === "decrypt") {
        return processEncryption(data);
    } else if (data.type === "encryptHKDF" || data.type === "decryptHKDF") {
        return processEncryption(data);
    } else {
        self.postMessage({ key: data.key, error: new Error("Invalid type") });
    }
};
