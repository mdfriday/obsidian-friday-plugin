import { HashManagerCore, type HashManagerCoreOptions } from "./HashManagerCore.ts";
import { xxhashNew } from "../../string_and_binary/hash.ts";
import type { XXHashAPI } from "xxhash-wasm-102";
import { HashAlgorithms, type HashAlgorithm } from "../../common/types.ts";

/**
 * Abstract base class for hash managers using XXHash algorithms.
 * Provides initialisation and common properties for XXHash-based managers.
 */
export abstract class XXHashHashManager extends HashManagerCore {
    /**
     * Instance of XXHash API used for hashing operations.
     */
    xxhash!: XXHashAPI;

    /**
     * Constructs a new XXHashHashManager.
     * @param options - Options for the hash manager core.
     */
    constructor(options: HashManagerCoreOptions) {
        super(options);
    }

    /**
     * Initialises the XXHash API instance.
     * @returns A promise resolving to true when initialisation is complete.
     */
    async processInitialise(): Promise<boolean> {
        this.xxhash = await xxhashNew();
        return true;
    }
}

/**
 * Hash manager for the legacy hash algorithm (empty string).
 * Utilises XXHash32 raw hashing.
 */
export class XXHash32RawHashManager extends XXHashHashManager {
    /**
     * Determines whether this manager is available for the specified algorithm.
     * @param hashAlg - The hash algorithm to check.
     * @returns True if available, false otherwise.
     */
    static isAvailableFor(hashAlg: HashAlgorithm): boolean {
        return hashAlg === HashAlgorithms.LEGACY;
    }

    /**
     * Computes a hash for the given piece using encryption.
     * @param piece - The input string to hash.
     * @returns A promise resolving to the hash string.
     */
    computeHashWithEncryption(piece: string): Promise<string> {
        return Promise.resolve(
            (this.xxhash.h32Raw(new TextEncoder().encode(piece)) ^ this.hashedPassphrase32 ^ piece.length).toString(36)
        );
    }

    /**
     * Computes a hash for the given piece without encryption.
     * @param piece - The input string to hash.
     * @returns A promise resolving to the hash string.
     */
    computeHashWithoutEncryption(piece: string): Promise<string> {
        return Promise.resolve((this.xxhash.h32Raw(new TextEncoder().encode(piece)) ^ piece.length).toString(36));
    }
}

/**
 * Hash manager for the XXHash64 algorithm ("xxhash64").
 */
export class XXHash64HashManager extends XXHashHashManager {
    /**
     * Determines whether this manager is available for the specified algorithm.
     * @param hashAlg - The hash algorithm to check.
     * @returns True if available, false otherwise.
     */
    static isAvailableFor(hashAlg: HashAlgorithm): boolean {
        return hashAlg === HashAlgorithms.XXHASH64;
    }

    /**
     * Computes a hash for the given piece using encryption.
     * @param piece - The input string to hash.
     * @returns A promise resolving to the hash string.
     */
    computeHashWithEncryption(piece: string): Promise<string> {
        return Promise.resolve(this.xxhash.h64(`${piece}-${this.hashedPassphrase}-${piece.length}`).toString(36));
    }

    /**
     * Computes a hash for the given piece without encryption.
     * @param piece - The input string to hash.
     * @returns A promise resolving to the hash string.
     */
    computeHashWithoutEncryption(piece: string): Promise<string> {
        return Promise.resolve(this.xxhash.h64(`${piece}-${piece.length}`).toString(36));
    }
}

/**
 * Fallback hash manager utilising XXHash32.
 * Used when no specific algorithm is matched.
 * Please be careful with this manager, as it is different from XXHash32RawHashManager.
 */
export class FallbackWasmHashManager extends XXHashHashManager {
    /**
     * Determines whether this manager is available for the specified algorithm.
     * Always returns true as a fallback.
     * @param hashAlg - The hash algorithm to check.
     * @returns True.
     */
    static isAvailableFor(hashAlg: HashAlgorithm): boolean {
        return true; // As a fallback hash manager, it is always available.
    }

    /**
     * Computes a hash for the given piece using encryption.
     * @param piece - The input string to hash.
     * @returns A promise resolving to the hash string.
     */
    computeHashWithEncryption(piece: string): Promise<string> {
        return Promise.resolve(this.xxhash.h32(`${piece}-${this.hashedPassphrase}-${piece.length}`).toString(36));
    }

    /**
     * Computes a hash for the given piece without encryption.
     * @param piece - The input string to hash.
     * @returns A promise resolving to the hash string.
     */
    computeHashWithoutEncryption(piece: string): Promise<string> {
        return Promise.resolve(this.xxhash.h32(`${piece}-${piece.length}`).toString(36));
    }
}
