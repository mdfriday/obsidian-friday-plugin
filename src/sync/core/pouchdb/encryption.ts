import { Logger, LOG_LEVEL_NOTICE, LOG_LEVEL_VERBOSE } from "../common/logger";
import {
    type EntryDoc,
    type AnyEntry,
    type EntryLeaf,
    type FilePathWithPrefix,
    type DocumentID,
    type EntryWithEden,
    type E2EEAlgorithm,
    E2EEAlgorithms,
    isMetaEntry,
} from "../common/types";
import { isEncryptedChunkEntry, isSyncInfoEntry, isObfuscatedEntry } from "../common/utils";
import { isPathProbablyObfuscated, obfuscatePath } from "octagonal-wheels/encryption/encryption";
// import { encryptHKDF, decryptHKDF } from "../encryption/encryptHKDF.ts";
import { getPath } from "../string_and_binary/path.ts";
import { encryptWorker, decryptWorker, encryptHKDFWorker, decryptHKDFWorker } from "../worker/bgWorker.ts";

export const encrypt = encryptWorker;
export const decrypt = decryptWorker;
export const encryptHKDF = encryptHKDFWorker;
export const decryptHKDF = decryptHKDFWorker;

const Encrypt_HKDF_Header = "%=";
const Encrypt_OLD_Header = "%";

const EncryptionVersions = {
    UNENCRYPTED: 0,
    ENCRYPTED: 1,
    HKDF: 2,
    UNKNOWN: 99,
} as const;
type EncryptionVersion = (typeof EncryptionVersions)[keyof typeof EncryptionVersions];

function getEncryptionVersion(data: EntryLeaf): EncryptionVersion {
    if ("e_" in data && data.e_ === true) {
        if (data.data.startsWith(Encrypt_HKDF_Header)) {
            return EncryptionVersions.HKDF;
        } else if (data.data.startsWith(Encrypt_OLD_Header)) {
            return EncryptionVersions.ENCRYPTED;
        }
        return EncryptionVersions.UNKNOWN;
    }
    return EncryptionVersions.UNENCRYPTED;
}

async function tryDecryptV1AsFallback(
    encryptedData: string,
    passphrase: string,
    useDynamicIterationCount: boolean
): Promise<string | false> {
    try {
        return await decrypt(encryptedData, passphrase, useDynamicIterationCount);
    } catch (ex) {
        try {
            Logger(
                "Failed to decrypt with V1 method. Fallback to disable useDynamicIterationCount.",
                LOG_LEVEL_VERBOSE
            );
            Logger(ex, LOG_LEVEL_VERBOSE);
            return await decrypt(encryptedData, passphrase, false);
        } catch (ex) {
            Logger("Completely failed to decrypt with V1 method.", LOG_LEVEL_VERBOSE);
            Logger(ex, LOG_LEVEL_VERBOSE);
            return false; // failed to decrypt
        }
    }
}

type EncryptedDocument<T> = T & {
    e_?: boolean; // indicates that the document is encrypted
};

const ENCRYPTED_META_PREFIX = "/\\:";
function isEncryptedMeta<T extends AnyEntry>(doc: T) {
    return "path" in doc && doc.path.startsWith(ENCRYPTED_META_PREFIX);
}
type EncryptProps = {
    path: string;
    mtime: number;
    ctime: number;
    size: number;
    children?: any[];
};
async function encryptMetaWithHKDF<T extends AnyEntry>(
    doc: T,
    passphrase: string,
    pbkdf2Salt: Uint8Array<ArrayBuffer>
): Promise<string> {
    if (isEncryptedMeta(doc)) {
        // already encrypted with HKDF, no need to re-encrypt
        return doc.path;
    }
    const props: EncryptProps = {
        path: getPath(doc),
        mtime: doc.mtime,
        ctime: doc.ctime,
        size: doc.size,
        children: isMetaEntry(doc) ? doc.children : undefined,
    };
    const propStr = JSON.stringify(props);
    const encryptedMeta = await encryptHKDFWorker(propStr, passphrase, pbkdf2Salt);
    return ENCRYPTED_META_PREFIX + encryptedMeta;
}
async function decryptMetaWithHKDF(
    meta: string,
    passphrase: string,
    pbkdf2Salt: Uint8Array<ArrayBuffer>
): Promise<EncryptProps> {
    if (!meta.startsWith(ENCRYPTED_META_PREFIX)) {
        throw new Error("Meta is not encrypted with HKDF.");
    }
    const encryptedMeta = meta.slice(ENCRYPTED_META_PREFIX.length);
    const props = await decryptHKDF(encryptedMeta, passphrase, pbkdf2Salt);
    const parsedProps = JSON.parse(props) as EncryptProps;
    return parsedProps;
}

