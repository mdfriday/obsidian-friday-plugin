// Misc
import {
    arrayBufferToBase64,
    base64ToArrayBuffer,
    base64ToArrayBufferInternalBrowser,
    arrayBufferToBase64Single,
    readString,
    writeString,
    tryConvertBase64ToArrayBuffer,
} from "octagonal-wheels/binary";
export {
    arrayBufferToBase64,
    base64ToArrayBuffer,
    base64ToArrayBufferInternalBrowser,
    arrayBufferToBase64Single,
    readString,
    writeString,
    tryConvertBase64ToArrayBuffer,
};
export { uint8ArrayToHexString, hexStringToUint8Array } from "octagonal-wheels/binary/hex";
export { encodeBinaryEach, decodeToArrayBuffer } from "octagonal-wheels/binary/encodedUTF16";
export { decodeBinary, encodeBinary } from "octagonal-wheels/binary";
export { escapeStringToHTML } from "octagonal-wheels/string";
export function versionNumberString2Number(version: string): number {
    return version // "1.23.45"
        .split(".") // 1  23  45
        .reverse() // 45  23  1
        .map((e, i) => ((e as any) / 1) * 1000 ** i) // 45 23000 1000000
        .reduce((prev, current) => prev + current, 0); // 1023045
}
