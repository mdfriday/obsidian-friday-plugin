/**
 * FridayHiddenFileSync - Hidden file synchronization module for Friday plugin
 * 
 * Ported from livesync's CmdHiddenFileSync.ts to enable .obsidian folder synchronization.
 * This module handles bidirectional sync of hidden files (themes, plugins, snippets, settings).
 * 
 * Key features:
 * - Real-time monitoring of .obsidian file changes via vault "raw" events
 * - Periodic scanning for offline changes
 * - Content comparison to avoid unnecessary writes
 * - Conflict detection and resolution
 * - Integration with livesync's database format (i: prefix for internal files)
 */

import { type Plugin, type ListedFiles } from "obsidian";
import { serialized, skipIfDuplicated } from "octagonal-wheels/concurrency/lock";
import { Semaphore } from "octagonal-wheels/concurrency/semaphore";
import { QueueProcessor } from "octagonal-wheels/concurrency/processor";

import type { FridaySyncCore } from "src/sync";
import {
    type FilePath,
    type FilePathWithPrefix,
    type LoadedEntry,
    type MetaEntry,
    type SavingEntry,
    type DocumentID,
    type UXStat,
    LOG_LEVEL_INFO,
    LOG_LEVEL_VERBOSE,
    LOG_LEVEL_NOTICE,
    ICHeader,
    ICHeaderEnd,
    ICHeaderLength,
    DEFAULT_INTERNAL_IGNORE_PATTERNS,
    type InternalFileInfo,
} from "src/sync";

/**
 * Conflict information for resolution processing
 */
interface ConflictInfo {
    path: FilePathWithPrefix;
    revA: string;  // Current revision
    revB: string;  // Conflicted revision
    id: DocumentID;
    doc: MetaEntry;
}
import { Logger } from "../../core/common/logger";
import { isDocContentSame, readContent, createBlob, readAsBlob } from "@lib/common/utils.ts";
import { addPrefix, stripAllPrefixes, isPlainText } from "@lib/string_and_binary/path.ts";
import {
    isInternalMetadata,
    stripInternalMetadataPrefix,
    compareMTime,
    markChangesAreSame,
    unmarkChanges,
    getComparingMTime,
    onlyInNTimes,
    statToKey,
    docToKey,
    parsePatterns,
    matchesAnyPattern,
    getPath,
    TARGET_IS_NEW,
    BASE_IS_NEW,
    EVEN,
} from "../../utils/hiddenFileUtils";

/**
 * UXFileInfo interface for file with content
 */
interface UXFileInfo {
    name: string;
    path: string;
    stat: UXStat;
    isInternal: boolean;
    deleted: boolean;
    body: Blob;
}

/**
 * FridayHiddenFileSync - Main hidden file sync module
 */
export class FridayHiddenFileSync {
    private plugin: Plugin;
    private core: FridaySyncCore;
    
    // Cache management for tracking processed files
    private _fileInfoLastProcessed: Map<string, string> = new Map();
    private _fileInfoLastKnown: Map<string, number> = new Map();
    private _databaseInfoLastProcessed: Map<string, string> = new Map();
    
    // RegExp cache for pattern matching
    private cacheFileRegExps: Map<string, RegExp[][]> = new Map();
    
    // Semaphore for limiting concurrent operations
    private semaphore = Semaphore(10);
    
    // Periodic scan timer
    private periodicScanTimer: number | null = null;
    
    // Module enabled state
    private _enabled: boolean = true;
    
    // Conflict resolution queue processor
    private conflictResolutionProcessor!: QueueProcessor<FilePathWithPrefix[], ConflictInfo[]>;

    constructor(plugin: Plugin, core: FridaySyncCore) {
        this.plugin = plugin;
        this.core = core;
        this.initConflictResolutionProcessor();
    }

    // ==================== Module State ====================

    /**
     * Check if hidden file sync module is enabled
     */
    isThisModuleEnabled(): boolean {
        const settings = this.core.getSettings();
        return this._enabled && (settings.syncInternalFiles ?? true);
    }

    /**
     * Get the vault adapter for file operations
     */
    private get adapter() {
        return this.plugin.app.vault.adapter;
    }

    /**
     * Get the config directory (usually .obsidian)
     */
    private get configDir(): string {
        return this.plugin.app.vault.configDir;
    }

    /**
     * Get settings with defaults
     */
    private get settings() {
        const s = this.core.getSettings();
        return {
            syncInternalFiles: s.syncInternalFiles ?? true,
            syncInternalFilesIgnorePatterns: s.syncInternalFilesIgnorePatterns ?? DEFAULT_INTERNAL_IGNORE_PATTERNS,
            syncInternalFilesTargetPatterns: s.syncInternalFilesTargetPatterns ?? "",
            syncInternalFileOverwritePatterns: s.syncInternalFileOverwritePatterns ?? "",
            watchInternalFileChanges: s.watchInternalFileChanges ?? true,
            syncInternalFilesInterval: s.syncInternalFilesInterval ?? 60,
        };
    }

    // ==================== Lifecycle ====================

    /**
     * Initialize the module
     */
    async onload(): Promise<void> {
        Logger("[HiddenFileSync] Module loaded", LOG_LEVEL_INFO);
        
        // Clear caches
        this._fileInfoLastProcessed.clear();
        this._fileInfoLastKnown.clear();
        this._databaseInfoLastProcessed.clear();
        this.cacheFileRegExps.clear();
        
        // Resolve any existing conflicts before starting sync
        await this.resolveConflictOnInternalFiles();
        
        // Start periodic scan if enabled
        this.startPeriodicScan();
    }