const MESSAGE_FALLBACK_DECRYPT_FAILED = "Failed to decrypt the data with V1 method. Cannot encrypt with HKDF.";
const ENCRYPTION_HKDF_FAILED = "Encryption with HKDF failed.";
const DECRYPTION_HKDF_FAILED = "Decryption with HKDF failed.";
const DECRYPTION_FALLBACK_FAILED = "Decryption with fallback failed.";

// requires transform-pouch
async function incomingEncryptHKDF(
    doc: AnyEntry | EntryLeaf,
    passphrase: string,
    useDynamicIterationCount: boolean,
    getPBKDF2Salt: () => Promise<Uint8Array<ArrayBuffer>>
): Promise<EntryLeaf | AnyEntry> {
    const saveDoc = {
        ...doc,
    } as EncryptedDocument<EntryLeaf | AnyEntry>;

    if (isEncryptedChunkEntry(saveDoc) || isSyncInfoEntry(saveDoc)) {
        try {
            const encryptionVersion = getEncryptionVersion(saveDoc);
            if (encryptionVersion === EncryptionVersions.ENCRYPTED) {
                const decrypted = await tryDecryptV1AsFallback(saveDoc.data, passphrase, useDynamicIterationCount);
                if (decrypted === false) {
                    Logger(MESSAGE_FALLBACK_DECRYPT_FAILED, LOG_LEVEL_NOTICE);
                    throw new Error(MESSAGE_FALLBACK_DECRYPT_FAILED);
                }
                const pbkdf2salt = await getPBKDF2Salt();
                // re-encrypt with HKDF
                saveDoc.data = await encryptHKDF(saveDoc.data, passphrase, pbkdf2salt);
                saveDoc.e_ = true; // mark as encrypted
            }
            if (encryptionVersion === EncryptionVersions.HKDF) {
                // already encrypted with HKDF, no need to re-encrypt
            } else if (encryptionVersion === EncryptionVersions.UNENCRYPTED) {
                // not encrypted, encrypt with HKDF
                const pbkdf2salt = await getPBKDF2Salt();
                saveDoc.data = await encryptHKDF(saveDoc.data, passphrase, pbkdf2salt);
                saveDoc.e_ = true; // mark as encrypted
            }
        } catch (ex) {
            Logger(ENCRYPTION_HKDF_FAILED, LOG_LEVEL_NOTICE);
            Logger(ex);
            throw ex;
        }
    }

    if (shouldEncryptEdenHKDF(saveDoc)) {
        // If failed, throw an error.
        const pbkdf2salt = await getPBKDF2Salt();

        try {
            saveDoc.eden = {
                [EDEN_ENCRYPTED_KEY_HKDF]: {
                    data: await encryptHKDF(JSON.stringify(saveDoc.eden), passphrase, pbkdf2salt),
                    epoch: 999999,
                },
            };
        } catch (ex) {
            Logger(`${ENCRYPTION_HKDF_FAILED} on Eden`, LOG_LEVEL_NOTICE);
            Logger(ex);
            throw ex;
        }
    }
    if (isObfuscatedEntry(saveDoc)) {
        const pbkdf2salt = await getPBKDF2Salt();

        if (!isEncryptedMeta(saveDoc)) {
            try {
                saveDoc.path = (await encryptMetaWithHKDF(
                    saveDoc,
                    passphrase,
                    pbkdf2salt
                )) as unknown as FilePathWithPrefix;
                saveDoc.mtime = 0;
                saveDoc.ctime = 0;
                saveDoc.size = 0;
                if ("children" in saveDoc) saveDoc.children = [];
            } catch (ex) {
                Logger(`${ENCRYPTION_HKDF_FAILED} on Metadata`, LOG_LEVEL_NOTICE);
                Logger(ex);
                throw ex;
            }
        }
    }
    return saveDoc;
}

