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

// Import services
import { FridayServiceHub } from "./FridayServiceHub";
import type { SyncConfig, SyncStatus, SyncStatusCallback } from "./SyncService";

// PouchDB imports
import PouchDB from "pouchdb-core";
import idb from "pouchdb-adapter-idb";
import http from "pouchdb-adapter-http";
import replication from "pouchdb-replication";
import mapreduce from "pouchdb-mapreduce";
import find from "pouchdb-find";

// Initialize PouchDB plugins
PouchDB.plugin(idb);
PouchDB.plugin(http);
PouchDB.plugin(replication);
PouchDB.plugin(mapreduce);
PouchDB.plugin(find);

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
    
    // Reactive counters for status display
    replicationStat: ReactiveSource<ReplicationStat> = reactiveSource({
        sent: 0,
        arrived: 0,
        maxPullSeq: 0,
        maxPushSeq: 0,
        lastSyncPullSeq: 0,
        lastSyncPushSeq: 0,
        syncStatus: "NOT_CONNECTED" as DatabaseConnectingStatus,
    });

    constructor(plugin: Plugin) {
        this.plugin = plugin;
        this._settings = { ...DEFAULT_SETTINGS };
        this._services = new FridayServiceHub(this);
        this._kvDB = new SimpleKeyValueDB("friday-kv");
        this._simpleStore = new FridaySimpleStore("checkpoint");
        
        // Set up global logging
        setGlobalLogFunction((message: any, level?: number, key?: string) => {
            if (level && level >= LOG_LEVEL_NOTICE) {
                new Notice(String(message));
            }
            if (level && level >= LOG_LEVEL_INFO) {
                console.log(`[Friday Sync] ${message}`);
            } else {
                console.debug(`[Friday Sync] ${message}`);
            }
        });
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

            // Initialize local database
            const vaultName = this.getVaultName();
            this._localDatabase = new LiveSyncLocalDB(vaultName, this);
            
            const dbInitialized = await this._localDatabase.initializeDatabase();
            if (!dbInitialized) {
                this.setStatus("ERRORED", "Failed to initialize local database");
                return false;
            }

            // Initialize replicator
            this._replicator = new LiveSyncCouchDBReplicator(this);

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
     * Start synchronization (pull from server)
     */
    async startSync(continuous: boolean = false): Promise<boolean> {
        if (!this._replicator) {
            this.setStatus("ERRORED", "Replicator not initialized");
            return false;
        }

        try {
            this.setStatus("STARTED", "Starting synchronization...");
            
            // Open replication
            await this._replicator.openReplication(
                this._settings,
                continuous,  // keepAlive for live sync
                true,        // showResult
                false        // ignoreCleanLock
            );

            this.setStatus("CONNECTED", "Connected to CouchDB");
            return true;
        } catch (error) {
            console.error("Sync failed:", error);
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
            new Notice("Sync: Pulling from server...");
            
            const result = await this._replicator.replicateAllFromServer(this._settings, true);
            
            if (result) {
                this.setStatus("COMPLETED", "Pull completed");
                new Notice("Sync: Pull completed");
            } else {
                this.setStatus("ERRORED", "Pull failed");
                new Notice("Sync: Pull failed");
            }
            
            return result;
        } catch (error) {
            console.error("Pull failed:", error);
            this.setStatus("ERRORED", `Pull failed: ${error}`);
            new Notice(`Sync error: ${error}`);
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
            new Notice("Sync: Pushing to server...");
            
            const result = await this._replicator.replicateAllToServer(this._settings, true);
            
            if (result) {
                this.setStatus("COMPLETED", "Push completed");
                new Notice("Sync: Push completed");
            } else {
                this.setStatus("ERRORED", "Push failed");
                new Notice("Sync: Push failed");
            }
            
            return result;
        } catch (error) {
            console.error("Push failed:", error);
            this.setStatus("ERRORED", `Push failed: ${error}`);
            new Notice(`Sync error: ${error}`);
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
            new Notice("Sync: Fetching from server (this may take a while)...");
            
            // Step 1: Mark this device as resolved/accepted
            Logger("Marking remote as resolved...", LOG_LEVEL_INFO);
            await this._replicator.markRemoteResolved(this._settings);
            
            // Step 2: Pull all data from server
            Logger("Pulling all data from server...", LOG_LEVEL_INFO);
            const result = await this._replicator.replicateAllFromServer(this._settings, true);
            
            if (result) {
                // Step 3: Rebuild vault from local database
                Logger("Rebuilding vault from local database...", LOG_LEVEL_INFO);
                new Notice("Sync: Writing files to vault...");
                await this.rebuildVaultFromDB();
                
                this.setStatus("COMPLETED", "Fetch completed");
                new Notice("Sync: Fetch completed successfully!");
            } else {
                this.setStatus("ERRORED", "Fetch failed");
                new Notice("Sync: Fetch failed");
            }
            
            return result;
        } catch (error) {
            console.error("Fetch failed:", error);
            this.setStatus("ERRORED", `Fetch failed: ${error}`);
            new Notice(`Sync error: ${error}`);
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
                    
                    // Get content
                    let content: string | ArrayBuffer = "";
                    if ("data" in fullEntry && fullEntry.data) {
                        content = fullEntry.data;
                    }
                    
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
                    const existingFile = vault.getAbstractFileByPath(path);
                    if (existingFile) {
                        if (typeof content === "string") {
                            await vault.modify(existingFile as any, content);
                        } else {
                            await vault.modifyBinary(existingFile as any, content);
                        }
                        updated++;
                    } else {
                        if (typeof content === "string") {
                            await vault.create(path, content);
                        } else {
                            await vault.createBinary(path, content);
                        }
                        created++;
                    }
                    
                    if (processed % 50 === 0) {
                        Logger(`Progress: ${processed} files processed (${created} created, ${updated} updated)`, LOG_LEVEL_INFO);
                        new Notice(`Sync: ${processed} files processed...`);
                    }
                } catch (error) {
                    errors++;
                    Logger(`Error writing file ${path}: ${error}`, LOG_LEVEL_VERBOSE);
                }
            }
            
            Logger(`Rebuild complete: ${processed} files processed, ${created} created, ${updated} updated, ${errors} errors`, LOG_LEVEL_NOTICE);
            new Notice(`Sync: ${processed} files processed (${created} created, ${updated} updated)`);
            
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

    // ==================== Helper Methods ====================

    private getVaultName(): string {
        // @ts-ignore - accessing internal Obsidian API
        return this.plugin.app.vault.getName() || "friday-vault";
    }

    /**
     * Convert document ID to file path
     */
    id2path(id: DocumentID, entry?: EntryHasPath, stripPrefix?: boolean): FilePathWithPrefix {
        // Simple implementation - document ID is the path
        if (entry?.path) {
            return entry.path as FilePathWithPrefix;
        }
        // Remove any prefix like "f:" from the ID
        let path = id as string;
        if (path.startsWith("f:")) {
            path = path.substring(2);
        }
        return path as FilePathWithPrefix;
    }

    /**
     * Convert file path to document ID
     */
    async path2id(filename: FilePathWithPrefix | FilePath, prefix?: string): Promise<DocumentID> {
        // Simple implementation - use path as ID with prefix
        const p = prefix || "f:";
        return `${p}${filename}` as DocumentID;
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