    /**
     * Cleanup the module
     */
    onunload(): void {
        this.stopPeriodicScan();
        Logger("[HiddenFileSync] Module unloaded", LOG_LEVEL_INFO);
    }

    /**
     * Start periodic scanning for hidden file changes
     */
    private startPeriodicScan(): void {
        this.stopPeriodicScan();
        
        const interval = this.settings.syncInternalFilesInterval;
        if (interval > 0 && this.isThisModuleEnabled()) {
            this.periodicScanTimer = window.setInterval(async () => {
                if (this.isThisModuleEnabled()) {
                    await this.scanAllStorageChanges(false);
                }
            }, interval * 1000);
        }
    }

    /**
     * Stop periodic scanning
     */
    private stopPeriodicScan(): void {
        if (this.periodicScanTimer !== null) {
            window.clearInterval(this.periodicScanTimer);
            this.periodicScanTimer = null;
        }
    }

    // ==================== Target File Detection ====================

    /**
     * Check if path is a hidden file that should be handled
     */
    isHiddenFileSyncHandlingPath(path: FilePath): boolean {
        // Must start with . but not be .trash
        return path.startsWith(".") && !path.startsWith(".trash");
    }

    /**
     * Parse RegExp settings with caching
     */
    private parseRegExpSettings(): { ignoreFilter: RegExp[]; targetFilter: RegExp[] } {
        const key = `${this.settings.syncInternalFilesTargetPatterns}||${this.settings.syncInternalFilesIgnorePatterns}`;
        
        if (this.cacheFileRegExps.has(key)) {
            const cached = this.cacheFileRegExps.get(key)!;
            return { targetFilter: cached[0], ignoreFilter: cached[1] };
        }
        
        const ignoreFilter = parsePatterns(this.settings.syncInternalFilesIgnorePatterns);
        const targetFilter = parsePatterns(this.settings.syncInternalFilesTargetPatterns);
        
        this.cacheFileRegExps.clear();
        this.cacheFileRegExps.set(key, [targetFilter, ignoreFilter]);
        
        return { ignoreFilter, targetFilter };
    }

    /**
     * Check if path matches target patterns and not ignored
     */
    isTargetFileInPatterns(path: string): boolean {
        const { ignoreFilter, targetFilter } = this.parseRegExpSettings();
        
        // Check ignore patterns first
        if (ignoreFilter.length > 0 && matchesAnyPattern(path, ignoreFilter)) {
            return false;
        }
        
        // If target patterns exist, path must match one
        if (targetFilter.length > 0) {
            return matchesAnyPattern(path, targetFilter);
        }
        
        // No target patterns means accept all non-ignored
        return true;
    }

    /**
     * Check if file is a valid sync target
     */
    async isTargetFile(path: FilePath): Promise<boolean> {
        // Must be hidden file sync path
        if (!this.isHiddenFileSyncHandlingPath(path)) {
            return false;
        }
        
        // Must match patterns
        if (!this.isTargetFileInPatterns(path)) {
            return false;
        }
        
        // Check against ignore file if configured
        if (this.core.isIgnoredByIgnoreFile) {
            const ignored = await this.core.isIgnoredByIgnoreFile(path);
            if (ignored) return false;
        }
        
        return true;
    }

    // ==================== Storage Operations ====================

    /**
     * Load file content and stat
     * CRITICAL: Use text reading for plain text files (.js, .css, .json, etc.)
     * to match livesync's adapterReadAuto behavior.
     * This ensures storage type matches retrieval logic in readContent().
     */
    async loadFileWithInfo(path: FilePath): Promise<UXFileInfo> {
        try {
            const stat = await this.adapter.stat(path);
            if (!stat) {
                return {
                    name: path.split("/").pop() ?? "",
                    path,
                    stat: { size: 0, mtime: 0, ctime: 0, type: "file" },
                    isInternal: true,
                    deleted: true,
                    body: createBlob(new Uint8Array(0)),
                };
            }
            
            // Use the same logic as livesync's adapterReadAuto:
            // - Plain text files (.js, .css, .json, etc.) are read as text
            // - Binary files are read as binary
            // This ensures the Blob type matches what readContent() expects
            let content: string | ArrayBuffer;
            if (isPlainText(path)) {
                content = await this.adapter.read(path);  // Read as text
            } else {
                content = await this.adapter.readBinary(path);  // Read as binary
            }
            
            return {
                name: path.split("/").pop() ?? "",
                path,
                stat: { size: stat.size, mtime: stat.mtime, ctime: stat.ctime, type: "file" },
                isInternal: true,
                deleted: false,
                body: createBlob(content),
            };
        } catch {
            return {
                name: path.split("/").pop() ?? "",
                path,
                stat: { size: 0, mtime: 0, ctime: 0, type: "file" },
                isInternal: true,
                deleted: true,
                body: createBlob(new Uint8Array(0)),
            };
        }
    }

    /**
     * Ensure directory exists
     */
    async ensureDir(path: FilePath): Promise<void> {
        const dir = path.substring(0, path.lastIndexOf("/"));
        if (dir && !(await this.adapter.exists(dir))) {
            try {
                await this.plugin.app.vault.createFolder(dir);
            } catch {
                // Directory might already exist
            }
        }
    }

