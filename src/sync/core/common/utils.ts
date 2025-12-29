import { LRUCache } from "octagonal-wheels/memory/LRUCache";
import { isPlainText } from "../string_and_binary/path.ts";
import { Semaphore } from "octagonal-wheels/concurrency/semaphore";
import { arrayBufferToBase64Single, decodeBinary, writeString } from "../string_and_binary/convert.ts";
import {
    type AnyEntry,
    type DatabaseEntry,
    type EntryLeaf,
    PREFIX_ENCRYPTED_CHUNK,
    PREFIX_OBFUSCATED,
    SYNCINFO_ID,
    type SyncInfo,
    type LoadedEntry,
    type SavingEntry,
    type NewEntry,
    type PlainEntry,
    type CustomRegExpSource,
    type ParsedCustomRegExp,
    type CustomRegExpSourceList,
    type ObsidianLiveSyncSettings,
    type RemoteDBSettings,
    type P2PConnectionInfo,
    type BucketSyncSetting,
    type CouchDBConnection,
    type EncryptionSettings,
} from "./types.ts";
import { isErrorOfMissingDoc } from "../pouchdb/utils_couchdb.ts";
import { replaceAll, replaceAllPairs } from "octagonal-wheels/string";
export { replaceAll, replaceAllPairs };
import { concatUInt8Array } from "octagonal-wheels/binary";
export { concatUInt8Array };

import { delay, fireAndForget } from "octagonal-wheels/promises";
export { delay, fireAndForget };

import { arrayToChunkedArray, unique } from "octagonal-wheels/collection";
export { arrayToChunkedArray, unique };

import { extractObject, isObjectDifferent } from "octagonal-wheels/object";
export { extractObject, isObjectDifferent };

import { sendValue, sendSignal, waitForSignal, waitForValue } from "octagonal-wheels/messagepassing/signal";
export { sendValue, sendSignal, waitForSignal, waitForValue };

import { throttle } from "octagonal-wheels/function";
export { throttle };

import type { SimpleStore } from "octagonal-wheels/databases/SimpleStoreBase";
export type { SimpleStore };

export { sizeToHumanReadable } from "octagonal-wheels/number";

export function resolveWithIgnoreKnownError<T>(p: Promise<T>, def: T): Promise<T> {
    return new Promise((res, rej) => {
        p.then(res).catch((ex) => (isErrorOfMissingDoc(ex) ? res(def) : rej(ex)));
    });
}

// Referenced below
// https://zenn.dev/sora_kumo/articles/539d7f6e7f3c63
export const Parallels = (ps = new Set<Promise<unknown>>()) => ({
    // eslint-disable-next-line @typescript-eslint/no-misused-promises
    add: (p: Promise<unknown>) => ps.add(!!p.then(() => ps.delete(p)).catch(() => ps.delete(p)) && p),
    wait: (limit: number) => ps.size >= limit && Promise.race(ps),
    all: () => Promise.all(ps),
});
export async function allSettledWithConcurrencyLimit<T>(processes: Promise<T>[], limit: number) {
    const ps = Parallels();
    for (const proc of processes) {
        ps.add(proc);
        await ps.wait(limit);
    }
    (await ps.all()).forEach(() => {});
}

export function getDocData(doc: string | string[]) {
    return typeof doc == "string" ? doc : doc.join("");
}
export function getDocDataAsArray(doc: string | string[]) {
    return typeof doc == "string" ? [doc] : doc;
}

export function getDocDataAsArrayBuffer(doc: string | string[] | ArrayBuffer) {
    if (doc instanceof ArrayBuffer) return new Uint8Array(doc);
    const docData = getDocDataAsArray(doc);
    const s = docData.map((e) => writeString(e));
    return concatUInt8Array(s);
}

