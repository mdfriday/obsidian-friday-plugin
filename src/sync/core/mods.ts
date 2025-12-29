let webcrypto: Crypto;
export async function getWebCrypto() {
    if (webcrypto) {
        return webcrypto;
    }
    if (globalThis.crypto) {
        webcrypto = globalThis.crypto;
        return webcrypto;
    } else {
        const module = await import("crypto");
        webcrypto = module.webcrypto as Crypto;
        return webcrypto;
    }
}