    /**
     * Write file to storage
     */
    async writeFile(path: FilePath, data: string | ArrayBuffer, opt?: { mtime?: number; ctime?: number }): Promise<UXStat | null> {
        try {
            await this.ensureDir(path);
            
            if (typeof data === "string") {
                await this.adapter.write(path, data);
            } else {
                await this.adapter.writeBinary(path, data);
            }
            
            // Try to set mtime if provided
            if (opt?.mtime) {
                try {
                    // @ts-ignore - Internal API
                    await this.adapter.setMtime?.(path, opt.mtime);
                } catch {
                    // mtime setting not supported
                }
            }
            
            const stat = await this.adapter.stat(path);
            return stat ? { size: stat.size, mtime: stat.mtime, ctime: stat.ctime, type: "file" } : null;
        } catch (ex) {
            Logger(`[HiddenFileSync] Failed to write file: ${path}`, LOG_LEVEL_VERBOSE);
            Logger(ex, LOG_LEVEL_VERBOSE);
            return null;
        }
    }

    /**
     * Remove file from storage
     */
    async removeFile(path: FilePath): Promise<"OK" | "ALREADY" | false> {
        try {
            if (!(await this.adapter.exists(path))) {
                return "ALREADY";
            }
            await this.adapter.remove(path);
            return "OK";
        } catch (ex) {
            Logger(`[HiddenFileSync] Failed to remove file: ${path}`, LOG_LEVEL_VERBOSE);
            Logger(ex, LOG_LEVEL_VERBOSE);
            return false;
        }
    }

    // ==================== Cache Management ====================

    /**
     * Update last processed file cache
     */
    updateLastProcessedFile(file: FilePath, keySrc: string | UXStat): void {
        const key = typeof keySrc === "string" ? keySrc : statToKey(keySrc);
        const mtime = parseInt(key.split("-")[0]);
        if (mtime !== 0) {
            this._fileInfoLastKnown.set(file, mtime);
        }
        this._fileInfoLastProcessed.set(file, key);
    }

    /**
     * Get last processed file key
     */
    getLastProcessedFileKey(file: FilePath): string | undefined {
        return this._fileInfoLastProcessed.get(file);
    }

    /**
     * Get last known file mtime
     */
    getLastProcessedFileMTime(file: FilePath): number {
        return this._fileInfoLastKnown.get(file) ?? 0;
    }

    /**
     * Update last processed database cache
     */
    updateLastProcessedDatabase(file: FilePath, keySrc: string | MetaEntry | LoadedEntry): void {
        const key = typeof keySrc === "string" ? keySrc : docToKey(keySrc);
        this._databaseInfoLastProcessed.set(file, key);
    }

    /**
     * Get last processed database key
     */
    getLastProcessedDatabaseKey(file: FilePath): string | undefined {
        return this._databaseInfoLastProcessed.get(file);
    }

    /**
     * Update both file and database processed caches
     */
    updateLastProcessed(path: FilePath, db: MetaEntry | LoadedEntry, stat: UXStat): void {
        this.updateLastProcessedDatabase(path, db);
        this.updateLastProcessedFile(path, statToKey(stat));
        
        const dbMTime = getComparingMTime(db);
        const storageMTime = getComparingMTime({ stat });
        
        if (dbMTime === 0 || storageMTime === 0) {
            unmarkChanges(path);
        } else {
            markChangesAreSame(path, dbMTime, storageMTime);
        }
    }

    /**
     * Update processed cache for deletion
     */
    updateLastProcessedDeletion(path: FilePath, db: MetaEntry | LoadedEntry | false): void {
        unmarkChanges(path);
        if (db) this.updateLastProcessedDatabase(path, db);
        this.updateLastProcessedFile(path, statToKey(null));
    }

    /**
     * Reset file processed cache
     */
    resetLastProcessedFile(targetFiles: FilePath[] | false): void {
        if (targetFiles) {
            for (const key of targetFiles) {
                this._fileInfoLastProcessed.delete(key);
            }
        } else {
            this._fileInfoLastProcessed.clear();
        }
    }

    /**
     * Reset database processed cache
     */
    resetLastProcessedDatabase(targetFiles: FilePath[] | false): void {
        if (targetFiles) {
            for (const key of targetFiles) {
                this._databaseInfoLastProcessed.delete(key);
            }
        } else {
            this._databaseInfoLastProcessed.clear();
        }
    }

    // ==================== Database Operations ====================

    /**
     * Load base save data for a file
     */
    private async loadBaseSaveData(file: FilePath, includeContent = true): Promise<LoadedEntry | false> {
        const localDB = this.core.localDatabase;
        if (!localDB) return false;
        
        const prefixedFileName = addPrefix(file, ICHeader);
        // FIX: Don't pass ICHeader prefix to path2id since prefixedFileName already has it
        // path2id will add the prefix if we pass it, causing double "i:" prefix
        const id = await this.core.path2id(prefixedFileName);
        
        try {
            const old = includeContent
                ? await localDB.getDBEntry(prefixedFileName, undefined, false, true)
                : await localDB.getDBEntryMeta(prefixedFileName, { conflicts: true }, true);
            
            if (old === false) {
                // Create new entry
                const baseSaveData: LoadedEntry = {
                    _id: id,
                    data: [],
                    path: prefixedFileName,
                    mtime: 0,
                    ctime: 0,
                    datatype: "newnote",
                    children: [],
                    size: 0,
                    deleted: false,
                    type: "newnote",
                    eden: {},
                };
                return baseSaveData;
            }
            return old;
        } catch (ex) {
            Logger(`[HiddenFileSync] Failed to load base data: ${file}`, LOG_LEVEL_VERBOSE);
            Logger(ex, LOG_LEVEL_VERBOSE);
            return false;
        }
    }

