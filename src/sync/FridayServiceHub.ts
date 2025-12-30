/**
 * FridayServiceHub - Simplified service hub for Friday sync
 * 
 * Implements the minimum required services for CouchDB synchronization
 */

import { Platform } from "obsidian";
import { ServiceHub, type ServiceInstances } from "./core/services/ServiceHub";
import {
    type APIService,
    type PathService,
    type DatabaseService,
    type DatabaseEventService,
    type ReplicatorService,
    type FileProcessingService,
    type ReplicationService,
    type RemoteService,
    type ConflictService,
    type AppLifecycleService,
    type SettingService,
    type TweakValueService,
    type VaultService,
    type TestService,
    type UIService,
    ServiceBase,
    HubService,
} from "./core/services/Services";
import { ServiceBackend } from "./core/services/ServiceBackend";
import type { FridaySyncCore } from "./FridaySyncCore";
import type { FetchHttpHandler } from "@smithy/fetch-http-handler";
import type { LOG_LEVEL } from "octagonal-wheels/common/logger";
import type {
    DocumentID,
    EntryDoc,
    EntryHasPath,
    FilePath,
    FilePathWithPrefix,
    LoadedEntry,
    MetaEntry,
    ObsidianLiveSyncSettings,
    RemoteDBSettings,
    TweakValues,
    FileEventItem,
    diff_result,
    CouchDBCredentials,
    UXFileInfoStub,
    AUTO_MERGED,
    MISSING_OR_ERROR,
} from "./core/common/types";
import type { LiveSyncLocalDB } from "./core/pouchdb/LiveSyncLocalDB";
import type { LiveSyncAbstractReplicator } from "./core/replication/LiveSyncAbstractReplicator";
import type { SimpleStore } from "octagonal-wheels/databases/SimpleStoreBase";
import type { SvelteDialogManagerBase } from "./core/UI/svelteDialog";
import { readContent, isTextDocument } from "./core/common/utils";
import { enableEncryption, disableEncryption } from "./core/pouchdb/encryption";
import { replicationFilter } from "./core/pouchdb/compress";
import { E2EEAlgorithms } from "./core/common/types";

// PouchDB imports - use the configured PouchDB with transform-pouch plugin
import { PouchDB } from "./core/pouchdb/pouchdb-browser";

/**
 * Stub API Service
 */
class FridayAPIService extends ServiceBase implements APIService {
    private core: FridaySyncCore;

    constructor(backend: ServiceBackend, core: FridaySyncCore) {
        super(backend);
        this.core = core;
    }

    getCustomFetchHandler(): FetchHttpHandler {
        // Return a basic fetch handler
        return {
            handle: async (request: any) => {
                const response = await fetch(request.url, {
                    method: request.method,
                    headers: request.headers,
                    body: request.body,
                });
                return { response };
            },
        } as any;
    }

    addLog(message: any, level: LOG_LEVEL, key: string): void {
        console.log(`[${key}] ${message}`);
    }

    isMobile(): boolean {
        return Platform.isMobile;
    }

    async showWindow(type: string): Promise<void> {
        // Not implemented for Friday
    }

    getAppID(): string {
        return "friday-sync";
    }

    isLastPostFailedDueToPayloadSize(): boolean {
        return false;
    }

    getPlatform(): string {
        return Platform.isDesktop ? "desktop" : "mobile";
    }

    getAppVersion(): string {
        return "1.0.0";
    }

    getPluginVersion(): string {
        return "0.1.0";
    }
}

/**
 * Stub Path Service
 */
class FridayPathService extends ServiceBase implements PathService {
    private core: FridaySyncCore;

    constructor(backend: ServiceBackend, core: FridaySyncCore) {
        super(backend);
        this.core = core;
    }

    id2path(id: DocumentID, entry?: EntryHasPath, stripPrefix?: boolean): FilePathWithPrefix {
        return this.core.id2path(id, entry, stripPrefix);
    }

    async path2id(filename: FilePathWithPrefix | FilePath, prefix?: string): Promise<DocumentID> {
        return this.core.path2id(filename, prefix);
    }
}

/**
 * Stub Database Service
 */
class FridayDatabaseService extends ServiceBase implements DatabaseService {
    private core: FridaySyncCore;
    private _isDatabaseReady = false;

    constructor(backend: ServiceBackend, core: FridaySyncCore) {
        super(backend);
        this.core = core;
    }

    createPouchDBInstance<T extends object>(
        name?: string,
        options?: PouchDB.Configuration.DatabaseConfiguration
    ): PouchDB.Database<T> {
        return new PouchDB<T>(name, {
            adapter: "idb",
            ...options,
        });
    }