async function outgoingDecryptHKDF(
    doc: EntryDoc,
    migrationDecrypt: boolean,
    decrypted: Map<DocumentID, boolean>,
    passphrase: string,
    useDynamicIterationCount: boolean,
    getPBKDF2Salt: () => Promise<Uint8Array<ArrayBuffer>>
): Promise<AnyEntry | EntryLeaf> {
    const loadDoc = {
        ...doc,
    } as EncryptedDocument<AnyEntry | EntryLeaf>;
    //TODO

    if (isEncryptedChunkEntry(loadDoc) || isSyncInfoEntry(loadDoc)) {
        try {
            const encryptionVersion = getEncryptionVersion(loadDoc);
            if (encryptionVersion === EncryptionVersions.HKDF) {
                const pbkdf2salt = await getPBKDF2Salt();
                loadDoc.data = await decryptHKDF(loadDoc.data, passphrase, pbkdf2salt);
                delete loadDoc.e_;
            } else if (encryptionVersion === EncryptionVersions.ENCRYPTED) {
                const decryptedData = await tryDecryptV1AsFallback(loadDoc.data, passphrase, useDynamicIterationCount);
                if (decryptedData === false) {
                    Logger(MESSAGE_FALLBACK_DECRYPT_FAILED, LOG_LEVEL_NOTICE);
                    throw new Error(MESSAGE_FALLBACK_DECRYPT_FAILED);
                }
                loadDoc.data = decryptedData;
                delete loadDoc.e_;
            } else if (encryptionVersion === EncryptionVersions.UNENCRYPTED) {
                // not encrypted, no need to decrypt
            } else {
                Logger("Unknown encryption version. Cannot decrypt.", LOG_LEVEL_NOTICE);
                throw new Error("Unknown encryption version. Cannot decrypt.");
            }
        } catch (ex) {
            Logger(DECRYPTION_HKDF_FAILED, LOG_LEVEL_NOTICE);
            Logger(ex);
            throw ex;
        }
    }
    if (isObfuscatedEntry(loadDoc)) {
        const path = getPath(loadDoc);
        if (isEncryptedMeta(loadDoc)) {
            const pbkdf2salt = await getPBKDF2Salt();
            try {
                const metadata = await decryptMetaWithHKDF(path, passphrase, pbkdf2salt);
                for (const key of Object.keys(metadata)) {
                    (loadDoc as any)[key] = metadata[key as keyof EncryptProps];
                }
            } catch (ex) {
                Logger(`${DECRYPTION_HKDF_FAILED} on Path`, LOG_LEVEL_NOTICE);
                Logger(ex);
                throw ex;
            }
        } else if (isPathProbablyObfuscated(path)) {
            // As a fallback, try to decrypt with V1 method. This part will eventually be removed.
            const decryptedPath = await tryDecryptV1AsFallback(path, passphrase, useDynamicIterationCount);
            if (decryptedPath === false) {
                Logger(`${MESSAGE_FALLBACK_DECRYPT_FAILED} on Path`, LOG_LEVEL_NOTICE);
                throw new Error(MESSAGE_FALLBACK_DECRYPT_FAILED);
            }
            loadDoc.path = decryptedPath as unknown as FilePathWithPrefix;
        }
    }
    let readEden: EntryWithEden["eden"] = {};
    let edenDecrypted = false;
    // Fallback to V1 decryption if Eden is not encrypted with HKDF.
    if (shouldDecryptEden(loadDoc)) {
        try {
            const decryptedEden = await tryDecryptV1AsFallback(
                loadDoc.eden[EDEN_ENCRYPTED_KEY].data,
                passphrase,
                useDynamicIterationCount
            );
            if (decryptedEden === false) throw new Error(MESSAGE_FALLBACK_DECRYPT_FAILED);
            readEden = {
                ...readEden,
                ...JSON.parse(decryptedEden),
            };
            edenDecrypted = true;
        } catch (ex) {
            Logger(`${DECRYPTION_FALLBACK_FAILED} on Eden`, LOG_LEVEL_NOTICE);
            Logger(ex);
            throw ex;
        }
    }
    /// If Eden is encrypted with HKDF, decrypt it.
    if (shouldDecryptEdenHKDF(loadDoc)) {
        const pbkdf2salt = await getPBKDF2Salt();

        try {
            const decryptedEdenData = await decryptHKDF(
                loadDoc.eden[EDEN_ENCRYPTED_KEY_HKDF].data,
                passphrase,
                pbkdf2salt
            );
            readEden = {
                ...readEden,
                ...JSON.parse(decryptedEdenData),
            };
            edenDecrypted = true;
        } catch (ex) {
            Logger(`${DECRYPTION_HKDF_FAILED} on Eden`, LOG_LEVEL_NOTICE);
            Logger(ex);
            throw ex;
        }
    }
    if (edenDecrypted) {
        (loadDoc as any).eden = readEden;
    } else {
        // If Eden is not decrypted, NO OP.
    }
    return loadDoc;
}
// requires transform-pouch
async function incomingEncryptV1(
    doc: AnyEntry | EntryLeaf,
    passphrase: string,
    useDynamicIterationCount: boolean
): Promise<EntryLeaf | AnyEntry> {
    const saveDoc = {
        ...doc,
    } as EntryLeaf | AnyEntry;

    if (isEncryptedChunkEntry(saveDoc) || isSyncInfoEntry(saveDoc)) {
        try {
            if (!("e_" in saveDoc)) {
                saveDoc.data = await encrypt(saveDoc.data, passphrase, useDynamicIterationCount);
                (saveDoc as any).e_ = true;
            }
        } catch (ex) {
            Logger("Encryption failed.", LOG_LEVEL_NOTICE);
            Logger(ex);
            throw ex;
        }
    }

    if (shouldEncryptEden(saveDoc)) {
        saveDoc.eden = {
            [EDEN_ENCRYPTED_KEY]: {
                data: await encrypt(JSON.stringify(saveDoc.eden), passphrase, useDynamicIterationCount),
                epoch: 999999,
            },
        };
    }
    if (isObfuscatedEntry(saveDoc)) {
        try {
            const path = getPath(saveDoc);
            if (!isPathProbablyObfuscated(path)) {
                saveDoc.path = (await obfuscatePath(
                    path,
                    passphrase,
                    useDynamicIterationCount
                )) as unknown as FilePathWithPrefix;
            }
        } catch (ex) {
            Logger("Encryption failed.", LOG_LEVEL_NOTICE);
            Logger(ex);
            throw ex;
        }
    }
    return saveDoc;
}
async function outgoingDecryptV1(
    doc: EntryDoc,
    migrationDecrypt: boolean,
    decrypted: Map<DocumentID, boolean>,
    passphrase: string,
    useDynamicIterationCount: boolean
): Promise<AnyEntry | EntryLeaf> {
    const loadDoc = {
        ...doc,
    } as AnyEntry | EntryLeaf;
    const _isChunkOrSyncInfo = isEncryptedChunkEntry(loadDoc) || isSyncInfoEntry(loadDoc);

    const _isObfuscatedEntry = isObfuscatedEntry(loadDoc);
    const _shouldDecryptEden = shouldDecryptEden(loadDoc);
    if (_isChunkOrSyncInfo || _isObfuscatedEntry || _shouldDecryptEden) {
        if (migrationDecrypt && decrypted.has(loadDoc._id)) {
            return loadDoc; // once decrypted.
        }
        try {
            if (_isChunkOrSyncInfo) {
                loadDoc.data = await decrypt(loadDoc.data, passphrase, useDynamicIterationCount);
                delete (loadDoc as any).e_;
            } else if ("e_" in loadDoc) {
                (loadDoc as any).data = await decrypt((loadDoc as any).data, passphrase, useDynamicIterationCount);
                delete (loadDoc as any).e_;
            }
            if (_isObfuscatedEntry) {
                const path = getPath(loadDoc);
                if (isPathProbablyObfuscated(path)) {
                    loadDoc.path = (await decrypt(
                        path,
                        passphrase,
                        useDynamicIterationCount
                    )) as unknown as FilePathWithPrefix;
                }
            }
            if (_shouldDecryptEden) {
                loadDoc.eden = JSON.parse(
                    await decrypt(loadDoc.eden[EDEN_ENCRYPTED_KEY].data, passphrase, useDynamicIterationCount)
                );
            }
            if (migrationDecrypt) {
                decrypted.set(loadDoc._id, true);
            }
        } catch (ex) {
            if (useDynamicIterationCount) {
                try {
                    if (_isChunkOrSyncInfo) {
                        loadDoc.data = await decrypt(loadDoc.data, passphrase, false);
                    }
                    if (_isObfuscatedEntry) {
                        const path = getPath(loadDoc);
                        if (isPathProbablyObfuscated(path)) {
                            loadDoc.path = (await decrypt(path, passphrase, false)) as unknown as FilePathWithPrefix;
                        }
                    }
                    if (_shouldDecryptEden) {
                        loadDoc.eden = JSON.parse(
                            await decrypt(loadDoc.eden[EDEN_ENCRYPTED_KEY].data, passphrase, false)
                        );
                    }
                    if (migrationDecrypt) {
                        decrypted.set(loadDoc._id, true);
                    }
                } catch (ex: any) {
                    if (migrationDecrypt && ex.name == "SyntaxError") {
                        return loadDoc; // This logic will be removed in a while.
                    }
                    Logger("Decryption failed.", LOG_LEVEL_NOTICE);
                    Logger(ex, LOG_LEVEL_VERBOSE);
                    Logger(`id:${loadDoc._id}-${loadDoc._rev?.substring(0, 10)}`, LOG_LEVEL_VERBOSE);
                    throw ex;
                }
            } else {
                Logger("Decryption failed.", LOG_LEVEL_NOTICE);
                Logger(ex, LOG_LEVEL_VERBOSE);
                Logger(`id:${loadDoc._id}-${loadDoc._rev?.substring(0, 10)}`, LOG_LEVEL_VERBOSE);
                throw ex;
            }
        }
    }
    return loadDoc;
}
export let preprocessOutgoing: (doc: AnyEntry | EntryLeaf) => Promise<AnyEntry | EntryLeaf> = async (doc) => {
    return await Promise.resolve(doc);
};
export let preprocessIncoming: (doc: EntryDoc) => Promise<EntryDoc> = async (doc) => {
    return await Promise.resolve(doc);
};

