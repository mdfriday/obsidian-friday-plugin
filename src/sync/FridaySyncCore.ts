/**
 * FridaySyncCore - Core sync implementation for Friday plugin
 * 
 * This class implements the necessary interfaces from livesync's core library
 * to enable full CouchDB synchronization functionality.
 */

import { Plugin, Notice, Platform, TFile, TFolder, normalizePath } from "obsidian";
import { reactiveSource, type ReactiveSource } from "octagonal-wheels/dataobject/reactive";

// Import core types
import {
    type EntryDoc,
    type ObsidianLiveSyncSettings,
    type RemoteDBSettings,
    type DocumentID,
    type FilePath,
    type FilePathWithPrefix,
    type EntryHasPath,
    type DatabaseConnectingStatus,
    DEFAULT_SETTINGS,
    REMOTE_COUCHDB,
    LOG_LEVEL_INFO,
    LOG_LEVEL_NOTICE,
    LOG_LEVEL_VERBOSE,
} from "./core/common/types";

// Import core components
import { LiveSyncLocalDB, type LiveSyncLocalDBEnv } from "./core/pouchdb/LiveSyncLocalDB";
import { LiveSyncCouchDBReplicator, type LiveSyncCouchDBReplicatorEnv } from "./core/replication/couchdb/LiveSyncReplicator";
import { type LiveSyncAbstractReplicator, type ReplicationStat } from "./core/replication/LiveSyncAbstractReplicator";
import { LiveSyncManagers } from "./core/managers/LiveSyncManagers";
import { type KeyValueDatabase } from "./core/interfaces/KeyValueDatabase";
import { type SimpleStore } from "octagonal-wheels/databases/SimpleStoreBase";
import { Logger, setGlobalLogFunction } from "./core/common/logger";
import { readContent, isTextDocument } from "./core/common/utils";

// Import services
import { FridayServiceHub } from "./FridayServiceHub";
import type { SyncConfig, SyncStatus, SyncStatusCallback } from "./SyncService";
import { FridayStorageEventManager } from "./FridayStorageEventManager";

// PouchDB imports - use the configured PouchDB with all plugins (including transform-pouch)
import { PouchDB } from "./core/pouchdb/pouchdb-browser";

// Import encryption utilities for local database
import { enableEncryption, disableEncryption } from "./core/pouchdb/encryption";
import { replicationFilter } from "./core/pouchdb/compress";
import { E2EEAlgorithms } from "./core/common/types";

// Import path utilities for correct document ID generation
import { path2id_base, id2path_base } from "./core/string_and_binary/path";

/**
 * Simple KeyValue Database implementation using localStorage
 */
class SimpleKeyValueDB implements KeyValueDatabase {
    private prefix: string;

    constructor(prefix: string) {
        this.prefix = prefix;
    }

    private getKey(key: string): string {
        return `${this.prefix}-${key}`;
    }

    async get<T>(key: string): Promise<T | undefined> {
        const value = localStorage.getItem(this.getKey(key));
        if (value === null) return undefined;
        try {
            return JSON.parse(value) as T;
        } catch {
            return undefined;
        }
    }

    async set<T>(key: string, value: T): Promise<void> {
        localStorage.setItem(this.getKey(key), JSON.stringify(value));
    }

    async delete(key: string): Promise<void> {
        localStorage.removeItem(this.getKey(key));
    }

    async keys(): Promise<string[]> {
        const result: string[] = [];
        for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (key?.startsWith(this.prefix)) {
                result.push(key.substring(this.prefix.length + 1));
            }
        }
        return result;
    }

    destroy(): void {
        const keysToRemove: string[] = [];
        for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (key?.startsWith(this.prefix)) {
                keysToRemove.push(key);
            }
        }
        keysToRemove.forEach(key => localStorage.removeItem(key));
    }
}

/**
 * Simple Store implementation
 */
class FridaySimpleStore<T> implements SimpleStore<T> {
    private db: SimpleKeyValueDB;

    constructor(name: string) {
        this.db = new SimpleKeyValueDB(`friday-store-${name}`);
    }

    async get(key: string): Promise<T | undefined> {
        return this.db.get<T>(key);
    }

    async set(key: string, value: T): Promise<void> {
        return this.db.set(key, value);
    }

