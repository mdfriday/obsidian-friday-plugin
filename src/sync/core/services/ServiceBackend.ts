import { Logger, LOG_LEVEL_VERBOSE } from "octagonal-wheels/common/logger";
// import { Broadcaster, Pipeline, Survey, Switch } from "octagonal-wheels/channel/channels";
// import { DirectTransport } from "octagonal-wheels/channel/transport";

class ChannelBase {
    protected readonly handlers: Array<(...args: any[]) => Promise<any> | any> = [];
    protected readonly handlerNames: Map<(...args: any[]) => Promise<any> | any, string> = new Map();
    protected isAlreadyRegistered(handler: (...args: any[]) => Promise<any> | any) {
        const result = this.handlers.indexOf(handler);
        if (result === -1) {
            return false;
        }
        console.error("Handler already registered at index", result);
        return true;
    }
    protected getHandlerName(handler: (...args: any[]) => Promise<any> | any): string | undefined {
        return this.handlerNames.get(handler);
    }
    register(handler: (...args: any[]) => Promise<any> | any, name: string): void {
        if (this.isAlreadyRegistered(handler)) {
            Logger("Handler already registered for " + this.name, LOG_LEVEL_VERBOSE);
            return;
        }
        this.handlers.push(handler);
        this.handlerNames.set(handler, name);
    }
    protected isSomeHandlerRegistered() {
        const result = this.handlers.length > 0;
        if (!result) {
            console.warn("No handler registered");
        }
        return result;
    }
    constructor(protected readonly name: string) {}
}
/**
 * A pipeline where each handler is invoked in sequence. If any handler returns false, the pipeline stops and returns false.
 * If all handlers succeed (return true or undefined), the pipeline returns true.
 * If no handler is registered, it always returns true.
 */
class Pipeline<T extends any[]> extends ChannelBase {
    constructor(name: string) {
        super(name);
    }
    override register(handler: (...args: T) => Promise<boolean>, name: string): void {
        super.register(handler, name);
    }

    async invoke(...args: T): Promise<boolean> {
        if (!this.isSomeHandlerRegistered()) {
            Logger("No handler registered for Pipeline " + this.name, LOG_LEVEL_VERBOSE);
            return true;
        }
        for (const handler of this.handlers) {
            const name = this.getHandlerName(handler);
            try {
                // Logger(`Invoking handler ${name ?? "unknown"} for Pipeline ${this.name}`, LOG_LEVEL_VERBOSE);
                const result = await handler(...args);
                if (result === false) {
                    Logger(`Handler ${name ?? "unknown"} for Pipeline ${this.name} returned false`, LOG_LEVEL_VERBOSE);
                    const err = new Error();
                    console.error(err.stack);
                    return false;
                }
            } catch (e) {
                Logger(`Handler ${name ?? "unknown"} Error in Pipeline handler for ${this.name}`);
                Logger(e, LOG_LEVEL_VERBOSE);
                return false;
            }
        }
        return true;
    }
}

/**
 * A switch where each handler is invoked in sequence until one returns a non-false value, which is then returned.
 * If all handlers return false, the switch returns undefined.
 * If no handler is registered, an undefined value is returned.
 */
class Switch<T extends any[], U> extends ChannelBase {
    constructor(name: string) {
        super(name);
    }
    override register(handler: (...args: T) => Promise<U | false> | U | false, name: string): void {
        super.register(handler, name);
    }
    async invoke(...args: T): Promise<U | false | undefined> {
        if (!this.isSomeHandlerRegistered()) {
            Logger("No handler registered for Switch " + this.name, LOG_LEVEL_VERBOSE);
            return undefined;
        }
        for (const handler of this.handlers) {
            try {
                const result = await handler(...args);
                if (result !== false) {
                    return result;
                }
            } catch (e) {
                Logger("Error in Switch handler for " + this.name);
                Logger(e, LOG_LEVEL_VERBOSE);
            }
        }
        return undefined;
    }
}
const AN_ERROR_OCCURRED = Symbol("AN_ERROR_OCCURRED");
/**
 * A survey where all handlers are invoked and their results collected.
 * If any handler throws an error, it is caught and logged, and undefined is returned for that handler.
 * If no handler is registered, an empty array is returned.
 */
class Survey<T extends any[], U> extends ChannelBase {
    constructor(name: string) {
        super(name);
    }
    override register(handler: (...args: T) => Promise<U> | U, name: string): void {
        super.register(handler, name);
    }
    invoke(...args: T): Array<Promise<U>> {
        if (!this.isSomeHandlerRegistered()) {
            return [];
        }
        return this.handlers
            .map(async (handler) => {
                try {
                    return await handler(...args);
                } catch (e) {
                    Logger("Error in Survey handler for " + this.name);
                    Logger(e, LOG_LEVEL_VERBOSE);
                    return AN_ERROR_OCCURRED as unknown as U;
                }
            })
            .filter((result) => result !== (AN_ERROR_OCCURRED as unknown as Promise<U>));
    }
}
/**
 * A broadcaster where all handlers are invoked in parallel.
 * If any handler throws an error, it is caught and logged, but does not affect the invocation of other handlers.
 * If no handler is registered, nothing happens.
 */
class Broadcaster<T extends any[]> extends ChannelBase {
    constructor(name: string) {
        super(name);
    }
    override register(handler: (...args: T) => Promise<any> | any, name: string): void {
        super.register(handler, name);
    }
    async invoke(...args: T): Promise<void> {
        if (!this.isSomeHandlerRegistered()) {
            return;
        }
        await Promise.all(
            this.handlers.map(async (handler) => {
                try {
                    await handler(...args);
                } catch (e) {
                    Logger("Error in Broadcaster handler for " + this.name);
                    Logger(e, LOG_LEVEL_VERBOSE);
                }
            })
        );
    }
}

