function isTextBlob(blob: Blob) {
    return blob.type === "text/plain";
}

import { arrayBufferToBase64Single, readString } from "./convert.ts";

/// Chunk utilities
function* pickPiece(leftData: string[], minimumChunkSize: number): Generator<string> {
    let buffer = "";
    L1: do {
        const curLine = leftData.shift();
        if (typeof curLine === "undefined") {
            yield buffer;
            break L1;
        }

        // Do not use regexp for performance.
        if (
            curLine.startsWith("```") ||
            curLine.startsWith(" ```") ||
            curLine.startsWith("  ```") ||
            curLine.startsWith("   ```")
        ) {
            yield buffer;
            buffer = curLine + (leftData.length != 0 ? "\n" : "");
            L2: do {
                const curPx = leftData.shift();
                if (typeof curPx === "undefined") {
                    break L2;
                }
                buffer += curPx + (leftData.length != 0 ? "\n" : "");
            } while (
                leftData.length > 0 &&
                !(
                    leftData[0].startsWith("```") ||
                    leftData[0].startsWith(" ```") ||
                    leftData[0].startsWith("  ```") ||
                    leftData[0].startsWith("   ```")
                )
            );
            const isLooksLikeBASE64 = buffer.endsWith("=");
            const maybeUneditable = buffer.length > 2048;
            // concat code block end mark
            const endOfCodeBlock = leftData.shift();
            if (typeof endOfCodeBlock !== "undefined") {
                buffer += endOfCodeBlock;
                buffer += leftData.length != 0 ? "\n" : "";
            }
            if (!isLooksLikeBASE64 && !maybeUneditable) {
                const splitExpr = /(.*?[;,:<])/g;
                const sx = buffer.split(splitExpr).filter((e) => e != "");
                for (const v of sx) {
                    yield v;
                }
            } else {
                yield buffer;
            }
            buffer = "";
        } else {
            buffer += curLine + (leftData.length != 0 ? "\n" : "");
            if (buffer.length >= minimumChunkSize || leftData.length == 0 || leftData[0] == "#" || buffer[0] == "#") {
                yield buffer;
                buffer = "";
            }
        }
    } while (leftData.length > 0);
}

const charNewLine = "\n".charCodeAt(0);

//@ts-ignore Segmenter is not available in all browsers yet.
const segmenter = "Segmenter" in Intl ? new Intl.Segmenter(navigator.language, { granularity: "sentence" }) : undefined;

function* splitStringWithinLength(text: string, pieceSize: number) {
    let leftData = text;
    do {
        const splitSize = pieceSize;
        const piece = leftData.substring(0, splitSize);
        leftData = leftData.substring(splitSize);
        yield piece;
    } while (leftData != "");
}

function* splitTextInSegment(text: string, pieceSize: number, minimumChunkSize: number) {
    const segments = segmenter!.segment(text) as [{ segment: string }];

    let prev = "";
    let buf = "";

    for (const seg of segments) {
        // Same segment, concat.
        const buffer = seg.segment;
        if (prev == buffer || buf.length < minimumChunkSize) {
            buf += buffer;
            prev = buffer;
        } else {
            prev = buffer;
            if (buf.length > 0) {
                yield* splitStringWithinLength(buf, pieceSize);
            }
            buf = buffer;
        }
    }
    if (buf.length > 0) {
        yield* splitStringWithinLength(buf, pieceSize);
    }
}