    /**
     * Store internal file to database
     */
    async storeInternalFileToDatabase(file: InternalFileInfo | UXFileInfo, forceWrite = false): Promise<boolean | undefined> {
        const localDB = this.core.localDatabase;
        if (!localDB) return false;
        
        const storeFilePath = stripAllPrefixes(file.path as FilePath);
        const prefixedFileName = addPrefix(storeFilePath, ICHeader);
        
        // Check if ignored
        if (this.core.isIgnoredByIgnoreFile && await this.core.isIgnoredByIgnoreFile(storeFilePath)) {
            return undefined;
        }
        
        return await serialized("file-" + prefixedFileName, async () => {
            try {
                // Load file info if not provided
                const fileInfo = "body" in file && "stat" in file 
                    ? file as UXFileInfo
                    : await this.loadFileWithInfo(storeFilePath);
                
                if (fileInfo.deleted) {
                    throw new Error(`Hidden file ${storeFilePath} is deleted`);
                }
                
                // Load existing document
                const baseData = await this.loadBaseSaveData(storeFilePath, true);
                if (baseData === false) throw new Error("Failed to load base data");
                
                // Check if content actually changed
                if (baseData._rev && !forceWrite) {
                    const isSame = await isDocContentSame(readAsBlob(baseData), fileInfo.body);
                    if (isSame) {
                        this.updateLastProcessed(storeFilePath, baseData, fileInfo.stat);
                        return undefined; // No change
                    }
                }
                
                // Create save entry
                const saveData: SavingEntry = {
                    ...baseData,
                    data: fileInfo.body,
                    mtime: fileInfo.stat.mtime,
                    ctime: fileInfo.stat.ctime,
                    size: fileInfo.stat.size,
                    children: [],
                    deleted: false,
                    type: baseData.datatype,
                };
                
                // Save to database
                const ret = await localDB.putDBEntry(saveData);
                if (ret && ret.ok) {
                    saveData._rev = ret.rev;
                    this.updateLastProcessed(storeFilePath, saveData as any, fileInfo.stat);
                }
                
                const success = ret && ret.ok;
                Logger(`STORAGE --> DB:${storeFilePath}: (hidden) ${success ? "Done" : "Failed"}`, LOG_LEVEL_INFO);
                return success;
            } catch (ex) {
                Logger(`STORAGE --> DB:${storeFilePath}: (hidden) Failed`, LOG_LEVEL_INFO);
                Logger(ex, LOG_LEVEL_VERBOSE);
                return false;
            }
        });
    }

    /**
     * Delete internal file from database
     */
    async deleteInternalFileOnDatabase(filenameSrc: FilePath, forceWrite = false): Promise<boolean | undefined> {
        const localDB = this.core.localDatabase;
        if (!localDB) return false;
        
        const storeFilePath = filenameSrc;
        const prefixedFileName = addPrefix(storeFilePath, ICHeader);
        const mtime = Date.now();
        
        // Check if ignored
        if (this.core.isIgnoredByIgnoreFile && await this.core.isIgnoredByIgnoreFile(storeFilePath)) {
            return undefined;
        }
        
        return await serialized("file-" + prefixedFileName, async () => {
            try {
                const baseData = await this.loadBaseSaveData(storeFilePath, false);
                if (baseData === false) throw new Error("Failed to load base data during deleting");
                
                // Handle conflicts
                if ((baseData as any)._conflicts !== undefined) {
                    for (const conflictRev of (baseData as any)._conflicts) {
                        await localDB.removeRevision(baseData._id, conflictRev);
                    }
                }
                
                // Check if already deleted
                if ((baseData as any).deleted) {
                    this.updateLastProcessedDeletion(storeFilePath, baseData as any);
                    return true;
                }
                
                // Mark as deleted
                const saveData: LoadedEntry = {
                    ...baseData as any,
                    mtime,
                    size: 0,
                    children: [],
                    deleted: true,
                    type: baseData.datatype,
                };
                
                const ret = await localDB.putRaw(saveData);
                if (ret && ret.ok) {
                    Logger(`STORAGE -x> DB:${storeFilePath}: (hidden) Done`, LOG_LEVEL_INFO);
                    saveData._rev = ret.rev;
                    this.updateLastProcessedDeletion(storeFilePath, saveData);
                    return true;
                }
                
                Logger(`STORAGE -x> DB:${storeFilePath}: (hidden) Failed`, LOG_LEVEL_INFO);
                return false;
            } catch (ex) {
                Logger(`STORAGE -x> DB:${storeFilePath}: (hidden) Failed`, LOG_LEVEL_INFO);
                Logger(ex, LOG_LEVEL_VERBOSE);
                return false;
            }
        });
    }