    openSimpleStore<T>(kind: string): SimpleStore<T> {
        // Return a simple localStorage-based store
        return {
            get: async (key: string) => {
                const value = localStorage.getItem(`friday-${kind}-${key}`);
                return value ? JSON.parse(value) : undefined;
            },
            set: async (key: string, value: T) => {
                localStorage.setItem(`friday-${kind}-${key}`, JSON.stringify(value));
            },
            delete: async (key: string) => {
                localStorage.removeItem(`friday-${kind}-${key}`);
            },
            keys: async () => {
                const prefix = `friday-${kind}-`;
                const keys: string[] = [];
                for (let i = 0; i < localStorage.length; i++) {
                    const key = localStorage.key(i);
                    if (key?.startsWith(prefix)) {
                        keys.push(key.substring(prefix.length));
                    }
                }
                return keys;
            },
            close: () => {},
        };
    }

    async openDatabase(): Promise<boolean> {
        this._isDatabaseReady = true;
        return true;
    }

    async resetDatabase(): Promise<boolean> {
        this._isDatabaseReady = false;
        return true;
    }

    isDatabaseReady(): boolean {
        return this._isDatabaseReady;
    }
}

/**
 * Stub Database Event Service
 */
class FridayDatabaseEventService extends ServiceBase implements DatabaseEventService {
    constructor(backend: ServiceBackend) {
        super(backend);
        // Initialize event handlers
        [this.onUnloadDatabase, this.handleOnUnloadDatabase] = this._all<typeof this.onUnloadDatabase>("dbUnload");
        [this.onCloseDatabase, this.handleOnCloseDatabase] = this._all<typeof this.onCloseDatabase>("dbClose");
        [this.onDatabaseInitialisation, this.handleOnDatabaseInitialisation] =
            this._firstFailure<typeof this.onDatabaseInitialisation>("databaseInitialisation");
        [this.onDatabaseInitialised, this.handleDatabaseInitialised] =
            this._firstFailure<typeof this.onDatabaseInitialised>("databaseInitialised");
        [this.onResetDatabase, this.handleOnResetDatabase] =
            this._firstFailure<typeof this.onResetDatabase>("resetDatabase");
    }

    readonly onUnloadDatabase!: (db: LiveSyncLocalDB) => Promise<boolean>;
    readonly handleOnUnloadDatabase!: (handler: (db: LiveSyncLocalDB) => Promise<boolean>) => void;
    readonly onCloseDatabase!: (db: LiveSyncLocalDB) => Promise<boolean>;
    readonly handleOnCloseDatabase!: (handler: (db: LiveSyncLocalDB) => Promise<boolean>) => void;
    readonly onDatabaseInitialisation!: (db: LiveSyncLocalDB) => Promise<boolean>;
    readonly handleOnDatabaseInitialisation!: (handler: (db: LiveSyncLocalDB) => Promise<boolean>) => void;
    readonly onDatabaseInitialised!: (showNotice: boolean) => Promise<boolean>;
    readonly handleDatabaseInitialised!: (handler: (showNotice: boolean) => Promise<boolean>) => void;
    readonly onResetDatabase!: (db: LiveSyncLocalDB) => Promise<boolean>;
    readonly handleOnResetDatabase!: (handler: (db: LiveSyncLocalDB) => Promise<boolean>) => void;

    async initialiseDatabase(
        showingNotice?: boolean,
        reopenDatabase?: boolean,
        ignoreSuspending?: boolean
    ): Promise<boolean> {
        return true;
    }
}

/**
 * Stub Replicator Service
 */
class FridayReplicatorService extends ServiceBase implements ReplicatorService {
    private core: FridaySyncCore;

    constructor(backend: ServiceBackend, core: FridaySyncCore) {
        super(backend);
        this.core = core;
        [this.getNewReplicator, this.handleGetNewReplicator] =
            this._firstOrUndefined<typeof this.getNewReplicator>("getNewReplicator");
        [this.onCloseActiveReplication, this.handleOnCloseActiveReplication] =
            this._first<typeof this.onCloseActiveReplication>("closeActiveReplication");
    }

    readonly onCloseActiveReplication!: () => Promise<boolean>;
    readonly handleOnCloseActiveReplication!: (handler: () => Promise<boolean>) => void;
    readonly getNewReplicator!: (settingOverride?: Partial<ObsidianLiveSyncSettings>) => Promise<LiveSyncAbstractReplicator | undefined | false>;
    readonly handleGetNewReplicator!: (handler: (settingOverride?: Partial<ObsidianLiveSyncSettings>) => Promise<Exclude<Awaited<ReturnType<typeof this.getNewReplicator>>, undefined>>) => void;