function* splitInNewLine(texts: string[]) {
    for (const text of texts) {
        let start = -1;
        let end = -1;
        do {
            end = text.indexOf("\n", start);
            if (end == -1) {
                yield text.substring(start);
                break;
            }
            // Concat empty lines.
            while (text[end] == "\n") {
                end++;
            }
            yield text.substring(start, end);
            start = end;
        } while (end != -1);
    }
    return;
}
export function splitPiecesTextV2(dataSrc: string | string[], pieceSize: number, minimumChunkSize: number) {
    const dataListAllArray = typeof dataSrc == "string" ? [dataSrc] : dataSrc;
    const dataListAll = splitInNewLine(dataListAllArray);
    let inCodeBlock = 0;
    let flush = false;
    let flushBefore = false;
    return function* (): Generator<string> {
        const buf = [] as string[];
        for (const line of dataListAll) {
            if (line.startsWith("````")) {
                if (inCodeBlock == 0) {
                    inCodeBlock = 4;
                    flushBefore = true;
                } else if (inCodeBlock == 4) {
                    inCodeBlock = 0;
                    flush = true;
                }
            } else if (line.startsWith("```")) {
                if (inCodeBlock == 0) {
                    inCodeBlock = 3;
                    flushBefore = true;
                } else if (inCodeBlock == 3) {
                    inCodeBlock = 0;
                    flush = true;
                }
            }
            if (flushBefore) {
                if (buf.length > 0) {
                    yield* splitTextInSegment(buf.join(""), pieceSize, minimumChunkSize);
                    buf.length = 0;
                }
                flushBefore = false;
            }
            buf.push(line);
            if (flush) {
                if (buf.length > 0) {
                    yield* splitStringWithinLength(buf.join(""), pieceSize);
                    buf.length = 0;
                }
                flush = false;
            }
        }
        if (buf.length > 0) {
            if (inCodeBlock == 0) {
                yield* splitTextInSegment(buf.join(""), pieceSize, minimumChunkSize);
            } else {
                yield* splitStringWithinLength(buf.join(""), pieceSize);
            }
        }
    };
}
export function binaryTextSplit(data: string, pieceSize: number, minimumChunkSize: number) {
    return function* pieces(): Generator<string> {
        yield* splitStringWithinLength(data, pieceSize);
    };
}
// Split string into pieces within specific lengths (characters).
export function splitPiecesText(
    dataSrc: string | string[],
    pieceSize: number,
    plainSplit: boolean,
    minimumChunkSize: number,
    useSegmenter: boolean
) {
    if (!useSegmenter || !segmenter) {
        return splitPiecesTextV1(dataSrc, pieceSize, plainSplit, minimumChunkSize);
    }
    if (!plainSplit) {
        return binaryTextSplit(dataSrc as string, pieceSize, minimumChunkSize);
    }
    return splitPiecesTextV2(dataSrc, pieceSize, minimumChunkSize);
}

export function splitPiecesTextV1(
    dataSrc: string | string[],
    pieceSize: number,
    plainSplit: boolean,
    minimumChunkSize: number
) {
    const dataList = typeof dataSrc == "string" ? [dataSrc] : dataSrc;
    return function* pieces(): Generator<string> {
        for (const data of dataList) {
            if (plainSplit) {
                const leftData = data.split("\n"); //use memory
                const f = pickPiece(leftData, minimumChunkSize);
                for (const piece of f) {
                    let buffer = piece;
                    do {
                        // split to within maximum pieceSize
                        let ps = pieceSize;
                        if (buffer.charCodeAt(ps - 1) != buffer.codePointAt(ps - 1)) {
                            // If the char at the end of the chunk has been part of the surrogate pair, grow the piece size a bit.
                            ps++;
                        }
                        yield buffer.substring(0, ps);
                        buffer = buffer.substring(ps);
                    } while (buffer != "");
                }
            } else {
                let leftData = data;
                do {
                    const splitSize = pieceSize;
                    const piece = leftData.substring(0, splitSize);
                    leftData = leftData.substring(splitSize);
                    yield piece;
                } while (leftData != "");
            }
        }
    };
}

function* splitByDelimiterWithMinLength(
    sources: Generator<string, void, unknown>,
    delimiter: string,
    minimumChunkLength = 25,
    splitThreshold?: number
) {
    let buf = "";
    let last = false;
    const dl = delimiter.length;
    for (const source of sources) {
        const max = source.length;
        if (splitThreshold && max > splitThreshold) {
            yield buf + source;
            last = false;
            buf = "";
            continue;
        }
        let i = -1;
        let prev = 0;
        L1: do {
            i = source.indexOf(delimiter, prev);
            if (i == -1) break L1;
            buf += source.slice(prev, i) + delimiter;
            if (buf.length > minimumChunkLength) {
                yield buf;
                buf = "";
                last = false;
            } else {
                last = true;
            }
            prev = i + dl;
        } while (i < max);
        if (prev != i || (prev == -1 && i == -1)) {
            buf += source.slice(prev);
            last = true;
        }
    }
    if (last) {
        yield buf;
    }
}
function* chunkStringGenerator(source: string, maxLength: number) {
    const strLen = source.length;
    if (strLen > maxLength) {
        let from = 0;
        do {
            let end = from + maxLength;
            if (end > strLen) {
                yield source.substring(from);
                break;
            }
            while (source.charCodeAt(end - 1) != source.codePointAt(end - 1)) {
                // If the char at the end of the chunk has been part of the surrogate pair, grow the piece size a bit.
                end++;
            }
            yield source.substring(from, end);
            from = end;
        } while (from < strLen);
    } else {
        yield source;
    }
}