    /**
     * Extract internal file from database to storage
     */
    async extractInternalFileFromDatabase(
        storageFilePath: FilePath,
        force = false,
        metaEntry?: MetaEntry | LoadedEntry,
        preventDoubleProcess = true,
        onlyNew = false,
        includeDeletion = true
    ): Promise<boolean | undefined> {
        const localDB = this.core.localDatabase;
        if (!localDB) return false;
        
        const prefixedFileName = addPrefix(storageFilePath, ICHeader);
        
        // Check if ignored
        if (this.core.isIgnoredByIgnoreFile && await this.core.isIgnoredByIgnoreFile(storageFilePath)) {
            return undefined;
        }
        
        return await serialized("file-" + prefixedFileName, async () => {
            try {
                // Get document metadata
                const metaOnDB = metaEntry || await localDB.getDBEntryMeta(prefixedFileName, { conflicts: true }, true);
                if (metaOnDB === false) throw new Error(`File not found on database: ${storageFilePath}`);
                
                // Check for conflicts - queue resolution instead of skipping
                if ((metaOnDB as any)._conflicts?.length) {
                    Logger(`[HiddenFileSync] ${storageFilePath} has conflicts, queuing resolution`, LOG_LEVEL_INFO);
                    const prefixedPath = addPrefix(storageFilePath, ICHeader) as FilePathWithPrefix;
                    this.queueConflictCheck(prefixedPath);
                    return false;  // Don't write until conflict resolved
                }
                
                // Prevent double processing
                if (preventDoubleProcess) {
                    const key = docToKey(metaOnDB);
                    if (this.getLastProcessedDatabaseKey(storageFilePath) === key && !force) {
                        return undefined;
                    }
                }
                
                // Check if newer
                if (onlyNew) {
                    const dbMTime = getComparingMTime(metaOnDB, includeDeletion);
                    const storageStat = await this.adapter.stat(storageFilePath);
                    const storageMTimeActual = storageStat?.mtime ?? 0;
                    const storageMTime = storageMTimeActual === 0 
                        ? this.getLastProcessedFileMTime(storageFilePath) 
                        : storageMTimeActual;
                    
                    const diff = compareMTime(storageMTime, dbMTime);
                    if (diff !== TARGET_IS_NEW) {
                        this.updateLastProcessedDatabase(storageFilePath, metaOnDB);
                        if (storageStat) this.updateLastProcessedFile(storageFilePath, { 
                            mtime: storageStat.mtime, 
                            size: storageStat.size, 
                            ctime: storageStat.ctime, 
                            type: "file" 
                        });
                        return undefined;
                    }
                }
                
                // Check if deleted
                const deleted = (metaOnDB as any).deleted || (metaOnDB as any)._deleted || false;
                if (deleted) {
                    const result = await this.removeFile(storageFilePath);
                    if (result === "OK" || result === "ALREADY") {
                        this.updateLastProcessedDeletion(storageFilePath, metaOnDB);
                        Logger(`STORAGE <x- DB:${storageFilePath}: deleted (hidden)`, LOG_LEVEL_INFO);
                        return true;
                    }
                    return false;
                }
                
                // Get full document with content
                const fileOnDB = await localDB.getDBEntryFromMeta(metaOnDB, false, true);
                if (fileOnDB === false) {
                    throw new Error(`Failed to read file from database: ${storageFilePath}`);
                }
                
                // Write to storage
                const writeContent = readContent(fileOnDB);
                const resultStat = await this.writeFile(storageFilePath, writeContent, {
                    mtime: (fileOnDB as any).mtime,
                    ctime: (fileOnDB as any).ctime,
                });
                
                if (resultStat) {
                    this.updateLastProcessed(storageFilePath, metaOnDB, resultStat);
                    Logger(`STORAGE <-- DB:${storageFilePath}: written (hidden)`, LOG_LEVEL_INFO);
                    return true;
                }
                
                return false;
            } catch (ex) {
                console.error(`[HiddenFileSync] extractInternalFileFromDatabase failed:`, {
                    path: storageFilePath,
                    error: ex,
                    errorMessage: ex instanceof Error ? ex.message : String(ex),
                    errorStack: ex instanceof Error ? ex.stack : undefined,
                });
                Logger(`STORAGE <-- DB:${storageFilePath}: (hidden) Failed`, LOG_LEVEL_INFO);
                Logger(ex, LOG_LEVEL_VERBOSE);
                return false;
            }
        });
    }

    // ==================== Scan Operations ====================

    /**
     * Scan all internal file names in vault
     */
    async scanInternalFileNames(): Promise<FilePath[]> {
        const root = this.plugin.app.vault.getRoot();
        return await this.getFiles(root.path, (path) => this.isTargetFile(path));
    }

    /**
     * Recursively get files matching filter
     */
    private async getFiles(path: string, checkFunction: (path: FilePath) => Promise<boolean> | boolean): Promise<FilePath[]> {
        let w: ListedFiles;
        try {
            w = await this.adapter.list(path);
        } catch {
            return [];
        }
        
        let files: string[] = [];
        
        for (const file of w.files) {
            if (await checkFunction(file as FilePath)) {
                files.push(file);
            }
        }
        
        for (const folder of w.folders) {
            if (await checkFunction(folder as FilePath)) {
                files = files.concat(await this.getFiles(folder, checkFunction));
            }
        }
        
        return files as FilePath[];
    }

    /**
     * Get all database files
     */
    async getAllDatabaseFiles(): Promise<MetaEntry[]> {
        const localDB = this.core.localDatabase;
        if (!localDB) return [];
        
        const allFiles = (
            await localDB.allDocsRaw({ startkey: ICHeader, endkey: ICHeaderEnd, include_docs: true })
        ).rows
            .filter((e: any) => isInternalMetadata(e.id as DocumentID))
            .map((e: any) => e.doc) as MetaEntry[];
        
        const files: MetaEntry[] = [];
        for (const file of allFiles) {
            const path = stripAllPrefixes(getPath(file));
            if (await this.isTargetFile(path as FilePath)) {
                files.push(file);
            }
        }
        
        return files;
    }

