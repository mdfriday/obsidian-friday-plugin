/// <reference lib="webworker" />
// Background part of Worker-offloaded encryption function

import { encrypt, decrypt } from "octagonal-wheels/encryption";
import { encrypt as encryptHKDF, decrypt as decryptHKDF } from "octagonal-wheels/encryption/hkdf";
import type { EncryptHKDFArguments } from "./universalTypes.ts";
import type { EncryptArguments } from "./universalTypes.ts";

/**
 * Processes the encryption of data.
 * @param data The data to be encrypted or decrypted.
 */
export async function processEncryption(data: EncryptArguments | EncryptHKDFArguments) {
    const key = data.key;
    const { type, input, passphrase } = data;
    try {
        if (type == "encrypt") {
            const autoCalculateIterations = data.autoCalculateIterations;
            const result = await encrypt(input, passphrase, autoCalculateIterations);
            self.postMessage({ key, result });
        } else if (type == "decrypt") {
            const autoCalculateIterations = data.autoCalculateIterations;
            const result = await decrypt(input, passphrase, autoCalculateIterations);
            self.postMessage({ key, result });
        } else if (type == "encryptHKDF") {
            const pbkdf2Salt = data.pbkdf2Salt;
            const result = await encryptHKDF(input, passphrase, pbkdf2Salt);
            self.postMessage({ key, result });
        } else if (type == "decryptHKDF") {
            const pbkdf2Salt = data.pbkdf2Salt;
            const result = await decryptHKDF(input, passphrase, pbkdf2Salt);
            self.postMessage({ key, result });
        }
    } catch (ex) {
        self.postMessage({ key, error: ex });
    }
}