function* chunkStringGeneratorFromGenerator(sources: Generator<string, void, unknown>, maxLength: number) {
    for (const source of sources) {
        yield* chunkStringGenerator(source, maxLength);
    }
}

function* stringGenerator(sources: string[]) {
    for (const str of sources) {
        yield str;
    }
}
export async function collectGenAll(strGen: AsyncGenerator<string, any, unknown> | Generator<string>) {
    const ret = [] as string[];
    for await (const str of strGen) {
        ret.push(str);
    }
    return ret;
}
export async function concatGeneratedAll(strGen: AsyncGenerator<string, any, unknown> | Generator<string>) {
    return (await collectGenAll(strGen)).join("");
}

const MAX_ITEMS = 100;
export async function splitPieces2V2(
    dataSrc: Blob,
    pieceSize: number,
    plainSplit: boolean,
    minimumChunkSize: number,
    filename?: string,
    useSegmenter?: boolean
) {
    if (dataSrc.size == 0) {
        // eslint-disable-next-line require-yield
        return function* noItems(): Generator<string> {
            return;
        };
    }
    if (isTextBlob(dataSrc)) {
        const text = await dataSrc.text();
        // let pPieceSize = pieceSize;

        if (!plainSplit) {
            // const srcGen = stringGenerator([text]);
            const gen = chunkStringGenerator(text, pieceSize);
            return function* pieces(): Generator<string> {
                yield* gen;
            };
        }
        const textLen = text.length;
        let xMinimumChunkSize = minimumChunkSize;
        while (textLen / xMinimumChunkSize > MAX_ITEMS) {
            xMinimumChunkSize += minimumChunkSize;
        }
        const org = stringGenerator([text]);
        const gen1 = splitByDelimiterWithMinLength(org, "\n", xMinimumChunkSize);

        // const genHeading = splitByDelimiterWithMinLength(gen1, "\n#", minimumChunkSize);
        // const genCodeblock = splitByDelimiterWithMinLength(genHeading, "```", minimumChunkSize);
        // const srcGen = splitByDelimiterWithMinLength(genCodeblock, "\n", minimumChunkSize, minimumChunkSize * 25);
        const gen = chunkStringGeneratorFromGenerator(gen1, pieceSize);
        return function* pieces(): Generator<string> {
            yield* gen;
        };
    }
    let canBeSmall = false;
    let delimiter = 0; // Split null by default.
    if (filename && filename.endsWith(".pdf")) {
        delimiter = "/".charCodeAt(0);
    } else if (filename && filename.endsWith(".json")) {
        canBeSmall = true;
        delimiter = ",".charCodeAt(0);
    }

    // Optimise chunk size to efficient dedupe.
    const clampMin = canBeSmall ? 100 : 100000; //100kb
    const clampMax = 100000000; //100mb
    const clampedSize = Math.max(clampMin, Math.min(clampMax, dataSrc.size));
    let step = 1;
    let w = clampedSize;
    while (w > 10) {
        w /= 12.5;
        step++;
    }
    minimumChunkSize = Math.floor(10 ** (step - 1));

    return async function* piecesBlob(): AsyncGenerator<string> {
        const size = dataSrc.size;
        let i = 0;
        const buf = new Uint8Array(await dataSrc.arrayBuffer());
        do {
            // Find null (or / at PDF) or newLine, and make chunks.
            // To avoid making too much chunks, all chunks should be longer than minimumChunkSize.
            // However, we might have been capped the chunk size due to HTTP request size or document size on CouchDB.
            // The illustration is as follows. Each `[]` will yielded.
            // data         | ........ \0 ....\0 .... \0 ...\0 ...\0..
            // minimum   -- |{--------------}  |
            // pieceSize == |[============][..]|
            // minimum   -- |                  |{--------------}   |
            // pieceSize == |                  |[============][...]|
            const findStart = i + minimumChunkSize;
            const defaultSplitEnd = i + pieceSize;
            let splitEnd: number | undefined;
            let i1 = buf.indexOf(delimiter, findStart);
            if (i1 == -1) {
                i1 = buf.indexOf(charNewLine, findStart);
            }
            if (i1 == -1) {
                splitEnd = defaultSplitEnd;
            } else {
                splitEnd = i1 < defaultSplitEnd ? i1 : defaultSplitEnd;
            }
            yield await arrayBufferToBase64Single(buf.slice(i, splitEnd));
            i = splitEnd;
        } while (i < size);
    };
}