export function isTextBlob(blob: Blob) {
    return blob.type === "text/plain";
}
export function createTextBlob(data: string | string[]) {
    const d = Array.isArray(data) ? data : [data];
    return new Blob(d, { endings: "transparent", type: "text/plain" });
}
export function createBinaryBlob(data: Uint8Array<ArrayBuffer> | ArrayBuffer) {
    return new Blob([data], { endings: "transparent", type: "application/octet-stream" });
}
export function createBlob(data: string | string[] | Uint8Array<ArrayBuffer> | ArrayBuffer | Blob) {
    if (data instanceof Blob) return data;
    if (data instanceof Uint8Array || data instanceof ArrayBuffer) return createBinaryBlob(data);
    return createTextBlob(data);
}

export function isTextDocument(doc: LoadedEntry) {
    if (doc.type == "plain") return true;
    if (doc.datatype == "plain") return true;
    if (isPlainText(doc.path)) return true;
    return false;
}

export function readAsBlob(doc: LoadedEntry) {
    if (isTextDocument(doc)) {
        return createTextBlob(doc.data);
    } else {
        return createBinaryBlob(decodeBinary(doc.data));
    }
}
export function readContent(doc: LoadedEntry) {
    if (isTextDocument(doc)) {
        return getDocData(doc.data);
    } else {
        return decodeBinary(doc.data);
    }
}

const isIndexDBCmpExist = typeof globalThis?.indexedDB?.cmp !== "undefined";

export async function isDocContentSame(
    docA: string | string[] | Blob | ArrayBuffer,
    docB: string | string[] | Blob | ArrayBuffer
) {
    const blob1 = createBlob(docA);
    const blob2 = createBlob(docB);
    if (blob1.size != blob2.size) return false;
    if (isIndexDBCmpExist) {
        return globalThis.indexedDB.cmp(await blob1.arrayBuffer(), await blob2.arrayBuffer()) === 0;
    }
    const checkQuantum = 10000;
    const length = blob1.size;

    let i = 0;

    while (i < length) {
        const ab1 = await blob1.slice(i, i + checkQuantum).arrayBuffer();
        const ab2 = await blob2.slice(i, i + checkQuantum).arrayBuffer();
        i += checkQuantum;
        if ((await arrayBufferToBase64Single(ab1)) != (await arrayBufferToBase64Single(ab2))) return false;
    }
    return true;
}

export function isObfuscatedEntry(doc: DatabaseEntry): doc is AnyEntry {
    if (doc._id.startsWith(PREFIX_OBFUSCATED)) {
        return true;
    }
    return false;
}

export function isEncryptedChunkEntry(doc: DatabaseEntry): doc is EntryLeaf {
    if (doc._id.startsWith(PREFIX_ENCRYPTED_CHUNK)) {
        return true;
    }
    return false;
}

export function isSyncInfoEntry(doc: DatabaseEntry): doc is SyncInfo {
    if (doc._id == SYNCINFO_ID) {
        return true;
    }
    return false;
}

export function memorizeFuncWithLRUCache<T, U>(func: (key: T) => U) {
    const cache = new LRUCache<T, U>(100, 100000, true);
    return (key: T) => {
        const isExists = cache.has(key);
        if (isExists) return cache.get(key);
        const value = func(key);
        cache.set(key, value);
        return value;
    };
}

export function memorizeFuncWithLRUCacheMulti<T extends Array<any>, U>(func: (...keys: T) => U) {
    const cache = new LRUCache<string, U>(100, 100000, true);
    return (keys: T) => {
        const theKey = keys
            .map((e) =>
                typeof e == "string" || typeof e == "number" || typeof e == "boolean" ? e.toString() : JSON.stringify(e)
            )
            .join("-");
        const isExists = cache.has(theKey);
        if (isExists) return cache.get(theKey);
        const value = func(...keys);
        cache.set(theKey, value);
        return value;
    };
}

/**
 *
 * @param exclusion return only not exclusion
 * @returns
 *
 * ["something",false,"aaaaa"].filter(onlyNot(false)) => yields ["something","aaaaaa"]. but, as string[].
 */
