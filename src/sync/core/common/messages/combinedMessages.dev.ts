import { PartialMessages as def } from "./def.ts";
import { PartialMessages as es } from "./es.ts";
import { PartialMessages as ja } from "./ja.ts";
import { PartialMessages as ko } from "./ko.ts";
import { PartialMessages as ru } from "./ru.ts";
import { PartialMessages as zh } from "./zh.ts";
import { PartialMessages as zhTw } from "./zh-tw.ts";

type MessageKeys = keyof typeof def.def;

const messages = {
    ...def,
    ...es,
    ...ja,
    ...ko,
    ...ru,
    ...zh,
    ...zhTw,
};
const w = Object.entries(messages)
    .map(([lang, messageDefs]) =>
        Object.entries(messageDefs).map(([key, value]) => [key, [lang, value] as [string, string]] as const)
    )
    .flat();

const _allMessages = w.reduce(
    (acc, [key, value]) => {
        if (!acc[key]) acc[key] = {};
        acc[key][value[0]] = value[1];
        return acc;
    },
    {} as Record<string, Record<string, string>>
) as Record<MessageKeys, { [key: string]: string }>;

export { _allMessages, type MessageKeys };