    async delete(key: string): Promise<void> {
        return this.db.delete(key);
    }

    async keys(from?: string, to?: string): Promise<string[]> {
        const allKeys = await this.db.keys();
        if (!from && !to) return allKeys;
        return allKeys.filter(k => {
            if (from && k < from) return false;
            if (to && k >= to) return false;
            return true;
        });
    }

    close(): void {
        // No-op for localStorage-based store
    }
}

/**
 * FridaySyncCore - Main sync core implementation
 */
export class FridaySyncCore implements LiveSyncLocalDBEnv, LiveSyncCouchDBReplicatorEnv {
    private plugin: Plugin;
    private _settings: ObsidianLiveSyncSettings;
    private _localDatabase: LiveSyncLocalDB | null = null;
    private _replicator: LiveSyncCouchDBReplicator | null = null;
    private _managers: LiveSyncManagers | null = null;
    private _services: FridayServiceHub;
    private _kvDB: KeyValueDatabase;
    private _simpleStore: SimpleStore<any>;
    
    // Status tracking
    private statusCallback: SyncStatusCallback | null = null;
    private _status: SyncStatus = "NOT_CONNECTED";
    
    // Reactive counters for status display (same as livesync)
    replicationStat: ReactiveSource<ReplicationStat> = reactiveSource({
        sent: 0,
        arrived: 0,
        maxPullSeq: 0,
        maxPushSeq: 0,
        lastSyncPullSeq: 0,
        lastSyncPushSeq: 0,
        syncStatus: "NOT_CONNECTED" as DatabaseConnectingStatus,
    });
    
    // Additional reactive counters for status display
    requestCount: ReactiveSource<number> = reactiveSource(0);
    responseCount: ReactiveSource<number> = reactiveSource(0);
    totalQueued: ReactiveSource<number> = reactiveSource(0);
    batched: ReactiveSource<number> = reactiveSource(0);
    processing: ReactiveSource<number> = reactiveSource(0);
    databaseQueueCount: ReactiveSource<number> = reactiveSource(0);
    storageApplyingCount: ReactiveSource<number> = reactiveSource(0);
    replicationResultCount: ReactiveSource<number> = reactiveSource(0);
    conflictProcessQueueCount: ReactiveSource<number> = reactiveSource(0);
    pendingFileEventCount: ReactiveSource<number> = reactiveSource(0);
    processingFileEventCount: ReactiveSource<number> = reactiveSource(0);
    _totalProcessingCount: ReactiveSource<number> = reactiveSource(0);
    
    // Log callback for status display integration
    private _logCallback?: (message: string, level: number, key?: string) => void;
    
    // Storage event manager for watching file changes
    private _storageEventManager: FridayStorageEventManager | null = null;

    constructor(plugin: Plugin) {
        this.plugin = plugin;
        this._settings = { ...DEFAULT_SETTINGS };
        this._services = new FridayServiceHub(this);
        this._kvDB = new SimpleKeyValueDB("friday-kv");
        this._simpleStore = new FridaySimpleStore("checkpoint");
        
        // Set up global logging that also notifies status display
        // This matches livesync's pattern: all logs go to status display
        setGlobalLogFunction((message: any, level?: number, key?: string) => {
            const msgStr = String(message);
            const logLevel = level ?? LOG_LEVEL_INFO;
            
            // Console logging
            if (logLevel >= LOG_LEVEL_INFO) {
                console.log(`[Friday Sync] ${msgStr}`);
            } else {
                console.debug(`[Friday Sync] ${msgStr}`);
            }
            
            // Notify status display callback
            // All logs are displayed in logMessage area
            // Only LOG_LEVEL_NOTICE shows Notice popup
            if (this._logCallback) {
                this._logCallback(msgStr, logLevel, key);
            }
        });
    }
    
    /**
     * Set log callback for status display integration
     * This allows SyncStatusDisplay to receive log messages
     * @param callback - Function that receives (message, level, key)
     */
    setLogCallback(callback: (message: string, level: number, key?: string) => void) {
        this._logCallback = callback;
    }

    // ==================== LiveSyncLocalDBEnv Implementation ====================
    
    getSettings(): RemoteDBSettings {
        return this._settings;
    }