    /**
     * Scan all storage changes and sync to database
     */
    async scanAllStorageChanges(showNotice = false): Promise<void> {
        await skipIfDuplicated("scanAllStorageChanges", async () => {
            Logger("[HiddenFileSync] Scanning storage changes...", showNotice ? LOG_LEVEL_NOTICE : LOG_LEVEL_VERBOSE);
            
            const knownNames = [...this._fileInfoLastProcessed.keys()] as FilePath[];
            const existNames = await this.scanInternalFileNames();
            const allFiles = new Set([...knownNames, ...existNames]);
            
            // Get stats for all files
            const fileStats = await Promise.all(
                [...allFiles].map(async (path) => ({
                    path,
                    stat: await this.adapter.stat(path),
                }))
            );
            
            // Filter to changed files
            const processFiles = fileStats
                .filter(({ path, stat }) => {
                    const key = this.getLastProcessedFileKey(path);
                    const newKey = statToKey(stat ? { mtime: stat.mtime, size: stat.size, ctime: stat.ctime, type: "file" } : null);
                    return key !== newKey;
                })
                .map(({ path }) => path);
            
            Logger(`[HiddenFileSync] Found ${processFiles.length} changed files`, LOG_LEVEL_VERBOSE);
            
            // Process changed files
            const notifyProgress = onlyInNTimes(25, (progress) => 
                Logger(`[HiddenFileSync] Processing ${progress}/${processFiles.length}...`, LOG_LEVEL_VERBOSE)
            );
            
            await Promise.all(
                processFiles.map(async (file) => {
                    await this.trackStorageFileModification(file);
                    notifyProgress();
                })
            );
            
            Logger("[HiddenFileSync] Storage scan complete", showNotice ? LOG_LEVEL_NOTICE : LOG_LEVEL_VERBOSE);
        });
    }

    /**
     * Scan all database changes and sync to storage
     */
    async scanAllDatabaseChanges(showNotice = false): Promise<void> {
        await skipIfDuplicated("scanAllDatabaseChanges", async () => {
            Logger("[HiddenFileSync] Scanning database changes...", showNotice ? LOG_LEVEL_NOTICE : LOG_LEVEL_VERBOSE);
            
            const databaseFiles = await this.getAllDatabaseFiles();
            
            // Filter to changed files
            const processFiles = databaseFiles.filter((doc) => {
                const key = docToKey(doc);
                const path = stripAllPrefixes(getPath(doc));
                const lastKey = this.getLastProcessedDatabaseKey(path as FilePath);
                return lastKey !== key;
            });
            
            Logger(`[HiddenFileSync] Found ${processFiles.length} changed database entries`, LOG_LEVEL_VERBOSE);
            
            // Process changed files
            const notifyProgress = onlyInNTimes(25, (progress) =>
                Logger(`[HiddenFileSync] Processing ${progress}/${processFiles.length}...`, LOG_LEVEL_VERBOSE)
            );
            
            await Promise.all(
                processFiles.map(async (doc) => {
                    const path = stripAllPrefixes(getPath(doc)) as FilePath;
                    await this.trackDatabaseFileModification(path, doc);
                    notifyProgress();
                })
            );
            
            Logger("[HiddenFileSync] Database scan complete", showNotice ? LOG_LEVEL_NOTICE : LOG_LEVEL_VERBOSE);
        });
    }

    /**
     * Track storage file modification
     */
    async trackStorageFileModification(path: FilePath, onlyNew = false, forceWrite = false): Promise<boolean | undefined> {
        if (!(await this.isTargetFile(path))) {
            return false;
        }
        
        const rel = await this.semaphore.acquire();
        try {
            return await serialized(`hidden-file-event:${path}`, async () => {
                const stat = await this.adapter.stat(path);
                if (stat && stat.type !== "file") return false;
                
                const key = statToKey(stat ? { mtime: stat.mtime, size: stat.size, ctime: stat.ctime, type: "file" } : null);
                const lastKey = this.getLastProcessedFileKey(path);
                
                // Skip if already processed
                if (lastKey === key && !forceWrite) {
                    return true;
                }
                
                // Load file info
                const cache = await this.loadFileWithInfo(path);
                this.updateLastProcessedFile(path, cache.stat);
                
                const lastIsNotFound = !lastKey || lastKey.endsWith("-0-0");
                const nowIsNotFound = cache.deleted;
                const type = lastIsNotFound && nowIsNotFound ? "invalid" : nowIsNotFound ? "delete" : "modified";
                
                if (type === "invalid") return false;
                
                if (type === "delete") {
                    return await this.deleteInternalFileOnDatabase(path, forceWrite);
                } else {
                    return await this.storeInternalFileToDatabase(cache, forceWrite);
                }
            });
        } finally {
            rel();
        }
    }

    /**
     * Track database file modification
     * This is the main entry point for processing replicated hidden files.
     * Key change: Check for conflicts BEFORE extracting file to storage.
     * Source: livesync CmdHiddenFileSync.ts lines 1114-1158
     */
    async trackDatabaseFileModification(path: FilePath, meta?: MetaEntry | false): Promise<boolean> {
        const rel = await this.semaphore.acquire();
        try {
            return await serialized(`hidden-file-event:${path}`, async () => {
                const localDB = this.core.localDatabase;
                if (!localDB) return false;
                
                try {
                    // CRITICAL: Always fetch metadata with conflicts flag to detect conflicts
                    // The passed `meta` from replication may not include _conflicts info
                    const prefixedPath = addPrefix(path, ICHeader);
                    const docMeta = await localDB.getDBEntryMeta(prefixedPath, { conflicts: true }, true);
                    
                    if (docMeta === false) return false;
                    
                    // Check for conflicts BEFORE extracting file to storage
                    // If conflicted, queue for resolution and do NOT write the file yet
                    if (docMeta._conflicts && docMeta._conflicts.length > 0) {
                        const prefixedPathWithType = addPrefix(path, ICHeader) as FilePathWithPrefix;
                        this.queueConflictCheck(prefixedPathWithType);
                        return true; // Return true to indicate we handled it (queued for conflict resolution)
                    }
                    
                    // No conflicts - safe to extract file to storage
                    await this.extractInternalFileFromDatabase(
                        path,
                        false,
                        docMeta,
                        true,  // preventDoubleProcess
                        false, // onlyNew
                        true   // includeDeletion
                    );
                    
                    return true;
                } catch (ex) {
                    console.error(`[HiddenFileSync] trackDatabaseFileModification failed:`, {
                        path: path,
                        error: ex,
                        errorMessage: ex instanceof Error ? ex.message : String(ex),
                        errorStack: ex instanceof Error ? ex.stack : undefined,
                    });
                    Logger(`[HiddenFileSync] trackDatabaseFileModification failed: ${path}`, LOG_LEVEL_VERBOSE);
                    Logger(ex, LOG_LEVEL_VERBOSE);
                    return false;
                }
            });
        } finally {
            rel();
        }
    }

