import type { FetchHttpHandler } from "@smithy/fetch-http-handler";
import { type LOG_LEVEL } from "octagonal-wheels/common/logger";
import type {
    AUTO_MERGED,
    CouchDBCredentials,
    diff_result,
    DocumentID,
    EntryDoc,
    EntryHasPath,
    FileEventItem,
    FilePath,
    FilePathWithPrefix,
    LoadedEntry,
    MetaEntry,
    MISSING_OR_ERROR,
    ObsidianLiveSyncSettings,
    RemoteDBSettings,
    TweakValues,
    UXFileInfoStub,
} from "../common/types";
// TODO: Migrate to octagonal-wheels
import type { ServiceBackend } from "./ServiceBackend.ts";
import type { LiveSyncLocalDB } from "../pouchdb/LiveSyncLocalDB";
import type { LiveSyncAbstractReplicator } from "../replication/LiveSyncAbstractReplicator";
import type { SimpleStore } from "octagonal-wheels/databases/SimpleStoreBase";
import type { SvelteDialogManagerBase } from "../UI/svelteDialog.ts";
import type { ServiceHub } from "./ServiceHub.ts";

declare global {
    interface OPTIONAL_SYNC_FEATURES {
        DISABLE: "DISABLE";
    }
}
type HandlerFunc<F extends (...args: any[]) => any> = (handler: (...args: Parameters<F>) => ReturnType<F>) => void;
type HandlerFuncWithoutUndefined<F extends (...args: any[]) => any> = (
    handler: (...args: Parameters<F>) => Promise<Exclude<Awaited<ReturnType<F>>, undefined>>
) => void;
export abstract class HubService {
    // TODO: Possibly we need weak reference here.
    protected _services!: ServiceHub;
    get services() {
        return this._services;
    }
    setServices(services: ServiceHub) {
        this._services = services;
    }
}
export abstract class ServiceBase extends HubService {
    protected readonly _backend: ServiceBackend;

    /**
     * Register a handler that returns all results from the listeners.
     * Means ex-`all`
     * @param key The event key to listen to.
     */
    protected _all<U extends (...args: any[]) => any>(key: string) {
        return this._backend.all<Parameters<U>>(key);
    }

    /**
     * Register a handler that returns the first success (true) from the listeners.
     * Means ex-`any`
     * @param key The event key to listen to.
     * @returns
     */
    protected _first<T extends (...args: any[]) => any, U = ReturnType<T>>(key: string) {
        return this._backend.first<Parameters<T>, Awaited<U>>(key);
    }

    /**
     * Register a handler that returns the first success (true) from the listeners.
     * Means ex-`any` of some sort.
     * @param key The event key to listen to.
     * @returns
     */
    protected _firstOrUndefined<T extends (...args: any[]) => any, U = ReturnType<T>>(key: string) {
        return this._backend.firstOrUndefined<Parameters<T>, Awaited<U>>(key);
    }
    /**
     * Register a handler that returns the first failure (false) from the listeners.
     * Means ex-`every`
     * @param key The event key to listen to.
     * @returns
     */
    protected _firstFailure<T extends (...args: any[]) => any>(key: string) {
        return this._backend.firstFailure<Parameters<T>>(key);
    }

    /**
     *  Register a handler that broadcasts to all listeners without caring about the result.
     *  Means ex-`all` of some sort.
     * @param key The event key to listen to.
     * @returns
     */
    protected _broadcast<T extends (...args: any[]) => any>(key: string) {
        return this._backend.broadcast<Parameters<T>>(key);
    }

    /**
     * Register a collector that collects results from all listeners.
     * @param key The event key to listen to.
     * @returns A collector for the specified event key.
     */
    protected _collect<T extends (...args: any[]) => U, U = ReturnType<T>>(key: string) {
        return this._backend.collect<Parameters<T>, U>(key);
    }

    /**
     * Register a batch collector that collects results from all listeners in batches.
     * @param key The event key to listen to.
     * @returns A batch collector for the specified event key.
     */
    protected _collectBatch<T extends (...args: any[]) => U, U = ReturnType<T>>(key: string) {
        return this._backend.collectBatch<Parameters<T>, U>(key);
    }
    constructor(hub: ServiceBackend) {
        super();
        this._backend = hub;
    }
}
/**
 * The APIService provides methods for interacting with the plug-in's API,
 */
export abstract class APIService extends ServiceBase {
    /**
     * Get a custom fetch handler for making HTTP requests (e.g., S3 without CORS issues).
     */
    abstract getCustomFetchHandler(): FetchHttpHandler;

    /**
     * Add a log entry to the log (Now not used).
     * @param message The log message.
     * @param level The log level.
     * @param key The log key.
     */
    abstract addLog(message: any, level: LOG_LEVEL, key: string): void;

    /**
     * Check if the app is running on a mobile device.
     * @returns true if running on mobile, false otherwise.
     */
    abstract isMobile(): boolean;

    /**
     * Show a window (or in Obsidian, a leaf).
     * @param type The type of window to show.
     */
    abstract showWindow(type: string): Promise<void>;

    /**
     * returns App ID. In Obsidian, it is vault ID.
     */
    abstract getAppID(): string;

    /**
     * Check if the last POST request failed due to payload size.
     */
    abstract isLastPostFailedDueToPayloadSize(): boolean;
    abstract getPlatform(): string;
    abstract getAppVersion(): string;
    abstract getPluginVersion(): string;
}

/**
 * The PathService provides methods for converting between file paths and document IDs.
 * This class would be migrated to the new logic later.
 */
