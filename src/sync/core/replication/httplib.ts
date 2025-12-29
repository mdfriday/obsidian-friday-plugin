import type {
    CouchDBCredentials,
    JWTCredentials,
    JWTHeader,
    JWTParams,
    JWTPayload,
    PreparedJWT,
    RemoteDBSettings,
} from "../common/types";
import { arrayBufferToBase64Single, writeString } from "../string_and_binary/convert";
import { Computed } from "octagonal-wheels/dataobject/Computed";

/**
 * Generates a credential object based on the provided settings.
 * @param settings - RemoteDBSettings
 * @returns {CouchDBCredentials} credentials object
 */
export function generateCredentialObject(settings: RemoteDBSettings) {
    if (settings.useJWT) {
        return {
            jwtAlgorithm: settings.jwtAlgorithm,
            jwtKey: settings.jwtKey,
            jwtKid: settings.jwtKid,
            jwtSub: settings.jwtSub,
            jwtExpDuration: settings.jwtExpDuration,
            type: "jwt",
        } satisfies JWTCredentials;
    } else {
        return {
            username: settings.couchDB_USER,
            password: settings.couchDB_PASSWORD,
            type: "basic",
        } satisfies CouchDBCredentials;
    }
    throw new Error("Invalid credentials");
}
/**
 * Generates a basic authentication header for CouchDB credentials using the provided username and password.
 * And it caches the result for performance if the credentials are not changed.
 */
export class BasicHeaderGenerator {
    _header = new Computed({
        evaluation: (source: CouchDBCredentials) => {
            if ("username" in source) {
                const userNameAndPassword =
                    source.username && source.password ? `${source.username}:${source.password}` : "";
                return `Basic ${btoa(userNameAndPassword)}`;
            }
            return "";
        },
    });

    /**
     * Generates a basic authentication header for CouchDB credentials using the provided username and password.
     * @param auth - CouchDBCredentials
     * @returns {Promise<string>} The basic authentication header (without "Basic" prefix).
     */
    async getBasicHeader(auth: CouchDBCredentials): Promise<string> {
        return (await this._header.update(auth)).value;
    }
}
/**
 * Generates a JWT token based on the provided credentials and parameters.
 * And it caches the result for performance if the credentials are not changed.
 */
export class JWTTokenGenerator {
    _importKey(auth: JWTCredentials) {
        if (auth.jwtAlgorithm == "HS256" || auth.jwtAlgorithm == "HS512") {
            const key = (auth.jwtKey || "").trim();
            if (key == "") {
                throw new Error("JWT key is empty");
            }
            const binaryDerString = window.atob(key);
            const binaryDer = new Uint8Array(binaryDerString.length);
            for (let i = 0; i < binaryDerString.length; i++) {
                binaryDer[i] = binaryDerString.charCodeAt(i);
            }
            const hashName = auth.jwtAlgorithm == "HS256" ? "SHA-256" : "SHA-512";
            return crypto.subtle.importKey("raw", binaryDer, { name: "HMAC", hash: { name: hashName } }, true, [
                "sign",
            ]);
        } else if (auth.jwtAlgorithm == "ES256" || auth.jwtAlgorithm == "ES512") {
            const pem = auth.jwtKey
                .replace(/-----BEGIN [^-]+-----/, "")
                .replace(/-----END [^-]+-----/, "")
                .replace(/\s+/g, "");
            // const pem = key.replace(/\s/g, "");
            const binaryDerString = window.atob(pem);
            const binaryDer = new Uint8Array(binaryDerString.length);
            for (let i = 0; i < binaryDerString.length; i++) {
                binaryDer[i] = binaryDerString.charCodeAt(i);
            }
            // const binaryDer = base64ToArrayBuffer(pem);
            const namedCurve = auth.jwtAlgorithm == "ES256" ? "P-256" : "P-521";
            const param = { name: "ECDSA", namedCurve };
            return crypto.subtle.importKey("pkcs8", binaryDer, param, true, ["sign"]);
        } else {
            throw new Error("Supplied JWT algorithm is not supported.");
        }
    }
    _currentCryptoKey = new Computed({
        evaluation: async (auth: JWTCredentials) => {
            return await this._importKey(auth);
        },
    });