    get managers(): LiveSyncManagers {
        if (!this._managers) {
            throw new Error("Managers not initialized");
        }
        return this._managers;
    }

    get services(): FridayServiceHub {
        return this._services;
    }

    // ==================== LiveSyncReplicatorEnv Implementation ====================

    getDatabase(): PouchDB.Database<EntryDoc> {
        if (!this._localDatabase?.localDatabase) {
            throw new Error("Local database not initialized");
        }
        return this._localDatabase.localDatabase;
    }

    get kvDB(): KeyValueDatabase {
        return this._kvDB;
    }

    get simpleStore(): SimpleStore<any> {
        return this._simpleStore;
    }

    // ==================== Public API ====================

    get status(): SyncStatus {
        return this._status;
    }

    get localDatabase(): LiveSyncLocalDB | null {
        return this._localDatabase;
    }

    get replicator(): LiveSyncCouchDBReplicator | null {
        return this._replicator;
    }

    onStatusChange(callback: SyncStatusCallback) {
        this.statusCallback = callback;
    }

    private setStatus(status: SyncStatus, message?: string) {
        this._status = status;
        this.replicationStat.value = {
            ...this.replicationStat.value,
            syncStatus: status as DatabaseConnectingStatus,
        };
        if (this.statusCallback) {
            this.statusCallback(status, message);
        }
    }

    /**
     * Set up monitoring for replication status changes
     * Note: Uses VERBOSE level to avoid cluttering user-visible logs
     * These messages are for debugging/console only
     */
    private _lastLoggedStatus: string = "";
    private setupStatusMonitoring() {
        // Monitor replicationStat changes by polling
        // This helps debug LiveSync status issues (verbose level - console only)
        setInterval(() => {
            const currentStatus = this.replicationStat.value.syncStatus;
            if (currentStatus !== this._lastLoggedStatus) {
                // Use VERBOSE level - only shows in console, not in UI
                Logger(`[Status Change] ${this._lastLoggedStatus || 'initial'} -> ${currentStatus}`, LOG_LEVEL_VERBOSE);
                this._lastLoggedStatus = currentStatus;
                
                // Log detailed info on status changes (verbose level)
                const stat = this.replicationStat.value;
                Logger(`  Docs: sent=${stat.sent}, arrived=${stat.arrived}`, LOG_LEVEL_VERBOSE);
                Logger(`  Seq: pull=${stat.lastSyncPullSeq}/${stat.maxPullSeq}, push=${stat.lastSyncPushSeq}/${stat.maxPushSeq}`, LOG_LEVEL_VERBOSE);
            }
        }, 2000); // Check every 2 seconds
    }