export function onlyNot<A, B>(exclusion: B) {
    function _onlyNot(item: A | B): item is Exclude<A, B> {
        if (item === exclusion) return false;
        return true;
    }
    return _onlyNot;
}

const lastProcessed = {} as Record<string, number>;
function markInterval(key: string, now?: number) {
    const next = now ?? Date.now();
    if (lastProcessed?.[key] ?? 0 < next) {
        lastProcessed[key] = next;
    }
}
/**
 * Run task with keeping minimum interval
 * @param key waiting key
 * @param interval interval (ms)
 * @param task task to perform.
 * @returns result of task
 * @remarks This function is not designed to be concurrent.
 */
export async function runWithInterval<T>(key: string, interval: number, task: () => Promise<T>): Promise<T> {
    const now = Date.now();
    try {
        if (!(key in lastProcessed)) {
            markInterval(key, now);
            return await task();
        }

        const last = lastProcessed[key];
        const diff = now - last;
        if (diff < interval) {
            markInterval(key, now);
            await delay(diff);
        }
        markInterval(key);
        return await task();
    } finally {
        markInterval(key);
    }
}

/**
 * Run task with keeping minimum interval on start
 * @param key waiting key
 * @param interval interval (ms)
 * @param task task to perform.
 * @returns result of task
 * @remarks This function is not designed to be concurrent.
 */
export async function runWithStartInterval<T>(key: string, interval: number, task: () => Promise<T>): Promise<T> {
    const now = Date.now();
    if (!(key in lastProcessed)) {
        markInterval(key, now);
        return await task();
    }

    const last = lastProcessed[key];
    const diff = now - last;
    if (diff < interval) {
        markInterval(key, now);
        await delay(diff);
    }
    markInterval(key);
    return await task();
}

export const globalConcurrencyController = Semaphore(50);

export function determineTypeFromBlob(data: Blob): "newnote" | "plain" {
    return isTextBlob(data) ? "plain" : "newnote";
}
export function determineType(
    path: string,
    data: string | string[] | Uint8Array | ArrayBuffer | Blob
): "newnote" | "plain" {
    if (data instanceof Blob) {
        return determineTypeFromBlob(data);
    }
    if (isPlainText(path)) return "plain";
    if (data instanceof Uint8Array) return "newnote";
    if (data instanceof ArrayBuffer) return "newnote";
    // string | string[]
    return "plain";
}

export function isAnyNote(doc: DatabaseEntry): doc is NewEntry | PlainEntry {
    return "type" in doc && (doc.type == "newnote" || doc.type == "plain");
}
export function isLoadedEntry(doc: DatabaseEntry): doc is LoadedEntry {
    return "type" in doc && (doc.type == "newnote" || doc.type == "plain") && "data" in doc;
}

export function isDeletedEntry(doc: LoadedEntry): boolean {
    return doc._deleted || doc.deleted || false;
}
export function createSavingEntryFromLoadedEntry(doc: LoadedEntry): SavingEntry {
    const data = readAsBlob(doc);
    const type = determineType(doc.path, data);
    return {
        ...doc,
        data: data,
        datatype: type,
        type,
        children: [],
    };
}

export function setAllItems<T>(set: Set<T>, items: T[]) {
    items.forEach((e) => set.add(e));
    return set;
}

const map = {
    "\n": "\\n",
    "\r": "\\r",
    "\\": "\\\\",
} as Record<string, string>;
const revMap = {
    "\\n": "\n",
    "\\r": "\r",
    "\\\\": "\\",
} as Record<string, string>;
export function escapeNewLineFromString(str: string) {
    if (str.indexOf("\n") === -1 && str.indexOf("\r") === -1) {
        return str;
    }
    const p = str.replace(/(\n|\r|\\)/g, (m) => `${map[m]}`);
    return "\\f" + p;
}

export function unescapeNewLineFromString(str: string) {
    if (!str.startsWith("\\f")) {
        return str;
    }
    const p = str.substring(2).replace(/(\\n|\\r|\\\\)/g, (m) => `${revMap[m]}`);
    return p;
}