    getActiveReplicator(): LiveSyncAbstractReplicator | undefined {
        return this.core.replicator || undefined;
    }
}

/**
 * Stub Replication Service
 */
class FridayReplicationService extends ServiceBase implements ReplicationService {
    private core: FridaySyncCore;
    private processingQueue: Array<PouchDB.Core.ExistingDocument<EntryDoc>> = [];
    private isProcessing = false;

    constructor(backend: ServiceBackend, core: FridaySyncCore) {
        super(backend);
        this.core = core;
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
        
        // Register the default document processor
        this.handleProcessSynchroniseResult(this.defaultProcessSynchroniseResult.bind(this));
    }

    /**
     * Default handler for processing synchronized documents
     * Writes the document content to the vault
     * 
     * This follows the same pattern as livesync's ModuleFileHandler.dbToStorage
     */
    private async defaultProcessSynchroniseResult(doc: MetaEntry): Promise<boolean> {
        try {
            const path = doc.path;
            if (!path) {
                console.log(`[Friday Sync] Document has no path: ${doc._id}`);
                return false;
            }
            
            // Mark file as being processed to prevent sync loop
            // (When we write the file, vault will emit 'modify' event, 
            //  which should NOT trigger another upload to server)
            const storageEventManager = this.core.storageEventManager;
            if (storageEventManager) {
                storageEventManager.markFileProcessing(path);
            }
            
            try {
                // Check if document is deleted
                const isDeleted = doc._deleted === true || ("deleted" in doc && (doc as any).deleted === true);
                
                if (isDeleted) {
                    // Handle deletion
                    console.log(`[Friday Sync] Deleting file: ${path}`);
                    const vault = this.core.plugin.app.vault;
                    const existingFile = vault.getAbstractFileByPath(path);
                    if (existingFile) {
                        await vault.delete(existingFile);
                    }
                    return true;
                }
                
                // Get full document content from local database
                const localDB = this.core.localDatabase;
                if (!localDB) {
                    console.error("[Friday Sync] Local database not available");
                    return false;
                }
                
                // Fetch the full entry with data
                const fullEntry = await localDB.getDBEntryFromMeta(doc, false, true);
                if (!fullEntry) {
                    console.log(`[Friday Sync] Could not get full entry for: ${path}`);
                    return false;
                }
                
                // Get content using readContent (same as livesync)
                // This correctly handles:
                // - Text documents: joins string[] chunks into a single string  
                // - Binary documents: decodes base64 data to ArrayBuffer
                const content = readContent(fullEntry);
                const isText = isTextDocument(fullEntry);
                
                // Write to vault
                const vault = this.core.plugin.app.vault;
                const existingFile = vault.getAbstractFileByPath(path);
                
                // Ensure parent directories exist
                const dirPath = path.substring(0, path.lastIndexOf("/"));
                if (dirPath) {
                    const existingDir = vault.getAbstractFileByPath(dirPath);
                    if (!existingDir) {
                        await vault.createFolder(dirPath).catch(() => {});
                    }
                }
                
                if (existingFile) {
                    // Modify existing file
                    if (isText) {
                        await vault.modify(existingFile as any, content as string);
                    } else {
                        await vault.modifyBinary(existingFile as any, content as ArrayBuffer);
                    }
                    console.log(`[Friday Sync] Updated file: ${path}`);
                } else {
                    // Create new file
                    if (isText) {
                        await vault.create(path, content as string);
                    } else {
                        await vault.createBinary(path, content as ArrayBuffer);
                    }
                    console.log(`[Friday Sync] Created file: ${path}`);
                }
                
                // Update counter for UI
                this.core.replicationStat.value = {
                    ...this.core.replicationStat.value,
                    arrived: this.core.replicationStat.value.arrived + 1,
                };
                
                return true;
            } finally {
                // Unmark file after a short delay to allow vault events to settle
                if (storageEventManager) {
                    setTimeout(() => {
                        storageEventManager.unmarkFileProcessing(path);
                    }, 1000);
                }
            }
        } catch (error) {
            console.error(`[Friday Sync] Error processing document:`, error);
            return false;
        }
    }

