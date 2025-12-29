/**
# Rosetta stone
- To localise messages to your language, please write a translation to this file and submit a PR.
- Please order languages in alphabetic order, if you write multiple items.

## Notice to ensure that your favours are not wasted.

If you plan to utilise machine translation engines to contribute translated resources,
please ensure the engine's terms of service are compatible with our project's license.
Your diligence in this matter helps maintain compliance and avoid potential licensing issues.
Thank you for your consideration.

Usually, our projects (Obsidian LiveSync and its families) are licensed under MIT License.
To see details, please refer to the LICENSES file on each repository.

## How to internationalise untranslated items?
1. Change the message literal to use `$msg`
   "Could not parse YAML" -> $msg('anyKey')
2. Create `ls-debug` folder under the `.obsidian` folder of your vault.
3. Run Self-hosted LiveSync in dev mode (npm run dev).
4. You will get the `missing-translation-YYYY-MM-DD.jsonl` under `ls-debug`. Please copy and paste inside `allMessages` and write the translations.
5. Send me the PR!
*/

const LANG_DE = "de";
const LANG_ES = "es";
const LANG_JA = "ja";
const LANG_RU = "ru";
const LANG_ZH = "zh";
const LANG_KO = "ko";
const LANG_ZH_TW = "zh-tw";
const LANG_DEF = "def"; // Default language: English

// Also please order in alphabetic order except for the default language.

export const SUPPORTED_I18N_LANGS = [LANG_DEF, LANG_DE, LANG_ES, LANG_JA, LANG_KO, LANG_RU, LANG_ZH, LANG_ZH_TW];

// Also this.
export type I18N_LANGS =
    | typeof LANG_DEF // Default language: English
    | typeof LANG_DE
    | typeof LANG_ES
    | typeof LANG_JA
    | typeof LANG_KO
    | typeof LANG_RU
    | typeof LANG_ZH
    | typeof LANG_ZH_TW
    | "";

type MESSAGE = { [key in I18N_LANGS]?: string };

import { Logger } from "./logger.ts";
// deno-lint-ignore no-sloppy-imports
import { _allMessages, type MessageKeys } from "./messages/combinedMessages.dev"; // This sloppy-imports are used to replace the messages with the combined messages.
const expandedMessage = {
    ...expandKeywords(_allMessages, "def"),
    ...expandKeywords(_allMessages, "es"),
    ...expandKeywords(_allMessages, "ja"),
    ...expandKeywords(_allMessages, "ko"),
    ...expandKeywords(_allMessages, "ru"),
    ...expandKeywords(_allMessages, "zh"),
    ...expandKeywords(_allMessages, "zh-tw"),
};

function expandKeywords<T extends Record<string, U>, U extends Record<string, string>>(
    message: T,
    lang: I18N_LANGS,
    recurseLimit = 10
): T {
    if (recurseLimit <= 0) {
        Logger(
            `ExpandKeywords hit the recursion limit, returning the current state. but this is not expected. May recursive referenced.`
        );
        return message;
    }
    // const DEFAULT_ENGLISH = "en-GB"; //This is to balance the books with existing messages.
    // const langCode = (lang == "def" || lang == "") ? DEFAULT_ENGLISH : lang;

    // Generate keywords from all messages
    // This can handles the case where the message itself contains a keyword:
    // - task:`Some procedure`
    // - check: `%{task} checking`
    // - checkfailed: `%{check} failed`
    // If in this case `checkfailed` may `Some procedure checking failed`.
    // And, it can compress the rosetta stone: the message table.
    const keywords = Object.entries(message)
        .map(([key, value]) => [key, value[lang]])
        // Use all messages as keywords, but traditional keyword prefix should be trimmed.
        .map(([key, value]) => [`${key.startsWith("K.") ? key.substring("K.".length) : key}`, value])
        .map(
            ([key, value]) =>
                [
                    [`%{${key}}`, value],
                    // [`%{${key}.upper}`, [value[0].toLocaleUpperCase(langCode) + value.substring(1)]],
                    // [`%{${key}.lower}`, [value[0].toLocaleLowerCase(langCode) + value.substring(1)]],
                ] as [key: string, value: string][]
        )
        .flat()
        .sort((a, b) => (a[1]?.length ?? 0) - (b[1]?.length ?? 0));

    const ret = {
        ...message,
    } as Record<string, Record<string, string>>;
    let isChanged = false;
    for (const key of Object.keys(message)) {
        if (!(lang in ret[key])) continue;
        for (const [keyword, replacement] of keywords) {
            if (ret[key][lang].includes(keyword)) {
                ret[key][lang] = ret[key][lang].split(keyword).join(replacement);
                isChanged = true;
            }
        }
    }
    if (isChanged) return expandKeywords(ret, lang, recurseLimit--) as T;

    return ret as T;
}

export const allMessages = expandedMessage as { [key: string]: MESSAGE };
export type AllMessageKeys = MessageKeys;
