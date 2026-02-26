/**
 * FridayStorageEventManager - Watches vault file events and syncs to database
 * 
 * This is modeled after livesync's StorageEventManager. It:
 * 1. Listens to Obsidian vault events (create, modify, delete, rename)
 * 2. Processes file changes and stores them to the local PouchDB
 * 3. LiveSync replication automatically syncs changes to remote CouchDB
 * 
 * Key features from livesync:
 * - recentlyTouched: Prevents self-triggered event loops
 * - mtime caching: Prevents reprocessing unchanged files
 * - Content comparison: Only writes when content actually changed
 */

import { TAbstractFile, TFile, TFolder, Plugin } from "obsidian";
import { Logger } from "./core/common/logger";
import { 
    LOG_LEVEL_INFO, 
    LOG_LEVEL_VERBOSE, 
    LOG_LEVEL_NOTICE,
    LOG_LEVEL_DEBUG,
    type FilePath,
    type FilePathWithPrefix,
    type DocumentID,
    type SavingEntry,
    type LoadedEntry,
} from "./core/common/types";
import { shouldBeIgnored } from "./core/string_and_binary/path";
import type { FridaySyncCore } from "./FridaySyncCore";
import { 
    fireAndForget, 
    createTextBlob, 
    createBinaryBlob, 
    determineTypeFromBlob,
    isDocContentSame,
    getDocDataAsArray,
    readAsBlob,
} from "./core/common/utils";
import {
    isMarkedAsSameChanges,
    markChangesAreSame,
    unmarkChanges,
    BASE_IS_NEW,
    TARGET_IS_NEW,
    EVEN,
} from "./utils/sameChangePairs";
import type { MetaEntry } from "./core/common/types";

export type FileEventType = "CREATE" | "CHANGED" | "DELETE" | "RENAME";

export interface FileEvent {
    type: FileEventType;
    path: FilePath;
    oldPath?: FilePath;
    file?: TFile;
    mtime?: number;
    size?: number;
}

// Resolution for mtime comparison
// 2 seconds for comparison (matching livesync for ZIP file compatibility)
const MTIME_RESOLUTION = 2000;

/**
 * Compare mtime with resolution (matching livesync's compareMtime)
 * Exported for use in other modules
 */
export function compareMtime(baseMTime: number, targetMTime: number): "BASE_IS_NEW" | "TARGET_IS_NEW" | "EVEN" {
    const truncatedBaseMTime = Math.floor(baseMTime / MTIME_RESOLUTION) * MTIME_RESOLUTION;
    const truncatedTargetMTime = Math.floor(targetMTime / MTIME_RESOLUTION) * MTIME_RESOLUTION;
    if (truncatedBaseMTime === truncatedTargetMTime) return "EVEN";
    if (truncatedBaseMTime > truncatedTargetMTime) return "BASE_IS_NEW";
    return "TARGET_IS_NEW";
}

/**
 * Compare file freshness with sameChangePairs optimization
 * (Matching livesync's compareFileFreshness from src/common/utils.ts)
 * 
 * This function first checks if the mtimes are marked as "same changes" (identical content),
 * and only falls back to mtime comparison if not marked.
 * 
 * @param baseFile - Base file info (local file or storage)
 * @param targetFile - Target file info (database entry or remote)
 * @returns "BASE_IS_NEW" | "TARGET_IS_NEW" | "EVEN"
 * 
 * @example
 * ```typescript
 * const result = compareFileFreshness(
 *     { path: "note.md", mtime: localFile.stat.mtime },
 *     { path: "note.md", mtime: dbEntry.mtime }
 * );
 * if (result === "EVEN") {
 *     // Files are considered identical, skip processing
 * }
 * ```
 */
