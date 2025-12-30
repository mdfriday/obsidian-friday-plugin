/**
 * FridayStorageEventManager - Watches vault file events and syncs to database
 * 
 * This is modeled after livesync's StorageEventManager. It:
 * 1. Listens to Obsidian vault events (create, modify, delete, rename)
 * 2. Processes file changes and stores them to the local PouchDB
 * 3. LiveSync replication automatically syncs changes to remote CouchDB
 */

import { TAbstractFile, TFile, TFolder, Plugin } from "obsidian";
import { Logger } from "./core/common/logger";
import { 
    LOG_LEVEL_INFO, 
    LOG_LEVEL_VERBOSE, 
    LOG_LEVEL_NOTICE,
    type FilePath,
    type FilePathWithPrefix,
    type DocumentID,
    type SavingEntry,
} from "./core/common/types";
import { shouldBeIgnored } from "./core/string_and_binary/path";
import type { FridaySyncCore } from "./FridaySyncCore";
import { fireAndForget, createTextBlob, createBinaryBlob, determineTypeFromBlob } from "./core/common/utils";

export type FileEventType = "CREATE" | "CHANGED" | "DELETE" | "RENAME";

export interface FileEvent {
    type: FileEventType;
    path: FilePath;
    oldPath?: FilePath;
    file?: TFile;
}

/**
 * Manages storage events and syncs local file changes to database
 */
export class FridayStorageEventManager {
    private plugin: Plugin;
    private core: FridaySyncCore;
    private isWatching = false;
    
    // Track files being processed to avoid loops
    private processingFiles = new Set<string>();
    
    // Queue for file events to process
    private eventQueue: FileEvent[] = [];
    private isProcessingQueue = false;
    
    // Debounce map for file changes
    private debounceTimers = new Map<string, ReturnType<typeof setTimeout>>();
    private readonly DEBOUNCE_DELAY = 500; // 500ms debounce for file changes
    
    constructor(plugin: Plugin, core: FridaySyncCore) {
        this.plugin = plugin;
        this.core = core;
    }
    
    /**
     * Start watching vault for file changes
     */
    beginWatch() {
        if (this.isWatching) {
            Logger("Storage event manager already watching", LOG_LEVEL_VERBOSE);
            return;
        }
        
        // Bind event handlers
        this.watchVaultCreate = this.watchVaultCreate.bind(this);
        this.watchVaultChange = this.watchVaultChange.bind(this);
        this.watchVaultDelete = this.watchVaultDelete.bind(this);
        this.watchVaultRename = this.watchVaultRename.bind(this);
        
        // Register vault events
        this.plugin.registerEvent(
            this.plugin.app.vault.on("create", this.watchVaultCreate)
        );
        this.plugin.registerEvent(
            this.plugin.app.vault.on("modify", this.watchVaultChange)
        );
        this.plugin.registerEvent(
            this.plugin.app.vault.on("delete", this.watchVaultDelete)
        );
        this.plugin.registerEvent(
            this.plugin.app.vault.on("rename", this.watchVaultRename)
        );
        
        this.isWatching = true;
        Logger("Storage event manager started watching vault", LOG_LEVEL_INFO);
    }
    
    /**
     * Stop watching vault
     */
    stopWatch() {
        this.isWatching = false;
        // Clear any pending debounce timers
        for (const timer of this.debounceTimers.values()) {
            clearTimeout(timer);
        }
        this.debounceTimers.clear();
        Logger("Storage event manager stopped", LOG_LEVEL_VERBOSE);
    }
    
    /**
     * Mark a file as being processed (to prevent feedback loops)
     */
    markFileProcessing(path: string) {
        this.processingFiles.add(path);
        // Auto-clear after 5 seconds
        setTimeout(() => {
            this.processingFiles.delete(path);
        }, 5000);
    }
    
    /**
     * Check if a file is currently being processed
     */
    isFileProcessing(path: string): boolean {
        return this.processingFiles.has(path);
    }
    
    /**
     * Unmark a file as being processed
     */
    unmarkFileProcessing(path: string) {
        this.processingFiles.delete(path);
    }
    
    // ==================== Event Handlers ====================
    
    private watchVaultCreate(file: TAbstractFile) {
        if (file instanceof TFolder) return;
        if (this.isFileProcessing(file.path)) {
            Logger(`File create skipped (being processed): ${file.path}`, LOG_LEVEL_VERBOSE);
            return;
        }
        this.enqueueEvent({
            type: "CREATE",
            path: file.path as FilePath,
            file: file as TFile,
        });
    }
    
