// Wrapping classes

import { Logger } from "../common/logger.ts";
import { LOG_LEVEL_NOTICE } from "../common/types.ts";

export class WrappedNotice {
    constructor(message: string | DocumentFragment, timeout?: number) {
        let strMessage = "";
        if (message instanceof DocumentFragment) {
            strMessage = message.textContent ?? "";
        } else {
            strMessage = message;
        }
        Logger(strMessage, LOG_LEVEL_NOTICE);
    }

    setMessage(message: string | DocumentFragment): this {
        let strMessage = "";
        if (message instanceof DocumentFragment) {
            strMessage = message.textContent ?? "";
        } else {
            strMessage = message;
        }
        Logger(strMessage, LOG_LEVEL_NOTICE);
        return this;
    }

    hide(): void {}
}
let _notice = WrappedNotice;

export function setNoticeClass(notice: typeof WrappedNotice) {
    _notice = notice;
}
export function NewNotice(message: string | DocumentFragment, timeout?: number) {
    return new _notice(message, timeout);
}
