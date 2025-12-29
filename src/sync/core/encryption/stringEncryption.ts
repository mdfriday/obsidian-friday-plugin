import {
    decrypt,
    ENCRYPT_V2_PREFIX,
    ENCRYPT_V3_PREFIX,
    ENCRYPT_V1_PREFIX_PROBABLY,
} from "octagonal-wheels/encryption/encryption";
import {
    encryptWithEphemeralSalt,
    decryptWithEphemeralSalt,
    HKDF_SALTED_ENCRYPTED_PREFIX,
} from "octagonal-wheels/encryption/hkdf";
import { LOG_LEVEL_VERBOSE, Logger } from "../common/logger";
/**
 * Encrypts a string using a passphrase, unless the string is already encrypted.
 *
 * If the input string begins with `ENCRYPT_V2_PREFIX` or `HKDF_SALTED_ENCRYPTED_PREFIX`,
 * we assume it is already encrypted and return it unchanged.
 * Otherwise, we encrypt the string using an ephemeral salt and the provided passphrase.
 *
 * @param source - The plaintext string to encrypt, or an already encrypted string.
 * @param passphrase - The passphrase used for encryption.
 * @returns A promise resolving to the encrypted string, or the original string if it is already encrypted.
 */
export async function encryptString(source: string, passphrase: string): Promise<string> {
    if (source.startsWith(ENCRYPT_V2_PREFIX)) {
        return source;
    } else if (source.startsWith(HKDF_SALTED_ENCRYPTED_PREFIX)) {
        return source; // Already encrypted with ephemeral salt
    } else {
        return await encryptWithEphemeralSalt(source, passphrase);
    }
}

async function tryDecryption(trials: (() => Promise<string>)[]): Promise<string> {
    for (const trial of trials) {
        try {
            return await trial();
        } catch (error) {
            Logger(`Decryption trial failed: ${error}`, LOG_LEVEL_VERBOSE);
        }
    }
    throw new Error("All decryption trials failed");
}
/**
 * Decrypts an encrypted string using the provided passphrase.
 *
 * This function determines the encryption format by inspecting the string prefix, then applies
 * the appropriate decryption method. It supports several encryption formats, including
 * HKDF salted encryption and legacy formats (V1, V2, V3). If the format is not supported,
 * an error is thrown.
 *
 * @param encrypted - The encrypted string to decrypt.
 * @param passphrase - The passphrase used for decryption.
 * @returns A promise resolving to the decrypted string.
 * @throws {Error} If the encryption format is unsupported.
 */
export async function decryptString(encrypted: string, passphrase: string): Promise<string> {
    if (encrypted.startsWith(HKDF_SALTED_ENCRYPTED_PREFIX)) {
        return decryptWithEphemeralSalt(encrypted, passphrase);
    } else if (
        encrypted.startsWith(ENCRYPT_V2_PREFIX) ||
        encrypted.startsWith(ENCRYPT_V3_PREFIX) ||
        encrypted.startsWith(ENCRYPT_V1_PREFIX_PROBABLY)
    ) {
        return await tryDecryption([
            async () => await decrypt(encrypted, passphrase, false),
            async () => await decrypt(encrypted, passphrase, true), // Try with legacy support
        ]);
    } else {
        throw new Error("Unsupported encryption format");
    }
}
export async function tryDecryptString(encrypted: string, passphrase: string | false): Promise<string | false> {
    try {
        return await decryptString(encrypted, passphrase as string);
    } catch (error) {
        Logger(`Decryption failed: ${error}`, LOG_LEVEL_VERBOSE);
        return false;
    }
}