export function escapeMarkdownValue(value: any) {
    if (typeof value === "string") {
        return replaceAllPairs(value, ["|", "\\|"], ["`", "\\`"]);
    } else {
        return value;
    }
}

export function timeDeltaToHumanReadable(delta: number) {
    const sec = delta / 1000;
    if (sec < 60) {
        return `${sec.toFixed(2)}s`;
    }
    const min = sec / 60;
    if (min < 60) {
        return `${min.toFixed(2)}m`;
    }
    const hour = min / 60;
    if (hour < 24) {
        return `${hour.toFixed(2)}h`;
    }
    const day = hour / 24;
    if (day < 365) {
        return `${day.toFixed(2)}d`;
    }
    const year = day / 365;
    return `${year.toFixed(2)}y`;
}

export async function wrapException<T>(func: () => Promise<Awaited<T>>): Promise<Awaited<T> | Error> {
    try {
        return await func();
    } catch (ex: any) {
        if (ex instanceof Error) {
            return ex;
        }
        return new Error(ex);
    }
}

// numeric array to range
// IN  : [1,2,3,5,6,10,11]
// OUT : `1-3,5-6,10-11`

export function toRanges(sorted: number[]) {
    // const sorted = numbers.sort((a, b) => a - b);
    if (sorted?.length == 0) return "";
    const ranges = [];
    let start = sorted[0];
    let end = sorted[0];
    for (let i = 1; i < sorted.length; i++) {
        if (sorted[i] === end + 1) {
            end = sorted[i];
        } else {
            ranges.push(start === end ? `${start.toString(32)}` : `${start.toString(32)}-${end.toString(32)}`);
            start = sorted[i];
            end = sorted[i];
        }
    }
    ranges.push(start === end ? `${start.toString(32)}` : `${start.toString(32)}-${end.toString(32)}`);

    return ranges.join(",");
}

const previousValues = new Map<string, any>();
export function isDirty(key: string, value: any) {
    const prev = previousValues.get(key);
    if (prev === value) return false;
    previousValues.set(key, value);
    return true;
}

export function isSensibleMargeApplicable(path: string) {
    if (path.endsWith(".md")) return true;
    return false;
}
export function isObjectMargeApplicable(path: string) {
    if (path.endsWith(".canvas")) return true;
    if (path.endsWith(".json")) return true;
    return false;
}

export function tryParseJSON(str: string, fallbackValue?: any) {
    try {
        return JSON.parse(str);
    } catch {
        return fallbackValue;
    }
}

const MARK_OPERATOR = `\u{0001}`;
const MARK_DELETED = `${MARK_OPERATOR}__DELETED`;
const MARK_ISARRAY = `${MARK_OPERATOR}__ARRAY`;
const MARK_SWAPPED = `${MARK_OPERATOR}__SWAP`;

function unorderedArrayToObject(obj: Array<any>) {
    return obj.map((e) => ({ [e.id as string]: e })).reduce((p, c) => ({ ...p, ...c }), {});
}
function objectToUnorderedArray(obj: object) {
    const entries = Object.entries(obj);
    if (entries.some((e) => e[0] != e[1]?.id)) throw new Error("Item looks like not unordered array");
    return entries.map((e) => e[1]);
}
function generatePatchUnorderedArray(from: Array<any>, to: Array<any>) {
    if (from.every((e) => typeof e == "object" && "id" in e) && to.every((e) => typeof e == "object" && "id" in e)) {
        const fObj = unorderedArrayToObject(from);
        const tObj = unorderedArrayToObject(to);
        const diff = generatePatchObj(fObj, tObj);
        if (Object.keys(diff).length > 0) {
            return { [MARK_ISARRAY]: diff };
        } else {
            return {};
        }
    }
    return { [MARK_SWAPPED]: to };
}