export abstract class PathService extends ServiceBase {
    /**
     * Convert a document ID or entry to a virtual file path.
     * @param id A document ID. Nowadays, it is mostly not the same as the file path.
     * If the document has `_` prefixed, saved as `/_`.
     * @param entry An entry object. If provided, it can be used to get the path directly.
     * @param stripPrefix Whether to strip the prefix from the path.
     */
    abstract id2path(id: DocumentID, entry?: EntryHasPath, stripPrefix?: boolean): FilePathWithPrefix;
    /**
     * Convert a virtual file path to a document ID (with prefix if any).
     * @param filename A file path with or without prefix.
     * @param prefix The prefix to use for the document ID.
     */
    abstract path2id(filename: FilePathWithPrefix | FilePath, prefix?: string): Promise<DocumentID>;
}

/**
 * The DatabaseService provides methods for managing the local database.
 * Please note that each event of database lifecycle is handled in DatabaseEventService.
 */
export abstract class DatabaseService extends ServiceBase {
    /**
     * Create a new PouchDB instance.
     * @param name Optional name for the database instance.
     * @param options Optional configuration options for the database.
     */
    abstract createPouchDBInstance<T extends object>(
        name?: string,
        options?: PouchDB.Configuration.DatabaseConfiguration
    ): PouchDB.Database<T>;

    /**
     * Open a simple store for storing key-value pairs.
     * @param kind The kind of simple store to open.
     */
    abstract openSimpleStore<T>(kind: string): SimpleStore<T>;

    /**
     * Open the local database.
     */
    abstract openDatabase(): Promise<boolean>;
    /**
     * Discard the local database.
     * Please note that this *DOES* delete the database contents perfectly.
     */
    abstract resetDatabase(): Promise<boolean>;
    /**
     * Check if the local database is ready.
     */
    abstract isDatabaseReady(): boolean;
}

/**
 * The DatabaseEventService provides methods for handling database lifecycle events.
 */
export abstract class DatabaseEventService extends ServiceBase {
    constructor(hub: ServiceBackend) {
        super(hub);
        [this.onUnloadDatabase, this.handleOnUnloadDatabase] = this._all<typeof this.onUnloadDatabase>("dbUnload");
        [this.onCloseDatabase, this.handleOnCloseDatabase] = this._all<typeof this.onCloseDatabase>("dbClose");
        [this.onDatabaseInitialisation, this.handleOnDatabaseInitialisation] =
            this._firstFailure<typeof this.onDatabaseInitialisation>("databaseInitialisation");
        [this.onDatabaseInitialised, this.handleDatabaseInitialised] =
            this._firstFailure<typeof this.onDatabaseInitialised>("databaseInitialised");
        [this.onResetDatabase, this.handleOnResetDatabase] =
            this._firstFailure<typeof this.onResetDatabase>("resetDatabase");
    }

    /**
     * Event triggered when the database is about to be unloaded.
     */
    readonly onUnloadDatabase: (db: LiveSyncLocalDB) => Promise<boolean>;
    /**
     * Handler to register for the onUnloadDatabase event.
     */
    readonly handleOnUnloadDatabase: HandlerFunc<typeof this.onUnloadDatabase>;

    /**
     * Event triggered when the database is about to be closed.
     */
    readonly onCloseDatabase: (db: LiveSyncLocalDB) => Promise<boolean>;

    /**
     * Handler to register for the onCloseDatabase event.
     */
    readonly handleOnCloseDatabase: HandlerFunc<typeof this.onCloseDatabase>;

    /**
     * Event triggered when the database is being initialized.
     */
    readonly onDatabaseInitialisation: (db: LiveSyncLocalDB) => Promise<boolean>;
    /**
     * Handler to register for the onDatabaseInitialisation event.
     */
    readonly handleOnDatabaseInitialisation: HandlerFunc<typeof this.onDatabaseInitialisation>;

    /**
     * Event triggered when the database has been initialized.
     */
    readonly onDatabaseInitialised: (showNotice: boolean) => Promise<boolean>;
    /**
     * Handler to register for the onDatabaseInitialised event.
     */
    readonly handleDatabaseInitialised: HandlerFunc<typeof this.onDatabaseInitialised>;

    /**
     * Event triggered when the database is being reset.
     */
    readonly onResetDatabase: (db: LiveSyncLocalDB) => Promise<boolean>;

    /**
     * Handler to register for the onResetDatabase event.
     */
    readonly handleOnResetDatabase: HandlerFunc<typeof this.onResetDatabase>;

    /**
     * Initialize the database.
     * @param showingNotice Whether to show a notice to the user.
     * @param reopenDatabase Whether to reopen the database if it is already open.
     * @param ignoreSuspending Whether to ignore any suspending state.
     */
    abstract initialiseDatabase(
        showingNotice?: boolean,
        reopenDatabase?: boolean,
        ignoreSuspending?: boolean
    ): Promise<boolean>;
}

/**
 * File processing service handles file events and processes them accordingly.
 */
export class FileProcessingService extends ServiceBase {
    constructor(hub: ServiceBackend) {
        super(hub);
        [this.processFileEvent, this.handleProcessFileEvent] =
            this._first<typeof this.processFileEvent>("processFileEvent");
        [this.processOptionalFileEvent, this.handleOptionalFileEvent] =
            this._first<typeof this.processOptionalFileEvent>("processOptionalFileEvent");
        [this.commitPendingFileEvents, this.handleCommitPendingFileEvents] =
            this._firstFailure<typeof this.commitPendingFileEvents>("commitPendingFileEvents");
    }

