import * as fflate from "fflate";
import {
    tryConvertBase64ToArrayBuffer,
    arrayBufferToBase64Single,
    base64ToArrayBuffer,
} from "../string_and_binary/convert";
import type { EntryDoc } from "../common/types";

export async function _compressText(text: string) {
    const converted = tryConvertBase64ToArrayBuffer(text);
    const data = new Uint8Array(
        converted || (await new Blob([text], { type: "application/octet-stream" }).arrayBuffer())
    );
    if (data.buffer.byteLength == 0) {
        return "";
    }
    const df = await wrappedDeflate(new Uint8Array(data), { consume: true, level: 8 });
    // Reverted: Even if chars in UTF-16 encoded were short, bytes in UTF-8 are longer than in base64 encoding.
    // const deflateResult = (converted ? "~" : "") + "%" + fflate.strFromU8(df, true);
    // @ts-ignore Wrong type at octagonal-wheels v0.1.25
    const deflateResult = (converted ? "~" : "") + (await arrayBufferToBase64Single(df));
    return deflateResult;
}
export const wrappedInflate = wrapFflateFunc<Uint8Array<ArrayBuffer>, fflate.AsyncInflateOptions>(fflate.inflate);
export const wrappedDeflate = wrapFflateFunc<Uint8Array<ArrayBuffer>, fflate.AsyncDeflateOptions>(fflate.deflate);
export async function _decompressText(compressed: string, _useUTF16 = false) {
    if (compressed.length == 0) {
        return "";
    }
    const converted = compressed[0] == "~";
    const src = compressed.substring(converted ? 1 : 0);
    if (src.length == 0) {
        return "";
    }
    // const ab = src.startsWith("%") ? fflate.strToU8(src.substring(1), true) : new Uint8Array(base64ToArrayBuffer(src));
    const ab = new Uint8Array(base64ToArrayBuffer(src));
    if (ab.length == 0) {
        return "";
    }
    const ret = await wrappedInflate(new Uint8Array(ab), { consume: true });
    if (converted) {
        //@ts-ignore Wrong type at octagonal-wheels v0.1.25
        return await arrayBufferToBase64Single(ret);
    }
    const response = new Blob([ret]);
    const text = await response.text();
    return text;
}
export async function compressDoc(doc: EntryDoc) {
    if (!("data" in doc)) {
        return doc;
    }
    if (typeof doc.data !== "string") return doc;
    if (doc.data.startsWith(MARK_SHIFT_COMPRESSED)) return doc;
    const oldData = doc.data;
    const compressed = await _compressText(oldData);
    const newData = MARK_SHIFT_COMPRESSED + compressed;
    if (doc.data.length > newData.length) doc.data = newData;
    return doc;
}
export async function decompressDoc(doc: EntryDoc) {
    if (!("data" in doc)) {
        return doc;
    }
    if (typeof doc.data !== "string") return doc;

    // Already decrypted
    if (doc.data.startsWith(MARK_SHIFT_COMPRESSED)) {
        doc.data = await _decompressText(doc.data.substring(MARK_SHIFT_COMPRESSED.length));
    }
    return doc;
}
export function wrapFflateFunc<T, U>(
    func: (data: T, opts: U, cb: fflate.FlateCallback) => any
): (data: T, opts: U) => Promise<Uint8Array<ArrayBuffer>> {
    return (data: T, opts: U) => {
        return new Promise<Uint8Array<ArrayBuffer>>((res, rej) => {
            func(data, opts, (err, result) => {
                if (err) rej(err);
                else res(new Uint8Array(result));
            });
        });
    };
}
export const replicationFilter = (db: PouchDB.Database<EntryDoc>, compress: boolean) => {
    //@ts-ignore
    db.transform({
        //@ts-ignore
        async incoming(doc) {
            if (!compress) return doc;
            return await compressDoc(doc);
        },
        //@ts-ignore
        async outgoing(doc) {
            // We should decompress if compression is not configured.
            return await decompressDoc(doc);
        },
    });
};
const MARK_SHIFT = `\u{000E}L`;
export const MARK_SHIFT_COMPRESSED = `${MARK_SHIFT}Z\u{001D}`;
