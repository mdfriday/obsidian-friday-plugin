/**
 * FridaySyncCore - Core sync implementation for Friday plugin
 * 
 * This class implements the necessary interfaces from livesync's core library
 * to enable full CouchDB synchronization functionality.
 */

import {Plugin} from "obsidian";
import {reactiveSource, type ReactiveSource} from "octagonal-wheels/dataobject/reactive";

// Import core types
import {
	type DatabaseConnectingStatus,
	DEFAULT_SETTINGS,
	type DocumentID,
	E2EEAlgorithms,
	type EntryDoc,
	type EntryHasPath,
	type FilePath,
	type FilePathWithPrefix,
	LOG_LEVEL_INFO,
	LOG_LEVEL_NOTICE,
	LOG_LEVEL_VERBOSE,
	type ObsidianLiveSyncSettings,
	REMOTE_COUCHDB,
	type RemoteDBSettings,
} from "./core/common/types";

// Import core components
import {LiveSyncLocalDB, type LiveSyncLocalDBEnv} from "./core/pouchdb/LiveSyncLocalDB";
import {
	LiveSyncCouchDBReplicator,
	type LiveSyncCouchDBReplicatorEnv
} from "./core/replication/couchdb/LiveSyncReplicator";
import {type ReplicationStat} from "./core/replication/LiveSyncAbstractReplicator";
import {LiveSyncManagers} from "./core/managers/LiveSyncManagers";
import {type KeyValueDatabase} from "./core/interfaces/KeyValueDatabase";
import {type SimpleStore} from "octagonal-wheels/databases/SimpleStoreBase";
import {Logger, setGlobalLogFunction} from "./core/common/logger";
import {isTextDocument, readContent} from "./core/common/utils";

// Import services
import {FridayServiceHub} from "./FridayServiceHub";
import type {SyncConfig, SyncStatus, SyncStatusCallback} from "./SyncService";
import {FridayStorageEventManager} from "./FridayStorageEventManager";

// Import HiddenFileSync module
import {FridayHiddenFileSync} from "./features/HiddenFileSync";
import {DEFAULT_INTERNAL_IGNORE_PATTERNS} from "./types";

// Import hidden file utilities
import {isInternalMetadata} from "./utils/hiddenFileUtils";

// PouchDB imports - use the configured PouchDB with all plugins (including transform-pouch)
import {PouchDB} from "./core/pouchdb/pouchdb-browser";

// Import encryption utilities for local database
import {disableEncryption, enableEncryption} from "./core/pouchdb/encryption";
import {replicationFilter} from "./core/pouchdb/compress";

