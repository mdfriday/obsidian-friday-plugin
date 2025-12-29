// Sync Parameters management functions
// This file is responsible for managing synchronisation parameters, including fetching, creating, and updating them.
//
// The Security Seed (represented as PBKDF2 Salt in logs) derives the encryption key for replication, so it should be stored on the server prior to synchronisation.
import { createPBKDF2Salt } from "octagonal-wheels/encryption/hkdf";
import { LOG_LEVEL_INFO, LOG_LEVEL_VERBOSE, Logger } from "../common/logger.ts";
import type { SyncParameters } from "../common/types.ts";
import { arrayBufferToBase64Single, base64ToArrayBufferInternalBrowser } from "../string_and_binary/convert.ts";
import { LiveSyncError } from "../common/LSError.ts";

/**
 * Creates a SyncParamsHandler for managing synchronisation parameters.
 */
type putFunc = (params: SyncParameters) => Promise<boolean>;
/**
 * Fetches synchronisation parameters from the server.
 */
type getFunc = () => Promise<SyncParameters>;
/**
 * The function to create new synchronisation parameters.
 * Note that this function should not return `pbkdf2salt` in the result; it should be generated and stored in the handler.
 */
type createFunc = () => Promise<SyncParameters>;

type CreateSyncParamsHanderOptions = {
    put: putFunc;
    get: getFunc;
    create: createFunc;
};

export type SyncParamsHandler = {
    fetch: (refresh?: boolean) => Promise<SyncParameters | false>;
    getPBKDF2Salt: (refresh?: boolean) => Promise<Uint8Array<ArrayBuffer>>;
};
const _handlers = new Map<string, SyncParamsHandler>();

export function createSyncParamsHanderForServer(
    key: string,
    options: CreateSyncParamsHanderOptions
): SyncParamsHandler {
    if (_handlers.has(key)) {
        return _handlers.get(key)!;
    }
    const handler = createSyncParamsHandler(options);
    _handlers.set(key, handler);
    return handler;
}
export function clearHandlers() {
    _handlers.clear();
}
export class SyncParamsHandlerError extends LiveSyncError {}
export class SyncParamsFetchError extends SyncParamsHandlerError {}
export class SyncParamsNotFoundError extends SyncParamsHandlerError {}
export class SyncParamsUpdateError extends SyncParamsHandlerError {}

/**
 * SyncParameters with decoded PBKDF2 salt (as Uint8Array).
 * This is for performance reasons, to avoid decoding it every time.
 */
type SyncParametersWithDecoded = SyncParameters & {
    pbkdf2saltDecoded?: Uint8Array<ArrayBuffer>;
};