    readonly processSynchroniseResult!: (doc: MetaEntry) => Promise<boolean>;
    readonly handleProcessSynchroniseResult!: (handler: (doc: MetaEntry) => Promise<boolean>) => void;
    readonly processOptionalSynchroniseResult!: (doc: LoadedEntry) => Promise<boolean>;
    readonly handleProcessOptionalSynchroniseResult!: (handler: (doc: LoadedEntry) => Promise<boolean>) => void;
    readonly processVirtualDocument!: (docs: PouchDB.Core.ExistingDocument<EntryDoc>) => Promise<boolean>;
    readonly handleProcessVirtualDocuments!: (handler: (docs: PouchDB.Core.ExistingDocument<EntryDoc>) => Promise<boolean>) => void;
    readonly onBeforeReplicate!: (showMessage: boolean) => Promise<boolean>;
    readonly handleBeforeReplicate!: (handler: (showMessage: boolean) => Promise<boolean>) => void;
    readonly checkConnectionFailure!: () => Promise<boolean | "CHECKAGAIN" | undefined>;
    readonly handleCheckConnectionFailure!: (handler: () => Promise<boolean | "CHECKAGAIN" | undefined>) => void;

    parseSynchroniseResult(docs: Array<PouchDB.Core.ExistingDocument<EntryDoc>>): void {
        // Queue documents for processing
        console.log(`[Friday Sync] *** LiveSync received ${docs.length} documents for processing ***`);
        
        let queuedCount = 0;
        for (const doc of docs) {
            // Skip chunks and system documents
            if (doc._id.startsWith("h:")) continue; // chunk
            if (doc._id === "_design") continue;
            if (doc.type === "versioninfo") continue;
            if (doc.type === "milestoneinfo") continue;
            if (doc.type === "nodeinfo") continue;
            if (doc._id.startsWith("_")) continue; // internal docs
            
            // Process note/plain documents
            if (doc.type === "notes" || doc.type === "newnote" || doc.type === "plain") {
                this.processingQueue.push(doc);
                queuedCount++;
                console.log(`[Friday Sync] Queued document: ${(doc as any).path || doc._id} (type: ${doc.type})`);
            }
        }
        
        console.log(`[Friday Sync] Queued ${queuedCount} documents for writing to vault`);
        
        // Start processing queue if not already processing
        if (!this.isProcessing) {
            this.processQueue();
        }
    }
    
    private async processQueue(): Promise<void> {
        if (this.isProcessing) return;
        this.isProcessing = true;
        
        console.log(`[Friday Sync] Starting to process ${this.processingQueue.length} queued documents...`);
        
        try {
            let processed = 0;
            while (this.processingQueue.length > 0) {
                const doc = this.processingQueue.shift();
                if (!doc) continue;
                
                try {
                    // Cast to MetaEntry for processing
                    const path = (doc as any).path || doc._id;
                    console.log(`[Friday Sync] Processing document: ${path}`);
                    const result = await this.processSynchroniseResult(doc as unknown as MetaEntry);
                    processed++;
                    console.log(`[Friday Sync] Document processed (${result ? 'success' : 'failed'}): ${path}`);
                } catch (error) {
                    console.error(`[Friday Sync] Error processing doc ${doc._id}:`, error);
                }
            }
            console.log(`[Friday Sync] Finished processing ${processed} documents`);
        } finally {
            this.isProcessing = false;
        }
    }

    async isReplicationReady(showMessage: boolean): Promise<boolean> {
        return this.core.localDatabase !== null && this.core.replicator !== null;
    }

    /**
     * Trigger a replication (one-shot sync).
     * In LiveSync mode, this will run alongside the continuous replication.
     * This is typically called when the user wants to manually trigger a sync.
     */
    async replicate(showMessage?: boolean): Promise<boolean | void> {
        // If LiveSync is already running, the continuous replication
        // will automatically handle changes. We can still do a one-shot
        // sync if needed, but it's generally not necessary.
        const replicator = this.core.replicator;
        if (replicator) {
            // Check if we already have an active replication
            const status = this.core.replicationStat.value.syncStatus;
            if (status === "CONNECTED" || status === "STARTED") {
                // LiveSync is running, no need to do one-shot sync
                console.log("[Friday Sync] LiveSync is running, skipping one-shot sync");
                return true;
            }
            // Otherwise, do a one-shot sync
            return this.core.startSync(false);
        }
        return false;
    }

    /**
     * Trigger replication by event (e.g., file saved).
     * In LiveSync mode, changes are automatically synced, so this may be a no-op.
     */
    async replicateByEvent(showMessage?: boolean): Promise<boolean | void> {
        // Same as replicate() - if LiveSync is running, it will handle changes automatically
        return this.replicate(showMessage);
    }
}

/**
 * Stub App Lifecycle Service
 */
