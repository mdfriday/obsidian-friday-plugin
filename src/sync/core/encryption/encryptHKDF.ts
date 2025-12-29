import { encryptHKDFWorker, decryptHKDFWorker } from "../worker/bgWorker";

export const encryptHKDF = encryptHKDFWorker;
export const decryptHKDF = decryptHKDFWorker;