    /**
     * Initialize the sync core with configuration
     */
    async initialize(config: SyncConfig): Promise<boolean> {
        try {
            // Update settings from config
            this._settings = {
                ...DEFAULT_SETTINGS,
                couchDB_URI: config.couchDB_URI,
                couchDB_USER: config.couchDB_USER,
                couchDB_PASSWORD: config.couchDB_PASSWORD,
                couchDB_DBNAME: config.couchDB_DBNAME,
                encrypt: config.encrypt,
                passphrase: config.passphrase,
                usePathObfuscation: config.usePathObfuscation,
                liveSync: config.liveSync,
                syncOnStart: config.syncOnStart,
                syncOnSave: config.syncOnSave,
                remoteType: REMOTE_COUCHDB,
                isConfigured: true,
            };

            // Initialize managers
            const getDB = () => this._localDatabase!.localDatabase;
            const getSettings = () => this._settings;
            
            this._managers = new LiveSyncManagers({
                get database() {
                    return getDB();
                },
                getActiveReplicator: () => this._replicator!,
                id2path: this.id2path.bind(this),
                path2id: this.path2id.bind(this),
                get settings() {
                    return getSettings();
                },
            });

            // CRITICAL: Register database initialization handler BEFORE creating database
            // This handler sets up encryption for the local database (matching livesync's pattern)
            // The getPBKDF2Salt function is passed as a callback and called when encryption is needed
            console.log("[Friday Sync] Registering database initialization handler for encryption...");
            this._services.databaseEvents.handleOnDatabaseInitialisation(async (db: LiveSyncLocalDB) => {
                console.log("[Friday Sync] onDatabaseInitialisation event triggered!");
                console.log("[Friday Sync] db.localDatabase exists:", !!db.localDatabase);
                console.log("[Friday Sync] db.localDatabase.transform exists:", typeof (db.localDatabase as any).transform);
                
                // Set up compression filter
                replicationFilter(db.localDatabase, false);
                
                // Reset encryption state first
                disableEncryption();
                
                // Check if encryption should be enabled
                console.log("[Friday Sync] Settings - encrypt:", this._settings.encrypt);
                console.log("[Friday Sync] Settings - passphrase exists:", !!this._settings.passphrase);
                
                // Enable encryption if passphrase is configured
                if (this._settings.passphrase && this._settings.encrypt) {
                    console.log("[Friday Sync] Enabling encryption for local database...");
                    
                    // Get E2EE algorithm from settings
                    const e2eeAlgorithm = this._settings.E2EEAlgorithm || E2EEAlgorithms.V2;
                    console.log("[Friday Sync] E2EE algorithm:", e2eeAlgorithm);
                    
                    enableEncryption(
                        db.localDatabase,
                        this._settings.passphrase,
                        false, // useDynamicIterationCount
                        false, // migrationDecrypt
                        async () => {
                            // This callback is called when PBKDF2 salt is needed
                            // The replicator must be initialized first (happens after db init)
                            console.log("[Friday Sync] getPBKDF2Salt callback invoked!");
                            if (!this._replicator) {
                                console.log("[Friday Sync] Warning: Replicator not ready, creating temporary for salt retrieval");
                                // Create a temporary replicator just for salt retrieval
                                const tempReplicator = new LiveSyncCouchDBReplicator(this);
                                const salt = await tempReplicator.getReplicationPBKDF2Salt(this._settings);
                                console.log("[Friday Sync] Salt retrieved via temp replicator, length:", salt.length);
                                return salt;
                            }
                            const salt = await this._replicator.getReplicationPBKDF2Salt(this._settings);
                            console.log("[Friday Sync] Salt retrieved via replicator, length:", salt.length);
                            return salt;
                        },
                        e2eeAlgorithm
                    );
                    console.log("[Friday Sync] Local database encryption setup complete");
                } else {
                    console.log("[Friday Sync] No passphrase configured or encryption disabled - skipping encryption");
                }
                
                return true;
            });
            console.log("[Friday Sync] Database initialization handler registered");

            // Initialize local database
            const vaultName = this.getVaultName();
            this._localDatabase = new LiveSyncLocalDB(vaultName, this);
            
            const dbInitialized = await this._localDatabase.initializeDatabase();
            if (!dbInitialized) {
                this.setStatus("ERRORED", "Failed to initialize local database");
                return false;
            }
            
            // Initialize replicator first (needed for salt retrieval)
            // Note: Encryption will be set up when startSync is called
            this._replicator = new LiveSyncCouchDBReplicator(this);
            
            // Initialize storage event manager for watching file changes
            this._storageEventManager = new FridayStorageEventManager(this.plugin, this);

            // Set up status monitoring for debugging
            this.setupStatusMonitoring();

            this.setStatus("NOT_CONNECTED", "Sync initialized");
            Logger("Sync core initialized", LOG_LEVEL_INFO);
            return true;
        } catch (error) {
            console.error("Sync initialization failed:", error);
            this.setStatus("ERRORED", `Initialization failed: ${error}`);
            return false;
        }
    }

    /**
     * Start synchronization
     * 
     * @param continuous - If true (default), starts LiveSync mode (continuous replication)
     *                     If false, performs a one-shot sync
     * 
     * Note: Following livesync's pattern, continuous sync uses showResult=false
     * to avoid spamming users with Notice popups. Status is shown in the 
     * top-right corner display instead.
     */
    async startSync(continuous: boolean = true): Promise<boolean> {
        if (!this._replicator) {
            this.setStatus("ERRORED", "Replicator not initialized");
            return false;
        }

        try {
            this.setStatus("STARTED", "Starting synchronization...");
            
            // Open replication - default is LiveSync (continuous) mode
            // IMPORTANT: Use showResult=false for continuous mode (matching livesync)
            // This prevents Notice spam - status updates are shown in the UI instead
            // Only manual operations (pull/push/fetch) use showResult=true
            await this._replicator.openReplication(
                this._settings,
                continuous,  // keepAlive for live sync (default: true)
                false,       // showResult: false for LiveSync (matches livesync)
                false        // ignoreCleanLock
            );
            
            // Start watching for local file changes (for upload to server)
            // This enables bidirectional sync: server->local and local->server
            if (this._storageEventManager) {
                this._storageEventManager.beginWatch();
                Logger("File watcher started - local changes will sync to server", LOG_LEVEL_INFO);
            }
            
            // Status will be updated by replicator via updateInfo
            return true;
        } catch (error) {
            console.error("Sync failed:", error);
            Logger(`Sync failed: ${error}`, LOG_LEVEL_NOTICE);
            this.setStatus("ERRORED", `Sync failed: ${error}`);
            return false;
        }
    }