export function generatePatchObj(
    from: Record<string | number | symbol, any>,
    to: Record<string | number | symbol, any>
) {
    const entries = Object.entries(from);
    const tempMap = new Map<string | number | symbol, any>(entries);
    const ret = {} as Record<string | number | symbol, any>;
    const newEntries = Object.entries(to);
    for (const [key, value] of newEntries) {
        if (!tempMap.has(key)) {
            //New
            ret[key] = value;
            tempMap.delete(key);
        } else {
            //Exists
            const v = tempMap.get(key);
            if (typeof v !== typeof value || Array.isArray(v) !== Array.isArray(value)) {
                //if type is not match, replace completely.
                ret[key] = { [MARK_SWAPPED]: value };
            } else {
                if (v === null && value === null) {
                    // NO OP.
                } else if (v === null && value !== null) {
                    ret[key] = { [MARK_SWAPPED]: value };
                } else if (v !== null && value === null) {
                    ret[key] = { [MARK_SWAPPED]: value };
                } else if (
                    typeof v == "object" &&
                    typeof value == "object" &&
                    !Array.isArray(v) &&
                    !Array.isArray(value)
                ) {
                    const wk = generatePatchObj(v, value);
                    if (Object.keys(wk).length > 0) ret[key] = wk;
                } else if (
                    typeof v == "object" &&
                    typeof value == "object" &&
                    Array.isArray(v) &&
                    Array.isArray(value)
                ) {
                    const wk = generatePatchUnorderedArray(v, value);
                    if (Object.keys(wk).length > 0) ret[key] = wk;
                } else if (typeof v != "object" && typeof value != "object") {
                    if (JSON.stringify(tempMap.get(key)) !== JSON.stringify(value)) {
                        ret[key] = value;
                    }
                } else {
                    if (JSON.stringify(tempMap.get(key)) !== JSON.stringify(value)) {
                        ret[key] = { [MARK_SWAPPED]: value };
                    }
                }
            }
            tempMap.delete(key);
        }
    }
    //Not used item, means deleted one
    for (const [key] of tempMap) {
        ret[key] = MARK_DELETED;
    }
    return ret;
}

export function applyPatch(from: Record<string | number | symbol, any>, patch: Record<string | number | symbol, any>) {
    const ret = from;
    const patches = Object.entries(patch);
    for (const [key, value] of patches) {
        if (value == MARK_DELETED) {
            delete ret[key];
            continue;
        }
        if (value === null) {
            ret[key] = null;
            continue;
        }
        if (typeof value == "object") {
            if (MARK_SWAPPED in value) {
                ret[key] = value[MARK_SWAPPED];
                continue;
            }
            if (MARK_ISARRAY in value) {
                if (!(key in ret)) ret[key] = [];
                if (!Array.isArray(ret[key])) {
                    throw new Error("Patch target type is mismatched (array to something)");
                }
                const orgArrayObject = unorderedArrayToObject(ret[key]);
                const appliedObject = applyPatch(orgArrayObject, value[MARK_ISARRAY]);
                const appliedArray = objectToUnorderedArray(appliedObject);
                ret[key] = [...appliedArray];
            } else {
                if (!(key in ret)) {
                    ret[key] = value;
                    continue;
                }
                ret[key] = applyPatch(ret[key], value);
            }
        } else {
            ret[key] = value;
        }
    }
    return ret;
}

export function mergeObject(
    objA: Record<string | number | symbol, any> | [any],
    objB: Record<string | number | symbol, any> | [any]
) {
    const newEntries = Object.entries(objB);
    const ret: any = { ...objA };
    if (typeof objA !== typeof objB || Array.isArray(objA) !== Array.isArray(objB)) {
        return objB;
    }

    for (const [key, v] of newEntries) {
        if (key in ret) {
            const value = ret[key];
            if (typeof v !== typeof value || Array.isArray(v) !== Array.isArray(value)) {
                //if type is not match, replace completely.
                ret[key] = v;
            } else {
                if (typeof v == "object" && typeof value == "object" && !Array.isArray(v) && !Array.isArray(value)) {
                    ret[key] = mergeObject(v, value);
                } else if (
                    typeof v == "object" &&
                    typeof value == "object" &&
                    Array.isArray(v) &&
                    Array.isArray(value)
                ) {
                    ret[key] = [...new Set([...v, ...value])];
                } else {
                    ret[key] = v;
                }
            }
        } else {
            ret[key] = v;
        }
    }
    const retSorted = Object.fromEntries(Object.entries(ret).sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)));
    if (Array.isArray(objA) && Array.isArray(objB)) {
        return Object.values(retSorted);
    }
    return retSorted;
}

