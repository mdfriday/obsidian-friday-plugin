/**
 * FridaySyncCore - Core sync implementation for Friday plugin
 * 
 * This class implements the necessary interfaces from livesync's core library
 * to enable full CouchDB synchronization functionality.
 */

import {Plugin} from "obsidian";
import {reactiveSource, type ReactiveSource} from "octagonal-wheels/dataobject/reactive";

// Import file progress types
import type { FileProgressCallback } from "./types/FileProgressEvents";

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
import {$msg} from "./core/common/i18n";

// Import services
import {FridayServiceHub} from "./FridayServiceHub";
import type {SyncConfig, SyncStatus, SyncStatusCallback} from "./SyncService";
import {FridayStorageEventManager} from "./FridayStorageEventManager";
import { initializeSameChangePairs } from "./utils/sameChangePairs";
import type { SyncStatusDisplay } from "./SyncStatusDisplay";

// Import HiddenFileSync module
import {FridayHiddenFileSync} from "./features/HiddenFileSync";
import {DEFAULT_INTERNAL_IGNORE_PATTERNS} from "./types";

// Import network error handling modules
import {FridayNetworkEvents} from "./features/NetworkEvents";
import {FridayConnectionMonitor} from "./features/ConnectionMonitor";
import {FridayConnectionFailureHandler} from "./features/ConnectionFailure";
import {FridayOfflineTracker} from "./features/OfflineTracker";
import {ServerConnectivityChecker, type ServerStatus} from "./features/ServerConnectivity";

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
    
    // ✨ File progress callback (for core to communicate with UI layer)
    onFileProgress?: FileProgressCallback;
    
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
    
    // Status display for progress tracking and UI updates
    private _statusDisplay: SyncStatusDisplay | null = null;q
    
    // Storage event manager for watching file changes
    private _storageEventManager: FridayStorageEventManager | null = null;
    
    // Hidden file sync module for .obsidian synchronization
    private _hiddenFileSync: FridayHiddenFileSync | null = null;
    
    // Network error handling modules
    private _networkEvents: FridayNetworkEvents | null = null;
    private _connectionMonitor: FridayConnectionMonitor | null = null;
    private _connectionFailureHandler: FridayConnectionFailureHandler | null = null;
    private _offlineTracker: FridayOfflineTracker | null = null;
    
    // Server connectivity checker for pre-sync validation
    private _serverChecker: ServerConnectivityChecker | null = null;
    
    // Track if file watcher has been started (to avoid duplicate starts)
    private _fileWatcherStarted: boolean = false;
    
    // Track if network monitoring has been started (to avoid duplicate starts)
    private _networkMonitoringStarted: boolean = false;
    
    // Track manual operations (RESET/Push/Fetch) to pause auto-reconnect
    private _manualOperationType: "RESET" | "PUSH" | "FETCH" | "PULL" | null = null;
    
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
        
        // ✨ Set up file progress callback
        // Forward file progress events from core to FileProgressTracker
        this.onFileProgress = (event) => {
            const tracker = this._statusDisplay?.getFileProgressTracker();
            if (tracker) {
                tracker.handleEvent(event);
            }
        };
        
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
    
    /**
     * Set status display for progress tracking
     * This allows FridaySyncCore to update progress bars
     * @param statusDisplay - SyncStatusDisplay instance
     */
    setStatusDisplay(statusDisplay: SyncStatusDisplay): void {
        this._statusDisplay = statusDisplay;
    }

    // ==================== LiveSyncLocalDBEnv Implementation ====================
    
    getSettings(): RemoteDBSettings {
        return this._settings;
    }
    
    // Getter for direct property access (used by Services)
    get settings(): ObsidianLiveSyncSettings {
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

    get app() {
        return this.plugin.app;
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
    
    /**
     * Current server connectivity status
     */
    get serverStatus(): ServerStatus {
        return this._serverChecker?.currentStatus ?? "UNKNOWN";
    }
    
    /**
     * Whether server is currently reachable
     * Used by replicator for error attribution
     */
    isServerReachable(): boolean {
        return this._serverChecker?.isServerReachable ?? false;
    }

    get offlineTracker(): FridayOfflineTracker | null {
        return this._offlineTracker;
    }

    get connectionMonitor(): FridayConnectionMonitor | null {
        return this._connectionMonitor;
    }

    get connectionFailureHandler(): FridayConnectionFailureHandler | null {
        return this._connectionFailureHandler;
    }
    
    /**
     * Check if a manual operation (RESET/Push/Fetch) is in progress
     */
    get isManualOperation(): boolean {
        return this._manualOperationType !== null;
    }
    
    /**
     * Get the type of manual operation currently in progress
     */
    get manualOperationType(): string | null {
        return this._manualOperationType;
    }
    
    /**
     * Start network monitoring (event listeners and connection monitoring)
     * 
     * This should be called:
     * - After first-time upload completes (rebuildRemote)
     * - After first-time download completes (fetchFromServer)
     * - Automatically during normal sync startup (if not first-time)
     */
    startNetworkMonitoring(): void {
        if (this._networkMonitoringStarted) {
            Logger("Network monitoring already started", LOG_LEVEL_VERBOSE);
            return;
        }
        
        // Register network event listeners
        if (this._networkEvents) {
            this._networkEvents.registerEvents();
        }
        
        // Start connection monitoring
        if (this._connectionMonitor) {
            this._connectionMonitor.startMonitoring();
        }
        
        this._networkMonitoringStarted = true;
        Logger("Network monitoring started (auto-reconnect enabled)", LOG_LEVEL_INFO);
    }
    
    /**
     * Stop network monitoring
     */
    stopNetworkMonitoring(): void {
        if (!this._networkMonitoringStarted) {
            return;
        }
        
        // Stop connection monitoring
        if (this._connectionMonitor) {
            this._connectionMonitor.stopMonitoring();
        }
        
        // Unload network events
        if (this._networkEvents) {
            this._networkEvents.unload();
        }
        
        this._networkMonitoringStarted = false;
        Logger("Network monitoring stopped", LOG_LEVEL_VERBOSE);
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
                    syncImages: config.selectiveSync.syncImages ?? false,
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
                syncInternalFilesIgnorePatterns: config.syncInternalFilesIgnorePatterns 
                    ? `${DEFAULT_INTERNAL_IGNORE_PATTERNS},${config.syncInternalFilesIgnorePatterns}`
                    : DEFAULT_INTERNAL_IGNORE_PATTERNS,
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
            
            // ✨ Initialize sameChangePairs storage (persistent mtime comparison cache)
            // This is critical for the mtime-based sync optimization
            initializeSameChangePairs(vaultName);
            Logger("sameChangePairs storage initialized", LOG_LEVEL_INFO);
            
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

            // Initialize network error handling modules
            this._networkEvents = new FridayNetworkEvents(this.plugin, this);
            this._connectionMonitor = new FridayConnectionMonitor(this);
            this._connectionFailureHandler = new FridayConnectionFailureHandler(this);
            this._offlineTracker = new FridayOfflineTracker(this);
            
            // Initialize server connectivity checker (for pre-sync validation)
            this._serverChecker = new ServerConnectivityChecker();
            
            await this._offlineTracker.initialize();
            
            // NOTE: Network event listeners and connection monitoring are NOT started here
            // They will be started by startNetworkMonitoring() after:
            // - First-time upload completes (rebuildRemote)
            // - First-time download completes (fetchFromServer)
            // - Or automatically if not first-time scenario
            
            Logger("Network error handling modules initialized (monitoring not started yet)", LOG_LEVEL_INFO);

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
     * Handle network recovery - called when network comes back online
     * Source: Network event handlers trigger this when online event fires
     */
    async handleNetworkRecovery(): Promise<void> {
        Logger("Network recovery detected", LOG_LEVEL_INFO);

        // Check current status - if already LIVE, skip recovery
        const currentStatus = this.replicationStat.value.syncStatus;
        if (currentStatus === "LIVE") {
            Logger("Sync already in LIVE state, skipping recovery", LOG_LEVEL_VERBOSE);
            return;
        }

        // Update network status
        this._managers?.networkManager.setServerReachable(true);

        // Update offline tracker
        if (this._offlineTracker) {
            this._offlineTracker.setOffline(false);
        }

        // Apply any offline changes first
        if (this._offlineTracker && this._offlineTracker.pendingCount > 0) {
            await this._offlineTracker.applyOfflineChanges(true);
        }

        // Restart sync if configured
        // Check if sync needs to be restarted - only skip if already in LIVE state
        if (this._settings.liveSync && this._replicator) {
            // Only restart if not in LIVE state
            if (currentStatus !== "LIVE") {
                Logger(`Restarting sync after network recovery (current status: ${currentStatus})`, LOG_LEVEL_INFO);
                await this.startSync(true, {
                    reason: "NETWORK_RECOVERY",
                    forceCheck: true
                });
            }
        }
    }

    /**
     * Start synchronization
     * 
     * @param continuous - If true (default), starts LiveSync mode (continuous replication)
     *                     If false, performs a one-shot sync
     * @param options - Optional configuration:
     *                  - reason: Why sync is being started (for logging and behavior)
     *                  - forceCheck: Force server connectivity check (bypass cooldown)
     * 
     * Note: Following livesync's pattern, continuous sync uses showResult=false
     * to avoid spamming users with Notice popups. Status is shown in the 
     * top-right corner display instead.
     * 
     * IMPORTANT: File watcher is started AFTER a delay to avoid capturing
     * Obsidian's startup events as file changes.
     */
    async startSync(
        continuous: boolean = true,
        options?: {
            reason?: "PLUGIN_STARTUP" | "AUTO_RECONNECT" | "NETWORK_RECOVERY";
            forceCheck?: boolean;
        }
    ): Promise<boolean> {
        if (!this._replicator) {
            this.setStatus("ERRORED", "Replicator not initialized");
            return false;
        }

        const reason = options?.reason ?? "PLUGIN_STARTUP";
        const forceCheck = options?.forceCheck ?? (reason === "PLUGIN_STARTUP");
        
        Logger(`Starting sync (reason: ${reason}, forceCheck: ${forceCheck})`, LOG_LEVEL_VERBOSE);

        // ========== Pre-Check: Device Acceptance (aligned with livesync) ==========
        // If device is not accepted by remote (e.g., salt mismatch detected),
        // block all sync operations and guide user to perform "Fetch from Server"
        if (this._replicator.remoteLockedAndDeviceNotAccepted) {
            Logger(
                $msg("fridaySync.saltChanged.actionRequired") || 
                "Remote database has been reset. Please go to Settings → 'Fetch from Server' to re-sync your vault.",
                LOG_LEVEL_NOTICE
            );
            this.setStatus("ERRORED", "Device not accepted - Fetch required");
            return false;
        }

        try {
            this.setStatus("STARTED", "Checking server connectivity...");
            
            // ========== Step 1: Server Connectivity Pre-Check ==========
            // This lightweight check determines if we should attempt full sync
            // or enter offline mode
            const connectivityResult = await this._serverChecker?.checkConnectivity(
                this._settings,
                forceCheck  // Use forceCheck based on reason
            );

            if (connectivityResult?.status !== "REACHABLE") {
                // Server unreachable - enter offline mode
                return this.handleOfflineMode(connectivityResult?.error);
            }

            // ========== Server Reachable - Continue Normal Flow ==========
            Logger("Server connectivity confirmed", LOG_LEVEL_VERBOSE);
            this._managers?.networkManager.setServerReachable(true);
            this._serverChecker?.setStatus("REACHABLE");
            
            // Disable offline mode if it was enabled
            if (this._offlineTracker) {
                this._offlineTracker.setOffline(false);
            }

            // Start file watcher (for both online and offline scenarios)
            // This ensures local changes are always saved to PouchDB
            this.startFileWatcherIfNeeded();
            
            // ========== Step 2: Open Replication ==========
            // Different handling for LiveSync vs OneShot mode
            
            if (continuous) {
                // LiveSync mode: fire-and-forget
                Logger("Starting LiveSync mode...", LOG_LEVEL_INFO);
                await this._replicator.openReplication(
                    this._settings,
                    true,   // keepAlive = true for LiveSync
                    false,  // showResult: false for LiveSync
                    false   // ignoreCleanLock
                );

                // Safety net: Check connection status after timeout
                this.setupConnectionTimeout();
                
            } else {
                // OneShot mode: check return value
                const result = await this._replicator.openReplication(
                    this._settings,
                    false,  // keepAlive = false for OneShot
                    false,  // showResult
                    false   // ignoreCleanLock
                );

                if (!result) {
                    // Connection failed - but server was reachable, so this is a real issue
                    this._managers?.networkManager.setServerReachable(false);
                    this._serverChecker?.setStatus("UNREACHABLE", "Sync operation failed");

                    const issues = this.getSyncIssues();
                    if (issues.needsFetch) {
                        Logger(issues.message, LOG_LEVEL_NOTICE);
                        this.setStatus("ERRORED", "Database reset detected");
                    } else {
                        this.setStatus("NOT_CONNECTED", "Connection failed, will retry");
                        this._connectionMonitor?.scheduleReconnect(5000);
                    }

                    return false;
                }
            }
            
            // Reset notification cooldown on success
            this._connectionFailureHandler?.resetNotificationCooldown();
            
            // Check for database reset after connection attempt
            const issues = this.getSyncIssues();
            if (issues.needsFetch) {
                Logger(issues.message, LOG_LEVEL_NOTICE);
                this.setStatus("ERRORED", "Database reset detected");
                return false;
            }
            
            // Start network monitoring if not already started
            // This is for non-first-time scenarios (normal sync startup)
            // First-time scenarios will call startNetworkMonitoring() explicitly after upload/download
            this.startNetworkMonitoring();
            
            // Status will be updated by replicator via updateInfo
            return true;
        } catch (error) {
            console.error("Sync failed:", error);
            this._managers?.networkManager.setServerReachable(false);
            this._serverChecker?.setStatus("UNREACHABLE", String(error));

            // Handle the error
            const action = await this._connectionFailureHandler?.handleReplicationError(error, true);

            if (action === 'retry') {
                const delay = this._connectionFailureHandler?.getRetryDelay() || 10000;
                this._connectionMonitor?.scheduleReconnect(delay);
                this.setStatus("NOT_CONNECTED", "Connection failed, will retry");
            } else {
                this.setStatus("ERRORED", "Sync failed");
            }

            return false;
        }
    }
    
    /**
     * Handle offline mode when server is unreachable
     * This ensures local changes are still saved and reconnection is scheduled
     */
    private handleOfflineMode(errorMessage?: string): boolean {
        Logger(`Server unreachable: ${errorMessage || 'unknown reason'}`, LOG_LEVEL_INFO);

        this._managers?.networkManager.setServerReachable(false);
        this._serverChecker?.setStatus("UNREACHABLE", errorMessage);
        this.setStatus("NOT_CONNECTED", "Server unreachable, offline mode");

        // Start file watcher for offline mode (local changes saved to PouchDB)
        this.startFileWatcherIfNeeded();

        // Enable offline tracking
        if (this._offlineTracker) {
            this._offlineTracker.setOffline(true);
        }

        // Schedule reconnection
        this._connectionMonitor?.scheduleReconnect(10000);

        // Show user-friendly message
        Logger(
            $msg("fridaySync.error.cannotConnectServer") ||
            "Cannot connect to server. Changes will be saved locally.",
            LOG_LEVEL_NOTICE
        );

        return false;
    }
    
    /**
     * Start file watcher if not already started
     * This ensures local changes are always saved to PouchDB, even in offline mode
     */
    private startFileWatcherIfNeeded(): void {
        if (this._storageEventManager && !this._fileWatcherStarted) {
            this._fileWatcherStarted = true;
            const WATCH_DELAY_MS = 1500;
            Logger(`File watcher will start in ${WATCH_DELAY_MS}ms...`, LOG_LEVEL_VERBOSE);
            
            setTimeout(() => {
                if (this._storageEventManager) {
                    this._storageEventManager.beginWatch();
                    Logger("File watcher started - local changes will be saved", LOG_LEVEL_INFO);
                }
            }, WATCH_DELAY_MS);
        }
    }
    
    /**
     * Setup connection timeout safety net
     * If status remains STARTED after timeout, transition to error state
     */
    private setupConnectionTimeout(): void {
        const CONNECTION_TIMEOUT_MS = 30000;
        setTimeout(() => {
            const status = this.replicationStat.value.syncStatus;
            if (status === "STARTED") {
                Logger("Connection timeout - status stuck at STARTED", LOG_LEVEL_INFO);
                this.setStatus("NOT_CONNECTED", "Connection timeout");
                this._managers?.networkManager.setServerReachable(false);
                this._serverChecker?.setStatus("UNREACHABLE", "Connection timeout");
                this._connectionMonitor?.scheduleReconnect(10000);
            }
        }, CONNECTION_TIMEOUT_MS);
    }

    /**
     * Execute a manual operation with auto-reconnect paused
     * This prevents ConnectionMonitor from interfering during user-initiated operations
     * 
     * @param type - Type of manual operation
     * @param operation - The async operation to execute
     * @returns Result of the operation
     */
    private async _executeManualOperation<T>(
        type: "RESET" | "PUSH" | "FETCH" | "PULL",
        operation: () => Promise<T>
    ): Promise<T> {
        this._manualOperationType = type;
        
        try {
            // Pause ConnectionMonitor to prevent interference
            this._connectionMonitor?.pauseDuringManualOperation();
            
            Logger(`Starting manual operation: ${type}`, LOG_LEVEL_INFO);
            
            // Execute the actual operation
            const result = await operation();
            
            Logger(`Manual operation completed: ${type}`, LOG_LEVEL_INFO);
            
            return result;
            
        } catch (error) {
            // Manual operation failed
            // Don't enter offline mode, don't trigger auto-reconnect
            Logger(`Manual operation failed: ${type}`, LOG_LEVEL_INFO);
            Logger(error, LOG_LEVEL_VERBOSE);
            throw error;  // Re-throw for caller to handle
            
        } finally {
            // Always resume ConnectionMonitor
            this._manualOperationType = null;
            this._connectionMonitor?.resumeAfterManualOperation();
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
            Logger($msg("fridaySync.pull.pulling"), LOG_LEVEL_NOTICE);
            
            const result = await this._replicator.replicateAllFromServer(this._settings, true);
            
            if (result) {
                this.setStatus("COMPLETED", "Pull completed");
                Logger($msg("fridaySync.pull.completed"), LOG_LEVEL_NOTICE);
            } else {
                this.setStatus("ERRORED", "Pull failed");
                Logger($msg("fridaySync.pull.failed"), LOG_LEVEL_NOTICE);
            }
            
            return result;
        } catch (error) {
            console.error("Pull failed:", error);
            this.setStatus("ERRORED", "Pull failed");
            Logger($msg("fridaySync.pull.failedConnection"), LOG_LEVEL_NOTICE);
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

        return this._executeManualOperation("PUSH", async () => {
            try {
                this.setStatus("STARTED", "Pushing to server...");
                Logger($msg("fridaySync.push.pushing"), LOG_LEVEL_NOTICE);
                
                const result = await this._replicator.replicateAllToServer(this._settings, true);
                
                if (result) {
                    this.setStatus("COMPLETED", "Push completed");
                    Logger($msg("fridaySync.push.completed"), LOG_LEVEL_NOTICE);
                } else {
                    this.setStatus("ERRORED", "Push failed");
                    Logger($msg("fridaySync.push.failed"), LOG_LEVEL_NOTICE);
                }
                
                return result;
            } catch (error) {
                console.error("Push failed:", error);
                this.setStatus("ERRORED", "Push failed");
                Logger($msg("fridaySync.push.failedConnection"), LOG_LEVEL_NOTICE);
                Logger(error, LOG_LEVEL_VERBOSE);
                return false;
            }
        });
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

        return this._executeManualOperation("FETCH", async () => {
            try {
                this.setStatus("STARTED", "Fetching from server (first-time sync)...");
                Logger($msg("fridaySync.fetch.fetching"), LOG_LEVEL_NOTICE);
                
                // Step 1: Mark this device as resolved/accepted
                // Note: This is now also called inside rebuildLocalFromRemote after database reset
                Logger("Marking remote as resolved...", LOG_LEVEL_INFO);
                await this._replicator.markRemoteResolved(this._settings);
                
                // Step 2: Use the complete rebuild flow (same as livesync)
                // This ensures chunks are fetched before attempting to rebuild files
                Logger("Rebuilding local database from remote...", LOG_LEVEL_INFO);
                const result = await this.rebuildLocalFromRemote();
                
                if (result) {
                    this.setStatus("COMPLETED", "Fetch completed");
                    Logger($msg("fridaySync.fetch.completed"), LOG_LEVEL_NOTICE);
                } else {
                    this.setStatus("ERRORED", "Fetch failed");
                    Logger($msg("fridaySync.fetch.failed"), LOG_LEVEL_NOTICE);
                }
                
                return result;
            } catch (error) {
                console.error("Fetch failed:", error);
                this.setStatus("ERRORED", "Fetch failed");
                Logger($msg("fridaySync.fetch.failedConnection"), LOG_LEVEL_NOTICE);
                Logger(error, LOG_LEVEL_VERBOSE);
                return false;
            }
        });
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

        return this._executeManualOperation("RESET", async () => {
            try {
                this.setStatus("STARTED", "Uploading your files...");
                Logger($msg("fridaySync.rebuildRemote.rebuilding"), LOG_LEVEL_NOTICE);
                
                // Get total files count for progress tracking
                const vault = this.plugin.app.vault;
                const files = vault.getFiles();
                const totalFiles = files.length;
                
                // ✨ 发出上传开始事件
                this.onFileProgress?.({
                    type: 'upload_start',
                    totalFiles: totalFiles,
                });
                
                // Step 1: Scan local vault and store all files to local database
                Logger("Step 1: Scanning local vault and storing to database...", LOG_LEVEL_INFO);
                
                const scanResult = await this.scanAndStoreVaultToDB();
                if (!scanResult) {
                    Logger($msg("fridaySync.rebuildRemote.scanFailed"), LOG_LEVEL_NOTICE);
                    this.setStatus("ERRORED", "Failed to scan vault files");
                    return false;
                }
                
                // Step 2: Reset remote database
                Logger("Step 2: Resetting remote database...", LOG_LEVEL_INFO);
                Logger($msg("fridaySync.rebuildRemote.resettingRemote"), LOG_LEVEL_INFO);
                try {
                    await this._replicator.tryResetRemoteDatabase(this._settings);
                } catch (error) {
                    console.error("[RebuildRemote] Step 2: Reset remote database error (may be expected if DB doesn't exist):", error);
                }
                
                // Step 3: Create remote database (in case it was destroyed)
                Logger("Step 3: Creating remote database...", LOG_LEVEL_INFO);
                try {
                    await this._replicator.tryCreateRemoteDatabase(this._settings);
                } catch (error) {
                    console.error("[RebuildRemote] Step 3: Create remote database error:", error);
                }
                
                // Small delay to ensure database is ready
                await new Promise(resolve => setTimeout(resolve, 2000));

                // Step 4: Push all local data to remote (first pass)
                Logger("Step 4: Pushing all data to remote server...", LOG_LEVEL_INFO);
                Logger($msg("fridaySync.rebuildRemote.pushingData"), LOG_LEVEL_NOTICE);
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
                    
                    // ✨ 发出上传完成事件
                    this.onFileProgress?.({
                        type: 'upload_complete',
                        totalFiles: totalFiles,
                        successCount: totalFiles,
                        errorCount: 0,
                    });
                    
                    Logger($msg("fridaySync.rebuildRemote.success"), LOG_LEVEL_NOTICE);
                    Logger("Other devices should now use 'Fetch from Server' to sync", LOG_LEVEL_INFO);
                    
                    // Start network monitoring after successful first-time upload
                    this.startNetworkMonitoring();
                } else {
                    this.setStatus("ERRORED", "Rebuild remote failed");
                    Logger($msg("fridaySync.rebuildRemote.failed"), LOG_LEVEL_NOTICE);
                }
                
                return result;
            } catch (error) {
                this.setStatus("ERRORED", `Rebuild remote error: ${error}`);
                Logger(`Rebuild remote error: ${error}`, LOG_LEVEL_NOTICE);
                console.error("[RebuildRemote] Error:", error);
                return false;
            }
        });
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
            // Show user-friendly message without technical jargon
            Logger(
                $msg("fridaySync.rebuildRemote.filesPrepared", { count: stored.toString() }) || 
                `Prepared ${stored} files for upload`,
                LOG_LEVEL_NOTICE
            );
            
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
            Logger($msg("fridaySync.rebuild.localDbNotInitialized"), LOG_LEVEL_NOTICE);
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
            
            // ✨ 统计需要写入的文件总数
            let totalFilesToWrite = 0;
            for (const row of allDocs.rows) {
                const doc = row.doc;
                if (!doc) continue;
                
                // Skip non-file documents (same logic as below)
                if (doc._id.startsWith("h:")) continue;
                if (doc._id.startsWith("_")) continue;
                if ((doc as any).type === "versioninfo") continue;
                if ((doc as any).type === "milestoneinfo") continue;
                if ((doc as any).type === "nodeinfo") continue;
                if ((doc as any).type === "leaf") continue;
                
                const docPath = (doc as any).path as string | undefined;
                const isInternalFile = isInternalMetadata(doc._id) || 
                    (docPath && isInternalMetadata(docPath));
                
                // Count internal files
                if (isInternalFile) {
                    totalFilesToWrite++;
                    continue;
                }
                
                // Count normal files
                const docType = (doc as any).type;
                if (docType === "notes" || docType === "newnote" || docType === "plain") {
                    const isDeleted = doc._deleted === true || (doc as any).deleted === true;
                    if (!isDeleted && docPath) {
                        totalFilesToWrite++;
                    }
                }
            }
            
            // ✨ 发出文件写入开始事件
            this.onFileProgress?.({
                type: 'file_write_start',
                totalFiles: totalFilesToWrite,
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
                                // ✨ 发出文件写入进度事件（内部文件）
                                this.onFileProgress?.({
                                    type: 'file_write_progress',
                                    writtenFiles: internalFilesProcessed + created + updated,
                                    totalFiles: totalFilesToWrite,
                                    currentFilePath: docPath || doc._id,
                                });
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
                    
                    // ✨ 发出文件写入进度事件
                    this.onFileProgress?.({
                        type: 'file_write_progress',
                        writtenFiles: internalFilesProcessed + created + updated,
                        totalFiles: totalFilesToWrite,
                        currentFilePath: path,
                    });
                    
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
            
            // ✨ 发出文件写入完成事件
            const successCount = created + updated + internalFilesProcessed;
            this.onFileProgress?.({
                type: 'file_write_complete',
                totalFiles: totalFilesToWrite,
                successCount: successCount,
                errorCount: errors + internalFilesErrors,
            });
            
            // Log summary with errors count
            const totalErrors = errors + internalFilesErrors + missingChunksErrors;
            
            // Aggregated error display: show one notice for missing chunks instead of many
            if (missingChunksErrors > 0) {
                const sampleFiles = missingChunksFiles.slice(0, 3).join(", ");
                const moreText = missingChunksErrors > 3 ? ` and ${missingChunksErrors - 3} more` : "";
                Logger(
                    $msg("fridaySync.rebuild.missingChunks", { 
                        count: missingChunksErrors.toString(),
                        examples: sampleFiles,
                        more: moreText
                    }) ||
                    `${missingChunksErrors} files could not be read (missing data). This usually happens after a database reset. Consider using "Fetch from Server" to re-sync. Examples: ${sampleFiles}${moreText}`,
                    LOG_LEVEL_NOTICE
                );
                console.error(`[Friday Sync] Missing chunks for ${missingChunksErrors} files:`, missingChunksFiles);
            }
            
            if (errors > 0) {
                console.error(`[Friday Sync] Rebuild completed with ${errors} write errors. Check console for details.`);
            }
            
            if (internalFilesErrors > 0) {
                console.error(`[Friday Sync] ${internalFilesErrors} internal files had errors. Check console for details.`);
            }
            
            // Show success message with summary
            if (successCount > 0 || totalErrors === 0) {
                Logger(
                    $msg("fridaySync.rebuild.complete", {
                        count: successCount.toString(),
                        created: created.toString(),
                        updated: updated.toString()
                    }) || 
                    `Rebuild complete: ${successCount} files written (${created} new, ${updated} updated)`,
                    LOG_LEVEL_NOTICE
                );
            }
            
            return true;
        } catch (error) {
            Logger($msg("fridaySync.rebuild.failed"), LOG_LEVEL_NOTICE);
            Logger(error, LOG_LEVEL_VERBOSE);
            return false;
        }
    }

    /**
     * Fetch all data from remote database (Rebuild local from remote)
     * This is the equivalent of livesync's "Fetch from Remote" feature
     * 
     * This method follows livesync's standard rebuild flow:
     * 1. Reset local database
     * 2. First replication pass (fetch all meta documents)
     * 3. Fetch missing chunks explicitly
     * 4. Second replication pass (ensure completeness)
     * 5. Rebuild local files from database
     */
    async rebuildLocalFromRemote(): Promise<boolean> {
        // Save original state outside try block so it's accessible in catch
        const originalSuspendParseState = this._settings.suspendParseReplicationResult;
        const originalSuspendFileWatchingState = this._settings.suspendFileWatching;
        
        try {
            // ===== Phase 1: Suspend (aligned with livesync suspendReflectingDatabase) =====
            Logger($msg("fridaySync.fetch.starting") || "Starting download from server...", LOG_LEVEL_NOTICE);
            Logger("[Fetch] Phase 1: Starting download from server", LOG_LEVEL_INFO);

            // ✨ 发出下载开始事件
            // 使用估算值，实际数量会在下载过程中更新
            const estimatedDocs = 1000;
            this.onFileProgress?.({
                type: 'download_start',
                totalDocs: estimatedDocs,
            });

            // Technical message - user doesn't need to know about "reflection"
            Logger(
                $msg("fridaySync.saltChanged.suspendingReflection") ||
                "Preparing to download files...",
                LOG_LEVEL_INFO
            );
            
            this._settings.suspendParseReplicationResult = true;
            this._settings.suspendFileWatching = true;
            Logger("[Fetch] Suspended database and storage reflection", LOG_LEVEL_INFO);

            // ===== Phase 2: Reset & Reopen Database =====
            if (this._storageEventManager) {
                this._storageEventManager.stopWatch();
            }
            
            Logger("Resetting local database...", LOG_LEVEL_INFO);
            if (this._localDatabase) {
                await this._localDatabase.resetDatabase();
            }
            
            await this.delay(1000);

            // ===== Phase 3: Reopen Database =====
            Logger("[Fetch] Phase 3: Reopening database connection", LOG_LEVEL_INFO);
            if (this._localDatabase) {
                const dbInitialized = await this._localDatabase.initializeDatabase();
                Logger(`[Fetch] Database reopened: ${dbInitialized}`, LOG_LEVEL_INFO);
            } else {
                Logger("[Fetch] WARNING: Cannot reopen database - not initialized", LOG_LEVEL_INFO);
            }
            
            // ===== Phase 4: Mark Device as Resolved =====
            Logger("[Fetch] Phase 4: Marking device as resolved", LOG_LEVEL_INFO);
            if (this._replicator) {
                this._replicator.remoteLockedAndDeviceNotAccepted = false;
                this._replicator.remoteLocked = false;
                this._replicator.remoteCleaned = false;
                
                await this._replicator.markRemoteResolved(this._settings);
                await this._replicator.updateStoredSalt(this._settings);
                
                Logger("Device is now accepted by remote database", LOG_LEVEL_INFO);
            } else {
                Logger("[Fetch] WARNING: Replicator not initialized", LOG_LEVEL_INFO);
            }
            
            await this.delay(500);
            
            // ===== Phase 5: Fetch from Remote =====
            Logger($msg("fridaySync.fetch.downloading") || "Downloading files from server (this may take a while)...", LOG_LEVEL_NOTICE);
            
            const result1 = await this._replicator?.replicateAllFromServer(
                this._settings, 
                true
            );

            if (!result1) {
                throw new Error("First replication pass failed");
            }

            await this.delay(1000);
            
            // ===== Phase 6: Fetch from Remote (Second Pass) =====
            const result2 = await this._replicator?.replicateAllFromServer(
                this._settings,
                true
            );
            
            if (!result2) {
                Logger("[Fetch] Second replication pass failed, but continuing...", LOG_LEVEL_INFO);
            }

            await this.delay(500);
            
            // ✨ 发出下载完成事件
            this.onFileProgress?.({
                type: 'download_complete',
                totalDocs: estimatedDocs,
            });
            
            // ===== Phase 7: Resume and Rebuild Vault =====
            Logger($msg("fridaySync.fetch.writingFiles") || "Writing files to your vault...", LOG_LEVEL_NOTICE);
            
            this._settings.suspendParseReplicationResult = false;
            this._settings.suspendFileWatching = false;
            
            // rebuildVaultFromDB 会触发 file_write 事件
            Logger("Scanning and rebuilding vault from database...", LOG_LEVEL_INFO);
            const rebuildResult = await this.rebuildVaultFromDB();

            if (!rebuildResult) {
                throw new Error("Rebuild vault failed");
            }

            // ===== Phase 8: Complete =====
            Logger($msg("fridaySync.fetch.downloadComplete") || "Download complete!", LOG_LEVEL_NOTICE);
            
            // Start network monitoring after successful first-time download
            this.startNetworkMonitoring();

            // Restart sync if it was running
            if (this._settings.liveSync) {
                await this.startSync(true);
            }
            
            return true;
        } catch (error) {
            Logger($msg("fridaySync.fetch.downloadFailed") || "Download from server failed", LOG_LEVEL_NOTICE);
            Logger(error, LOG_LEVEL_VERBOSE);
            
            // Restore suspend state
            this._settings.suspendParseReplicationResult = originalSuspendParseState;
            this._settings.suspendFileWatching = originalSuspendFileWatchingState;
            
            return false;
        }
    }

    /**
     * Fetch all missing chunks from remote database
     * This ensures chunks are present before rebuildVaultFromDB
     * 
     * Equivalent to livesync's fetchAllUsedChunks()
     * 
     * Why this is needed:
     * - ChunkFetcher is passive (responds to MISSING_CHUNKS events)
     * - It only triggers when getDBEntryFromMeta is called
     * - rebuildVaultFromDB would fail if chunks aren't present yet
     * - This method ACTIVELY fetches all referenced chunks upfront
     */
    private async fetchAllMissingChunksFromRemote(): Promise<void> {
        if (!this._replicator || !this._localDatabase) {
            Logger("Cannot fetch chunks: Replicator or LocalDatabase not initialized", LOG_LEVEL_INFO);
            return;
        }
        
        try {
            // Step 1: Collect all chunk IDs that are referenced by documents
            Logger("Scanning database for referenced chunks...", LOG_LEVEL_INFO);
            
            const localDB = this._localDatabase.localDatabase;
            const referencedChunkIds = new Set<string>();
            
            // Query all documents with children (i.e., files with chunks)
            const allDocs = await localDB.allDocs({
                include_docs: true,
                attachments: false,
            });
            
            for (const row of allDocs.rows) {
                const doc = row.doc as any;
                if (doc && doc.children && Array.isArray(doc.children)) {
                    doc.children.forEach((chunkId: string) => {
                        referencedChunkIds.add(chunkId);
                    });
                }
            }
            
            Logger(`Found ${referencedChunkIds.size} referenced chunks`, LOG_LEVEL_INFO);
            
            if (referencedChunkIds.size === 0) {
                Logger("No chunks referenced, skipping chunk fetch", LOG_LEVEL_INFO);
                return;
            }
            
            // Step 2: Check which chunks are missing locally
            const chunkIds = Array.from(referencedChunkIds);
            const localChunksResult = await localDB.allDocs({
                keys: chunkIds,
            });
            
            const missingChunkIds = localChunksResult.rows
                .filter((row: any) => 'error' in row && row.error === 'not_found')
                .map((row: any) => row.key);
            
            if (missingChunkIds.length === 0) {
                Logger("All chunks present locally, no fetching needed", LOG_LEVEL_INFO);
                return;
            }
            
            Logger(
                $msg("fridaySync.fetch.fetchingMissingChunks", { 
                    count: missingChunkIds.length.toString() 
                }) ||
                `Found ${missingChunkIds.length} missing chunks, fetching from remote...`,
                LOG_LEVEL_NOTICE
            );
            
            // Step 3: Fetch missing chunks from remote using the replicator
            const batchSize = 100;
            let fetched = 0;
            
            for (let i = 0; i < missingChunkIds.length; i += batchSize) {
                const batch = missingChunkIds.slice(i, i + batchSize);
                
                // Use the replicator's fetchRemoteChunks method
                const chunks = await this._replicator.fetchRemoteChunks(batch, false);
                
                if (chunks === false) {
                    Logger(`Failed to fetch chunk batch ${Math.floor(i / batchSize) + 1}`, LOG_LEVEL_INFO);
                    continue;
                }
                
                // Write chunks to local database
                try {
                    await localDB.bulkDocs(chunks, { new_edits: false });
                    fetched += chunks.length;
                    Logger(
                        `Fetched chunks: ${fetched} / ${missingChunkIds.length}`,
                        LOG_LEVEL_NOTICE,
                        "fetch-chunks"
                    );
                } catch (ex) {
                    Logger(`Error writing chunks to database: ${ex}`, LOG_LEVEL_VERBOSE);
                }
            }
            
            Logger(
                $msg("fridaySync.fetch.chunkFetchComplete", { 
                    count: fetched.toString() 
                }) ||
                `Chunk fetching complete: ${fetched} chunks fetched`,
                LOG_LEVEL_NOTICE
            );
        } catch (ex) {
            // Log error but don't throw - allow rebuild to continue
            // Some chunks may be missing due to database inconsistencies
            // Those files will fail during rebuild but others will succeed
            Logger("Error in fetchAllMissingChunksFromRemote", LOG_LEVEL_INFO);
            Logger(ex, LOG_LEVEL_VERBOSE);
            Logger("Continuing with rebuild despite chunk fetch errors...", LOG_LEVEL_INFO);
        }
    }

    /**
     * Helper function for delays
     */
    private delay(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
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
        // Stop network monitoring (will check if it's started)
        this.stopNetworkMonitoring();

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