    // ==================== Event Processing ====================

    /**
     * Process replication result for internal files
     */
    async processReplicationResult(doc: LoadedEntry): Promise<boolean> {
        const path = stripAllPrefixes(getPath(doc)) as FilePath;
        
        if (!(await this.isTargetFile(path))) {
            return false;
        }
        
        return await this.trackDatabaseFileModification(path);
    }

    /**
     * Handle vault raw events for hidden files
     * Called from FridayStorageEventManager
     */
    async watchVaultRawEvents(path: FilePath): Promise<void> {
        if (!this.isThisModuleEnabled()) return;
        if (!this.settings.watchInternalFileChanges) return;
        
        // Only handle config directory files
        if (!path.startsWith(this.configDir)) return;
        
        // Skip directories
        if (path.endsWith("/")) return;
        
        // Check if target file
        if (!(await this.isTargetFile(path))) return;
        
        // Process the file change
        await this.trackStorageFileModification(path);
    }

    // ==================== Initialization ====================

    /**
     * Initialize hidden file sync (for first-time setup)
     * @param direction - "push" | "pull" | "safe"
     */
    async initialiseInternalFileSync(direction: "push" | "pull" | "safe", showNotice = true): Promise<void> {
        Logger(`[HiddenFileSync] Initializing with direction: ${direction}`, showNotice ? LOG_LEVEL_NOTICE : LOG_LEVEL_INFO);
        
        if (direction === "push") {
            // Push local files to database
            this.resetLastProcessedFile(false);
            await this.scanAllStorageChanges(showNotice);
        } else if (direction === "pull") {
            // Pull database files to local
            this.resetLastProcessedDatabase(false);
            await this.scanAllDatabaseChanges(showNotice);
        } else {
            // Safe: merge based on mtime
            this.resetLastProcessedFile(false);
            this.resetLastProcessedDatabase(false);
            await this.scanAllStorageChanges(showNotice);
            await this.scanAllDatabaseChanges(showNotice);
        }
        
        Logger("[HiddenFileSync] Initialization complete", showNotice ? LOG_LEVEL_NOTICE : LOG_LEVEL_INFO);
    }

    // ==================== Conflict Resolution ====================

    /**
     * Initialize the conflict resolution queue processor
     * Source: livesync CmdHiddenFileSync.ts lines 679-770
     */
    private initConflictResolutionProcessor(): void {
        this.conflictResolutionProcessor = new QueueProcessor(
            async (paths: FilePathWithPrefix[]) => {
                const path = paths[0];
                const localDB = this.core.localDatabase;
                if (!localDB) return [];
                
                try {
                    // FIX: path already has i: prefix, don't pass ICHeader again
                    const prefixedPath = path.startsWith(ICHeader) ? path : addPrefix(path, ICHeader);
                    const id = await this.core.path2id(prefixedPath);
                    const doc = await localDB.getRaw<MetaEntry>(id, { conflicts: true });
                    
                    if (!doc._conflicts?.length) return [];
                    
                    Logger(`[HiddenFileSync] Resolving ${doc._conflicts.length} conflict(s) for: ${path}`, LOG_LEVEL_INFO);
                    
                    const conflicts = doc._conflicts.sort(
                        (a, b) => Number(a.split("-")[0]) - Number(b.split("-")[0])
                    );
                    const revA = doc._rev!;
                    const revB = conflicts[0];
                    
                    // For JSON files, try smart merge first
                    if (path.endsWith(".json")) {
                        const merged = await this.tryMergeJSON(id, path, doc, revA, revB);
                        if (merged) return [];
                        
                        // Check overwrite patterns
                        const overwritePatterns = parsePatterns(
                            this.settings.syncInternalFileOverwritePatterns || ""
                        );
                        if (matchesAnyPattern(stripAllPrefixes(path), overwritePatterns)) {
                            await this.resolveByNewerEntry(id, path, doc, revA, revB);
                            return [];
                        }
                        
                        // Fall back to newer entry for unresolved JSON conflicts
                        await this.resolveByNewerEntry(id, path, doc, revA, revB);
                        return [];
                    }
                    
                    // Non-JSON files (main.js, styles.css, etc.): always resolve by newer mtime
                    await this.resolveByNewerEntry(id, path, doc, revA, revB);
                    return [];
                } catch (ex) {
                    Logger(`[HiddenFileSync] Conflict resolution failed: ${path}`, LOG_LEVEL_VERBOSE);
                    Logger(ex, LOG_LEVEL_VERBOSE);
                    return [];
                }
            },
            {
                suspended: false,
                batchSize: 1,
                concurrentLimit: 1,  // Process one at a time
                delay: 10,
                keepResultUntilDownstreamConnected: false,
                yieldThreshold: 10,
            }
        );
    }

    /**
     * Queue a path for conflict resolution
     */
    queueConflictCheck(path: FilePathWithPrefix): void {
        this.conflictResolutionProcessor.enqueue(path);
    }