export const enableEncryption = (
    db: PouchDB.Database<EntryDoc>,
    passphrase: string,
    useDynamicIterationCount: boolean,
    migrationDecrypt: boolean,
    getPBKDF2Salt: () => Promise<Uint8Array<ArrayBuffer>>,
    algorithm: E2EEAlgorithm
) => {
    const decrypted = new Map();

    const incoming = (doc: AnyEntry | EntryLeaf) =>
        algorithm === E2EEAlgorithms.V2
            ? incomingEncryptHKDF(doc, passphrase, useDynamicIterationCount, getPBKDF2Salt)
            : incomingEncryptV1(doc, passphrase, useDynamicIterationCount);
    // If unless specified algorithm is ForceV1, then use HKDF decryption for forward compatibility.
    const outgoing = (doc: EntryDoc) =>
        algorithm !== E2EEAlgorithms.ForceV1
            ? outgoingDecryptHKDF(doc, migrationDecrypt, decrypted, passphrase, useDynamicIterationCount, getPBKDF2Salt)
            : outgoingDecryptV1(doc, migrationDecrypt, decrypted, passphrase, useDynamicIterationCount);
    preprocessOutgoing = incoming;
    preprocessIncoming = outgoing;
    //@ts-ignore
    db.transform({
        incoming,
        outgoing,
    });
};