    /**
     * Pull all documents from server (one-shot)
     */
    async pullFromServer(): Promise<boolean> {
        if (!this._replicator) {
            this.setStatus("ERRORED", "Replicator not initialized");
            return false;
        }

        try {
            this.setStatus("STARTED", "Pulling from server...");
            Logger("Pulling from server...", LOG_LEVEL_NOTICE);
            
            const result = await this._replicator.replicateAllFromServer(this._settings, true);
            
            if (result) {
                this.setStatus("COMPLETED", "Pull completed");
                Logger("Pull completed", LOG_LEVEL_NOTICE);
            } else {
                this.setStatus("ERRORED", "Pull failed");
                Logger("Pull failed", LOG_LEVEL_NOTICE);
            }
            
            return result;
        } catch (error) {
            console.error("Pull failed:", error);
            this.setStatus("ERRORED", `Pull failed: ${error}`);
            Logger(`Sync error: ${error}`, LOG_LEVEL_NOTICE);
            return false;
        }
    }

    /**
     * Push all documents to server (one-shot)
     */
    async pushToServer(): Promise<boolean> {
        if (!this._replicator) {
            this.setStatus("ERRORED", "Replicator not initialized");
            return false;
        }

        try {
            this.setStatus("STARTED", "Pushing to server...");
            Logger("Pushing to server...", LOG_LEVEL_NOTICE);
            
            const result = await this._replicator.replicateAllToServer(this._settings, true);
            
            if (result) {
                this.setStatus("COMPLETED", "Push completed");
                Logger("Push completed", LOG_LEVEL_NOTICE);
            } else {
                this.setStatus("ERRORED", "Push failed");
                Logger("Push failed", LOG_LEVEL_NOTICE);
            }
            
            return result;
        } catch (error) {
            console.error("Push failed:", error);
            this.setStatus("ERRORED", `Push failed: ${error}`);
            Logger(`Sync error: ${error}`, LOG_LEVEL_NOTICE);
            return false;
        }
    }

    /**
     * Fetch from server for first-time sync
     * 
     * This method is used when connecting a new device to an existing database.
     * It marks the device as resolved (accepted) and then pulls all data from server.
     */
    async fetchFromServer(): Promise<boolean> {
        if (!this._replicator) {
            this.setStatus("ERRORED", "Replicator not initialized");
            return false;
        }

        try {
            this.setStatus("STARTED", "Fetching from server (first-time sync)...");
            Logger("Fetching from server (this may take a while)...", LOG_LEVEL_NOTICE);
            
            // Step 1: Mark this device as resolved/accepted
            Logger("Marking remote as resolved...", LOG_LEVEL_INFO);
            await this._replicator.markRemoteResolved(this._settings);
            
            // Step 2: Pull all data from server
            Logger("Pulling all data from server...", LOG_LEVEL_INFO);
            const result = await this._replicator.replicateAllFromServer(this._settings, true);
            
            if (result) {
                // Step 3: Rebuild vault from local database
                Logger("Rebuilding vault from local database...", LOG_LEVEL_INFO);
                Logger("Writing files to vault...", LOG_LEVEL_NOTICE);
                await this.rebuildVaultFromDB();
                
                this.setStatus("COMPLETED", "Fetch completed");
                Logger("Fetch completed successfully!", LOG_LEVEL_NOTICE);
            } else {
                this.setStatus("ERRORED", "Fetch failed");
                Logger("Fetch failed", LOG_LEVEL_NOTICE);
            }
            
            return result;
        } catch (error) {
            console.error("Fetch failed:", error);
            this.setStatus("ERRORED", `Fetch failed: ${error}`);
            Logger(`Sync error: ${error}`, LOG_LEVEL_NOTICE);
            return false;
        }
    }

