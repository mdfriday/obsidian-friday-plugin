import { getContext, setContext, type Component } from "svelte";

export type HasSetResult<T = any> = {
    setResult: (result: T) => void;
};
export type HasGetInitialData<T = any> = {
    getInitialData?: () => T | undefined;
};
export type ComponentHasResult<T = any, U = any> = Component<HasSetResult<T> & HasGetInitialData<U>>;
export type GuestDialogProps<T = any, U = any> = HasSetResult<T> & HasGetInitialData<U>;
export type DialogSvelteComponentBaseProps = {
    // component: Component;
    setTitle: (title: string) => void;
    closeDialog: () => void;
} & HasSetResult &
    HasGetInitialData;

export type DialogControlBase<T = any, U = any> = {
    setTitle: (title: string) => void;
    closeDialog: () => void;
} & HasSetResult<T> &
    HasGetInitialData<U>;

export const CONTEXT_DIALOG_CONTROLS = "svelte-dialog-controls";
export function setupDialogContext<T extends DialogControlBase>(controls: T) {
    setContext(CONTEXT_DIALOG_CONTROLS, controls);
}
export function getDialogContext<T = any>(): DialogControlBase<T> {
    return getContext<DialogControlBase<T>>(CONTEXT_DIALOG_CONTROLS);
}

export interface SvelteDialogManagerBase {
    open<T, U>(component: ComponentHasResult<T, U>, initialData?: U): Promise<T | undefined>;
    openWithExplicitCancel<T, U>(component: ComponentHasResult<T, U>, initialData?: U): Promise<T>;
}