    /**
     * Process a file event item by the registered handlers.
     */
    readonly processFileEvent: (item: FileEventItem) => Promise<boolean>;
    /**
     * Handler to register for the processFileEvent event.
     */
    readonly handleProcessFileEvent: HandlerFunc<typeof this.processFileEvent>;

    /**
     * Process a file event item optionally, if any handler is registered.
     * i.e., hidden files synchronisation or customisation sync.
     */
    readonly processOptionalFileEvent: (path: FilePath) => Promise<boolean>;

    /**
     * Handler to register for the processOptionalFileEvent event.
     */
    readonly handleOptionalFileEvent: HandlerFunc<typeof this.processOptionalFileEvent>;

    /**
     * Commit any pending file events that have been queued for processing.
     */
    readonly commitPendingFileEvents: () => Promise<boolean>;
    /**
     * Handler to register for the commitPendingFileEvents event.
     */
    readonly handleCommitPendingFileEvents: HandlerFunc<typeof this.commitPendingFileEvents>;
}

/**
 * The ReplicatorService provides methods for managing replication.
 */
export abstract class ReplicatorService extends ServiceBase {
    constructor(hub: ServiceBackend) {
        super(hub);
        [this.getNewReplicator, this.handleGetNewReplicator] =
            this._firstOrUndefined<typeof this.getNewReplicator>("getNewReplicator");
        [this.onCloseActiveReplication, this.handleOnCloseActiveReplication] =
            this._first<typeof this.onCloseActiveReplication>("closeActiveReplication");
    }
    /**
     * Close the active replication if any.
     * Not used currently.
     */
    readonly onCloseActiveReplication: () => Promise<boolean>;
    /**
     * Handler to register for the onCloseActiveReplication event.
     * Not used currently.
     */
    readonly handleOnCloseActiveReplication: HandlerFunc<typeof this.onCloseActiveReplication>;

    /**
     * Get a new replicator instance based on the provided settings.
     */
    readonly getNewReplicator: (
        settingOverride?: Partial<ObsidianLiveSyncSettings>
    ) => Promise<LiveSyncAbstractReplicator | undefined | false>;
    /**
     * Handler to register for the getNewReplicator event, active replicator should produce an instance.
     */
    readonly handleGetNewReplicator: HandlerFuncWithoutUndefined<typeof this.getNewReplicator>;

    /**
     * Get the currently active replicator instance.
     * If no active replicator, return undefined but that is the fatal situation (on Obsidian).
     */
    abstract getActiveReplicator(): LiveSyncAbstractReplicator | undefined;
}

/**
 * The ReplicationService provides methods for managing replication processes.
 */
export abstract class ReplicationService extends ServiceBase {
    constructor(hub: ServiceBackend) {
        super(hub);
        [this.processOptionalSynchroniseResult, this.handleProcessOptionalSynchroniseResult] = this._first<
            typeof this.processOptionalSynchroniseResult
        >("processOptionalSynchroniseResult");
        [this.processSynchroniseResult, this.handleProcessSynchroniseResult] =
            this._first<typeof this.processSynchroniseResult>("processSynchroniseResult");
        [this.processVirtualDocument, this.handleProcessVirtualDocuments] =
            this._first<typeof this.processVirtualDocument>("processVirtualDocuments");
        [this.onBeforeReplicate, this.handleBeforeReplicate] =
            this._firstFailure<typeof this.onBeforeReplicate>("beforeReplicate");
        [this.checkConnectionFailure, this.handleCheckConnectionFailure] =
            this._first<typeof this.checkConnectionFailure>("connectionHasFailure");
    }

    /**
     * Process a synchronisation result document.
     */
    readonly processSynchroniseResult: (doc: MetaEntry) => Promise<boolean>;
    /**
     * Handler to register for the processSynchroniseResult event.
     */
    readonly handleProcessSynchroniseResult: HandlerFunc<typeof this.processSynchroniseResult>;

    /**
     * Process a synchronisation result document for optional entries i.e., hidden files.
     */
    readonly processOptionalSynchroniseResult: (doc: LoadedEntry) => Promise<boolean>;
    /**
     * Handler to register for the processOptionalSynchroniseResult event.
     */
    readonly handleProcessOptionalSynchroniseResult: HandlerFunc<typeof this.processOptionalSynchroniseResult>;

    /**
     * Process an array of synchronisation result documents.
     * @param docs An array of documents to parse and handle.
     */
    abstract parseSynchroniseResult(docs: Array<PouchDB.Core.ExistingDocument<EntryDoc>>): void;
    /**
     * Process a virtual document (e.g., for customisation sync).
     */
    readonly processVirtualDocument: (docs: PouchDB.Core.ExistingDocument<EntryDoc>) => Promise<boolean>;
    /**
     * Handler to register for the processVirtualDocument event.
     */
    readonly handleProcessVirtualDocuments: HandlerFunc<typeof this.processVirtualDocument>;

    /**
     * An event triggered before starting replication.
     */
    readonly onBeforeReplicate: (showMessage: boolean) => Promise<boolean>;
    /**
     * Handler to register for the onBeforeReplicate event.
     */
    readonly handleBeforeReplicate: HandlerFunc<typeof this.onBeforeReplicate>;
    /**
     *  Check if the replication is ready to start.
     * @param showMessage Whether to show messages to the user.
     */
    abstract isReplicationReady(showMessage: boolean): Promise<boolean>;

    /**
     * Start the replication process.
     * @param showMessage Whether to show messages to the user.
     */
    abstract replicate(showMessage?: boolean): Promise<boolean | void>;

