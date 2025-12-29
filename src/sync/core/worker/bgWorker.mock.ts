// A mock for bgWorker (For environments where Worker cannot be used).
import { decrypt, encrypt } from "octagonal-wheels/encryption/index.js";
import { encrypt as encryptHKDF, decrypt as decryptHKDF } from "octagonal-wheels/encryption/hkdf";

import { splitPieces2, splitPieces2V2, splitPiecesRabinKarp } from "../string_and_binary/chunks.ts";

export type SplitArguments = {
    key: number;
    type: "split";
    dataSrc: Blob;
    pieceSize: number;
    plainSplit: boolean;
    minimumChunkSize: number;
    filename?: string;
    useV2: boolean;
    useSegmenter: boolean;
};

export type EncryptArguments = {
    key: number;
    type: "encrypt" | "decrypt";
    input: string;
    passphrase: string;
    autoCalculateIterations: boolean;
};

export type EncryptHKDFArguments = {
    key: number;
    type: "encryptHKDF" | "decryptHKDF";
    input: string;
    passphrase: string;
    pbkdf2Salt: Uint8Array;
};

export function terminateWorker() {
    return;
}

export function splitPieces2Worker(
    dataSrc: Blob,
    pieceSize: number,
    plainSplit: boolean,
    minimumChunkSize: number,
    filename?: string,
    useSegmenter?: boolean
) {
    return splitPieces2(dataSrc, pieceSize, plainSplit, minimumChunkSize, filename, useSegmenter ?? false);
}
export function splitPieces2WorkerV2(
    dataSrc: Blob,
    pieceSize: number,
    plainSplit: boolean,
    minimumChunkSize: number,
    filename?: string,
    useSegmenter?: boolean
) {
    return splitPieces2V2(dataSrc, pieceSize, plainSplit, minimumChunkSize, filename, useSegmenter ?? false);
}
export function splitPieces2WorkerRabinKarp(
    dataSrc: Blob,
    pieceSize: number,
    plainSplit: boolean,
    minimumChunkSize: number,
    filename?: string,
    useSegmenter?: boolean
) {
    return splitPiecesRabinKarp(dataSrc, pieceSize, plainSplit, minimumChunkSize, filename, useSegmenter ?? false);
}

export function encryptWorker(input: string, passphrase: string, autoCalculateIterations: boolean): Promise<string> {
    return encrypt(input, passphrase, autoCalculateIterations);
}

export function decryptWorker(input: string, passphrase: string, autoCalculateIterations: boolean) {
    return decrypt(input, passphrase, autoCalculateIterations);
}

export function encryptHKDFWorker(
    input: string,
    passphrase: string,
    pbkdf2Salt: Uint8Array<ArrayBuffer>
): Promise<string> {
    return encryptHKDF(input, passphrase, pbkdf2Salt);
}

export function decryptHKDFWorker(
    input: string,
    passphrase: string,
    pbkdf2Salt: Uint8Array<ArrayBuffer>
): Promise<string> {
    return decryptHKDF(input, passphrase, pbkdf2Salt);
}