    /**
     * Rebuild remote database from local files
     * 
     * This method is used for first-time sync from a device that has local files.
     * It will:
     * 1. Scan all local vault files and store them in local PouchDB
     * 2. Reset the remote database
     * 3. Push all local data to the remote server
     * 
     * WARNING: This will overwrite the remote database!
     * Other devices will need to fetch from server after this operation.
     * 
     * Based on livesync's ModuleRebuilder.rebuildRemote()
     */
    async rebuildRemote(): Promise<boolean> {
        if (!this._replicator || !this._localDatabase) {
            this.setStatus("ERRORED", "Sync not initialized");
            return false;
        }

        try {
            this.setStatus("STARTED", "Rebuilding remote database from local files...");
            Logger("Rebuilding remote database from local files...", LOG_LEVEL_NOTICE);
            
            // Step 1: Scan local vault and store all files to local database
            Logger("Step 1: Scanning local vault and storing to database...", LOG_LEVEL_INFO);
            const scanResult = await this.scanAndStoreVaultToDB();
            if (!scanResult) {
                Logger("Failed to scan and store vault files", LOG_LEVEL_NOTICE);
                this.setStatus("ERRORED", "Failed to scan vault files");
                return false;
            }
            
            // Step 2: Reset remote database
            Logger("Step 2: Resetting remote database...", LOG_LEVEL_INFO);
            Logger("Resetting remote database...", LOG_LEVEL_NOTICE);
            try {
                await this._replicator.tryResetRemoteDatabase(this._settings);
            } catch (error) {
                console.log("Reset remote database error (may be expected if DB doesn't exist):", error);
            }
            
            // Step 3: Create remote database (in case it was destroyed)
            Logger("Step 3: Creating remote database...", LOG_LEVEL_INFO);
            try {
                await this._replicator.tryCreateRemoteDatabase(this._settings);
            } catch (error) {
                console.log("Create remote database error:", error);
            }
            
            // Small delay to ensure database is ready
            await new Promise(resolve => setTimeout(resolve, 1000));
            
            // Step 4: Push all local data to remote (first pass)
            Logger("Step 4: Pushing all data to remote server...", LOG_LEVEL_INFO);
            Logger("Pushing all data to server (this may take a while)...", LOG_LEVEL_NOTICE);
            let result = await this._replicator.replicateAllToServer(this._settings, true);
            
            if (!result) {
                Logger("First push attempt failed, retrying...", LOG_LEVEL_INFO);
            }
            
            // Small delay
            await new Promise(resolve => setTimeout(resolve, 1000));
            
            // Step 5: Push again to ensure all data is synced (livesync does this twice)
            Logger("Step 5: Final push to ensure all data is synced...", LOG_LEVEL_INFO);
            result = await this._replicator.replicateAllToServer(this._settings, true);
            
            if (result) {
                this.setStatus("COMPLETED", "Remote database rebuilt successfully");
                Logger("Remote database rebuilt successfully!", LOG_LEVEL_NOTICE);
                Logger("Other devices should now use 'Fetch from Server' to sync", LOG_LEVEL_INFO);
            } else {
                this.setStatus("ERRORED", "Rebuild remote failed");
                Logger("Rebuild remote failed", LOG_LEVEL_NOTICE);
            }
            
            return result;
        } catch (error) {
            console.error("Rebuild remote failed:", error);
            this.setStatus("ERRORED", `Rebuild remote failed: ${error}`);
            Logger(`Rebuild remote error: ${error}`, LOG_LEVEL_NOTICE);
            return false;
        }
    }

