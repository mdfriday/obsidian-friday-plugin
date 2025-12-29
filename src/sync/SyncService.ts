/**
 * Friday Sync Service
 * 
 * A simplified CouchDB sync service for the Friday Obsidian plugin
 * Based on Self-hosted LiveSync core library
 * 
 * This service provides a high-level API for synchronization,
 * wrapping the FridaySyncCore which implements the full livesync functionality.
 */

import { Plugin, Notice } from "obsidian";
import { FridaySyncCore } from "./FridaySyncCore";

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
            new Notice(`Sync initialization failed: ${error}`);
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

        // Debug: log the values to diagnose LiveSync issue
        console.log(`[Friday Sync] startSync called with continuous=${continuous}, config.liveSync=${this.config?.liveSync}`);
        
        // When continuous is explicitly true, always use LiveSync mode
        // Only check config.liveSync when continuous is not explicitly passed
        const useContinuous = continuous;
        console.log(`[Friday Sync] Using continuous=${useContinuous} for sync`);
        
        return await this.core.startSync(useContinuous);
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
     * Stop synchronization
     */
    async stopSync(): Promise<void> {
        if (this.core) {
            await this.core.stopSync();
        }
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
        };
    }
}