    /**
     * Start the replication process triggered by an event (e.g., file change).
     * @param showMessage Whether to show messages to the user.
     */
    abstract replicateByEvent(showMessage?: boolean): Promise<boolean | void>;

    /**
     * Check if there is a connection failure with the remote database.
     */
    readonly checkConnectionFailure: () => Promise<boolean | "CHECKAGAIN" | undefined>;

    /**
     * Handler to register for the checkConnectionFailure event.
     */
    readonly handleCheckConnectionFailure: HandlerFunc<typeof this.checkConnectionFailure>;
}

/**
 * The RemoteService provides methods for interacting with the remote database.
 */
export abstract class RemoteService extends ServiceBase {
    constructor(hub: ServiceBackend) {
        super(hub);
    }

    /**
     * Connect to the remote database with the provided settings.
     * @param uri  The URI of the remote database.
     * @param auth  The authentication credentials for the remote database.
     * @param disableRequestURI  Whether to disable the request URI.
     * @param passphrase  The passphrase for the remote database.
     * @param useDynamicIterationCount  Whether to use dynamic iteration count.
     * @param performSetup  Whether to perform setup.
     * @param skipInfo  Whether to skip information retrieval.
     * @param compression  Whether to enable compression.
     * @param customHeaders  Custom headers to include in the request.
     * @param useRequestAPI  Whether to use the request API.
     * @param getPBKDF2Salt  Function to retrieve the PBKDF2 salt.
     * Note that this function is used for CouchDB and compatible only.
     */
    abstract connect(
        uri: string,
        auth: CouchDBCredentials,
        disableRequestURI: boolean,
        passphrase: string | false,
        useDynamicIterationCount: boolean,
        performSetup: boolean,
        skipInfo: boolean,
        compression: boolean,
        customHeaders: Record<string, string>,
        useRequestAPI: boolean,
        getPBKDF2Salt: () => Promise<Uint8Array<ArrayBuffer>>
    ): Promise<
        | string
        | {
              db: PouchDB.Database<EntryDoc>;
              info: PouchDB.Core.DatabaseInfo;
          }
    >;

    /**
     * Replicate all local database content to the remote database.
     * @param showingNotice Whether to show a notice to the user.
     * @param sendChunksInBulkDisabled Whether to disable sending chunks in bulk.
     */
    abstract replicateAllToRemote(showingNotice?: boolean, sendChunksInBulkDisabled?: boolean): Promise<boolean>;

    /**
     * Replicate all content from the remote database to the local database.
     * @param showingNotice Whether to show a notice to the user.
     */

    abstract replicateAllFromRemote(showingNotice?: boolean): Promise<boolean>;

    /**
     * Mark the database as locked.
     * @param lockByClean Whether the lock is due to a clean operation (e.g., reset).
     */
    abstract markLocked(lockByClean?: boolean): Promise<void>;

    /**
     * Mark the database as unlocked. Then other clients will be banned to connect until resolved.
     */
    abstract markUnlocked(): Promise<void>;

    /**
     * Mark the database as resolved. Then the client (current device) can be connected.
     */
    abstract markResolved(): Promise<void>;

    /**
     * Try to reset the remote database if possible.
     * Note that all error will be thrown to the caller.
     * @returns Promise<void>
     */
    abstract tryResetDatabase(): Promise<void>;
    /**
     * Try to create the remote database if it does not exist.
     * Note that all error will be thrown to the caller.
     * @returns Promise<void>
     *
     */
    abstract tryCreateDatabase(): Promise<void>;
}

/**
 * The ConflictService provides methods for handling file conflicts.
 */
export abstract class ConflictService extends ServiceBase {
    constructor(hub: ServiceBackend) {
        super(hub);
        [this.resolveByUserInteraction, this.handleResolveByUserInteraction] =
            this._first<typeof this.resolveByUserInteraction>("resolveByUserInteraction");
        [this.getOptionalConflictCheckMethod, this.handleGetOptionalConflictCheckMethod] = this._first<
            typeof this.getOptionalConflictCheckMethod
        >("getOptionalConflictCheckMethod");
    }

    /**
     * Get an optional conflict check method for a given file (virtual) path.
     */
    readonly getOptionalConflictCheckMethod: (path: FilePathWithPrefix) => Promise<boolean | undefined | "newer">;

    /**
     * Handler to register for the getOptionalConflictCheckMethod event.
     */
    readonly handleGetOptionalConflictCheckMethod: HandlerFunc<typeof this.getOptionalConflictCheckMethod>;

    /**
     * Queue a check for conflicts if the file is currently open in the editor.
     * @param path The file (virtual) path to check for conflicts.
     */
    abstract queueCheckForIfOpen(path: FilePathWithPrefix): Promise<void>;

    /**
     * Queue a check for conflicts for a given file (virtual) path.
     * @param path The file (virtual) path to check for conflicts.
     */
    abstract queueCheckFor(path: FilePathWithPrefix): Promise<void>;

    /**
     * Ensure all queued file conflict checks are processed.
     */
    abstract ensureAllProcessed(): Promise<boolean>;

    /**
     * Resolve a conflict by user interaction (e.g., showing a modal dialog).
     * @param filename The file (virtual) path with conflict.
     * @param conflictCheckResult The result of the conflict check.
     * @returns A promise that resolves to true if the conflict was resolved, false if not, or undefined if no action was taken.
     */
    readonly resolveByUserInteraction: (
        filename: FilePathWithPrefix,
        conflictCheckResult: diff_result
    ) => Promise<boolean | undefined>;