    /**
     * Scan all vault files and store them to local PouchDB database
     * 
     * This prepares local database for pushing to remote.
     */
    private async scanAndStoreVaultToDB(): Promise<boolean> {
        if (!this._localDatabase || !this._storageEventManager) {
            return false;
        }

        try {
            const vault = this.plugin.app.vault;
            const files = vault.getFiles();
            
            Logger(`Found ${files.length} files in vault`, LOG_LEVEL_INFO);
            
            let stored = 0;
            let skipped = 0;
            let errors = 0;
            
            for (const file of files) {
                try {
                    // Skip hidden files and plugin config
                    if (file.path.startsWith(".")) {
                        skipped++;
                        continue;
                    }
                    
                    // Use storage event manager to store file (handles encryption, chunking, etc.)
                    // Create a fake "CHANGED" event to trigger storage
                    const result = await this._storageEventManager.processFileEventDirect({
                        type: "CHANGED",
                        path: file.path as FilePath,
                        file: file,
                    });
                    
                    if (result) {
                        stored++;
                        if (stored % 50 === 0) {
                            Logger(`Stored ${stored}/${files.length} files...`, LOG_LEVEL_INFO);
                        }
                    } else {
                        errors++;
                    }
                } catch (error) {
                    console.error(`Error storing file ${file.path}:`, error);
                    errors++;
                }
            }
            
            Logger(`Vault scan complete: ${stored} stored, ${skipped} skipped, ${errors} errors`, LOG_LEVEL_INFO);
            Logger(`Stored ${stored} files to local database`, LOG_LEVEL_NOTICE);
            
            return errors === 0 || stored > 0;
        } catch (error) {
            console.error("Vault scan failed:", error);
            return false;
        }
    }
    
    /**
     * Rebuild vault from local PouchDB database
     * 
     * This reads all documents from the local database and writes them to the vault.
     * Useful when the database is synced but files haven't been written to disk.
     */
    async rebuildVaultFromDB(): Promise<boolean> {
        if (!this._localDatabase) {
            Logger("Local database not initialized", LOG_LEVEL_NOTICE);
            return false;
        }
        
        try {
            const vault = this.plugin.app.vault;
            const localDB = this._localDatabase.localDatabase;
            
            // Get all documents
            Logger("Scanning local database for files...", LOG_LEVEL_INFO);
            const allDocs = await localDB.allDocs({
                include_docs: true,
                attachments: false,
            });
            
            let processed = 0;
            let created = 0;
            let updated = 0;
            let errors = 0;
            
            for (const row of allDocs.rows) {
                const doc = row.doc;
                if (!doc) continue;
                
                // Skip non-file documents
                if (doc._id.startsWith("h:")) continue; // chunk
                if (doc._id.startsWith("_")) continue; // internal
                if ((doc as any).type === "versioninfo") continue;
                if ((doc as any).type === "milestoneinfo") continue;
                if ((doc as any).type === "nodeinfo") continue;
                if ((doc as any).type === "leaf") continue;
                
                // Only process note/plain documents
                const docType = (doc as any).type;
                if (docType !== "notes" && docType !== "newnote" && docType !== "plain") continue;
                
                const path = (doc as any).path;
                if (!path) continue;
                
                // Check if deleted
                const isDeleted = doc._deleted === true || (doc as any).deleted === true;
                if (isDeleted) continue;
                
                processed++;
                
                try {
                    // Get full document with data
                    const fullEntry = await this._localDatabase.getDBEntryFromMeta(doc as any, false, true);
                    if (!fullEntry) {
                        Logger(`Could not get full entry for: ${path}`, LOG_LEVEL_VERBOSE);
                        continue;
                    }
                    
                    // Get content using readContent (same as livesync)
                    // This correctly handles:
                    // - Text documents: joins string[] chunks into a single string
                    // - Binary documents: decodes base64 data to ArrayBuffer
                    const content = readContent(fullEntry);
                    
                    // Ensure parent directories exist
                    const dirPath = path.substring(0, path.lastIndexOf("/"));
                    if (dirPath) {
                        const existingDir = vault.getAbstractFileByPath(dirPath);
                        if (!existingDir) {
                            try {
                                await vault.createFolder(dirPath);
                            } catch (e) {
                                // Folder might already exist
                            }
                        }
                    }
                    
                    // Write file
                    // Use isTextDocument to determine if content is text or binary (same as livesync)
                    const isText = isTextDocument(fullEntry);
                    const existingFile = vault.getAbstractFileByPath(path);
                    if (existingFile) {
                        if (isText) {
                            await vault.modify(existingFile as any, content as string);
                        } else {
                            await vault.modifyBinary(existingFile as any, content as ArrayBuffer);
                        }
                        updated++;
                    } else {
                        if (isText) {
                            await vault.create(path, content as string);
                        } else {
                            await vault.createBinary(path, content as ArrayBuffer);
                        }
                        created++;
                    }
                    
                    if (processed % 50 === 0) {
                        Logger(`Progress: ${processed} files processed (${created} created, ${updated} updated)`, LOG_LEVEL_INFO);
                    }
                } catch (error) {
                    errors++;
                    Logger(`Error writing file ${path}: ${error}`, LOG_LEVEL_VERBOSE);
                }
            }
            
            Logger(`Rebuild complete: ${processed} files processed, ${created} created, ${updated} updated, ${errors} errors`, LOG_LEVEL_NOTICE);
            
            return true;
        } catch (error) {
            Logger(`Rebuild failed: ${error}`, LOG_LEVEL_NOTICE);
            return false;
        }
    }