class FridayAppLifecycleService extends ServiceBase implements AppLifecycleService {
    private _isReady = false;
    private _isSuspended = false;
    private _hasUnloaded = false;

    constructor(backend: ServiceBackend) {
        super(backend);
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

    readonly onLayoutReady!: () => Promise<boolean>;
    readonly handleLayoutReady!: (handler: () => Promise<boolean>) => void;
    readonly onFirstInitialise!: () => Promise<boolean>;
    readonly handleFirstInitialise!: (handler: () => Promise<boolean>) => void;
    readonly onReady!: () => Promise<boolean>;
    readonly handleOnReady!: (handler: () => Promise<boolean>) => void;
    readonly onWireUpEvents!: () => Promise<boolean>;
    readonly handleOnWireUpEvents!: (handler: () => Promise<boolean>) => void;
    readonly onInitialise!: () => Promise<boolean>;
    readonly handleOnInitialise!: (handler: () => Promise<boolean>) => void;
    readonly onLoad!: () => Promise<boolean>;
    readonly handleOnLoad!: (handler: () => Promise<boolean>) => void;
    readonly onSettingLoaded!: () => Promise<boolean>;
    readonly handleOnSettingLoaded!: (handler: () => Promise<boolean>) => void;
    readonly onLoaded!: () => Promise<boolean>;
    readonly handleOnLoaded!: (handler: () => Promise<boolean>) => void;
    readonly onScanningStartupIssues!: () => Promise<boolean>;
    readonly handleOnScanningStartupIssues!: (handler: () => Promise<boolean>) => void;
    readonly onAppUnload!: () => Promise<void>;
    readonly handleOnAppUnload!: (handler: () => Promise<void>) => void;
    readonly onBeforeUnload!: () => Promise<boolean>;
    readonly handleOnBeforeUnload!: (handler: () => Promise<boolean>) => void;
    readonly onUnload!: () => Promise<boolean>;
    readonly handleOnUnload!: (handler: () => Promise<boolean>) => void;
    readonly onSuspending!: () => Promise<boolean>;
    readonly handleOnSuspending!: (handler: () => Promise<boolean>) => void;
    readonly onResuming!: () => Promise<boolean>;
    readonly handleOnResuming!: (handler: () => Promise<boolean>) => void;
    readonly onResumed!: () => Promise<boolean>;
    readonly handleOnResumed!: (handler: () => Promise<boolean>) => void;
    readonly getUnresolvedMessages!: () => Promise<string[][]>;
    readonly reportUnresolvedMessages!: (handler: () => Promise<string[]>) => void;

    performRestart(): void {}
    askRestart(message?: string): void {}
    scheduleRestart(): void {}
    isSuspended(): boolean { return this._isSuspended; }
    setSuspended(suspend: boolean): void { this._isSuspended = suspend; }
    isReady(): boolean { return this._isReady; }
    markIsReady(): void { this._isReady = true; }
    resetIsReady(): void { this._isReady = false; }
    hasUnloaded(): boolean { return this._hasUnloaded; }
    isReloadingScheduled(): boolean { return false; }
}

/**
 * FridayServiceHub - Main service hub implementation
 */
export class FridayServiceHub extends ServiceHub {
    private backend: ServiceBackend;
    private core: FridaySyncCore;

    protected _api: APIService;
    protected _path: PathService;
    protected _database: DatabaseService;
    protected _databaseEvents: DatabaseEventService;
    protected _replicator: ReplicatorService;
    protected _fileProcessing: FileProcessingService;
    protected _replication: ReplicationService;
    protected _remote: RemoteService;
    protected _conflict: ConflictService;
    protected _appLifecycle: AppLifecycleService;
    protected _setting: SettingService;
    protected _tweakValue: TweakValueService;
    protected _vault: VaultService;
    protected _test: TestService;
    protected _ui: UIService;