    /**
     * Handler to register for the resolveByUserInteraction event.
     */
    readonly handleResolveByUserInteraction: HandlerFunc<typeof this.resolveByUserInteraction>;

    /**
     * Resolve a conflict by deleting a specific revision.
     * @param path The file (virtual) path with conflict.
     * @param deleteRevision The revision to delete.
     * @param title The title of the conflict (for user display).
     */
    abstract resolveByDeletingRevision(
        path: FilePathWithPrefix,
        deleteRevision: string,
        title: string
    ): Promise<typeof MISSING_OR_ERROR | typeof AUTO_MERGED>;

    /**
     * Resolve a conflict as several possible strategies.
     * It may involve user interaction (means raising resolveByUserInteraction).
     * @param filename The file (virtual) path to resolve.
     */
    abstract resolve(filename: FilePathWithPrefix): Promise<void>;

    /**
     *  Resolve a conflict by choosing the newest version.
     * @param filename The file (virtual) path to resolve.
     */
    abstract resolveByNewest(filename: FilePathWithPrefix): Promise<boolean>;
}

/**
 * The AppLifecycleService provides methods for managing the plug-in's lifecycle events.
 */
export abstract class AppLifecycleService extends ServiceBase {
    constructor(hub: ServiceBackend) {
        super(hub);
        [this.onLayoutReady, this.handleLayoutReady] = this._firstFailure("layoutReady");
        [this.onFirstInitialise, this.handleFirstInitialise] = this._firstFailure("firstInitialise");
        [this.onReady, this.handleOnReady] = this._firstFailure("appReady");
        [this.onWireUpEvents, this.handleOnWireUpEvents] = this._firstFailure("wireUpEvents");
        [this.onLoad, this.handleOnLoad] = this._firstFailure("appLoad");
        [this.onAppUnload, this.handleOnAppUnload] = this._broadcast("appUnload");
        [this.onScanningStartupIssues, this.handleOnScanningStartupIssues] = this._all("scanStartupIssues");
        [this.onInitialise, this.handleOnInitialise] = this._firstFailure("appInitialise");
        [this.onLoaded, this.handleOnLoaded] = this._firstFailure("appLoaded");
        [this.onSettingLoaded, this.handleOnSettingLoaded] = this._firstFailure("applyStartupLoaded");
        [this.onBeforeUnload, this.handleOnBeforeUnload] = this._all("beforeUnload");
        [this.onUnload, this.handleOnUnload] = this._all("unload");
        [this.onSuspending, this.handleOnSuspending] = this._firstFailure("beforeSuspendProcess");
        [this.onResuming, this.handleOnResuming] = this._firstFailure("onResumeProcess");
        [this.onResumed, this.handleOnResumed] = this._firstFailure("afterResumeProcess");
        [this.getUnresolvedMessages, this.reportUnresolvedMessages] = this._collectBatch("unresolvedMessages");
    }

    /**
     * Event triggered when the plug-in's layout is ready.
     * In Obsidian, it is after the workspace is ready.
     */
    readonly onLayoutReady: () => Promise<boolean>;

    /**
     * Handler to register for the onLayoutReady event.
     */
    readonly handleLayoutReady: HandlerFunc<typeof this.onLayoutReady>;

    /**
     * Event triggered when the plug-in is being initialized for the first time.
     * This is only called once per plug-in lifecycle.
     */
    readonly onFirstInitialise: () => Promise<boolean>;

    /**
     * Handler to register for the onFirstInitialise event.
     */
    readonly handleFirstInitialise: HandlerFunc<typeof this.onFirstInitialise>;

    /**
     * Event triggered when the plug-in is fully ready.
     * This is called after all initialisation processes are complete.
     */
    readonly onReady: () => Promise<boolean>;
    /**
     * Handler to register for the onReady event.
     */
    readonly handleOnReady: HandlerFunc<typeof this.onReady>;

    /**
     * Event triggered to wire up necessary event listeners.
     * This is typically called during the initialisation phase.
     */
    readonly onWireUpEvents: () => Promise<boolean>;

    /**
     * Handler to register for the onWireUpEvents event.
     */
    readonly handleOnWireUpEvents: HandlerFunc<typeof this.onWireUpEvents>;

    /**
     * Event triggered when the plug-in is being initialised.
     */
    readonly onInitialise: () => Promise<boolean>;
    /**
     * Handler to register for the onInitialise event.
     */
    readonly handleOnInitialise: HandlerFunc<typeof this.onInitialise>;

    /**
     * Event triggered when the plug-in is loading.
     * This is typically called during the quite early initialisation phase, before everything.
     * In Obsidian, it is in the onload() method of the plugin.
     */
    readonly onLoad: () => Promise<boolean>;
    /**
     * Handler to register for the onLoad event.
     */
    readonly handleOnLoad: HandlerFunc<typeof this.onLoad>;

    /**
     * Event triggered when the plug-in's settings have been loaded and applied.
     */
    readonly onSettingLoaded: () => Promise<boolean>;
    /**
     * Handler to register for the onSettingLoaded event.
     */
    readonly handleOnSettingLoaded: HandlerFunc<typeof this.onSettingLoaded>;

    /**
     * Event triggered when the plug-in has fully loaded.
     * This is typically called after all initialisation and loading processes are complete.
     */
    readonly onLoaded: () => Promise<boolean>;
    /**
     * Handler to register for the onLoaded event.
     */
    readonly handleOnLoaded: HandlerFunc<typeof this.onLoaded>;