    _jwt = new Computed({
        evaluation: async (params: JWTParams) => {
            const encodedHeader = btoa(JSON.stringify(params.header));
            const encodedPayload = btoa(JSON.stringify(params.payload));
            const buff = `${encodedHeader}.${encodedPayload}`.replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");

            const key = (await this._currentCryptoKey.update(params.credentials)).value;
            let token = "";
            if (params.header.alg == "ES256" || params.header.alg == "ES512") {
                const digestAlg = params.header.alg == "ES256" ? "SHA-256" : "SHA-512";
                const jwt = await crypto.subtle.sign(
                    { name: "ECDSA", hash: { name: digestAlg } },
                    key,
                    writeString(buff)
                );
                token = (await arrayBufferToBase64Single(jwt))
                    .replace(/\+/g, "-")
                    .replace(/\//g, "_")
                    .replace(/=/g, "");
            } else if (params.header.alg == "HS256" || params.header.alg == "HS512") {
                const jwt = await crypto.subtle.sign(
                    { name: "HMAC", hash: { name: params.header.alg } },
                    key,
                    writeString(buff)
                );
                token = (await arrayBufferToBase64Single(jwt))
                    .replace(/\+/g, "-")
                    .replace(/\//g, "_")
                    .replace(/=/g, "");
            } else {
                throw new Error("JWT algorithm is not supported.");
            }
            return {
                ...params,
                token: `${buff}.${token}`,
            } as PreparedJWT;
        },
    });

    _jwtParams = new Computed({
        evaluation(source: JWTCredentials) {
            const kid = source.jwtKid || undefined;
            const sub = (source.jwtSub || "").trim();
            if (sub == "") {
                throw new Error("JWT sub is empty");
            }
            const algorithm = source.jwtAlgorithm || "";
            if (!algorithm) {
                throw new Error("JWT algorithm is not configured.");
            }
            if (algorithm != "HS256" && algorithm != "HS512" && algorithm != "ES256" && algorithm != "ES512") {
                throw new Error("JWT algorithm is not supported.");
            }
            const header: JWTHeader = {
                alg: source.jwtAlgorithm || "HS256",
                typ: "JWT",
                kid,
            };
            const iat = ~~(new Date().getTime() / 1000);
            const exp = iat + (source.jwtExpDuration || 5) * 60; // 5 minutes
            const payload = {
                exp,
                iat,
                sub: source.jwtSub || "",
                "_couchdb.roles": ["_admin"],
            } satisfies JWTPayload;
            return {
                header,
                payload,
                credentials: source,
            };
        },
        requiresUpdate(args, previousArgs, previous) {
            // if previous is not present.
            if (!previous || previous instanceof Error) {
                return true;
            }
            // Check if the expiration time is near.
            // This means that if the token is valid for 100 seconds, we consider it expired 10 seconds before actual expiration.
            const ttl = previous.payload.exp - previous.payload.iat;
            const margin20p = ttl * 0.1; // 10% margin of ttl
            const margin = Math.min(10, Math.max(margin20p, 60)); // max 10 seconds, min 60 seconds
            const d = ~~(new Date().getTime() / 1000) + margin; // current time + margin
            if (previous.payload.exp < d) {
                // console.warn(`jwt expired ${previous.payload.exp} < ${d}`);
                return true;
            }
            return false;
        },
    });

    async getJWT(auth: JWTCredentials): Promise<PreparedJWT> {
        const params = (await this._jwtParams.update(auth)).value;
        const jwt = (await this._jwt.update(params)).value;
        return jwt;
    }

    /**
     * Generates a JWT token based on the provided credentials and parameters.
     * @param auth - JWTCredentials
     * @returns {Promise<string>} The JWT token (with "Bearer" prefix).
     */
    async getBearerToken(auth: JWTCredentials): Promise<string> {
        const jwt = await this.getJWT(auth);
        return `Bearer ${jwt.token}`;
    }
}
export class AuthorizationHeaderGenerator {
    _basicHeader = new BasicHeaderGenerator();
    _jwtHeader = new JWTTokenGenerator();
    async getAuthorizationHeader(auth: CouchDBCredentials): Promise<string> {
        if ("username" in auth) {
            return await this._basicHeader.getBasicHeader(auth);
        } else if ("jwtAlgorithm" in auth) {
            return await this._jwtHeader.getBearerToken(auth);
        }
        return "";
    }
}