    constructor(core: FridaySyncCore) {
        const backend = new ServiceBackend();
        super();
        this.backend = backend;
        this.core = core;

        // Initialize services
        this._api = new FridayAPIService(backend, core);
        this._path = new FridayPathService(backend, core);
        this._database = new FridayDatabaseService(backend, core);
        this._databaseEvents = new FridayDatabaseEventService(backend);
        this._replicator = new FridayReplicatorService(backend, core);
        this._fileProcessing = new FridayFileProcessingService(backend);
        this._replication = new FridayReplicationService(backend, core);
        this._remote = new FridayRemoteService(backend, core);
        this._conflict = new FridayConflictService(backend);
        this._appLifecycle = new FridayAppLifecycleService(backend);
        this._setting = new FridaySettingService(backend, core);
        this._tweakValue = new FridayTweakValueService(backend);
        this._vault = new FridayVaultService(backend, core);
        this._test = new FridayTestService(backend);
        this._ui = new FridayUIService();

        // Set services reference for all services
        [
            this._api, this._path, this._database, this._databaseEvents,
            this._replicator, this._fileProcessing, this._replication,
            this._remote, this._conflict, this._appLifecycle, this._setting,
            this._tweakValue, this._vault, this._test, this._ui
        ].forEach(service => service.setServices(this));
    }
}

// Stub implementations for remaining services
class FridayFileProcessingService extends ServiceBase implements FileProcessingService {
    constructor(backend: ServiceBackend) {
        super(backend);
        [this.processFileEvent, this.handleProcessFileEvent] = this._first<typeof this.processFileEvent>("processFileEvent");
        [this.processOptionalFileEvent, this.handleOptionalFileEvent] = this._first<typeof this.processOptionalFileEvent>("processOptionalFileEvent");
        [this.commitPendingFileEvents, this.handleCommitPendingFileEvents] = this._firstFailure<typeof this.commitPendingFileEvents>("commitPendingFileEvents");
    }
    readonly processFileEvent!: (item: FileEventItem) => Promise<boolean>;
    readonly handleProcessFileEvent!: (handler: (item: FileEventItem) => Promise<boolean>) => void;
    readonly processOptionalFileEvent!: (path: FilePath) => Promise<boolean>;
    readonly handleOptionalFileEvent!: (handler: (path: FilePath) => Promise<boolean>) => void;
    readonly commitPendingFileEvents!: () => Promise<boolean>;
    readonly handleCommitPendingFileEvents!: (handler: () => Promise<boolean>) => void;
}

class FridayRemoteService extends ServiceBase implements RemoteService {
    private core: FridaySyncCore;
    constructor(backend: ServiceBackend, core: FridaySyncCore) {
        super(backend);
        this.core = core;
    }
    
    async connect(
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
    ): Promise<string | { db: PouchDB.Database<EntryDoc>; info: PouchDB.Core.DatabaseInfo }> {
        try {
            // Validate URI
            if (!uri || uri.trim() === "") {
                return "Remote URI is empty";
            }
            
            // Create PouchDB configuration with HTTP adapter
            const conf: PouchDB.HttpAdapter.HttpAdapterConfiguration = {
                adapter: "http",
                skip_setup: !performSetup,
                fetch: async (url: string | Request, opts?: RequestInit) => {
                    const headers = new Headers(opts?.headers);
                    
                    // Add custom headers
                    if (customHeaders) {
                        for (const [key, value] of Object.entries(customHeaders)) {
                            if (key && value) {
                                headers.append(key, value);
                            }
                        }
                    }
                    
                    // Add authentication
                    if ("username" in auth && auth.username && auth.password) {
                        const credentials = btoa(`${auth.username}:${auth.password}`);
                        headers.append("Authorization", `Basic ${credentials}`);
                    }
                    
                    try {
                        const response = await fetch(url, { ...opts, headers });
                        return response;
                    } catch (ex: any) {
                        console.error("[Friday Sync] Fetch error:", ex);
                        throw ex;
                    }
                },
            };
            
            // Create PouchDB instance
            const db = new PouchDB<EntryDoc>(uri, conf);
            
            // Apply replication filter (compression support)
            replicationFilter(db, compression);
            
            // Reset encryption state and enable if passphrase is provided
            // This is critical for decrypting data from the server (same as livesync)
            disableEncryption();
            if (passphrase !== false && typeof passphrase === "string" && passphrase !== "") {
                // Get E2EEAlgorithm from settings, default to V2 for forward compatibility
                const settings = this.core.getSettings();
                const e2eeAlgorithm = settings.E2EEAlgorithm || E2EEAlgorithms.V2;
                console.log(`[Friday Sync] Enabling encryption with passphrase (algorithm: ${e2eeAlgorithm})`);
                enableEncryption(
                    db,
                    passphrase,
                    useDynamicIterationCount,
                    false, // migrationDecrypt
                    getPBKDF2Salt,
                    e2eeAlgorithm
                );
            }
            
            // If skipInfo, return without fetching info
            if (skipInfo) {
                return { db, info: { db_name: "", doc_count: 0, update_seq: "" } };
            }
            
            // Fetch database info
            try {
                const info = await db.info();
                console.log(`[Friday Sync] Connected to ${info.db_name}, docs: ${info.doc_count}`);
                return { db, info };
            } catch (ex: any) {
                const msg = `${ex?.name}:${ex?.message}`;
                console.error("[Friday Sync] Failed to get database info:", msg);
                return msg;
            }
        } catch (ex: any) {
            const msg = `Connection error: ${ex?.message || ex}`;
            console.error("[Friday Sync]", msg);
            return msg;
        }
    }
    