export function compareFileFreshness(
    baseFile: { path: string; mtime: number } | undefined,
    targetFile: { path: string; mtime: number } | undefined
): "BASE_IS_NEW" | "TARGET_IS_NEW" | "EVEN" {
    // Handle undefined cases
    if (baseFile === undefined && targetFile === undefined) return "EVEN";
    if (baseFile === undefined) return "TARGET_IS_NEW";
    if (targetFile === undefined) return "BASE_IS_NEW";

    const baseMtime = baseFile.mtime;
    const targetMtime = targetFile.mtime;

    // ✨ Key optimization: Check if these mtimes are marked as same changes
    // This allows us to skip content comparison for known-identical files
    if (baseMtime && targetMtime && isMarkedAsSameChanges(baseFile.path, [baseMtime, targetMtime]) === EVEN) {
        Logger(
            `File mtimes marked as same: ${baseFile.path} [${baseMtime}, ${targetMtime}]`,
            LOG_LEVEL_VERBOSE
        );
        return "EVEN";
    }

    // Fall back to standard mtime comparison
    return compareMtime(baseMtime, targetMtime);
}

/**
 * Manages storage events and syncs local file changes to database
 */
export class FridayStorageEventManager {
    private plugin: Plugin;
    private core: FridaySyncCore;
    private _isWatching = false;
    private _isSuspended = false;  // LiveSync's suspendFileWatching mechanism
    
    /**
     * Whether file watcher is currently active
     */
    get isWatching(): boolean {
        return this._isWatching;
    }
    
    /**
     * Whether file watching is suspended (matching LiveSync's suspendFileWatching)
     */
    get isSuspended(): boolean {
        return this._isSuspended;
    }
    
    // Track files being processed to avoid loops (livesync's processingFiles)
    private processingFiles = new Set<string>();
    
    // ==================== Livesync's recentlyTouched mechanism ====================
    // Tracks files we've recently written to prevent self-triggered events
    // Key format: `${path}-${mtime}-${size}`
    private touchedFiles: string[] = [];
    private readonly MAX_TOUCHED_FILES = 100;
    
    // ==================== Livesync's mtime cache mechanism ====================
    // Tracks last processed mtime for each file to avoid reprocessing
    private lastProcessedMtime = new Map<string, number>();
    
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
    
    // ==================== Livesync's touched mechanism ====================
    
    /**
     * Mark a file as recently touched by us (livesync pattern)
     * This prevents our own writes from triggering sync events
     */
    touch(path: string, mtime: number, size: number) {
        const key = `${path}-${mtime}-${size}`;
        // Add to front, remove duplicates
        this.touchedFiles = this.touchedFiles.filter(k => k !== key);
        this.touchedFiles.unshift(key);
        // Keep only recent entries
        if (this.touchedFiles.length > this.MAX_TOUCHED_FILES) {
            this.touchedFiles = this.touchedFiles.slice(0, this.MAX_TOUCHED_FILES);
        }
        Logger(`Touched: ${path} (mtime=${mtime}, size=${size})`, LOG_LEVEL_DEBUG);
    }
    
    /**
     * Check if a file was recently touched by us (livesync pattern)
     */
    recentlyTouched(file: TFile): boolean {
        const key = `${file.path}-${file.stat.mtime}-${file.stat.size}`;
        const isTouched = this.touchedFiles.includes(key);
        if (isTouched) {
            Logger(`Recently touched, skipping: ${file.path}`, LOG_LEVEL_DEBUG);
        }
        return isTouched;
    }
    
    /**
     * Clear all touched files
     */
    clearTouched() {
        this.touchedFiles = [];
    }
    
    // ==================== File Processing Status ====================
    
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
    
    // ==================== Watch Control ====================
    
