import type { AllMessageKeys, I18N_LANGS } from "./rosetta";
import { allMessages } from "./rosetta";
import type { TaggedType } from "./types";
export let currentLang: I18N_LANGS = "";
const missingTranslations = [] as string[];

export function __getMissingTranslations() {
    return missingTranslations;
}

let __onMissingTranslations = (key: string) => console.warn(key);
export function __onMissingTranslation(callback: (key: string) => void) {
    __onMissingTranslations = callback;
}

const msgCache = new Map<string, string>();

export function setLang(lang: I18N_LANGS) {
    if (lang === currentLang) return;
    currentLang = lang;
    msgCache.clear();
}

function _getMessage(key: string, lang: I18N_LANGS) {
    if (key.trim() == "") return key;

    const msgs = allMessages[key] ?? undefined;

    if (lang == "") {
        lang = "def";
    }
    let msg = msgs?.[lang];

    if (!msg) {
        if (!missingTranslations.contains(key)) {
            __onMissingTranslations(key);
            missingTranslations.push(key);
        }
        msg = msgs?.def;
    }
    return msg ?? key;
}

function getMessage(key: string) {
    if (msgCache.has(key)) return msgCache.get(key) as string;
    const msg = _getMessage(key, currentLang);
    msgCache.set(key, msg);
    return msg;
}

/**
 * Translate message to each locale
 * @param message {string} Message to translate
 * @param lang {I18N_LANGS} (Optional) Language. If supplied, this result cannot be cached. Do not use this in tight loop.
 * @returns Translated message
 */
export function $t(message: string, lang?: I18N_LANGS) {
    if (lang !== undefined) {
        return _getMessage(message, lang);
    }
    return getMessage(message);
}

/**
 * TagFunction to Automatically translate.
 * @param strings
 * @param values
 * @returns
 */
export function $f(strings: TemplateStringsArray, ...values: string[]) {
    let result = "";
    for (let i = 0; i < values.length; i++) {
        result += getMessage(strings[i]) + values[i];
    }
    result += getMessage(strings[strings.length - 1]);
    return result;
}

/**
 * Translate message to each locale and replace placeholders.
 * @param key {string} Message identifier.
 * @param params {Record<string, string>} Parameters to replace placeholders.
 * @param lang {I18N_LANGS} (Optional) Language.
 * @returns Translated and formatted message.
 */
export function $msg<T extends AllMessageKeys>(
    key: T,
    params: Record<string, string> = {},
    lang?: I18N_LANGS
): TaggedType<string, T> {
    let msg = $t(key, lang);
    for (const [placeholder, value] of Object.entries(params)) {
        const regex = new RegExp(`\\\${${placeholder}}`, "g");
        msg = msg.replace(regex, value);
    }
    return msg as TaggedType<string, T>;
}
