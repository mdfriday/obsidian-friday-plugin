/// <reference lib="webworker" />
// Worker specific functions

import type { END_OF_DATA } from "./universalTypes.ts";
export function postBack(key: number, seq: number, data: string | END_OF_DATA) {
    self.postMessage({ key, seq, result: data });
}