    /**
     * Scan for any startup issues that may affect the plug-in's operation.
     */
    readonly onScanningStartupIssues: () => Promise<boolean>;
    /**
     * Handler to register for the onScanningStartupIssues event.
     */
    readonly handleOnScanningStartupIssues: HandlerFunc<typeof this.onScanningStartupIssues>;

    /**
     * Event triggered when the plug-in is unloading (e.g., during app shutdown or plug-in disable).
     * This is typically called during the unload() method of the plugin.
     * Entry point to unload everything.
     */
    readonly onAppUnload: () => Promise<void>;
    /**
     * Handler to register for the onAppUnload event.
     */
    readonly handleOnAppUnload: HandlerFunc<typeof this.onAppUnload>;

    /**
     * Event triggered before the plug-in is unloaded.
     * This is typically used to perform any necessary cleanup or save state before the plug-in is unloaded.
     */
    readonly onBeforeUnload: () => Promise<boolean>;
    /**
     * Handler to register for the onBeforeUnload event.
     */
    readonly handleOnBeforeUnload: HandlerFunc<typeof this.onBeforeUnload>;

    /**
     * Event triggered when the plug-in is being unloaded.
     */
    readonly onUnload: () => Promise<boolean>;
    /**
     * Handler to register for the onUnload event.
     */
    readonly handleOnUnload: HandlerFunc<typeof this.onUnload>;

    /**
     * Perform an immediate restart of the application.
     * Note that this is not graceful, and not only the plug-in. APPLICATION (means Obsidian) will be restarted.
     */
    abstract performRestart(): void;

    /**
     * Ask the user for a restart.
     * @param message Optional message to display to the user when asking for a restart.
     */
    abstract askRestart(message?: string): void;

    /**
     * Schedule a restart of the application.
     * After the current operation is done, the application will be restarted.
     * Note that this is not graceful, and not only the plug-in. APPLICATION (means Obsidian) will be restarted.
     */
    abstract scheduleRestart(): void;

    /**
     * Event triggered when the application is being suspended (e.g., system sleep).
     */
    readonly onSuspending: () => Promise<boolean>;

    /**
     * Handler to register for the onSuspending event.
     */
    readonly handleOnSuspending: HandlerFunc<typeof this.onSuspending>;

    /**
     * Event triggered when the application is resuming from a suspended state.
     */
    readonly onResuming: () => Promise<boolean>;

    /**
     * Handler to register for the onResuming event.
     */
    readonly handleOnResuming: HandlerFunc<typeof this.onResuming>;

    /**
     * Event triggered after the application has resumed from a suspended state.
     */
    readonly onResumed: () => Promise<boolean>;

    /**
     * Handler to register for the onResumed event.
     */
    readonly handleOnResumed: HandlerFunc<typeof this.onResumed>;

    /**
     * Check if the plug-in is currently suspended.
     */
    abstract isSuspended(): boolean;

    /**
     * Set the suspension state of the plug-in.
     * @param suspend Set to true to suspend the plug-in, false to resume.
     */
    abstract setSuspended(suspend: boolean): void;

    /**
     * Check if the plug-in is ready.
     * A ready plug-in means it has been fully initialised and is operational.
     * If not ready, most operations will be blocked.
     */
    abstract isReady(): boolean;
    /**
     * Mark the plug-in as ready.
     */
    abstract markIsReady(): void;
    /**
     * Reset the ready state of the plug-in.
     */
    abstract resetIsReady(): void;
    /**
     * Check if the plug-in has been unloaded.
     */
    abstract hasUnloaded(): boolean;

    /**
     * Check if a restart has been scheduled.
     */
    abstract isReloadingScheduled(): boolean;

    /**
     * Get unresolved error messages.
     */
    readonly getUnresolvedMessages: () => Promise<string[][]>;
    /**
     * Report unresolved error messages.
     */
    readonly reportUnresolvedMessages: HandlerFunc<() => Promise<string[]>>;
}

export abstract class SettingService extends ServiceBase {
    constructor(hub: ServiceBackend) {
        super(hub);
        [this.onBeforeRealiseSetting, this.handleBeforeRealiseSetting] = this._firstFailure("beforeRealiseSetting");
        [this.onSettingRealised, this.handleSettingRealised] = this._firstFailure("afterRealiseSetting");
        [this.onRealiseSetting, this.handleOnRealiseSetting] = this._firstFailure("realiseSetting");
        [this.suspendAllSync, this.handleSuspendAllSync] = this._all("suspendAllSync");
        [this.suspendExtraSync, this.handleSuspendExtraSync] = this._all("suspendExtraSync");
        [this.suggestOptionalFeatures, this.handleSuggestOptionalFeatures] =
            this._all<typeof this.suggestOptionalFeatures>("suggestOptionalFeatures");
        [this.enableOptionalFeature, this.handleEnableOptionalFeature] =
            this._all<typeof this.enableOptionalFeature>("enableOptionalFeature");
    }
    /**
     * Clear any used passphrase from memory.
     */
    abstract clearUsedPassphrase(): void;

    /**
     * Apply the current settings to the system.
     * This may involve re-initialising connections, updating configurations, etc.
     */
    abstract realiseSetting(): Promise<void>;

    /**
     * Decrypt the given settings.
     * @param settings The settings to decrypt.
     */
    abstract decryptSettings(settings: ObsidianLiveSyncSettings): Promise<ObsidianLiveSyncSettings>;

    /**
     * Adjust the given settings, e.g., migrate old settings to new format.
     * @param settings The settings to adjust.
     */
    abstract adjustSettings(settings: ObsidianLiveSyncSettings): Promise<ObsidianLiveSyncSettings>;