    /**
     * Stop synchronization
     */
    async stopSync(): Promise<void> {
        // Stop watching for file changes
        if (this._storageEventManager) {
            this._storageEventManager.stopWatch();
        }
        
        if (this._replicator) {
            this._replicator.closeReplication();
        }
        this.setStatus("CLOSED", "Sync stopped");
    }

    /**
     * Close and clean up
     */
    async close(): Promise<void> {
        await this.stopSync();
        if (this._localDatabase) {
            await this._localDatabase.close();
        }
    }
    
    /**
     * Get the storage event manager (for external access if needed)
     */
    get storageEventManager(): FridayStorageEventManager | null {
        return this._storageEventManager;
    }

    // ==================== Helper Methods ====================

    private getVaultName(): string {
        // @ts-ignore - accessing internal Obsidian API
        return this.plugin.app.vault.getName() || "friday-vault";
    }

    /**
     * Convert document ID to file path
     */
    /**
     * Convert document ID to file path
     * This uses id2path_base from livesync's path utilities to ensure consistency
     */
    id2path(id: DocumentID, entry?: EntryHasPath, stripPrefix?: boolean): FilePathWithPrefix {
        return id2path_base(id, entry);
    }

    /**
     * Convert file path to document ID
     * This uses path2id_base from livesync's path utilities to ensure consistency
     * 
     * CRITICAL: The document ID format must match livesync's format exactly:
     * - If usePathObfuscation is false: ID = file path (e.g., "未命名.md")
     * - If usePathObfuscation is true: ID = "f:" + hash (e.g., "f:abc123...")
     */
    async path2id(filename: FilePathWithPrefix | FilePath, prefix?: string): Promise<DocumentID> {
        // Use path2id_base to match livesync's exact behavior
        // obfuscatePassphrase: if usePathObfuscation is enabled, use passphrase; otherwise false
        const obfuscatePassphrase = this._settings.usePathObfuscation 
            ? this._settings.passphrase 
            : false;
        
        // caseInsensitive: false by default (matching livesync's default)
        const caseInsensitive = false;
        
        const baseId = await path2id_base(filename, obfuscatePassphrase, caseInsensitive);
        
        // If a prefix is explicitly provided, add it (used for internal files like "i:")
        if (prefix) {
            return `${prefix}${baseId}` as DocumentID;
        }
        
        return baseId;
    }

    /**
     * Test connection to CouchDB
     */
    async testConnection(): Promise<{ success: boolean; message: string }> {
        try {
            const uri = this._settings.couchDB_URI.replace(/\/$/, "");
            const dbUrl = `${uri}/${this._settings.couchDB_DBNAME}`;
            
            const credentials = btoa(`${this._settings.couchDB_USER}:${this._settings.couchDB_PASSWORD}`);
            
            const response = await fetch(dbUrl, {
                method: "GET",
                headers: {
                    "Authorization": `Basic ${credentials}`,
                    "Content-Type": "application/json",
                },
            });

            if (response.ok) {
                const data = await response.json();
                return { 
                    success: true, 
                    message: `Connected to ${data.db_name}, docs: ${data.doc_count}` 
                };
            } else if (response.status === 404) {
                return { success: false, message: "Database not found. Please create it first." };
            } else {
                return { success: false, message: `Connection failed: ${response.statusText}` };
            }
        } catch (error) {
            return { success: false, message: `Connection error: ${error}` };
        }
    }
}