export function flattenObject(obj: Record<string | number | symbol, any>, path: string[] = []): [string, any][] {
    if (typeof obj != "object") return [[path.join("."), obj]];
    if (obj === null) return [[path.join("."), null]];
    if (Array.isArray(obj)) return [[path.join("."), JSON.stringify(obj)]];
    const e = Object.entries(obj);
    const ret = [];
    for (const [key, value] of e) {
        const p = flattenObject(value, [...path, key]);
        ret.push(...p);
    }
    return ret;
}

export function parseHeaderValues(strHeader: string): Record<string, string> {
    const headers: Record<string, string> = {};
    const lines = strHeader.split("\n");
    for (const line of lines) {
        const [key, value] = line.split(":", 2).map((e) => e.trim());
        if (key && value) {
            headers[key] = value;
        }
    }
    return headers;
}

/***
 * Parse custom regular expression
 * @param regexp
 * @returns [negate: boolean, regexp: string]
 * @example `!!foo` => [true, "foo"]
 * @example `foo` => [false, "foo"]
 */
export function parseCustomRegExp(regexp: CustomRegExpSource): ParsedCustomRegExp {
    if (regexp.startsWith("!!")) {
        return [true, regexp.slice(2)];
    }
    return [false, regexp];
}
export function matchRegExp(regexp: CustomRegExpSource, target: string) {
    const [negate, regexpWithoutNegate] = parseCustomRegExp(regexp);
    if (regexpWithoutNegate.length == 0) return false;
    const re = new RegExp(regexpWithoutNegate);
    return negate ? !re.test(target) : re.test(target);
}
export function isValidRegExp(regexp: CustomRegExpSource) {
    try {
        const [, exp] = parseCustomRegExp(regexp);
        new RegExp(exp);
        return true;
    } catch {
        return false;
    }
}
export function isInvertedRegExp(regexp: CustomRegExpSource) {
    const [negate] = parseCustomRegExp(regexp);
    return negate;
}

function parseCustomRegExpList<D extends string>(list: CustomRegExpSourceList<D>, flags?: string, delimiter?: D) {
    const d = delimiter ?? ",";
    const items = list
        .replace(/\n| /g, "")
        .split(d)
        .filter((e) => e);
    return items.map((e) => new CustomRegExp(e as unknown as CustomRegExpSource, flags));
}

export function constructCustomRegExpList<D extends string>(
    items: CustomRegExpSource[],
    delimiter: D
): CustomRegExpSourceList<D> {
    return items.map((e) => `${e}`).join(`${delimiter}`) as CustomRegExpSourceList<D>;
}
export function splitCustomRegExpList<D extends string>(list: CustomRegExpSourceList<D>, delimiter: D) {
    const d = delimiter;
    return list.split(d).filter((e) => e as CustomRegExpSource) as CustomRegExpSource[];
}

export class CustomRegExp {
    regexp: RegExp;
    negate: boolean;
    pattern: string;
    constructor(regexp: CustomRegExpSource, flags?: string) {
        const [negate, exp] = parseCustomRegExp(regexp);
        this.pattern = exp;
        this.regexp = new RegExp(exp, flags);
        this.negate = negate;
    }
    test(str: string) {
        return this.negate ? !this.regexp.test(str) : this.regexp.test(str);
    }
}

type RegExpSettingKey =
    | "syncOnlyRegEx"
    | "syncIgnoreRegEx"
    | "syncInternalFilesIgnorePatterns"
    | "syncInternalFilesTargetPatterns"
    | "syncInternalFileOverwritePatterns";
