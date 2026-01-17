/**
 * Friday Sync Service
 * 
 * A simplified CouchDB sync service for the Friday Obsidian plugin
 * Based on Self-hosted LiveSync core library
 * 
 * This service provides a high-level API for synchronization,
 * wrapping the FridaySyncCore which implements the full livesync functionality.
 */

import {Notice, Plugin} from "obsidian";
import {FridaySyncCore} from "./FridaySyncCore";

/**
 * Selective sync settings for quick toggles
 */
export interface SelectiveSyncSettings {
    syncImages: boolean;    // bmp, png, jpg, jpeg, gif, svg, webp, avif
    syncAudio: boolean;     // mp3, wav, m4a, 3gp, flac, ogg, oga, opus
    syncVideo: boolean;     // mp4, webm, ogv, mov, mkv
    syncPdf: boolean;       // pdf
    syncThemes: boolean;    // .obsidian/themes
    syncPlugins: boolean;   // .obsidian/plugins
}

/**
 * Sync configuration for CouchDB
 */
export interface SyncConfig {
    // CouchDB Server
    couchDB_URI: string;
    couchDB_USER: string;
    couchDB_PASSWORD: string;
    couchDB_DBNAME: string;
    
    // Encryption
    encrypt: boolean;
    passphrase: string;
    usePathObfuscation: boolean;
    
    // Sync behavior
    liveSync: boolean;
    syncOnStart: boolean;
    syncOnSave: boolean;
    
    // Ignore patterns (gitignore format, used directly from memory)
    // e.g., ["images/", "*.tmp", "attachments/**"]
    ignorePatterns: string[];
    
    // Selective sync settings (quick toggles for common file types)
    selectiveSync?: SelectiveSyncSettings;
    
    // Hidden file sync (.obsidian folder synchronization)
    // Default: enabled with Obsidian official sync best practices
    syncInternalFiles?: boolean;                    // Enable .obsidian sync (default: true)
    syncInternalFilesBeforeReplication?: boolean;   // Scan before sync (default: true)
    syncInternalFilesInterval?: number;             // Periodic scan interval in seconds (default: 60)
    syncInternalFilesIgnorePatterns?: string;       // Regex patterns to ignore (comma-separated)
    syncInternalFilesTargetPatterns?: string;       // Regex patterns to target (comma-separated)
    watchInternalFileChanges?: boolean;             // Watch file changes in real-time (default: true)
}

/**
 * Sync status
 */
export type SyncStatus = 
    | "NOT_CONNECTED" 
    | "CONNECTED" 
    | "PAUSED" 
    | "STARTED" 
    | "COMPLETED" 
    | "ERRORED"
    | "CLOSED";

/**
 * Sync status callback
 */
export type SyncStatusCallback = (status: SyncStatus, message?: string) => void;

/**
 * Friday Sync Service
 * 
 * Provides a simple interface for CouchDB synchronization.
 * Uses FridaySyncCore internally for full livesync functionality.
 */
export class SyncService {
    private plugin: Plugin;
    private config: SyncConfig | null = null;
    private core: FridaySyncCore | null = null;
    private statusCallback: SyncStatusCallback | null = null;
    private _isInitialized = false;

    constructor(plugin: Plugin) {
        this.plugin = plugin;
    }

    /**
     * Get current sync status
     */
    get status(): SyncStatus {
        return this.core?.status ?? "NOT_CONNECTED";
    }

    /**
     * Check if sync is initialized
     */
    get isInitialized(): boolean {
        return this._isInitialized;
    }

    /**
     * Get the underlying sync core (for advanced usage)
     */
    get syncCore(): FridaySyncCore | null {
        return this.core;
    }

    /**
     * Set status callback
     */
    onStatusChange(callback: SyncStatusCallback) {
        this.statusCallback = callback;
        if (this.core) {
            this.core.onStatusChange(callback);
        }
    }

    /**
     * Initialize sync with configuration
     */
    async initialize(config: SyncConfig): Promise<boolean> {
        this.config = config;
        
        try {
            // Validate configuration
            if (!config.couchDB_URI || !config.couchDB_DBNAME) {
                new Notice("Sync: CouchDB URI and database name are required");
                return false;
            }

            // Create and initialize the sync core
            this.core = new FridaySyncCore(this.plugin);
            
            // Set up status callback
            if (this.statusCallback) {
                this.core.onStatusChange(this.statusCallback);
            }

            // Initialize the core
            const result = await this.core.initialize(config);
            this._isInitialized = result;
            
            return result;
        } catch (error) {
            console.error("Sync initialization failed:", error);
            new Notice("Sync initialization failed. Please check your settings.");
            return false;
        }
    }

    /**
     * Test connection to CouchDB
     */
    async testConnection(): Promise<{ success: boolean; message: string }> {
        if (!this.core) {
            // Create a temporary core for testing
            const tempCore = new FridaySyncCore(this.plugin);
            if (this.config) {
                await tempCore.initialize(this.config);
            }
            const result = await tempCore.testConnection();
            await tempCore.close();
            return result;
        }

        return await this.core.testConnection();
    }

