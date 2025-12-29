import { fallbackMixedHashEach, mixedHash } from "octagonal-wheels/hash/purejs";
import { type RemoteDBSettings, SEED_MURMURHASH, type HashAlgorithm, SALT_OF_ID } from "../../common/types.ts";

/**
 * Prefix for encrypted hashes.
 *
 * This constant is prepended to hash strings when encryption is enabled.
 */
export const HashEncryptedPrefix = "+";

/**
 * Options for initialising {@link HashManagerCore}.
 */
export type HashManagerCoreOptions = {
    /**
     * Remote database settings used for hash management.
     */
    settings: RemoteDBSettings;
};

/**
 * Abstract base class for hash management.
 *
 * Provides core logic for handling passphrase hashing, encryption toggling,
 * and initialisation routines. Subclasses should implement encryption-specific
 * hash computation methods.
 */
export abstract class HashManagerCore {
    /**
     * Remote database settings.
     */
    settings: RemoteDBSettings;

    /**
     * Indicates whether encryption is enabled for hash computation.
     */
    useEncryption: boolean = false;

    /**
     * Hashed passphrase as a string, used for hash operations.
     */
    hashedPassphrase: string = "";

    /**
     * Hashed passphrase as a 32-bit number, used for hash operations.
     */
    hashedPassphrase32: number = 0;

    /**
     * Options used for initialisation and configuration.
     */
    options: HashManagerCoreOptions;

    /**
     * Constructs a new {@link HashManagerCore} instance.
     *
     * @param options - Configuration options for hash management.
     */
    constructor(options: HashManagerCoreOptions) {
        this.options = options;
        this.settings = options.settings;
        this.applyOptions(options);
    }

    /**
     * Applies the given options to the hash manager.
     *
     * Updates encryption settings and computes passphrase hashes.
     *
     * @param options - Optional configuration to apply.
     */
    applyOptions(options?: HashManagerCoreOptions): void {
        if (options) {
            this.options = options;
        }
        this.settings = this.options.settings;
        this.useEncryption = this.settings.encrypt ?? false;
        const passphrase = this.settings.passphrase || "";
        const usingLetters = ~~((passphrase.length / 4) * 3);
        const passphraseForHash = SALT_OF_ID + passphrase.substring(0, usingLetters);
        this.hashedPassphrase = fallbackMixedHashEach(passphraseForHash);
        this.hashedPassphrase32 = mixedHash(passphraseForHash, SEED_MURMURHASH)[0];
    }

    /**
     * Performs initialisation logic specific to the hash manager implementation.
     *
     * Subclasses must implement this method.
     *
     * @returns Promise resolving to true if initialisation succeeds.
     */
    abstract processInitialise(): Promise<boolean>;

    /**
     * Task representing the initialisation process.
     */
    initialiseTask?: Promise<boolean>;

    /**
     * Ensures the hash manager is initialised.
     *
     * Returns a promise that resolves when initialisation is complete.
     *
     * @returns Promise resolving to true if initialisation succeeds.
     */
    initialise(): Promise<boolean> {
        if (this.initialiseTask) {
            return this.initialiseTask;
        }
        this.initialiseTask = this.processInitialise();
        return this.initialiseTask;
    }

    /**
     * Computes a hash for the given string.
     *
     * If encryption is enabled, the hash is computed with encryption and prefixed.
     * Otherwise, a plain hash is computed.
     *
     * @param piece - The input string to hash.
     * @returns Promise resolving to the computed hash string.
     */
    async computeHash(piece: string): Promise<string> {
        await this.initialiseTask;
        if (this.useEncryption) {
            return HashEncryptedPrefix + (await this.computeHashWithEncryption(piece));
        }
        return await this.computeHashWithoutEncryption(piece);
    }

    /**
     * Computes a hash for the given string without encryption.
     *
     * Subclasses must implement this method.
     *
     * @param piece - The input string to hash.
     * @returns Promise resolving to the computed hash string.
     */
    abstract computeHashWithoutEncryption(piece: string): Promise<string>;

    /**
     * Computes a hash for the given string with encryption.
     *
     * Subclasses must implement this method.
     *
     * @param piece - The input string to hash.
     * @returns Promise resolving to the computed encrypted hash string.
     */
    abstract computeHashWithEncryption(piece: string): Promise<string>;

    /**
     * Determines whether the hash manager is available for the specified algorithm.
     *
     * Subclasses should override this method to indicate supported algorithms.
     *
     * @param hashAlg - The hash algorithm to check.
     * @returns True if available, false otherwise.
     */
    static isAvailableFor(hashAlg: HashAlgorithm): boolean {
        return false; // Default implementation; subclasses should override
    }
}