    private watchVaultChange(file: TAbstractFile) {
        if (file instanceof TFolder) return;
        if (this.isFileProcessing(file.path)) {
            Logger(`File change skipped (being processed): ${file.path}`, LOG_LEVEL_VERBOSE);
            return;
        }
        // Debounce file changes to avoid rapid consecutive saves
        this.debouncedEnqueue({
            type: "CHANGED",
            path: file.path as FilePath,
            file: file as TFile,
        });
    }
    
    private watchVaultDelete(file: TAbstractFile) {
        if (file instanceof TFolder) return;
        if (this.isFileProcessing(file.path)) {
            Logger(`File delete skipped (being processed): ${file.path}`, LOG_LEVEL_VERBOSE);
            return;
        }
        // Cancel any pending debounce for this file
        const existingTimer = this.debounceTimers.get(file.path);
        if (existingTimer) {
            clearTimeout(existingTimer);
            this.debounceTimers.delete(file.path);
        }
        this.enqueueEvent({
            type: "DELETE",
            path: file.path as FilePath,
        });
    }
    
    private watchVaultRename(file: TAbstractFile, oldPath: string) {
        if (file instanceof TFolder) return;
        // Rename is handled as DELETE old + CREATE new
        this.enqueueEvent({
            type: "DELETE",
            path: oldPath as FilePath,
        });
        this.enqueueEvent({
            type: "CREATE",
            path: file.path as FilePath,
            file: file as TFile,
        });
    }
    
    // ==================== Event Queue Processing ====================
    
    private debouncedEnqueue(event: FileEvent) {
        const path = event.path;
        
        // Clear existing timer for this file
        const existingTimer = this.debounceTimers.get(path);
        if (existingTimer) {
            clearTimeout(existingTimer);
        }
        
        // Set new timer
        const timer = setTimeout(() => {
            this.debounceTimers.delete(path);
            this.enqueueEvent(event);
        }, this.DEBOUNCE_DELAY);
        
        this.debounceTimers.set(path, timer);
    }
    
    private enqueueEvent(event: FileEvent) {
        // Filter out files that should be ignored
        if (shouldBeIgnored(event.path)) {
            Logger(`File ignored: ${event.path}`, LOG_LEVEL_VERBOSE);
            return;
        }
        
        // Check if sync is configured
        if (!this.core.localDatabase) {
            Logger(`Database not ready, skipping event for: ${event.path}`, LOG_LEVEL_VERBOSE);
            return;
        }
        
        this.eventQueue.push(event);
        fireAndForget(() => this.processQueue());
    }
    
    private async processQueue() {
        if (this.isProcessingQueue) return;
        this.isProcessingQueue = true;
        
        try {
            while (this.eventQueue.length > 0) {
                const event = this.eventQueue.shift()!;
                await this.processEvent(event);
            }
        } finally {
            this.isProcessingQueue = false;
        }
    }
    
    private async processEvent(event: FileEvent): Promise<boolean> {
        try {
            switch (event.type) {
                case "CREATE":
                case "CHANGED":
                    return await this.storeFileToDB(event);
                case "DELETE":
                    return await this.deleteFileFromDB(event);
                default:
                    Logger(`Unknown event type: ${event.type}`, LOG_LEVEL_VERBOSE);
                    return false;
            }
        } catch (error) {
            Logger(`Error processing event ${event.type} for ${event.path}: ${error}`, LOG_LEVEL_VERBOSE);
            return false;
        }
    }
    
    // ==================== Database Operations ====================
    