    /**
     * Start synchronization
     * 
     * @param continuous - If true (default), starts LiveSync mode (continuous replication)
     *                     that monitors remote database for changes in real-time.
     *                     If false, performs a one-shot sync.
     */
    async startSync(continuous: boolean = true): Promise<boolean> {
        if (!this.core) {
            new Notice("Sync: Not initialized. Please initialize first.");
            return false;
        }

        // When continuous is explicitly true, always use LiveSync mode
        // Only check config.liveSync when continuous is not explicitly passed
		return await this.core.startSync(continuous);
    }

    /**
     * Pull all documents from server (one-shot sync)
     * 
     * This downloads all documents from the remote CouchDB to local.
     */
    async pullFromServer(): Promise<boolean> {
        if (!this.core) {
            new Notice("Sync: Not initialized. Please initialize first.");
            return false;
        }

        return await this.core.pullFromServer();
    }

    /**
     * Push all documents to server (one-shot sync)
     * 
     * This uploads all local documents to the remote CouchDB.
     */
    async pushToServer(): Promise<boolean> {
        if (!this.core) {
            new Notice("Sync: Not initialized. Please initialize first.");
            return false;
        }

        return await this.core.pushToServer();
    }

    /**
     * Fetch from server for first-time sync
     * 
     * Use this when connecting a new device to an existing database.
     * It marks the device as accepted and pulls all data from the server.
     * 
     * This is required when you see "The remote database has been rebuilt or corrupted" message.
     */
    async fetchFromServer(): Promise<boolean> {
        if (!this.core) {
            new Notice("Sync: Not initialized. Please initialize first.");
            return false;
        }

        return await this.core.fetchFromServer();
    }

    /**
     * Rebuild vault from local database
     * 
     * Use this when the database is synced but files haven't been written to disk.
     * This reads all documents from the local PouchDB and writes them to the vault.
     */
    async rebuildVaultFromDB(): Promise<boolean> {
        if (!this.core) {
            new Notice("Sync: Not initialized. Please initialize first.");
            return false;
        }

        return await this.core.rebuildVaultFromDB();
    }

    /**
     * Rebuild remote database from local files
     * 
     * Use this for first-time sync when you want to upload all local files to an empty server.
     * WARNING: This will reset the remote database and upload all local files.
     * Other devices will need to use "Fetch from Server" after this operation.
     */
    async rebuildRemote(): Promise<boolean> {
        if (!this.core) {
            new Notice("Sync: Not initialized. Please initialize first.");
            return false;
        }

        return await this.core.rebuildRemote();
    }

    /**
     * Stop synchronization
     */
    async stopSync(): Promise<void> {
        if (this.core) {
            await this.core.stopSync();
        }
    }

    /**
     * Update ignore patterns
     * 
     * This updates the ignore patterns in memory.
     * Changes take effect immediately for new sync operations.
     * 
     * @param patterns - Array of gitignore-style patterns
     */
    updateIgnorePatterns(patterns: string[]): void {
        if (this.config) {
            this.config.ignorePatterns = patterns;
        }
        if (this.core) {
            this.core.updateIgnorePatterns(patterns);
        }
    }
    
    /**
     * Update internal files ignore patterns (for .obsidian folder sync)
     * 
     * This updates the ignore patterns for themes, plugins, etc.
     * Changes take effect immediately.
     * 
     * @param patterns - Comma-separated regex patterns
     */
    updateInternalFilesIgnorePatterns(patterns: string): void {
        if (this.core) {
            this.core.updateInternalFilesIgnorePatterns(patterns);
        }
    }
    
    /**
     * Update selective sync settings (for file type filtering)
     * 
     * This updates which file types are synced (images, audio, video, pdf).
     * Changes take effect immediately.
     * 
     * @param settings - Partial selective sync settings
     */
    updateSelectiveSync(settings: { syncImages?: boolean; syncAudio?: boolean; syncVideo?: boolean; syncPdf?: boolean }): void {
        if (this.core) {
            this.core.updateSelectiveSync(settings);
        }
    }

    /**
     * Check if there are any sync issues that need user attention
     * 
     * This is useful for detecting:
     * - Remote database reset (requires "Fetch from Server")
     * - Configuration mismatches between devices
     * 
     * @returns object with status flags and message
     */
    getSyncIssues(): { hasIssues: boolean; message: string; needsFetch: boolean } {
        if (!this.core) {
            return { hasIssues: false, message: "", needsFetch: false };
        }
        return this.core.getSyncIssues();
    }
    
    /**
     * Check if the remote database has been reset/rebuilt
     * 
     * When this returns true, the user should use "Fetch from Server" to re-sync.
     * This typically happens when another device rebuilds the remote database.
     * 
     * @returns true if database reset was detected
     */
    isRemoteDatabaseReset(): boolean {
        return this.core?.isRemoteDatabaseReset() ?? false;
    }

    /**
     * Close and clean up resources
     */
    async close(): Promise<void> {
        if (this.core) {
            await this.core.close();
            this.core = null;
        }
        this._isInitialized = false;
    }

    /**
     * Get default sync configuration
     */
    static getDefaultConfig(): SyncConfig {
        return {
            couchDB_URI: "",
            couchDB_USER: "",
            couchDB_PASSWORD: "",
            couchDB_DBNAME: "friday-sync",
            encrypt: false,
            passphrase: "",
            usePathObfuscation: false,
            liveSync: true,   // Default to LiveSync mode for real-time synchronization
            syncOnStart: true,
            syncOnSave: true,
            ignorePatterns: [],  // No patterns ignored by default
        };
    }
}
