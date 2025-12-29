import { LOG_LEVEL_INFO, Logger } from "../common/logger";
import {
    LOG_LEVEL_VERBOSE,
    SYNCINFO_ID,
    VER,
    VERSIONING_DOCID,
    type EntryVersionInfo,
    type SyncInfo,
} from "../common/types";
import { resolveWithIgnoreKnownError } from "../common/utils";
import { isErrorOfMissingDoc } from "./utils_couchdb";

export const checkRemoteVersion = async (
    db: PouchDB.Database,
    migrate: (from: number, to: number) => Promise<boolean>,
    barrier: number = VER
): Promise<boolean> => {
    try {
        const versionInfo = (await db.get(VERSIONING_DOCID)) as EntryVersionInfo;
        if (versionInfo.type != "versioninfo") {
            return false;
        }
        // const salt = versionInfo?.pbkdf2salt;
        const version = versionInfo.version;
        if (version < barrier) {
            const versionUpResult = await migrate(version, barrier);
            if (versionUpResult) {
                await bumpRemoteVersion(db);
                return true;
            }
        }
        // setPBKDF2Salt(salt);
        if (version == barrier) return true;
        return false;
    } catch (ex: any) {
        if (isErrorOfMissingDoc(ex)) {
            if (await bumpRemoteVersion(db)) {
                return true;
            }
            return false;
        }
        throw ex;
    }
};
export const bumpRemoteVersion = async (db: PouchDB.Database, barrier: number = VER): Promise<boolean> => {
    const vi: EntryVersionInfo = {
        _id: VERSIONING_DOCID,
        version: barrier,
        type: "versioninfo",
        // pbkdf2salt: "", // this will be set later.
    };
    const versionInfo = await resolveWithIgnoreKnownError<EntryVersionInfo>(db.get(VERSIONING_DOCID), vi);
    if (versionInfo.type != "versioninfo") {
        return false;
    }
    vi._rev = versionInfo._rev;

    await db.put(vi);
    return true;
};

export const checkSyncInfo = async (db: PouchDB.Database): Promise<boolean> => {
    try {
        const syncinfo = (await db.get(SYNCINFO_ID)) as SyncInfo;
        console.log(syncinfo);
        // if we could decrypt the doc, it must be ok.
        return true;
    } catch (ex: any) {
        if (isErrorOfMissingDoc(ex)) {
            const randomStrSrc = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
            const temp = [...Array(30)]
                .map((_e) => Math.floor(Math.random() * randomStrSrc.length))
                .map((e) => randomStrSrc[e])
                .join("");
            const newSyncInfo: SyncInfo = {
                _id: SYNCINFO_ID,
                type: "syncinfo",
                data: temp,
            };
            if (await db.put(newSyncInfo)) {
                return true;
            }
            return false;
        } else {
            console.dir(ex);
            return false;
        }
    }
};

// Selectors to already transferred compromised chunks (before h:, i.e., "0123456")
const SELECTOR_COMPROMISED_CHUNK_1 = {
    selector: {
        _id: {
            $lt: "h:",
        },
        type: "leaf",
    },
} as const;

// Selectors to already transferred compromised chunks (after h:, i.e., "ijklmnop")
const SELECTOR_COMPROMISED_CHUNK_2 = {
    selector: {
        _id: {
            $gt: "h;",
        },
        type: "leaf",
    },
} as const;

/**
 * Counts the number of remote (potentially) compromised chunks in the database.
 * @param db The PouchDB database instance.
 * @returns The number of compromised chunks or false if an error occurs.
 */
export async function countCompromisedChunks(db: PouchDB.Database): Promise<number | false> {
    try {
        Logger(`Counting compromised chunks...`, LOG_LEVEL_VERBOSE);
        const task1 = db.find(SELECTOR_COMPROMISED_CHUNK_1);
        const task2 = db.find(SELECTOR_COMPROMISED_CHUNK_2);
        const [result1, result2] = await Promise.all([task1, task2]);
        return result1.docs.length + result2.docs.length;
    } catch (ex: any) {
        Logger(`Error counting compromised chunks!`, LOG_LEVEL_INFO);
        Logger(ex, LOG_LEVEL_VERBOSE);
        return false;
    }
}