    /**
     * Store a file to the local database
     * This follows livesync's pattern: file -> SavingEntry -> localDatabase.putDBEntry
     * 
     * IMPORTANT: The data must be a Blob, matching livesync's SavingEntry.data type.
     * This ensures proper chunking and encryption during sync.
     */
    private async storeFileToDB(event: FileEvent): Promise<boolean> {
        const path = event.path;
        const file = event.file || this.plugin.app.vault.getAbstractFileByPath(path) as TFile;
        
        if (!file || !(file instanceof TFile)) {
            Logger(`File not found for storage: ${path}`, LOG_LEVEL_VERBOSE);
            return false;
        }
        
        const localDB = this.core.localDatabase;
        if (!localDB) {
            Logger(`Local database not available`, LOG_LEVEL_VERBOSE);
            return false;
        }
        
        try {
            // DEBUG: Log the start of file storage
            console.log(`[Friday Sync] storeFileToDB: Starting storage for ${path}`);
            
            // Read file content and convert to Blob (matching livesync's pattern)
            // livesync uses UXFileInfo.body which is a Blob
            let contentBlob: Blob;
            const isText = this.isTextFile(file);
            
            if (isText) {
                const textContent = await this.plugin.app.vault.read(file);
                contentBlob = createTextBlob(textContent);
                console.log(`[Friday Sync] storeFileToDB: Text file, size=${contentBlob.size}`);
            } else {
                const binaryContent = await this.plugin.app.vault.readBinary(file);
                contentBlob = createBinaryBlob(binaryContent);
                console.log(`[Friday Sync] storeFileToDB: Binary file, size=${contentBlob.size}`);
            }
            
            // Determine document type using livesync's function (matching exact behavior)
            const datatype = determineTypeFromBlob(contentBlob);
            console.log(`[Friday Sync] storeFileToDB: datatype=${datatype}`);
            
            // Create document ID (matching livesync's pattern)
            const id = await this.core.path2id(path as FilePathWithPrefix);
            console.log(`[Friday Sync] storeFileToDB: id=${id}`);
            
            // Create saving entry (following livesync's SavingEntry structure exactly)
            // CRITICAL: data must be a Blob for proper chunking and encryption
            const savingEntry: SavingEntry = {
                _id: id,
                path: path as FilePathWithPrefix,
                data: contentBlob,  // Must be Blob!
                ctime: file.stat.ctime,
                mtime: file.stat.mtime,
                size: file.stat.size,
                children: [],
                datatype: datatype,
                type: datatype,
                eden: {},
            };
            
            console.log(`[Friday Sync] storeFileToDB: Calling putDBEntry...`);
            
            // Store to database (this will handle chunking and the actual write)
            // NOTE: Encryption happens here via transform-pouch if configured
            const result = await localDB.putDBEntry(savingEntry);
            
            if (result !== false) {
                console.log(`[Friday Sync] storeFileToDB: SUCCESS - ${path} stored with rev=${result.rev}`);
                Logger(`STORAGE -> DB: ${path}`, LOG_LEVEL_VERBOSE);
                // Update counter for UI
                this.core.replicationStat.value = {
                    ...this.core.replicationStat.value,
                    sent: this.core.replicationStat.value.sent + 1,
                };
                return true;
            } else {
                console.log(`[Friday Sync] storeFileToDB: FAILED - ${path}`);
                Logger(`Failed to store: ${path}`, LOG_LEVEL_VERBOSE);
                return false;
            }
        } catch (error) {
            console.error(`[Friday Sync] storeFileToDB: ERROR - ${path}:`, error);
            Logger(`Error storing file ${path}: ${error}`, LOG_LEVEL_VERBOSE);
            return false;
        }
    }
    
    /**
     * Delete a file from the local database
     */
    private async deleteFileFromDB(event: FileEvent): Promise<boolean> {
        const path = event.path;
        const localDB = this.core.localDatabase;
        
        if (!localDB) {
            Logger(`Local database not available`, LOG_LEVEL_VERBOSE);
            return false;
        }
        
        try {
            const result = await localDB.deleteDBEntry(path as FilePathWithPrefix);
            
            if (result) {
                Logger(`STORAGE -> DB (delete): ${path}`, LOG_LEVEL_VERBOSE);
                return true;
            } else {
                Logger(`Failed to delete from DB: ${path}`, LOG_LEVEL_VERBOSE);
                return false;
            }
        } catch (error) {
            Logger(`Error deleting file ${path} from DB: ${error}`, LOG_LEVEL_VERBOSE);
            return false;
        }
    }
    
    /**
     * Check if a file is a text file based on extension
     */
    private isTextFile(file: TFile): boolean {
        const textExtensions = [
            'md', 'txt', 'json', 'js', 'ts', 'css', 'html', 'xml', 
            'yaml', 'yml', 'toml', 'csv', 'svg', 'canvas'
        ];
        return textExtensions.includes(file.extension.toLowerCase());
    }
    
    /**
     * Wait until the event queue is empty
     */
    async waitForIdle(): Promise<void> {
        while (this.eventQueue.length > 0 || this.isProcessingQueue) {
            await new Promise(resolve => setTimeout(resolve, 100));
        }
    }
    
    /**
     * Get queue status for debugging
     */
    getStatus(): { queueLength: number; isProcessing: boolean } {
        return {
            queueLength: this.eventQueue.length,
            isProcessing: this.isProcessingQueue,
        };
    }
}