export function getFileRegExp(settings: ObsidianLiveSyncSettings | RemoteDBSettings, key: RegExpSettingKey) {
    const flagCase = settings.handleFilenameCaseSensitive ? "" : "i";
    if (
        key === "syncInternalFilesIgnorePatterns" ||
        key === "syncInternalFilesTargetPatterns" ||
        key === "syncInternalFileOverwritePatterns"
    ) {
        const regExp = (settings as ObsidianLiveSyncSettings)[key];
        return parseCustomRegExpList(regExp, flagCase, ",");
    }
    const regExp = settings[key];
    return parseCustomRegExpList(regExp, flagCase, "|[]|");
}

/**
 * Copies properties from the source object to the target object only if they exist in the target.
 * @param source The object to copy properties from.
 * @param target The object to copy properties to.
 */
export function copyTo<T extends object, U extends T>(source: U, target: T): void {
    for (const key of Object.keys(target) as (keyof T)[]) {
        target[key] = source[key];
    }
}

// export function getConnectionSummaryP2P(settings: P2PConnectionInfo) { }
// export function getConnectionSummaryBucket(settings: BucketSyncSetting) { }
// export function getConnectionSummaryCouchDB(settings: CouchDBConnection) { }
// export function getConnectionSummaryE2EE(settings: EncryptionSettings) { }

export function pickBucketSyncSettings(setting: ObsidianLiveSyncSettings): BucketSyncSetting {
    return {
        bucket: setting.bucket,
        region: setting.region,
        endpoint: setting.endpoint,
        accessKey: setting.accessKey,
        secretKey: setting.secretKey,
        bucketPrefix: setting.bucketPrefix,
        forcePathStyle: setting.forcePathStyle,
        useCustomRequestHandler: setting.useCustomRequestHandler,
        bucketCustomHeaders: setting.bucketCustomHeaders,
    };
}

export function pickCouchDBSyncSettings(setting: ObsidianLiveSyncSettings): CouchDBConnection {
    return {
        couchDB_URI: setting.couchDB_URI,
        couchDB_USER: setting.couchDB_USER,
        couchDB_PASSWORD: setting.couchDB_PASSWORD,
        couchDB_DBNAME: setting.couchDB_DBNAME,
        useRequestAPI: setting.useRequestAPI,
        // Advanced settings
        couchDB_CustomHeaders: setting.couchDB_CustomHeaders,
        jwtAlgorithm: setting.jwtAlgorithm,
        jwtExpDuration: setting.jwtExpDuration,
        jwtKey: setting.jwtKey,
        jwtKid: setting.jwtKid,
        jwtSub: setting.jwtSub,
        useJWT: setting.useJWT,
    };
}

export function pickEncryptionSettings(setting: ObsidianLiveSyncSettings | EncryptionSettings): EncryptionSettings {
    return {
        E2EEAlgorithm: setting.E2EEAlgorithm,
        encrypt: setting.encrypt,
        passphrase: setting.passphrase,
        usePathObfuscation: setting.usePathObfuscation,
    };
}
export function pickP2PSyncSettings(setting: Partial<ObsidianLiveSyncSettings> & P2PConnectionInfo): P2PConnectionInfo {
    return {
        P2P_Enabled: setting.P2P_Enabled,
        P2P_AppID: setting.P2P_AppID,
        P2P_roomID: setting.P2P_roomID,
        P2P_passphrase: setting.P2P_passphrase,
        P2P_relays: setting.P2P_relays,
        P2P_AutoStart: setting.P2P_AutoStart,
        P2P_AutoBroadcast: setting.P2P_AutoBroadcast,
        P2P_DevicePeerName: setting.P2P_DevicePeerName || "",
        P2P_turnServers: setting.P2P_turnServers,
        P2P_turnUsername: setting.P2P_turnUsername,
        P2P_turnCredential: setting.P2P_turnCredential,
    };
}
