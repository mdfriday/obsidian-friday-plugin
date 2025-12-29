/// <reference lib="webworker" />
// Background part of Worker-offloaded content-splitting function

import { splitPiecesRabinKarp, splitPieces2V2, splitPieces2 } from "../string_and_binary/chunks.ts";
import { postBack } from "./bg.common.ts";
import { END_OF_DATA } from "./universalTypes.ts";
import type { SplitArguments } from "./universalTypes.ts";

/**
 * Creates a function to post messages back to the main thread.
 * @param key The key associated with the message.
 * @returns A function that posts messages back to the main thread.
 */
function getMainThreadPostBack(key: number) {
    const _key = key;
    let seq = 0;
    return function (data: string | END_OF_DATA) {
        if (data === END_OF_DATA) {
            if (seq === 0) {
                postBack(_key, seq++, "");
            }
            postBack(_key, seq++, END_OF_DATA);
        } else {
            postBack(_key, seq++, data);
        }
    };
}

/**
 * Processes the splitting of data into chunks.
 * @param data The data to be split.
 */
export async function processSplit(data: SplitArguments) {
    const key = data.key;
    const dataSrc = data.dataSrc;
    const pieceSize = data.pieceSize;
    const plainSplit = data.plainSplit;
    const minimumChunkSize = data.minimumChunkSize;
    const filename = data.filename;
    const useSegmenter = data.useSegmenter;

    const func = data.splitVersion == 3 ? splitPiecesRabinKarp : data.splitVersion == 2 ? splitPieces2V2 : splitPieces2;
    const gen = await func(dataSrc, pieceSize, plainSplit, minimumChunkSize, filename, useSegmenter);
    const postBack = getMainThreadPostBack(key);
    for await (const v of gen()) {
        postBack(v);
    }
    postBack(END_OF_DATA);
}