function createSyncParamsHandler({ put, get, create }: CreateSyncParamsHanderOptions): SyncParamsHandler {
    // To cache the fetched synchronisation parameters, we re-use the promise to save memory consumption.
    let taskFetchParameters: Promise<SyncParametersWithDecoded | false> | undefined = undefined;

    // This function fetches synchronisation parameters from the server, ensuring that they have PBKDF2 salt.
    const _fetchSyncParameters = async (): Promise<SyncParametersWithDecoded | false> => {
        let syncParams: SyncParametersWithDecoded | undefined = undefined;
        try {
            let shouldRetry = false;
            do {
                shouldRetry = false;
                // 1. Try to fetch the synchronisation parameters from the server.
                try {
                    syncParams = await get();
                    Logger(`Fetched synchronisation parameters`, LOG_LEVEL_INFO);
                } catch (ex: any) {
                    if (LiveSyncError.isCausedBy(ex, SyncParamsNotFoundError)) {
                        // Expected error; we will create new synchronisation parameters.
                        Logger(`Synchronisation parameters not found, creating new ones`, LOG_LEVEL_INFO);
                        const newSyncParams = await create();
                        // If we have created new synchronisation parameters, immediately store them to the server, without salt.
                        // If a race condition occurs, it will cause a 409 (conflict) error. This should be detected and handled as an error; purging the cache and retrying.
                        const putResult = await put(newSyncParams);
                        if (!putResult) {
                            Logger(`Failed to store initial synchronisation parameters`, LOG_LEVEL_INFO);
                            throw new SyncParamsUpdateError(`Failed to store initial synchronisation parameters`);
                        }
                        Logger(
                            `Initial synchronisation parameters stored successfully, retrying fetch`,
                            LOG_LEVEL_INFO
                        );
                        shouldRetry = true;
                    } else {
                        // Unexpected error; rethrow it, as we cannot proceed without synchronisation parameters.
                        throw ex;
                    }
                }
            } while (shouldRetry);

            // 2. If the synchronisation parameters are fetched, ensure that they have PBKDF2 salt.
            // 2.1. If something went wrong, we cannot proceed without synchronisation parameters.
            if (!syncParams) {
                throw new SyncParamsFetchError(`Unexpected empty synchronisation parameters`);
            }
            // 2.2. If the synchronisation parameters do not have PBKDF2 salt, create a new one.
            if (!syncParams.pbkdf2salt) {
                Logger(`Synchronisation parameters do not have PBKDF2 salt, generating a new salt`, LOG_LEVEL_INFO);
                const salt = await arrayBufferToBase64Single(createPBKDF2Salt());
                if (!salt) {
                    Logger(`Failed to generate PBKDF2 salt`, LOG_LEVEL_INFO);
                    throw new SyncParamsFetchError(`Failed to generate PBKDF2 salt`);
                }
                syncParams.pbkdf2salt = salt;
                // We need to store the synchronisation parameters with the new salt immediately. If this fails, we cannot proceed (this means synchronisation parameters are created with another device).
                const putResult = await put(syncParams);
                if (!putResult) {
                    Logger(`Failed to store synchronisation parameters with new PBKDF2 salt`, LOG_LEVEL_INFO);
                    throw new SyncParamsUpdateError(`Failed to store synchronisation parameters with new PBKDF2 salt`);
                }
                syncParams = await get();
            }

            if (!syncParams) {
                // Again, something went wrong; we cannot proceed without synchronisation parameters. Indeed, this should not happen.
                throw new Error(`Failed to prepare synchronisation key in synchronisation parameters`);
            }

            Logger(`Synchronisation parameters fetched successfully`, LOG_LEVEL_INFO);
            // 3. Decode PBKDF2 salt from base64 to Uint8Array.
            if (!syncParams.pbkdf2saltDecoded) {
                const decodedSalt = new Uint8Array(base64ToArrayBufferInternalBrowser(syncParams.pbkdf2salt));
                if (!decodedSalt) {
                    throw new SyncParamsFetchError(`Failed to decode PBKDF2 salt`);
                }
                syncParams.pbkdf2saltDecoded = decodedSalt;
            }
            return syncParams;
        } catch (ex: any) {
            Logger(`Failed to fetch synchronisation parameters`, LOG_LEVEL_INFO);
            Logger(ex, LOG_LEVEL_VERBOSE);
            // To retry fetching synchronisation parameters in the next call.
            taskFetchParameters = undefined;
            return false;
        }
    };
    const fetchSyncParameters = (refresh: boolean = false): Promise<SyncParametersWithDecoded | false> => {
        if (taskFetchParameters && !refresh) {
            return taskFetchParameters;
        }
        taskFetchParameters = _fetchSyncParameters();
        return taskFetchParameters;
    };

    return {
        fetch: fetchSyncParameters,
        getPBKDF2Salt: async (refresh: boolean = false) => {
            const syncParams = await fetchSyncParameters(refresh);
            if (!syncParams) {
                Logger(`Failed to fetch synchronisation parameters`, LOG_LEVEL_INFO);
                throw new SyncParamsFetchError(`Failed to fetch synchronisation parameters`);
            }
            return syncParams.pbkdf2saltDecoded!;
        },
    };
}