export async function splitPieces2(
    dataSrc: Blob,
    pieceSize: number,
    plainSplit: boolean,
    minimumChunkSize: number,
    filename?: string,
    useSegmenter?: boolean
) {
    if (isTextBlob(dataSrc)) {
        return splitPiecesText(await dataSrc.text(), pieceSize, plainSplit, minimumChunkSize, useSegmenter ?? false);
    }

    let delimiter = 0; // Split null by default.
    let canBeSmall = false;
    if (filename && filename.endsWith(".pdf")) {
        delimiter = "/".charCodeAt(0);
    } else if (filename && filename.endsWith(".json")) {
        canBeSmall = true;
        delimiter = ",".charCodeAt(0);
    }

    // Optimise chunk size to efficient dedupe.
    const clampMin = canBeSmall ? 100 : 100000; //100kb
    const clampMax = 100000000; //100mb
    const clampedSize = Math.max(clampMin, Math.min(clampMax, dataSrc.size));
    let step = 1;
    let w = clampedSize;
    while (w > 10) {
        w /= 12.5;
        step++;
    }
    minimumChunkSize = Math.floor(10 ** (step - 1));

    return async function* piecesBlob(): AsyncGenerator<string> {
        const size = dataSrc.size;
        let i = 0;
        do {
            let splitSize = pieceSize;
            const currentData = new Uint8Array(await dataSrc.slice(i, i + pieceSize).arrayBuffer());
            // Find null (or / at PDF) or newLine, and make chunks.
            // To avoid making too much chunks, all chunks should be longer than minimumChunkSize.
            // However, we might have been capped the chunk size due to HTTP request size or document size on CouchDB.
            // The illustration is as follows. Each `[]` will yielded.
            // data         | ........ \0 ....\0 .... \0 ...\0 ...\0..
            // minimum   -- |{--------------}  |
            // pieceSize == |[============][..]|
            // minimum   -- |                  |{--------------}   |
            // pieceSize == |                  |[============][...]|
            let nextIdx = currentData.indexOf(delimiter, minimumChunkSize);
            splitSize = nextIdx == -1 ? pieceSize : Math.min(pieceSize, nextIdx);
            if (nextIdx == -1) nextIdx = currentData.indexOf(charNewLine, minimumChunkSize);
            const piece = currentData.slice(0, splitSize);
            i += piece.length;
            const b64 = await arrayBufferToBase64Single(piece);
            yield b64;
        } while (i < size);
    };
}

