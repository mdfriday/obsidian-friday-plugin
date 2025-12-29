import { type HashAlgorithm } from "../../common/types.ts";
import { FallbackWasmHashManager, XXHash32RawHashManager, XXHash64HashManager } from "./XXHashHashManager.ts";
import { FallbackPureJSHashManager, PureJSHashManager, SHA1HashManager } from "./PureJSHashManager.ts";
import { HashManagerCore, type HashManagerCoreOptions } from "./HashManagerCore.ts";
import { LOG_LEVEL_VERBOSE, Logger } from "../../common/logger.ts";

/**
 * List of available hash managers.
 * For compatibility, please retain fallback managers.
 */
const HashManagers = [
    XXHash64HashManager,
    XXHash32RawHashManager,
    SHA1HashManager,
    PureJSHashManager,
    // Please retain these fallback managers, as they are essential for compatibility.
    FallbackWasmHashManager,
    FallbackPureJSHashManager,
];

/**
 * Class for managing hash managers and performing hash calculations.
 * Selects an appropriate manager according to the available hash algorithm.
 */
export class HashManager extends HashManagerCore {
    /**
     * Instance of the hash manager currently in use.
     */
    manager: HashManagerCore = undefined!;

    /**
     * Checks whether the specified hash algorithm is available.
     *
     * @param hashAlg The hash algorithm to check
     * @returns True if available
     */
    static isAvailableFor(hashAlg: HashAlgorithm): boolean {
        return HashManagers.some((manager) => manager.isAvailableFor(hashAlg));
    }

    /**
     * Selects and initialises an available hash manager.
     *
     * @returns True if initialisation is successful
     * @throws Throws an error if no available manager exists
     */
    async setManager(): Promise<boolean> {
        for (const Manager of HashManagers) {
            if (Manager.isAvailableFor(this.settings.hashAlg)) {
                this.manager = new Manager(this.options);
                return await this.manager.initialise();
            }
        }
        // deno-coverage-ignore Fallback managers are always present, so this should never be reached.
        throw new Error(`HashManager for ${this.settings.hashAlg} is not available`);
    }

    /**
     * Constructs a new HashManager.
     *
     * @param options Initialisation options
     */
    constructor(options: HashManagerCoreOptions) {
        super(options);
    }

    /**
     * Initialises the hash manager.
     *
     * @returns True if initialisation is successful
     * @throws Throws an error if initialisation fails
     */
    async processInitialise(): Promise<boolean> {
        if (await this.setManager()) {
            Logger(`HashManager for ${this.settings.hashAlg} has been initialised`, LOG_LEVEL_VERBOSE);
            return true;
        }
        // deno-coverage-ignore-start This branch should never be reached.
        Logger(`HashManager for ${this.settings.hashAlg} failed to initialise`);
        throw new Error(`HashManager for ${this.settings.hashAlg} failed to initialise`);
        // deno-coverage-ignore-stop
    }

    /**
     * Computes the hash value for the specified string.
     *
     * @param piece The string to be hashed
     * @returns The hash value (returned as a Promise)
     */
    computeHash(piece: string): Promise<string> {
        return this.manager.computeHash(piece);
    }

    /**
     * Computes the hash value without encryption.
     *
     * @param piece The string to be hashed
     * @returns The hash value (returned as a Promise)
     */
    computeHashWithoutEncryption(piece: string): Promise<string> {
        return this.manager.computeHashWithoutEncryption(piece);
    }

    /**
     * Computes the hash value with encryption.
     *
     * @param piece The string to be hashed
     * @returns The hash value (returned as a Promise)
     */
    computeHashWithEncryption(piece: string): Promise<string> {
        return this.manager.computeHashWithEncryption(piece);
    }
}