// Import path utilities for correct document ID generation
import {id2path_base, path2id_base, isAccepted} from "./core/string_and_binary/path";

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
    
    // Hidden file sync module for .obsidian synchronization
    private _hiddenFileSync: FridayHiddenFileSync | null = null;
    
    // Ignore patterns configuration (directly from settings, no file needed)
    private _ignorePatterns: string[] = [];
    
    // Selective sync settings (for file type filtering)
    private _selectiveSync: {
        syncImages: boolean;
        syncAudio: boolean;
        syncVideo: boolean;
        syncPdf: boolean;
    } = {
        syncImages: true,
        syncAudio: false,
        syncVideo: false,
        syncPdf: false,
    };
    
    // File extension mappings for selective sync
    private static readonly IMAGE_EXTENSIONS = ['bmp', 'png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'avif'];
    private static readonly AUDIO_EXTENSIONS = ['mp3', 'wav', 'm4a', '3gp', 'flac', 'ogg', 'oga', 'opus'];
    private static readonly VIDEO_EXTENSIONS = ['mp4', 'webm', 'ogv', 'mov', 'mkv'];
    private static readonly PDF_EXTENSIONS = ['pdf'];

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

    get hiddenFileSync(): FridayHiddenFileSync | null {
        return this._hiddenFileSync;
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
            // Store ignore patterns directly in memory (no file needed)
            this._ignorePatterns = config.ignorePatterns || [];
            
            // Store selective sync settings for file type filtering
            if (config.selectiveSync) {
                this._selectiveSync = {
                    syncImages: config.selectiveSync.syncImages ?? true,
                    syncAudio: config.selectiveSync.syncAudio ?? false,
                    syncVideo: config.selectiveSync.syncVideo ?? false,
                    syncPdf: config.selectiveSync.syncPdf ?? false,
                };
            }
            
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
                // Livesync ignore file settings (disabled - we use in-memory patterns)
                useIgnoreFiles: false,
                ignoreFiles: "",
                // Hidden file sync settings (default: enabled with best practices)
                syncInternalFiles: config.syncInternalFiles ?? true,
                syncInternalFilesBeforeReplication: config.syncInternalFilesBeforeReplication ?? true,
                syncInternalFilesInterval: config.syncInternalFilesInterval ?? 60,
                syncInternalFilesIgnorePatterns: config.syncInternalFilesIgnorePatterns ?? DEFAULT_INTERNAL_IGNORE_PATTERNS,
                syncInternalFilesTargetPatterns: config.syncInternalFilesTargetPatterns ?? "",
                watchInternalFileChanges: config.watchInternalFileChanges ?? true,
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
            this._services.databaseEvents.handleOnDatabaseInitialisation(async (db: LiveSyncLocalDB) => {
                // Set up compression filter
                replicationFilter(db.localDatabase, false);
                
                // Reset encryption state first
                disableEncryption();

                // Enable encryption if passphrase is configured
                if (this._settings.passphrase && this._settings.encrypt) {
                    // Get E2EE algorithm from settings
                    const e2eeAlgorithm = this._settings.E2EEAlgorithm || E2EEAlgorithms.V2;

                    enableEncryption(
                        db.localDatabase,
                        this._settings.passphrase,
                        false, // useDynamicIterationCount
                        false, // migrationDecrypt
                        async () => {
                            // This callback is called when PBKDF2 salt is needed
                            // The replicator must be initialized first (happens after db init)
                            if (!this._replicator) {
                                // Create a temporary replicator just for salt retrieval
                                const tempReplicator = new LiveSyncCouchDBReplicator(this);
								return await tempReplicator.getReplicationPBKDF2Salt(this._settings);
                            }
							return await this._replicator.getReplicationPBKDF2Salt(this._settings);
                        },
                        e2eeAlgorithm
                    );
                } else {
                    console.warn("[Friday Sync] No passphrase configured or encryption disabled - skipping encryption");
                }
                
                return true;
            });

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
            
            // Initialize hidden file sync module (for .obsidian synchronization)
            // Default: enabled with Obsidian official sync best practices
            if (this._settings.syncInternalFiles !== false) {
                this._hiddenFileSync = new FridayHiddenFileSync(this.plugin, this);
                await this._hiddenFileSync.onload();
                Logger("Hidden file sync module initialized", LOG_LEVEL_INFO);
            }

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
     * Check if the remote database has been reset/rebuilt
     * 
     * This happens when:
     * - The main vault resets the remote database
     * - The remote database was corrupted and rebuilt
     * - Chunk cleanup was performed on the remote
     * 
     * When detected, the user should use "Fetch from Server" to re-sync.
     * 
     * @returns true if database reset was detected
     */
    isRemoteDatabaseReset(): boolean {
        if (!this._replicator) return false;
        return this._replicator.remoteLockedAndDeviceNotAccepted;
    }
    
    /**
     * Check if there are any sync issues that need user attention
     * 
     * @returns object with status flags and message
     */
    getSyncIssues(): { hasIssues: boolean; message: string; needsFetch: boolean } {
        if (!this._replicator) {
            return { hasIssues: false, message: "", needsFetch: false };
        }
        
        if (this._replicator.remoteLockedAndDeviceNotAccepted) {
            return {
                hasIssues: true,
                needsFetch: true,
                message: "Remote database has been reset. Use 'Fetch from Server' to re-sync."
            };
        }
        
        if (this._replicator.tweakSettingsMismatched) {
            return {
                hasIssues: true,
                needsFetch: false,
                message: "Configuration mismatch detected between devices."
            };
        }
        
        return { hasIssues: false, message: "", needsFetch: false };
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
     * 
     * IMPORTANT: File watcher is started AFTER a delay to avoid capturing
     * Obsidian's startup events as file changes.
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
            
            // Check for database reset after connection attempt
            const issues = this.getSyncIssues();
            if (issues.needsFetch) {
                Logger(issues.message, LOG_LEVEL_NOTICE);
                this.setStatus("ERRORED", "Database reset detected");
                return false;
            }
            
            // Start watching for local file changes (for upload to server)
            // This enables bidirectional sync: server->local and local->server
            // IMPORTANT: Delay startup to avoid capturing Obsidian's startup events
            // This matches livesync's pattern of waiting for the system to settle
            if (this._storageEventManager) {
                // Wait a short time for:
                // 1. OneShot sync to complete (pullOnly happens first in LiveSync)
                // 2. Obsidian's startup file events to settle
                // 3. Any cached file modifications to be processed
                const WATCH_DELAY_MS = 1500;
                Logger(`File watcher will start in ${WATCH_DELAY_MS}ms...`, LOG_LEVEL_VERBOSE);
                
                setTimeout(() => {
                    if (this._storageEventManager) {
                        this._storageEventManager.beginWatch();
                        Logger("File watcher started - local changes will sync to server", LOG_LEVEL_INFO);
                    }
                }, WATCH_DELAY_MS);
            }
            
            // Status will be updated by replicator via updateInfo
            return true;
        } catch (error) {
            console.error("Sync failed:", error);
            Logger("Sync failed. Please check your connection.", LOG_LEVEL_NOTICE);
            Logger(error, LOG_LEVEL_VERBOSE);
            this.setStatus("ERRORED", "Sync failed");
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
            this.setStatus("ERRORED", "Pull failed");
            Logger("Pull failed. Please check your connection.", LOG_LEVEL_NOTICE);
            Logger(error, LOG_LEVEL_VERBOSE);
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
            this.setStatus("ERRORED", "Push failed");
            Logger("Push failed. Please check your connection.", LOG_LEVEL_NOTICE);
            Logger(error, LOG_LEVEL_VERBOSE);
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
            this.setStatus("ERRORED", "Fetch failed");
            Logger("Fetch failed. Please check your connection.", LOG_LEVEL_NOTICE);
            Logger(error, LOG_LEVEL_VERBOSE);
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
                console.error("Reset remote database error (may be expected if DB doesn't exist):", error);
            }
            
            // Step 3: Create remote database (in case it was destroyed)
            Logger("Step 3: Creating remote database...", LOG_LEVEL_INFO);
            try {
                await this._replicator.tryCreateRemoteDatabase(this._settings);
            } catch (error) {
                console.error("Create remote database error:", error);
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
            this.setStatus("ERRORED", "Rebuild remote failed");
            Logger("Rebuild remote failed. Please check your connection.", LOG_LEVEL_NOTICE);
            Logger(error, LOG_LEVEL_VERBOSE);
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
            let ignored = 0;
            let errors = 0;
            
            for (const file of files) {
                try {
                    // Skip hidden files and plugin config
                    if (file.path.startsWith(".")) {
                        skipped++;
                        continue;
                    }
                    
                    // Check if file is ignored by ignore patterns
                    if (!(await this.isTargetFile(file.path))) {
                        ignored++;
                        Logger(`File ignored by ignore patterns: ${file.path}`, LOG_LEVEL_VERBOSE);
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
            
            Logger(`Vault scan complete: ${stored} stored, ${skipped} skipped (hidden), ${ignored} ignored (patterns), ${errors} errors`, LOG_LEVEL_INFO);
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
            
            // Track internal files processed by HiddenFileSync
            let internalFilesProcessed = 0;
            let internalFilesErrors = 0;
            
            // Error aggregation: track missing chunks errors separately
            let missingChunksErrors = 0;
            const missingChunksFiles: string[] = [];
            
            for (const row of allDocs.rows) {
                const doc = row.doc;
                if (!doc) continue;
                
                // Skip non-file documents
                if (doc._id.startsWith("h:")) continue; // chunk
                if (doc._id.startsWith("_")) continue; // internal PouchDB docs
                if ((doc as any).type === "versioninfo") continue;
                if ((doc as any).type === "milestoneinfo") continue;
                if ((doc as any).type === "nodeinfo") continue;
                if ((doc as any).type === "leaf") continue;
                
                // Check if this is an internal file (i: prefix) - delegate to HiddenFileSync
                // This matches livesync's architecture where internal files are processed separately
                const docPath = (doc as any).path as string | undefined;
                const isInternalFile = isInternalMetadata(doc._id) || 
                    (docPath && isInternalMetadata(docPath));
                
                if (isInternalFile) {
                    // Delegate internal files to HiddenFileSync module
                    if (this._hiddenFileSync && this._hiddenFileSync.isThisModuleEnabled()) {
                        try {
                            const result = await this._hiddenFileSync.processReplicationResult(doc as any);
                            if (result) {
                                internalFilesProcessed++;
                            } else {
                                internalFilesErrors++;
                            }
                        } catch (ex) {
                            internalFilesErrors++;
                            console.error(`[Friday Sync] Error processing internal file:`, {
                                docId: doc._id,
                                path: docPath,
                                error: ex instanceof Error ? ex.message : String(ex),
                            });
                        }
                    }
                    // Skip normal file processing for internal files
                    continue;
                }
                
                // Only process note/plain documents for normal files
                const docType = (doc as any).type;
                if (docType !== "notes" && docType !== "newnote" && docType !== "plain") continue;
                
                const path = docPath;
                if (!path) continue;
                
                // Check if deleted
                const isDeleted = doc._deleted === true || (doc as any).deleted === true;
                if (isDeleted) continue;
                
                processed++;
                
                try {
                    // Get full document with data
                    const fullEntry = await this._localDatabase.getDBEntryFromMeta(doc as any, false, true);
                    if (!fullEntry) {
                        // Track as missing chunks error (most common cause)
                        missingChunksErrors++;
                        if (missingChunksFiles.length < 10) {
                            missingChunksFiles.push(path);
                        }
                        console.error(`[Friday Sync] Could not get full entry for:`, {
                            docId: doc._id,
                            path: path,
                            docType: (doc as any).type,
                            docSize: (doc as any).size,
                            docChildren: (doc as any).children?.length ?? 0,
                        });
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
                    
                    // Mark file as touched AFTER write (livesync pattern)
                    // This prevents the vault event from triggering another sync
                    const writtenFile = vault.getAbstractFileByPath(path);
                    if (writtenFile && this._storageEventManager && 'stat' in writtenFile) {
                        const stat = (writtenFile as any).stat;
                        this._storageEventManager.touch(path, stat.mtime, stat.size);
                    }
                    
                    if (processed % 50 === 0) {
                        Logger(`Progress: ${processed} files processed (${created} created, ${updated} updated)`, LOG_LEVEL_INFO);
                    }
                } catch (error) {
                    errors++;
                    // Log detailed error info to console for debugging
                    console.error(`[Friday Sync] Error writing file ${path}:`, {
                        error: error,
                        docId: doc._id,
                        docType: (doc as any).type,
                        docSize: (doc as any).size,
                        errorMessage: error instanceof Error ? error.message : String(error),
                        errorStack: error instanceof Error ? error.stack : undefined,
                    });
                    Logger(`Error writing file ${path}: ${error}`, LOG_LEVEL_VERBOSE);
                }
            }
            
            // Log summary with errors count
            const totalErrors = errors + internalFilesErrors + missingChunksErrors;
            
            // Aggregated error display: show one notice for missing chunks instead of many
            if (missingChunksErrors > 0) {
                const sampleFiles = missingChunksFiles.slice(0, 3).join(", ");
                const moreText = missingChunksErrors > 3 ? ` and ${missingChunksErrors - 3} more` : "";
                Logger(
                    `${missingChunksErrors} files could not be read (missing data). This usually happens after a database reset. Consider using "Fetch from Server" to re-sync. Examples: ${sampleFiles}${moreText}`,
                    LOG_LEVEL_NOTICE
                );
                console.log(`[Friday Sync] Missing chunks for ${missingChunksErrors} files:`, missingChunksFiles);
            }
            
            if (errors > 0) {
                console.log(`[Friday Sync] Rebuild completed with ${errors} write errors. Check console for details.`);
            }
            
            if (internalFilesErrors > 0) {
                console.log(`[Friday Sync] ${internalFilesErrors} internal files had errors. Check console for details.`);
            }
            
            // Show success message with summary
            const successCount = created + updated;
            if (successCount > 0 || totalErrors === 0) {
                Logger(`Rebuild complete: ${successCount} files written (${created} new, ${updated} updated)`, LOG_LEVEL_NOTICE);
            }
            
            return true;
        } catch (error) {
            Logger("Rebuild failed. Please try again.", LOG_LEVEL_NOTICE);
            Logger(error, LOG_LEVEL_VERBOSE);
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

    // ==================== Ignore Patterns & Selective Sync Management ====================
    
    /**
     * Update ignore patterns (for real-time settings update)
     * Patterns are stored in memory and used directly without file I/O
     */
    updateIgnorePatterns(patterns: string[]): void {
        this._ignorePatterns = patterns;
        Logger(`Updated ignore patterns: ${patterns.length} patterns`, LOG_LEVEL_INFO);
    }
    
    /**
     * Update selective sync settings (for real-time settings update)
     * Controls which file types are synced (images, audio, video, pdf)
     */
    updateSelectiveSync(settings: { syncImages?: boolean; syncAudio?: boolean; syncVideo?: boolean; syncPdf?: boolean }): void {
        if (settings.syncImages !== undefined) this._selectiveSync.syncImages = settings.syncImages;
        if (settings.syncAudio !== undefined) this._selectiveSync.syncAudio = settings.syncAudio;
        if (settings.syncVideo !== undefined) this._selectiveSync.syncVideo = settings.syncVideo;
        if (settings.syncPdf !== undefined) this._selectiveSync.syncPdf = settings.syncPdf;
        
        Logger(`Updated selective sync: images=${this._selectiveSync.syncImages}, audio=${this._selectiveSync.syncAudio}, video=${this._selectiveSync.syncVideo}, pdf=${this._selectiveSync.syncPdf}`, LOG_LEVEL_INFO);
    }
    
    /**
     * Update internal files ignore patterns (for .obsidian folder sync)
     * This updates _settings directly for real-time effect
     */
    updateInternalFilesIgnorePatterns(patterns: string): void {
        this._settings.syncInternalFilesIgnorePatterns = patterns as any;
        
        // Clear HiddenFileSync regex cache to force re-parse
        if (this._hiddenFileSync) {
            this._hiddenFileSync.clearRegexCache();
        }
        
        Logger(`Updated internal files ignore patterns`, LOG_LEVEL_INFO);
    }
    
    /**
     * Check if a file is ignored by user-defined ignore patterns
     * Uses gitignore-style pattern matching directly from memory
     */
    async isIgnoredByIgnoreFile(filepath: string): Promise<boolean> {
        if (this._ignorePatterns.length === 0) {
            return false;
        }
        
        // Use isAccepted for gitignore-style matching
        // isAccepted returns: true=accepted, false=ignored, undefined=not mentioned
        const result = isAccepted(filepath, this._ignorePatterns);
        
        // If result is false, file should be ignored
        // If result is true or undefined, file is accepted (not ignored)
        return result === false;
    }
    
    /**
     * Check if a file is ignored by selective sync settings (file type filtering)
     * This checks the file extension against the selectiveSync settings
     */
    private isIgnoredBySelectiveSync(filepath: string): boolean {
        const ext = filepath.split('.').pop()?.toLowerCase();
        if (!ext) return false;
        
        // Check image extensions
        if (FridaySyncCore.IMAGE_EXTENSIONS.includes(ext)) {
            return !this._selectiveSync.syncImages;
        }
        
        // Check audio extensions
        if (FridaySyncCore.AUDIO_EXTENSIONS.includes(ext)) {
            return !this._selectiveSync.syncAudio;
        }
        
        // Check video extensions
        if (FridaySyncCore.VIDEO_EXTENSIONS.includes(ext)) {
            return !this._selectiveSync.syncVideo;
        }
        
        // Check PDF extensions
        if (FridaySyncCore.PDF_EXTENSIONS.includes(ext)) {
            return !this._selectiveSync.syncPdf;
        }
        
        return false;
    }
    
    /**
     * Check if a file is a valid sync target
     */
    async isTargetFile(filepath: string): Promise<boolean> {
        // Check selective sync settings first (file type filtering)
        if (this.isIgnoredBySelectiveSync(filepath)) {
            return false;
        }
        
        // Check user-defined ignore patterns
        if (await this.isIgnoredByIgnoreFile(filepath)) {
            return false;
        }
        
        // Check if database accepts this file
        if (this._localDatabase && !this._localDatabase.isTargetFile(filepath)) {
            return false;
        }
        
        return true;
    }
}