    /**
     * Load settings from storage and apply them.
     */
    abstract loadSettings(): Promise<void>;

    /**
     * Get the unique name for identify the device.
     */
    abstract getDeviceAndVaultName(): string;

    /**
     * Set the unique name for identify the device.
     * @param name The unique name to set.
     */
    abstract setDeviceAndVaultName(name: string): void;
    /**
     * Save the current device and vault name to settings, aside from the main settings.
     */
    abstract saveDeviceAndVaultName(): void;

    /**
     * Save the current settings to storage.
     */
    abstract saveSettingData(): Promise<void>;

    /**
     * Event triggered before realising the settings.
     * Handlers can return false to abort the realisation process.
     */
    readonly onBeforeRealiseSetting: () => Promise<boolean>;

    /**
     * Handler to register for the onBeforeRealiseSetting event.
     */
    readonly handleBeforeRealiseSetting: HandlerFunc<typeof this.onBeforeRealiseSetting>;

    /**
     * Event triggered after the settings have been realised.
     */
    readonly onSettingRealised: () => Promise<boolean>;

    /**
     * Handler to register for the onSettingRealised event.
     */
    readonly handleSettingRealised: HandlerFunc<typeof this.onSettingRealised>;

    /**
     * Event triggered to realise the settings.
     */
    readonly onRealiseSetting: () => Promise<boolean>;

    /**
     * Handler to register for the onRealiseSetting event.
     */
    readonly handleOnRealiseSetting: HandlerFunc<typeof this.onRealiseSetting>;

    /**
     * Suspend all synchronisation activities and save to the settings.
     */
    readonly suspendAllSync: () => Promise<boolean>;

    /**
     * Handler to register for the suspendAllSync event.
     */
    readonly handleSuspendAllSync: HandlerFunc<typeof this.suspendAllSync>;

    /**
     * Suspend extra synchronisation activities, e.g., hidden files sync.
     */
    readonly suspendExtraSync: () => Promise<boolean>;
    /**
     * Handler to register for the suspendExtraSync event and save to the settings.
     */
    readonly handleSuspendExtraSync: HandlerFunc<typeof this.suspendExtraSync>;

    /**
     * Suggest enabling optional features to the user.
     */
    readonly suggestOptionalFeatures: (opt: { enableFetch?: boolean; enableOverwrite?: boolean }) => Promise<boolean>;

    /**
     * Handler to register for the suggestOptionalFeatures event.
     * Each optional feature should suggest itself.
     */
    readonly handleSuggestOptionalFeatures: HandlerFunc<typeof this.suggestOptionalFeatures>;
    /**
     * Enable an optional feature and save to the settings.
     * It may also raised from `handleSuggestOptionalFeatures` if the user agrees.
     * @param mode The optional feature to enable.
     */
    readonly enableOptionalFeature: (mode: keyof OPTIONAL_SYNC_FEATURES) => Promise<boolean>;

    /**
     * Handler to register for the enableOptionalFeature event.
     */
    readonly handleEnableOptionalFeature: HandlerFunc<typeof this.enableOptionalFeature>;

    /**
     * Get the current settings.
     */
    abstract currentSettings(): ObsidianLiveSyncSettings;

    /**
     * Check if the file system should be treated case-insensitively.
     * This is important for certain operating systems like Windows and macOS.
     */
    abstract shouldCheckCaseInsensitively(): boolean;

    abstract importSettings(imported: Partial<ObsidianLiveSyncSettings>): Promise<boolean>;
}

/**
 * The TweakValueService provides methods for managing tweak values and resolving mismatches.
 */
export abstract class TweakValueService extends ServiceBase {
    /**
     * Fetch and trial the remote database settings to determine if they are preferred.
     * @param trialSetting The remote database settings to connect.
     */
    abstract fetchRemotePreferred(trialSetting: RemoteDBSettings): Promise<TweakValues | false>;

    /**
     * Check and ask the user to resolve any mismatched tweak values.
     * @param preferred The preferred tweak values to check against.
     */
    abstract checkAndAskResolvingMismatched(preferred: Partial<TweakValues>): Promise<[TweakValues | boolean, boolean]>;

    /**
     * Ask the user to resolve any mismatched tweak values.
     * @param preferredSource The preferred tweak values to resolve against.
     */
    abstract askResolvingMismatched(preferredSource: TweakValues): Promise<"OK" | "CHECKAGAIN" | "IGNORE">;

    /**
     * Check and ask the user to use the remote configuration.
     * @param settings The remote database settings to connect.
     */
    abstract checkAndAskUseRemoteConfiguration(
        settings: RemoteDBSettings
    ): Promise<{ result: false | TweakValues; requireFetch: boolean }>;

    /**
     * Ask the user to use the remote configuration.
     * @param trialSetting The remote database settings to connect.
     * @param preferred The preferred tweak values to use.
     */
    abstract askUseRemoteConfiguration(
        trialSetting: RemoteDBSettings,
        preferred: TweakValues
    ): Promise<{ result: false | TweakValues; requireFetch: boolean }>;
}

/**
 * The VaultService provides methods for interacting with the vault (local file system).
 */
export abstract class VaultService extends ServiceBase {
    constructor(hub: ServiceBackend) {
        super(hub);
    }
    /**
     * Get the vault name only.
     */
    abstract vaultName(): string;
    /**
     * Get the vault name with additional suffixes.
     */
    abstract getVaultName(): string;