export async function splitPiecesRabinKarp(
    dataSrc: Blob,
    absoluteMaxPieceSize: number,
    doPlainSplit: boolean,
    minimumChunkSize: number,
    _filename?: string,
    _useSegmenter?: boolean
) {
    const plainSplit = doPlainSplit || isTextBlob(dataSrc);
    // Minimum piece size is 128 bytes for text, 4KB for binary.
    const minPieceSize = plainSplit ? 128 : 1024 * 4;
    // For text, split into 20 pieces (5%) on average; for binary, split into 12 pieces on average.
    // 128 bytes or 5% of the file size, whichever is larger.
    // Therefore, for a 10KB text file, the average chunk size is 500B; for 1MB, 50KB; for 10MB, 500KB.
    // If the file is smaller than 128 bytes, the chunk size is 128 bytes. This means that for files smaller than 1KB, the chunk size is 128 bytes.
    const splitPieceCount = plainSplit ? 20 : 12;
    const avgChunkSize = Math.max(minPieceSize, Math.floor(dataSrc.size / splitPieceCount));
    const maxChunkSize = Math.min(absoluteMaxPieceSize, avgChunkSize * 5);
    const minChunkSize = Math.min(Math.max(Math.floor(avgChunkSize / 4), minimumChunkSize), maxChunkSize);
    const windowSize = 48;

    // Rabin-Karp chunking illustration:

    // 1. The data is processed in a rolling hash manner, where each byte contributes to the hash.
    // Yielding candidate is keep glowing until the hash matches the boundary pattern.
    // Data:        |---------------------------------------------------------------|
    // Buffer:      |---------------...===>|
    // Hash window: |           |<---48--->|

    // 2. The hash computed over the sliding window of 48 bytes got a modulus === 1, indicating a potential chunk boundary.
    // Data:        |---------------------------------------------------------------|
    // Buffer:      |{----  CANDIDATE ----}|
    // Hash window: |           |<---48--->|  ==> hashModulus % 1 == 0

    // 3. But, if the current chunk size is shorter than the minimum chunk size, we continue to grow the candidate.
    //              |<=========MINIMUM=========>|========MAXIMUM=======>|           |
    // Data:        |---------------------------------------------------------------|
    // Buffer:      |{----  CANDIDATE ----}|
    // Hash window: |           |<---48--->|  ==> hashModulus % 1 == 0

    // 4. If the current chunk size is longer than the minimum chunk size, we want to yield the buffer. However, we must check.
    //              |<=========MINIMUM=========>|========MAXIMUM=======>|           |
    // Data:        |---------------------------------------------------------------|
    // Buffer:      |{----  CANDIDATE -------------}|
    // Hash window: |                    |<---48--->| ==> hashModulus % 1 == 0

    // Check the last byte of the hash window to ensure it does not split in the middle of a surrogate pair (for text).
    // (if `*` is the surrogate pair, progress the position to the next byte and extends the candidate), and find the next candidate.
    //              |<=========MINIMUM=========>|========MAXIMUM=======>|           |
    // Data:        |---------------------------------------------------------------|
    // Buffer:      |{----  CANDIDATE ------------*-}|

    // 5. Yield the candidate as a chunk, and reset the buffer, and continue processing the data.

    // Probability of the hash modulus matching the boundary pattern is inversely proportional to the average chunk size. This is a notable very property so I very impressed.
    // (This means that, when aiming for 100 bytes, there is a 1 in 100 chance of matching the boundary pattern).
    const hashModulus = avgChunkSize;
    const boundaryPattern = 1;

    const PRIME = 31;
    let P_pow_w = 1;
    for (let i = 0; i < windowSize - 1; i++) {
        P_pow_w = Math.imul(P_pow_w, PRIME);
    }

    const buffer = new Uint8Array(await dataSrc.arrayBuffer());
    let pos = 0;

    let hash = 0;
    let start = 0;
    const isText = isTextBlob(dataSrc);

    const length = buffer.length;
    return async function* piecesBlob() {
        while (pos < length) {
            // Process the internal buffer byte by byte.
            const byte = buffer[pos];

            // Update the rolling hash.
            if (pos >= start + windowSize) {
                const oldByte = buffer[pos - windowSize];
                const oldByteTerm = Math.imul(oldByte, P_pow_w);
                hash = (hash - oldByteTerm) | 0;
                hash = Math.imul(hash, PRIME);
                hash = (hash + byte) | 0;
            } else {
                hash = Math.imul(hash, PRIME);
                hash = (hash + byte) | 0;
            }

            const currentChunkSize = pos - start + 1;
            let isBoundaryCandidate = false;

            // Boundary judgement.
            if (currentChunkSize >= minChunkSize) {
                if ((hash >>> 0) % hashModulus === boundaryPattern) {
                    isBoundaryCandidate = true;
                }
            }
            if (currentChunkSize >= maxChunkSize) {
                isBoundaryCandidate = true;
            }

            // Extract the chunk.
            if (isBoundaryCandidate) {
                let isSafeBoundary = true;
                // For text, ensure we do not split in the middle of a multi-byte character.
                if (isText) {
                    if (pos + 1 < length && (buffer[pos + 1] & 0xc0) === 0x80) {
                        isSafeBoundary = false;
                    }
                }
                if (isSafeBoundary) {
                    if (isText) {
                        yield Promise.resolve(readString(buffer.subarray(start, pos + 1)));
                    } else {
                        yield await arrayBufferToBase64Single(buffer.subarray(start, pos + 1));
                    }
                    start = pos + 1;
                }
            }
            pos++;
        }
        // After the stream ends, yield the remaining data in the buffer as the last chunk.
        if (start < length) {
            if (isText) {
                yield Promise.resolve(readString(buffer.subarray(start, length)));
            } else {
                yield await arrayBufferToBase64Single(buffer.subarray(start, length));
            }
        }
    };
}
