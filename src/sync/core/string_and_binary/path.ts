import { minimatch, type MinimatchOptions } from "minimatch";
import { getWebCrypto } from "../mods.ts";
import {
    type AnyEntry,
    type DocumentID,
    type EntryHasPath,
    type FilePath,
    type FilePathWithPrefix,
    FLAGMD_REDFLAG,
    FLAGMD_REDFLAG2,
    FLAGMD_REDFLAG3,
    PREFIX_OBFUSCATED,
    PREFIXMD_LOGFILE,
    FLAGMD_REDFLAG2_HR,
    FLAGMD_REDFLAG3_HR,
    PREFIXMD_LOGFILE_UC,
} from "../common/types.ts";
import { memorizeFuncWithLRUCache } from "../common/utils.ts";
import { uint8ArrayToHexString, writeString } from "./convert.ts";
import { unique } from "octagonal-wheels/collection.js";
// --- path utilities
export function isValidFilenameInWidows(filename: string): boolean {
    // eslint-disable-next-line no-control-regex
    const regex = /[\u0000-\u001f]|[\\":?<>|*#]/g;
    if (regex.test(filename)) return false;
    const win = /(\\|\/)(COM\d|LPT\d|CON|PRN|AUX|NUL|CLOCK$)($|\.)/gi;
    if (win.test(filename)) return false;
    return true;
}
export function isValidFilenameInDarwin(filename: string): boolean {
    // eslint-disable-next-line no-control-regex
    const regex = /[\u0000-\u001f]|[:]/g;
    return !regex.test(filename);
}
export function isValidFilenameInLinux(filename: string): boolean {
    // In the specification, `:` could be accepted, LiveSync should ignore this for make things simple.
    // eslint-disable-next-line no-control-regex
    const regex = /[\u0000-\u001f]|[:]/g;
    return !regex.test(filename);
}
export function isValidFilenameInAndroid(filename: string): boolean {
    // In principle, Android can handle the path as like Linux, but most devices mount the storage in VFAT.
    // eslint-disable-next-line no-control-regex
    const regex = /[\u0000-\u001f]|[\\":?<>|*#]/g;
    return !regex.test(filename);
}

export function isFilePath(path: FilePath | FilePathWithPrefix): path is FilePath {
    if (path.indexOf(":") === -1) return true;
    return false;
}
export function stripAllPrefixes(prefixedPath: FilePathWithPrefix): FilePath {
    if (isFilePath(prefixedPath)) return prefixedPath;
    const [, body] = expandFilePathPrefix(prefixedPath);
    return stripAllPrefixes(body);
}
export function addPrefix(path: FilePath | FilePathWithPrefix, prefix: string): FilePathWithPrefix {
    if (prefix && path.startsWith(prefix)) return path;
    return `${prefix ?? ""}${path}` as FilePathWithPrefix;
}
export function expandFilePathPrefix(path: FilePathWithPrefix | FilePath): [string, FilePathWithPrefix] {
    let [prefix, body] = path.split(":", 2);
    if (!body) {
        body = prefix;
        prefix = "";
    } else {
        prefix = prefix + ":";
    }
    return [prefix, body as FilePathWithPrefix];
}
export function expandDocumentIDPrefix(id: DocumentID): [string, FilePathWithPrefix] {
    let [prefix, body] = id.split(":", 2);
    if (!body) {
        body = prefix;
        prefix = "";
    } else {
        prefix = prefix + ":";
    }
    return [prefix, body as FilePathWithPrefix];
}

const _hashString = memorizeFuncWithLRUCache(async (key: string) => {
    const buff = writeString(key);
    const webcrypto = await getWebCrypto();
    let digest = await webcrypto.subtle.digest("SHA-256", buff);
    const len = key.length;
    for (let i = 0; i < len; i++) {
        // Stretching
        digest = await webcrypto.subtle.digest("SHA-256", buff);
    }
    return uint8ArrayToHexString(new Uint8Array(digest));
});

function hashString(key: string) {
    return _hashString(key);
}

export async function path2id_base(
    filenameSrc: FilePathWithPrefix | FilePath,
    obfuscatePassphrase: string | false,
    caseInsensitive: boolean
): Promise<DocumentID> {
    if (filenameSrc.startsWith(PREFIX_OBFUSCATED)) return `${filenameSrc}` as DocumentID;
    let filename = `${filenameSrc}`;
    const newPrefix = obfuscatePassphrase ? PREFIX_OBFUSCATED : "";
    if (caseInsensitive) {
        filename = filename.toLowerCase() as FilePathWithPrefix;
    }

    let x = filename;
    if (x.startsWith("_")) x = ("/" + x) as FilePathWithPrefix;

    if (!obfuscatePassphrase) {
        return (newPrefix + x) as DocumentID;
    }

    // obfuscating...
    const [prefix, body] = expandFilePathPrefix(x as FilePathWithPrefix);
    // Already Hashed
    if (body.startsWith(PREFIX_OBFUSCATED)) return (newPrefix + x) as DocumentID;
    const hashedPassphrase = await hashString(obfuscatePassphrase);
    // Hash it!
    const out = await hashString(`${hashedPassphrase}:${filename}`);
    return (prefix + newPrefix + out) as DocumentID;
}

export function id2path_base(id: DocumentID, entry?: EntryHasPath): FilePathWithPrefix {
    if (entry && entry?.path) {
        return id2path_base(entry.path as string as DocumentID);
    }
    if (id.startsWith(PREFIX_OBFUSCATED)) throw new Error("Entry has been obfuscated!");
    const [prefix, body] = expandDocumentIDPrefix(id);
    if (body.startsWith(PREFIX_OBFUSCATED)) throw new Error("Entry has been obfuscated!");
    if (body.startsWith("/")) {
        return body.substring(1) as FilePathWithPrefix;
    }
    return (prefix + body) as FilePathWithPrefix;
}

export function getPath(entry: AnyEntry) {
    return id2path_base(entry._id, entry);
}
export function getPathWithoutPrefix(entry: AnyEntry) {
    const f = getPath(entry);
    return stripAllPrefixes(f);
}
export function stripPrefix(prefixedPath: FilePathWithPrefix): FilePath {
    const [prefix, body] = prefixedPath.split(":", 2);
    if (!body) {
        return prefix as FilePath;
    }
    return body as FilePath;
}

export function shouldBeIgnored(filename: string): boolean {
    if (filename == FLAGMD_REDFLAG) {
        return true;
    }
    if (filename == FLAGMD_REDFLAG2) {
        return true;
    }
    if (filename == FLAGMD_REDFLAG2_HR) {
        return true;
    }
    if (filename == FLAGMD_REDFLAG3) {
        return true;
    }
    if (filename == FLAGMD_REDFLAG3_HR) {
        return true;
    }
    if (filename.startsWith(PREFIXMD_LOGFILE)) {
        return true;
    }
    if (filename.startsWith(PREFIXMD_LOGFILE_UC)) {
        return true;
    }
    return false;
}
export function isPlainText(filename: string): boolean {
    if (filename.endsWith(".md")) return true;
    if (filename.endsWith(".txt")) return true;
    if (filename.endsWith(".svg")) return true;
    if (filename.endsWith(".html")) return true;
    if (filename.endsWith(".csv")) return true;
    if (filename.endsWith(".css")) return true;
    if (filename.endsWith(".js")) return true;
    if (filename.endsWith(".xml")) return true;
    if (filename.endsWith(".canvas")) return true;
    return false;
}
export function shouldSplitAsPlainText(filename: string): boolean {
    if (filename.endsWith(".md")) return true;
    if (filename.endsWith(".txt")) return true;
    if (filename.endsWith(".canvas")) return true;
    return false;
}

const matchOpts: MinimatchOptions = { platform: "linux", dot: true, flipNegate: true, nocase: true };

/**
 * returns whether the given path is accepted (not ignored) by the `.gitignore`.
 * @param path path of the file which is relative from `.gitignore` file
 * @param ignore lines of `.gitignore`
 * @returns true when accepted.
 * false when not accepted.
 * undefined when the path is not mentioned in the `.gitignore` file.
 */
export function isAccepted(path: string, ignore: string[]): boolean | undefined {
    if (path.indexOf("./") !== -1 || path.indexOf("../") !== -1) {
        // We do not accept this for handle the cases which ends with `/` by wildcard
        return false;
    }
    const patterns = ignore.map((e) => e.trim()).filter((e) => e.length > 0 && !e.startsWith("#"));
    let result = undefined;
    for (const pattern of patterns) {
        if (pattern.endsWith("/")) {
            // If the path ends with `/` and matched to the path. we do not handle more patterns to negate the result.
            if (minimatch(path, `${pattern}**`, matchOpts)) {
                return false;
            }
        }
        const newResult = pattern.startsWith("!");
        const matched =
            minimatch(path, pattern, matchOpts) ||
            (!pattern.endsWith("/") && minimatch(path, pattern + "/**", matchOpts));

        if (matched) {
            result = newResult;
        }
    }
    return result;
}

/**
 * Checks whether the path is accepted by all ignored files.
 * @param path path of target file
 * @param ignoreFiles list of ignore files. i.e. [".gitignore", ".dockerignore"]
 * @param getList function to retrieve the file.
 * @returns true when accepted. false when should be ignored.
 */
export async function isAcceptedAll(
    path: string,
    ignoreFiles: string[],
    getList: (path: string) => Promise<string[] | false>
) {
    const pathBase = path.substring(0, path.lastIndexOf("/"));
    const intermediatePaths = unique(
        pathBase
            .split("/")
            .reduce((p, c) => [...p, p[p.length - 1] + "/" + c], [""])
            .map((e) => e.substring(1))
    ).reverse();

    for (const intermediatePath of intermediatePaths) {
        for (const ignoreFile of ignoreFiles) {
            const ignoreFilePath = intermediatePath + "/" + ignoreFile;
            const list = await getList(ignoreFilePath);
            if (list === false) continue;
            const result = isAccepted(path.substring(intermediatePath.length ? intermediatePath.length + 1 : 0), list);
            if (result !== undefined) {
                return result;
            }
        }
    }
    return true;
}
