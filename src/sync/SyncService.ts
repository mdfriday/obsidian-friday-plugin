/**
 * Friday Sync Service
 * 
 * A simplified CouchDB sync service for the Friday Obsidian plugin
 * Based on Self-hosted LiveSync core library
 */

import { Plugin, Notice } from "obsidian";
import type { 
    ObsidianLiveSyncSettings, 
    RemoteDBSettings 
} from "./core/common/types";
import { DEFAULT_SETTINGS, REMOTE_COUCHDB } from "./core/common/types";

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
 */
export class SyncService {
    private plugin: Plugin;
    private config: SyncConfig | null = null;
    private statusCallback: SyncStatusCallback | null = null;
    private _isInitialized = false;
    private _status: SyncStatus = "NOT_CONNECTED";

    constructor(plugin: Plugin) {
        this.plugin = plugin;
    }

    /**
     * Get current sync status
     */
    get status(): SyncStatus {
        return this._status;
    }

    /**
     * Check if sync is initialized
     */
    get isInitialized(): boolean {
        return this._isInitialized;
    }

    /**
     * Set status callback
     */
    onStatusChange(callback: SyncStatusCallback) {
        this.statusCallback = callback;
    }

    /**
     * Update status and notify callback
     */
    private setStatus(status: SyncStatus, message?: string) {
        this._status = status;
        if (this.statusCallback) {
            this.statusCallback(status, message);
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

            this._isInitialized = true;
            this.setStatus("NOT_CONNECTED", "Sync initialized");
            return true;
        } catch (error) {
            console.error("Sync initialization failed:", error);
            this.setStatus("ERRORED", `Initialization failed: ${error}`);
            return false;
        }
    }

    /**
     * Test connection to CouchDB
     */
    async testConnection(): Promise<{ success: boolean; message: string }> {
        if (!this.config) {
            return { success: false, message: "Sync not configured" };
        }

        try {
            // Create a simple fetch to test connection
            const uri = this.config.couchDB_URI.replace(/\/$/, "");
            const dbUrl = `${uri}/${this.config.couchDB_DBNAME}`;
            
            const credentials = btoa(`${this.config.couchDB_USER}:${this.config.couchDB_PASSWORD}`);
            
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
                // Database doesn't exist, try to create it
                const createResponse = await fetch(dbUrl, {
                    method: "PUT",
                    headers: {
                        "Authorization": `Basic ${credentials}`,
                        "Content-Type": "application/json",
                    },
                });
                
                if (createResponse.ok) {
                    return { success: true, message: "Database created successfully" };
                } else {
                    return { success: false, message: `Failed to create database: ${createResponse.statusText}` };
                }
            } else {
                return { success: false, message: `Connection failed: ${response.statusText}` };
            }
        } catch (error) {
            return { success: false, message: `Connection error: ${error}` };
        }
    }

    /**
     * Convert SyncConfig to ObsidianLiveSyncSettings
     */
    private toSettings(): ObsidianLiveSyncSettings {
        if (!this.config) {
            return DEFAULT_SETTINGS;
        }

        return {
            ...DEFAULT_SETTINGS,
            couchDB_URI: this.config.couchDB_URI,
            couchDB_USER: this.config.couchDB_USER,
            couchDB_PASSWORD: this.config.couchDB_PASSWORD,
            couchDB_DBNAME: this.config.couchDB_DBNAME,
            encrypt: this.config.encrypt,
            passphrase: this.config.passphrase,
            usePathObfuscation: this.config.usePathObfuscation,
            liveSync: this.config.liveSync,
            syncOnStart: this.config.syncOnStart,
            syncOnSave: this.config.syncOnSave,
            remoteType: REMOTE_COUCHDB,
            isConfigured: true,
        };
    }

    /**
     * Start synchronization
     */
    async startSync(): Promise<boolean> {
        if (!this.config) {
            new Notice("Sync: Not configured");
            return false;
        }

        try {
            this.setStatus("STARTED", "Starting synchronization...");
            new Notice("Sync: Starting...");
            
            // Test connection first
            const testResult = await this.testConnection();
            if (!testResult.success) {
                this.setStatus("ERRORED", testResult.message);
                new Notice(`Sync failed: ${testResult.message}`);
                return false;
            }

            this.setStatus("CONNECTED", "Connected to CouchDB");
            new Notice("Sync: Connected");
            return true;
        } catch (error) {
            this.setStatus("ERRORED", `Sync failed: ${error}`);
            new Notice(`Sync error: ${error}`);
            return false;
        }
    }

    /**
     * Stop synchronization
     */
    async stopSync(): Promise<void> {
        this.setStatus("CLOSED", "Sync stopped");
        new Notice("Sync: Stopped");
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
            liveSync: false,
            syncOnStart: true,
            syncOnSave: true,
        };
    }
}