export function disableEncryption() {
    preprocessOutgoing = async (doc) => {
        return await Promise.resolve(doc);
    };
    preprocessIncoming = async (doc) => {
        return await Promise.resolve(doc);
    };
}

export const EDEN_ENCRYPTED_KEY = "h:++encrypted" as DocumentID;
export const EDEN_ENCRYPTED_KEY_HKDF = "h:++encrypted-hkdf" as DocumentID;
export function shouldEncryptEden(doc: AnyEntry | EntryLeaf): doc is AnyEntry {
    if ("eden" in doc && !(EDEN_ENCRYPTED_KEY in doc.eden)) {
        return true;
    }
    return false;
}
export function shouldEncryptEdenHKDF(doc: AnyEntry | EntryLeaf): doc is AnyEntry {
    if ("eden" in doc && !(EDEN_ENCRYPTED_KEY_HKDF in doc.eden)) {
        if (Object.keys(doc.eden).length === 0) {
            return false; // If eden is empty, do not encrypt.
        }
        return true;
    }
    return false;
}

export function shouldDecryptEden(doc: AnyEntry | EntryLeaf): doc is AnyEntry {
    if ("eden" in doc && EDEN_ENCRYPTED_KEY in doc.eden) {
        return true;
    }
    return false;
}

export function shouldDecryptEdenHKDF(doc: AnyEntry | EntryLeaf): doc is AnyEntry {
    if ("eden" in doc && EDEN_ENCRYPTED_KEY_HKDF in doc.eden) {
        return true;
    }
    return false;
}