    async replicateAllToRemote(showingNotice?: boolean): Promise<boolean> {
        return this.core.pushToServer();
    }
    async replicateAllFromRemote(showingNotice?: boolean): Promise<boolean> {
        return this.core.pullFromServer();
    }
    async markLocked(lockByClean?: boolean): Promise<void> {}
    async markUnlocked(): Promise<void> {}
    async markResolved(): Promise<void> {}
    async tryResetDatabase(): Promise<void> {}
    async tryCreateDatabase(): Promise<void> {}
}

class FridayConflictService extends ServiceBase implements ConflictService {
    constructor(backend: ServiceBackend) {
        super(backend);
        [this.resolveByUserInteraction, this.handleResolveByUserInteraction] = this._first<typeof this.resolveByUserInteraction>("resolveByUserInteraction");
        [this.getOptionalConflictCheckMethod, this.handleGetOptionalConflictCheckMethod] = this._first<typeof this.getOptionalConflictCheckMethod>("getOptionalConflictCheckMethod");
    }
    readonly getOptionalConflictCheckMethod!: (path: FilePathWithPrefix) => Promise<boolean | undefined | "newer">;
    readonly handleGetOptionalConflictCheckMethod!: (handler: (path: FilePathWithPrefix) => Promise<boolean | undefined | "newer">) => void;
    readonly resolveByUserInteraction!: (filename: FilePathWithPrefix, conflictCheckResult: diff_result) => Promise<boolean | undefined>;
    readonly handleResolveByUserInteraction!: (handler: (filename: FilePathWithPrefix, conflictCheckResult: diff_result) => Promise<boolean | undefined>) => void;
    async queueCheckForIfOpen(path: FilePathWithPrefix): Promise<void> {}
    async queueCheckFor(path: FilePathWithPrefix): Promise<void> {}
    async ensureAllProcessed(): Promise<boolean> { return true; }
    async resolveByDeletingRevision(path: FilePathWithPrefix, deleteRevision: string, title: string): Promise<typeof MISSING_OR_ERROR | typeof AUTO_MERGED> {
        return "MISSING_OR_ERROR" as typeof MISSING_OR_ERROR;
    }
    async resolve(filename: FilePathWithPrefix): Promise<void> {}
    async resolveByNewest(filename: FilePathWithPrefix): Promise<boolean> { return true; }
}

class FridaySettingService extends ServiceBase implements SettingService {
    private core: FridaySyncCore;
    constructor(backend: ServiceBackend, core: FridaySyncCore) {
        super(backend);
        this.core = core;
        [this.onBeforeRealiseSetting, this.handleBeforeRealiseSetting] = this._firstFailure("beforeRealiseSetting");
        [this.onSettingRealised, this.handleSettingRealised] = this._firstFailure("afterRealiseSetting");
        [this.onRealiseSetting, this.handleOnRealiseSetting] = this._firstFailure("realiseSetting");
        [this.suspendAllSync, this.handleSuspendAllSync] = this._all("suspendAllSync");
        [this.suspendExtraSync, this.handleSuspendExtraSync] = this._all("suspendExtraSync");
        [this.suggestOptionalFeatures, this.handleSuggestOptionalFeatures] = this._all<typeof this.suggestOptionalFeatures>("suggestOptionalFeatures");
        [this.enableOptionalFeature, this.handleEnableOptionalFeature] = this._all<typeof this.enableOptionalFeature>("enableOptionalFeature");
    }
    readonly onBeforeRealiseSetting!: () => Promise<boolean>;
    readonly handleBeforeRealiseSetting!: (handler: () => Promise<boolean>) => void;
    readonly onSettingRealised!: () => Promise<boolean>;
    readonly handleSettingRealised!: (handler: () => Promise<boolean>) => void;
    readonly onRealiseSetting!: () => Promise<boolean>;
    readonly handleOnRealiseSetting!: (handler: () => Promise<boolean>) => void;
    readonly suspendAllSync!: () => Promise<boolean>;
    readonly handleSuspendAllSync!: (handler: () => Promise<boolean>) => void;
    readonly suspendExtraSync!: () => Promise<boolean>;
    readonly handleSuspendExtraSync!: (handler: () => Promise<boolean>) => void;
    readonly suggestOptionalFeatures!: (opt: { enableFetch?: boolean; enableOverwrite?: boolean }) => Promise<boolean>;
    readonly handleSuggestOptionalFeatures!: (handler: (opt: { enableFetch?: boolean; enableOverwrite?: boolean }) => Promise<boolean>) => void;
    readonly enableOptionalFeature!: (mode: keyof OPTIONAL_SYNC_FEATURES) => Promise<boolean>;
    readonly handleEnableOptionalFeature!: (handler: (mode: keyof OPTIONAL_SYNC_FEATURES) => Promise<boolean>) => void;
    
