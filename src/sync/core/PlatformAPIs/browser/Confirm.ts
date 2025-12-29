import type { Confirm } from "../../interfaces/Confirm";
import { setConfirmInstance } from "../Confirm";

export { setConfirmInstance, getConfirmInstance } from "../Confirm";

import MessageBox from "./ui/MessageBox.svelte";
import TextInputBox from "./ui/TextInputBox.svelte";

import { mount } from "svelte";
import { promiseWithResolver } from "octagonal-wheels/promises";

function displayMessageBox<T, U extends string[]>(
    message: string,
    buttons: U,
    title: string,
    commit: (ret: U[number]) => T
): Promise<T> {
    const el = document.createElement("div");
    const p = promiseWithResolver<T>();
    mount(MessageBox, {
        target: el,
        props: {
            message,
            buttons: buttons as string[],
            title: title,
            commit: (action: U[number]) => {
                const ret = commit(action);
                p.resolve(ret);
            },
        },
    });
    document.body.appendChild(el);
    void p.promise.finally(() => {
        el.remove();
    });
    return p.promise;
}
function promptForInput(
    title: string,
    key: string,
    placeholder: string,
    isPassword?: boolean
): Promise<string | false> {
    const el = document.createElement("div");
    const p = promiseWithResolver<string | false>();
    mount(TextInputBox, {
        target: el,
        props: {
            title,
            message: key,
            placeholder,
            isPassword,
            commit: (text: string | false) => {
                p.resolve(text);
            },
        },
    });
    document.body.appendChild(el);
    void p.promise.finally(() => {
        el.remove();
    });
    return p.promise;
}
class BrowserConfirm implements Confirm {
    askYesNo(message: string): Promise<"yes" | "no"> {
        return displayMessageBox(message, ["Yes", "No"] as const, "Confirm", (action) =>
            action == "Yes" ? "yes" : "no"
        );
    }
    askString(title: string, key: string, placeholder: string, isPassword?: boolean): Promise<string | false> {
        return promptForInput(title, key, placeholder, isPassword);
    }
    askYesNoDialog(
        message: string,
        opt: { title?: string; defaultOption?: "Yes" | "No"; timeout?: number }
    ): Promise<"yes" | "no"> {
        return displayMessageBox(message, ["Yes", "No"] as const, opt.title ?? "Confirm", (action) =>
            action == "Yes" ? "yes" : "no"
        );
    }
    askSelectString(message: string, items: string[]): Promise<string> {
        return displayMessageBox(message, [...items] as const, "Confirm", (action) => action);
    }
    askSelectStringDialogue<T extends readonly string[]>(
        message: string,
        buttons: T,
        opt: { title?: string; defaultAction: T[number]; timeout?: number }
    ): Promise<T[number] | false> {
        return displayMessageBox(message, [...buttons] as const, opt.title ?? "Confirm", (action) => action);
    }
    askInPopup(key: string, dialogText: string, anchorCallback: (anchor: HTMLAnchorElement) => void): void {
        throw new Error("Method not implemented.");
    }
    confirmWithMessage(
        title: string,
        contentMd: string,
        buttons: string[],
        defaultAction: (typeof buttons)[number],
        timeout?: number
    ): Promise<(typeof buttons)[number] | false> {
        return displayMessageBox(contentMd, [...buttons] as const, title ?? "Confirm", (action) => action);
    }
}

const __confirm = new BrowserConfirm();
setConfirmInstance(__confirm);