/**
 * ServiceBackend provides a flexible event handling system using pipelines, switches, surveys, and broadcasters.
 * It allows registering multiple handlers for various events and invoking them in different ways.
 */
export class ServiceBackend {
    private pipelines = new Map<string, Pipeline<any>>();
    private switches = new Map<string, Switch<any, any>>();
    private surveys = new Map<string, Survey<any, any>>();
    private broadcasters = new Map<string, Broadcaster<any[]>>();

    private getPipeline<T extends any[]>(name: string) {
        if (this.pipelines.has(name)) {
            return this.pipelines.get(name) as Pipeline<T>;
        }
        const pipeline = new Pipeline<T>(name);
        this.pipelines.set(name, pipeline);
        return pipeline;
    }

    private getSwitch<T extends any[], U>(name: string) {
        if (this.switches.has(name)) {
            return this.switches.get(name) as Switch<T, U>;
        }
        const switchChannel = new Switch<T, U>(name);
        this.switches.set(name, switchChannel);
        return switchChannel;
    }

    private getSurvey<T extends any[], U>(name: string) {
        if (this.surveys.has(name)) {
            return this.surveys.get(name) as Survey<T, U>;
        }
        const survey = new Survey<T, U>(name);
        this.surveys.set(name, survey);
        return survey;
    }
    private getBroadcaster<T extends any[]>(name: string) {
        if (this.broadcasters.has(name)) {
            return this.broadcasters.get(name) as Broadcaster<T>;
        }
        const broadcaster = new Broadcaster<T>(name);
        this.broadcasters.set(name, broadcaster);
        return broadcaster;
    }

    all<T extends any[]>(name: string) {
        const pipeline = this.getPipeline<T>(name);

        return [
            (...args: T) => pipeline.invoke(...args),
            (func: (...args: T) => Promise<any> | any) => pipeline.register(func, `${name} for ${func.name}`),
        ] as const;
    }

    first<T extends any[], U>(name: string) {
        const switchChannel = this.getSwitch<T, U>(name);
        return [
            (...args: T) => switchChannel.invoke(...args) as Promise<Awaited<U> | false>,
            (func: (...args: T) => Promise<Awaited<U> | false>) =>
                switchChannel.register(func, `${name} for ${func.name}`),
        ] as const;
    }

    firstOrUndefined<T extends any[], U>(name: string) {
        const switchChannel = this.getSwitch<T, U>(name);
        const invoke = async (...args: T): Promise<Awaited<U> | undefined> => {
            const result = await switchChannel.invoke(...args);
            if (!result) {
                return undefined;
            }
            return result;
        };
        const registerFunc = (handler: (...args: T) => Promise<Awaited<U> | false>) => {
            const wrapped = async (...args: T) => {
                try {
                    const result = await handler(...args);
                    if (result !== undefined && result !== false) {
                        return result;
                    }
                } catch (e) {
                    Logger("Error in firstOrUndefined handler for " + name);
                    Logger(e, LOG_LEVEL_VERBOSE);
                }
                return false;
            };
            switchChannel.register(wrapped, `${name} for ${handler.name}`);
        };
        return [invoke, registerFunc] as const;
    }

    firstFailure<T extends any[]>(name: string) {
        const survey = this.getSurvey<T, boolean>(name);
        const invoke = async (...args: T) => {
            const resultTasks = survey.invoke(...args);
            try {
                const results = await Promise.all(resultTasks);
                const someFailed = results.some((r) => r === false);
                if (someFailed) {
                    // console.warn("everySucceeds", name, "results", results, "someFailed", someFailed);
                    // debugger;
                }
                return !someFailed;
            } catch (e: any) {
                Logger("Error in firstFailure handler for survey " + name);
                Logger(e, LOG_LEVEL_VERBOSE);
                return false;
            }
        };
        const registerFunc = (handler: (...args: T) => Promise<boolean> | boolean) => {
            const wrapped = async (...args: T) => {
                try {
                    const result = await handler(...args);
                    if (result !== undefined && !result) {
                        return false;
                    }
                } catch (e) {
                    Logger("Error in firstFailure handler for survey " + name);
                    Logger(e, LOG_LEVEL_VERBOSE);
                    // Exception is considered as not a failure, this only handles explicit false.
                }
                return true;
            };
            survey.register(wrapped, `${name} for ${handler.name}`);
        };
        return [invoke, registerFunc] as const;
    }
    broadcast<T extends any[]>(name: string) {
        const broadcaster = this.getBroadcaster<T>(name);
        return [
            (...args: T) => broadcaster.invoke(...args),
            (func: (...args: T) => Promise<any> | any) => broadcaster.register(func, `${name} for ${func.name}`),
        ] as const;
    }

    collect<T extends any[], U>(name: string) {
        const survey = this.getSurvey<T, U>(name);
        return [
            (...args: T) => survey.invoke(...args),
            (func: (...args: T) => U) => survey.register(func, `${name} for ${func.name}`),
        ] as const;
    }
    collectBatch<T extends any[], U>(name: string) {
        const survey = this.getSurvey<T, U>(name);
        return [
            (...args: T) => {
                const tasks = survey.invoke(...args);
                return Promise.all(tasks);
            },
            (func: (...args: T) => U) => survey.register(func, `${name} for ${func.name}`),
        ] as const;
    }
}