    clearUsedPassphrase(): void {}
    async realiseSetting(): Promise<void> {}
    async decryptSettings(settings: ObsidianLiveSyncSettings): Promise<ObsidianLiveSyncSettings> { return settings; }
    async adjustSettings(settings: ObsidianLiveSyncSettings): Promise<ObsidianLiveSyncSettings> { return settings; }
    async loadSettings(): Promise<void> {}
    getDeviceAndVaultName(): string { return "friday-device"; }
    setDeviceAndVaultName(name: string): void {}
    saveDeviceAndVaultName(): void {}
    async saveSettingData(): Promise<void> {}
    currentSettings(): ObsidianLiveSyncSettings { return this.core.getSettings(); }
    shouldCheckCaseInsensitively(): boolean { return false; }
    async importSettings(imported: Partial<ObsidianLiveSyncSettings>): Promise<boolean> { return true; }
}

class FridayTweakValueService extends ServiceBase implements TweakValueService {
    constructor(backend: ServiceBackend) { super(backend); }
    async fetchRemotePreferred(trialSetting: RemoteDBSettings): Promise<TweakValues | false> { return false; }
    async checkAndAskResolvingMismatched(preferred: Partial<TweakValues>): Promise<[TweakValues | boolean, boolean]> { return [false, false]; }
    async askResolvingMismatched(preferredSource: TweakValues): Promise<"OK" | "CHECKAGAIN" | "IGNORE"> { return "OK"; }
    async checkAndAskUseRemoteConfiguration(settings: RemoteDBSettings): Promise<{ result: false | TweakValues; requireFetch: boolean }> { return { result: false, requireFetch: false }; }
    async askUseRemoteConfiguration(trialSetting: RemoteDBSettings, preferred: TweakValues): Promise<{ result: false | TweakValues; requireFetch: boolean }> { return { result: false, requireFetch: false }; }
}

class FridayVaultService extends ServiceBase implements VaultService {
    private core: FridaySyncCore;
    constructor(backend: ServiceBackend, core: FridaySyncCore) {
        super(backend);
        this.core = core;
    }
    vaultName(): string { return "friday-vault"; }
    getVaultName(): string { return "friday-vault"; }
    async scanVault(showingNotice?: boolean, ignoreSuspending?: boolean): Promise<boolean> { return true; }
    async isIgnoredByIgnoreFile(file: string | UXFileInfoStub): Promise<boolean> { return false; }
    markFileListPossiblyChanged(): void {}
    async isTargetFile(file: string | UXFileInfoStub, keepFileCheckList?: boolean): Promise<boolean> { return true; }
    isFileSizeTooLarge(size: number): boolean { return size > 100 * 1024 * 1024; }
    getActiveFilePath(): FilePath | undefined { return undefined; }
    isStorageInsensitive(): boolean { return false; }
}

class FridayTestService extends ServiceBase implements TestService {
    constructor(backend: ServiceBackend) {
        super(backend);
        [this.test, this.handleTest] = this._firstFailure<typeof this.test>("test");
        [this.testMultiDevice, this.handleTestMultiDevice] = this._firstFailure<typeof this.testMultiDevice>("testMultiDevice");
    }
    readonly test!: () => Promise<boolean>;
    readonly handleTest!: (handler: () => Promise<boolean>) => void;
    readonly testMultiDevice!: () => Promise<boolean>;
    readonly handleTestMultiDevice!: (handler: () => Promise<boolean>) => void;
    addTestResult(name: string, key: string, result: boolean, summary?: string, message?: string): void {}
}

class FridayUIService extends HubService implements UIService {
    get dialogManager(): SvelteDialogManagerBase {
        throw new Error("Dialog manager not implemented");
    }
    async promptCopyToClipboard(title: string, value: string): Promise<boolean> { return false; }
    async showMarkdownDialog<T extends string[]>(title: string, contentMD: string, buttons: T): Promise<(typeof buttons)[number] | false> { return false; }
}