    /**
     * Resolve conflict by selecting the revision with newer mtime
     * This is used for non-JSON files like main.js, styles.css
     * Source: livesync CmdHiddenFileSync.ts lines 653-678
     */
    private async resolveByNewerEntry(
        id: DocumentID,
        path: FilePathWithPrefix,
        currentDoc: MetaEntry,
        currentRev: string,
        conflictedRev: string
    ): Promise<void> {
        const localDB = this.core.localDatabase;
        if (!localDB) return;
        
        try {
            // Get the conflicted document
            const conflictedDoc = await localDB.getRaw<MetaEntry>(id, { rev: conflictedRev });
            
            // Compare mtime to determine which is newer
            const mtimeCurrent = getComparingMTime(currentDoc, true);
            const mtimeConflicted = getComparingMTime(conflictedDoc, true);
            
            // Delete the older revision
            const deleteRev = mtimeCurrent < mtimeConflicted ? currentRev : conflictedRev;
            await localDB.removeRevision(id, deleteRev);
            
            Logger(`[HiddenFileSync] Conflict resolved, older revision deleted: ${path}`, LOG_LEVEL_INFO);
            
            // Check if more conflicts exist
            const updated = await localDB.getRaw<MetaEntry>(id, { conflicts: true });
            const remainingConflicts = updated._conflicts?.length ?? 0;
            
            if (remainingConflicts === 0) {
                // No more conflicts, extract file to storage
                const storageFilePath = stripAllPrefixes(path) as FilePath;
                await this.extractInternalFileFromDatabase(storageFilePath);
            } else {
                // More conflicts, re-queue
                this.queueConflictCheck(path);
            }
        } catch (ex) {
            Logger(`[HiddenFileSync] resolveByNewerEntry failed: ${path}`, LOG_LEVEL_VERBOSE);
            Logger(ex, LOG_LEVEL_VERBOSE);
        }
    }

    /**
     * Try to merge JSON files using object-level merge
     * Returns true if merge was successful
     * Source: livesync CmdHiddenFileSync.ts lines 694-724
     */
    private async tryMergeJSON(
        id: DocumentID,
        path: FilePathWithPrefix,
        doc: MetaEntry,
        currentRev: string,
        conflictedRev: string
    ): Promise<boolean> {
        const localDB = this.core.localDatabase;
        if (!localDB) return false;
        
        try {
            // Find common base revision
            const revInfo = await localDB.getRaw<MetaEntry>(id, { revs_info: true });
            const conflictedRevNo = Number(conflictedRev.split("-")[0]);
            const commonBase = revInfo._revs_info
                ?.filter((e: any) => e.status === "available" && Number(e.rev.split("-")[0]) < conflictedRevNo)
                ?.[0]?.rev ?? "";
            
            if (!commonBase) return false;
            
            // Use ConflictManager for merge if available
            const conflictManager = this.core.managers?.conflictManager;
            if (!conflictManager || !conflictManager.mergeObject) return false;
            
            const result = await conflictManager.mergeObject(
                doc.path,
                commonBase,
                currentRev,
                conflictedRev
            );
            
            if (!result) return false;
            
            // Write merged content to storage
            const filename = stripAllPrefixes(path) as FilePath;
            await this.ensureDir(filename);
            const stat = await this.writeFile(filename, result);
            
            if (!stat) {
                throw new Error(`Failed to write merged file: ${filename}`);
            }
            
            // Store merged content to database and remove conflicted revision
            await this.storeInternalFileToDatabase({ path: filename, ...stat } as any);
            await localDB.removeRevision(id, conflictedRev);
            
            // Re-check for more conflicts
            this.queueConflictCheck(path);
            
            Logger(`[HiddenFileSync] JSON merge successful: ${path}`, LOG_LEVEL_INFO);
            return true;
        } catch (ex) {
            Logger(`[HiddenFileSync] JSON merge failed: ${path}`, LOG_LEVEL_VERBOSE);
            Logger(ex, LOG_LEVEL_VERBOSE);
            return false;
        }
    }

    /**
     * Scan all internal files for conflicts and queue resolution
     * Called during initialization
     * Source: livesync CmdHiddenFileSync.ts lines 635-651
     */
    async resolveConflictOnInternalFiles(): Promise<void> {
        const localDB = this.core.localDatabase;
        if (!localDB) return;
        
        Logger("[HiddenFileSync] Scanning for conflicted files...", LOG_LEVEL_INFO);
        
        try {
            // Find all conflicted internal files
            const conflicted = localDB.findEntries(ICHeader, ICHeaderEnd, { conflicts: true });
            
            let conflictCount = 0;
            for await (const doc of conflicted) {
                if (!("_conflicts" in doc)) continue;
                if (!doc._conflicts?.length) continue;
                if (isInternalMetadata(doc._id)) {
                    const path = (doc.path || doc._id) as FilePathWithPrefix;
                    this.queueConflictCheck(path);
                    conflictCount++;
                }
            }
            
            if (conflictCount > 0) {
                Logger(`[HiddenFileSync] Found ${conflictCount} conflicted file(s), resolving...`, LOG_LEVEL_INFO);
                // Wait for all conflicts to be processed
                await this.conflictResolutionProcessor.startPipeline().waitForAllProcessed();
                Logger("[HiddenFileSync] Conflict resolution complete", LOG_LEVEL_INFO);
            }
        } catch (ex) {
            Logger("[HiddenFileSync] Error scanning for conflicts", LOG_LEVEL_VERBOSE);
            Logger(ex, LOG_LEVEL_VERBOSE);
        }
    }
}

