export type PlatformType = "obsidian" | "browser" | "server" | "common";

export const EVENT_PLATFORM_UNLOADED = "platform-unloaded";

declare global {
    interface LSEvents {
        [EVENT_PLATFORM_UNLOADED]: undefined;
    }
}

export type IInitOptions<T extends object = object> = {} & T;

export abstract class APIBase<T extends object> {
    /**
     * @description Whether the API is ready to be used
     * @default false
     * Warning: this is exposed for the performance. Do not change it directly. Or you should know what you are doing.
     */
    _isReady: boolean = false;
    /**
     * @description Whether the API is disposed
     * @default false
     * Warning: this is exposed for the performance. Do not change it directly. Or you should know what you are doing.
     */
    _isDisposed: boolean = false;

    get isReady() {
        return this._isReady;
    }

    get isDisposed() {
        return this._isDisposed;
    }

    _options: IInitOptions<T> | undefined;

    async applyOptions(options: Partial<IInitOptions<T>>) {
        if (this.isDisposed) {
            throw new Error("Cannot apply options to a disposed API");
        }
        if (this.isReady) {
            await this.__teardownCurrentOptions?.();
        }

        await this.onApplyOptions?.(options);
        if (!this._options) {
            this._options = options as IInitOptions<T>;
        } else {
            this._options = { ...this._options, ...options } as IInitOptions<T>;
        }
        await this.onOptionsApplied?.();
        await this.onReady?.();
    }

    async init(options: IInitOptions<T>) {
        await this.applyOptions(options);
        await this.onInit?.();
        return this;
    }

    async __teardownCurrentOptions?() {
        await this.onDisposeCurrentOptions?.();
        await this.tearDownCurrentOptions?.();
        // await this.onOptionsReinitialized?.();
    }

    /**
     * Implement this method to dispose the current options i.e., the current state of the API, resources, etc.
     */
    tearDownCurrentOptions?(): Promise<void>;

    // abstract onOptionsReinitialized?(): Promise<void>;
    /**
     * Apply the options to the API instance.
     * @param options
     */
    onApplyOptions?(options: Partial<IInitOptions<T>>): Promise<void>;

    /**
     * Called after the options are applied
     */
    onOptionsApplied?(): Promise<void>;

    /**
     * Called before the current options are disposed
     */
    onDisposeCurrentOptions?(): Promise<void>;

    reload(options: Partial<IInitOptions<T>>) {
        return this.applyOptions(options);
    }
    async dispose() {
        await this.onDisposeCurrentOptions?.();
        await this.onDisposed?.();
    }

    onInit?(): Promise<void> | void;
    onReady?(): Promise<void> | void;
    onDisposed?(): Promise<void> | void;
}