    /**
     * Scan the vault for changes (especially for changes during the plug-in were not running).
     * @param showingNotice Whether to show a notice to the user.
     * @param ignoreSuspending Whether to ignore any suspending state.
     */
    abstract scanVault(showingNotice?: boolean, ignoreSuspending?: boolean): Promise<boolean>;

    /**
     * Check if a file is ignored by the ignore file (e.g., .gitignore, .obsidianignore).
     * @param file The file path or file info stub to check.
     */
    abstract isIgnoredByIgnoreFile(file: string | UXFileInfoStub): Promise<boolean>;

    /**
     * Mark the file list as possibly changed, so that the next operation will re-scan the vault.
     */
    abstract markFileListPossiblyChanged(): void;

    /**
     * Check if a file is a target file for synchronisation.
     * @param file The file path or file info stub to check.
     * @param keepFileCheckList Whether to keep the file in the check list.
     */
    abstract isTargetFile(file: string | UXFileInfoStub, keepFileCheckList?: boolean): Promise<boolean>;

    /**
     * Check if a filesize is too large against the current settings.
     * @param size The file size to check.
     */
    abstract isFileSizeTooLarge(size: number): boolean;

    /**
     * Get the currently active file path in the editor, if any.
     */
    abstract getActiveFilePath(): FilePath | undefined;

    /**
     * Check if the vault is on a case-insensitive file system.
     * This is important for certain operating systems like Windows and macOS.
     */
    abstract isStorageInsensitive(): boolean;
}

/**
 * The TestService provides methods for adding and handling test results.
 */
export abstract class TestService extends ServiceBase {
    constructor(hub: ServiceBackend) {
        super(hub);
        [this.test, this.handleTest] = this._firstFailure<typeof this.test>("test");
        [this.testMultiDevice, this.handleTestMultiDevice] =
            this._firstFailure<typeof this.testMultiDevice>("testMultiDevice");
    }
    /**
     * Run the test suite to verify the plug-in's functionality.
     * This is typically used for development and debugging purposes.
     * It may involve user interaction (means raising resolveByUserInteraction).
     */
    readonly test: () => Promise<boolean>;

    /**
     * Handler to register for the test event.
     */
    readonly handleTest: HandlerFunc<typeof this.test>;

    /**
     * Run the multi-device test suite to verify the plug-in's functionality across multiple devices.
     * This is typically used for development and debugging purposes.
     * It may involve user interaction (means raising resolveByUserInteraction).
     */
    readonly testMultiDevice: () => Promise<boolean>;

    /**
     * Handler to register for the testMultiDevice event.
     */
    readonly handleTestMultiDevice: HandlerFunc<typeof this.testMultiDevice>;

    /**
     * Add a test result to the test suite.
     * @param name The name of the test case.
     * @param key The key of the test result.
     * @param result The result of the test (true for success, false for failure).
     * @param summary A brief summary of the test result.
     * @param message A detailed message about the test result.
     */
    abstract addTestResult(name: string, key: string, result: boolean, summary?: string, message?: string): void;
}

export abstract class UIService extends HubService {
    abstract get dialogManager(): SvelteDialogManagerBase;
    abstract promptCopyToClipboard(title: string, value: string): Promise<boolean>;
    abstract showMarkdownDialog<T extends string[]>(
        title: string,
        contentMD: string,
        buttons: T
    ): Promise<(typeof buttons)[number] | false>;
}
export class UIServiceStub extends UIService {
    get dialogManager(): SvelteDialogManagerBase {
        throw new Error("UIService.dialogManager not implemented (stub)");
    }
    promptCopyToClipboard(title: string, value: string): Promise<boolean> {
        throw new Error("UIService.promptCopyToClipboard not implemented (stub)");
    }
    showMarkdownDialog<T extends string[]>(
        title: string,
        contentMD: string,
        buttons: T
    ): Promise<(typeof buttons)[number] | false> {
        throw new Error("UIService.showMarkdownDialog not implemented (stub)");
    }
}

export abstract class ConfigService extends HubService {
    abstract getSmallConfig(key: string): string | null;
    abstract setSmallConfig(key: string, value: string): void;
    abstract deleteSmallConfig(key: string): void;
}

export class ConfigServiceBrowserCompat extends ConfigService {
    getSmallConfig(key: string) {
        const vaultName = this.services.vault.getVaultName();
        const dbKey = `${vaultName}-${key}`;
        return localStorage.getItem(dbKey);
    }
    setSmallConfig(key: string, value: string): void {
        const vaultName = this.services.vault.getVaultName();
        const dbKey = `${vaultName}-${key}`;
        localStorage.setItem(dbKey, value);
    }
    deleteSmallConfig(key: string): void {
        const vaultName = this.services.vault.getVaultName();
        const dbKey = `${vaultName}-${key}`;
        localStorage.removeItem(dbKey);
    }
}

/**
 * ThroughHole is a utility class that allows lazy binding for older implementations.
 * For easy migration for future refactoring and adding tests.
 */
export class ThroughHole {
    registeredFunctions = new Map<string, () => any>();
    bindFunction<T extends (...args: any[]) => any>(name: string, func: T): void {
        this.registeredFunctions.set(name, func);
    }
    getFunction<T extends (...args: any[]) => any>(name: string): T {
        let invocation: ((...args: Parameters<T>) => ReturnType<T>) | undefined;
        const overlay = (...args: Parameters<T>) => {
            if (!invocation) {
                invocation = this.registeredFunctions.get(name);
            }
            if (!invocation) {
                throw new Error(`Function ${name} is not bound in ThroughHole`);
            }
            return invocation(...args);
        };
        return overlay as T;
    }
}