    /**
     * Start watching vault for file changes
     * Note: Following livesync, we don't immediately start - allow time for Obsidian to settle
     */
    beginWatch() {
        if (this._isWatching) {
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
        
        // Register raw event for hidden file sync (.obsidian files)
        // @ts-ignore - Internal Obsidian API
        this.plugin.registerEvent(
            this.plugin.app.vault.on("raw", this.watchVaultRawEvents.bind(this))
        );
        
        this._isWatching = true;
        Logger("Storage event manager started watching vault", LOG_LEVEL_INFO);
    }
    
    /**
     * Handle vault raw events for hidden files (.obsidian)
     * Delegates to HiddenFileSync module if enabled
     */
    private watchVaultRawEvents(path: string) {
        const hiddenFileSync = this.core.hiddenFileSync;
        if (hiddenFileSync && hiddenFileSync.isThisModuleEnabled()) {
            // Fire and forget - don't block the event handler
            fireAndForget(() => hiddenFileSync.watchVaultRawEvents(path as FilePath));
        }
    }
    
    /**
     * Stop watching vault
     */
    stopWatch() {
        this._isWatching = false;
        // Clear any pending debounce timers
        for (const timer of this.debounceTimers.values()) {
            clearTimeout(timer);
        }
        this.debounceTimers.clear();
        Logger("Storage event manager stopped", LOG_LEVEL_VERBOSE);
    }
    
    /**
     * Suspend file watching (LiveSync's suspendFileWatching pattern)
     * Used when processing remote updates to prevent feedback loops
     */
    suspend() {
        this._isSuspended = true;
        Logger("📛 File watching suspended (processing remote updates)", LOG_LEVEL_VERBOSE);
    }
    
    /**
     * Resume file watching after processing remote updates
     */
    resume() {
        this._isSuspended = false;
        Logger("✅ File watching resumed", LOG_LEVEL_VERBOSE);
    }
    
    /**
     * Check if we should process vault events
     * Implements LiveSync's suspendFileWatching safety valve
     */
    private shouldProcessEvent(): boolean {
        if (!this._isWatching) {
            return false;
        }
        return !this._isSuspended;
    }
    
    // ==================== Event Handlers ====================
    
    private watchVaultCreate(file: TAbstractFile) {
        // Check if we should process events (LiveSync's suspendFileWatching)
        if (!this.shouldProcessEvent()) {
            Logger(`File create skipped (watching suspended): ${file.path}`, LOG_LEVEL_DEBUG);
            return;
        }
        
        if (file instanceof TFolder) return;
        if (this.isFileProcessing(file.path)) {
            Logger(`File create skipped (being processed): ${file.path}`, LOG_LEVEL_VERBOSE);
            return;
        }
        // Note: recentlyTouched check moved to processEvent (after delay(10))
        this.enqueueEvent({
            type: "CREATE",
            path: file.path as FilePath,
            file: file as TFile,
            mtime: (file as TFile).stat.mtime,
            size: (file as TFile).stat.size,
        });
    }
    
    private watchVaultChange(file: TAbstractFile) {
        // Check if we should process events (LiveSync's suspendFileWatching)
        if (!this.shouldProcessEvent()) {
            Logger(`File change skipped (watching suspended): ${file.path}`, LOG_LEVEL_DEBUG);
            return;
        }
        
        if (file instanceof TFolder) return;
        if (this.isFileProcessing(file.path)) {
            Logger(`File change skipped (being processed): ${file.path}`, LOG_LEVEL_VERBOSE);
            return;
        }
        // Note: recentlyTouched check moved to processEvent (after delay(10))
        // Debounce file changes to avoid rapid consecutive saves
        this.debouncedEnqueue({
            type: "CHANGED",
            path: file.path as FilePath,
            file: file as TFile,
            mtime: (file as TFile).stat.mtime,
            size: (file as TFile).stat.size,
        });
    }
    
    private watchVaultDelete(file: TAbstractFile) {
        // Check if we should process events (LiveSync's suspendFileWatching)
        if (!this.shouldProcessEvent()) {
            Logger(`File delete skipped (watching suspended): ${file.path}`, LOG_LEVEL_DEBUG);
            return;
        }
        
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
        // Note: LiveSync does NOT call unmarkChanges here
        // The sameChangePairs will be naturally cleaned up when file is recreated
        this.enqueueEvent({
            type: "DELETE",
            path: file.path as FilePath,
        });
    }
    
    private watchVaultRename(file: TAbstractFile, oldPath: string) {
        // Check if we should process events (LiveSync's suspendFileWatching)
        if (!this.shouldProcessEvent()) {
            Logger(`File rename skipped (watching suspended): ${oldPath} -> ${file.path}`, LOG_LEVEL_DEBUG);
            return;
        }
        
        if (file instanceof TFolder) return;
        // Note: LiveSync does NOT call unmarkChanges here
        // Rename is handled as DELETE old + CREATE new
        this.enqueueEvent({
            type: "DELETE",
            path: oldPath as FilePath,
        });
        this.enqueueEvent({
            type: "CREATE",
            path: file.path as FilePath,
            file: file as TFile,
            mtime: (file as TFile).stat.mtime,
            size: (file as TFile).stat.size,
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
            // ========== LiveSync Layer 2: touched + recentlyTouched ==========
            // For CREATE/CHANGED events, wait for writer to mark as touched
            // This is the CORE protection against self-triggered sync loops
            if (event.type === "CREATE" || event.type === "CHANGED") {
                if (event.file) {
                    // Wait 10ms to let the writer complete the touch() call
                    // This matches livesync's StorageEventManager.appendQueue line 279
                    await new Promise(resolve => setTimeout(resolve, 10));
                    
                    // Check if this file was recently touched by us
                    // If yes, this event was triggered by our own write → skip it
                    if (this.recentlyTouched(event.file)) {
                        Logger(`File recently touched by us, skipping: ${event.path}`, LOG_LEVEL_VERBOSE);
                        return true;
                    }
                }
            }
            
            // Check if file is ignored by ignore patterns
            // Following livesync design: ALL events (including DELETE) are checked
            // This means ignored files' operations are never synced
            if (!(await this.core.isTargetFile(event.path))) {
                Logger(`File ignored by ignore patterns: ${event.path}`, LOG_LEVEL_VERBOSE);
                return true;
            }
            
            // Livesync pattern: Check mtime cache to avoid reprocessing
            if (event.type !== "DELETE" && event.mtime !== undefined) {
                const cacheKey = `${event.type}-${event.path}`;
                const lastMtime = this.lastProcessedMtime.get(cacheKey);
                if (lastMtime !== undefined && lastMtime === event.mtime) {
                    Logger(`File already processed at this mtime, skip: ${event.path}`, LOG_LEVEL_VERBOSE);
                    return true;
                }
            }
            
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

    /**
	 * Process a file event directly, bypassing queue and debounce
	 *
	 * Used by rebuildRemote() to scan and store all vault files at once.
	 * This is a public method that allows direct file processing.
	 *
	 * @param event
	 * @param force - If true, skip content comparison and force write
	 */
    async processFileEventDirect(event: FileEvent, force: boolean = false): Promise<boolean> {
        // Skip if file is being processed (to prevent circular sync)
        if (this.isFileProcessing(event.path)) {
            return true;
        }
        
        // Filter out files that should be ignored (livesync internal flags)
        if (shouldBeIgnored(event.path)) {
            return true;
        }
        
        // Check if file is ignored by ignore patterns
        if (!(await this.core.isTargetFile(event.path))) {
            Logger(`File ignored by ignore patterns: ${event.path}`, LOG_LEVEL_VERBOSE);
            return true;
        }
        
        return await this.storeFileToDB(event, force);
    }
    
    // ==================== Database Operations ====================
    
    /**
     * Store a file to the local database
     * This follows livesync's pattern: file -> SavingEntry -> localDatabase.putDBEntry
     * 
     * Key features from livesync:
     * 1. Check if file exists in DB first
     * 2. Compare mtime (with resolution) 
     * 3. Compare content if mtime suggests change
     * 4. Only write if content actually changed
     * 
     * @param event - The file event to process
     * @param force - If true, skip comparison and force write
     */
    private async storeFileToDB(event: FileEvent, force: boolean = false): Promise<boolean> {
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
            // Create document ID (matching livesync's pattern)
            const id = await this.core.path2id(path as FilePathWithPrefix);
            
            // Read file content
            const isText = this.isTextFile(file);
            let contentBlob: Blob;
            
            if (isText) {
                const textContent = await this.plugin.app.vault.read(file);
                contentBlob = createTextBlob(textContent);
            } else {
                const binaryContent = await this.plugin.app.vault.readBinary(file);
                contentBlob = createBinaryBlob(binaryContent);
            }
            
            // ==================== Livesync's content comparison logic ====================
            // Only perform comparison if not forced
            if (!force) {
				try {
					// Try to get existing entry from database
					const existingEntry = await localDB.getDBEntry(path as FilePathWithPrefix, undefined, false, true, false);

					if (existingEntry && !existingEntry.deleted && !existingEntry._deleted) {
						// Entry exists, check if we need to update
						let shouldUpdate = false;

						// ✨ Step 1: Use compareFileFreshness (checks sameChangePairs first)
						const freshnessResult = compareFileFreshness(
							{path, mtime: file.stat.mtime},
							{path, mtime: existingEntry.mtime}
						);

					switch (freshnessResult) {
						case "EVEN":
							Logger(`File mtimes are equivalent (marked or same), skip: ${path}`, LOG_LEVEL_VERBOSE);
							// Update mtime cache
							const cacheKey = `${event.type}-${path}`;
							this.lastProcessedMtime.set(cacheKey, file.stat.mtime);
							return true;
						case "BASE_IS_NEW":
						case "TARGET_IS_NEW":
							shouldUpdate = true;
							break;
					}

						// 2. Compare mtime with standard 2-second resolution (aligned with livesync)
						// Note: compareFileFreshness already did this, but if we reach here,
						// it means freshnessResult was not "EVEN", so we need to check content

					// 3. If mtime suggests change, compare content (livesync pattern)
					if (shouldUpdate) {
						const existingData = getDocDataAsArray(existingEntry.data);
						const isSame = await isDocContentSame(existingData, contentBlob);

						if (isSame) {
							// ✨ Content is same despite different mtime - mark them!
							markChangesAreSame(path, file.stat.mtime, existingEntry.mtime);
							Logger(`File content unchanged (mtime different), marked as same: ${path}`, LOG_LEVEL_VERBOSE);
							// Update mtime cache
							const cacheKey = `${event.type}-${path}`;
							this.lastProcessedMtime.set(cacheKey, file.stat.mtime);
							return true;
						} else {
							// Content is different - clear old marks
							unmarkChanges(path);
						}
					}
				}

				Logger(`File changed, updating: ${path}`, LOG_LEVEL_VERBOSE);
                } catch (e) {
                    // Entry doesn't exist or error getting it - proceed with creation
                    Logger(`Entry not found or error, creating: ${path}`, LOG_LEVEL_VERBOSE);
                }
            }
            
            // ==================== Create and store the entry ====================
            
            // Determine document type using livesync's function
            const datatype = determineTypeFromBlob(contentBlob);
            
            // Create saving entry (following livesync's SavingEntry structure exactly)
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
            
            // Store to database (this will handle chunking and the actual write)
            const result = await localDB.putDBEntry(savingEntry);
            
            if (result !== false) {
                // Success! Update caches
                const cacheKey = `${event.type}-${path}`;
                this.lastProcessedMtime.set(cacheKey, file.stat.mtime);
                
                // Note: LiveSync does NOT call unmarkChanges after successful write
                // The sameChangePairs marks should be preserved for future comparisons
                
                Logger(`STORAGE -> DB (${datatype}) ${path}`);
                
                // Note: Do NOT update counter here - LiveSyncReplicator will count on push
                // The replicator.docSent will include all docs (metadata + chunks) when pushed
                
                return true;
            } else {
                Logger(`Failed to store: ${path}`, LOG_LEVEL_INFO);
                return false;
            }
        } catch (error) {
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
                // Clear caches for deleted file
                this.lastProcessedMtime.delete(`CREATE-${path}`);
                this.lastProcessedMtime.delete(`CHANGED-${path}`);
                
                // Note: LiveSync does NOT call unmarkChanges in deleteFileFromDB
                // The sameChangePairs will be naturally cleaned up if file is recreated
                
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
    getStatus(): { queueLength: number; isProcessing: boolean; touchedCount: number } {
        return {
            queueLength: this.eventQueue.length,
            isProcessing: this.isProcessingQueue,
            touchedCount: this.touchedFiles.length,
        };
    }
}
