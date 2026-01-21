/**
 * FridayOfflineTracker - Offline change tracking
 * 
 * Tracks changes made while offline for later synchronization:
 * - Tracks file changes (create, modify, delete)
 * - Persists changes to kvDB for crash recovery
 * - Applies offline changes when connection is restored
 * 
 * Source: livesync CmdHiddenFileSync.ts lines 1000-1087
 */

import { Logger } from "../../core/common/logger";
import { LOG_LEVEL_INFO, LOG_LEVEL_NOTICE, LOG_LEVEL_VERBOSE, type FilePath } from "../../core/common/types";
import type { FridaySyncCore } from "../../FridaySyncCore";
import type { KeyValueDatabase } from "../../core/interfaces/KeyValueDatabase";

export interface OfflineChange {
    path: FilePath;
    type: "create" | "modify" | "delete";
    timestamp: number;
}

const OFFLINE_CHANGES_KEY = "friday-offline-changes";

export class FridayOfflineTracker {
    private core: FridaySyncCore;
    private kvDB: KeyValueDatabase;
    private pendingChanges: Map<string, OfflineChange> = new Map();
    private _isOffline: boolean = false;

    constructor(core: FridaySyncCore) {
        this.core = core;
        this.kvDB = core.kvDB;
    }

    /**
     * Initialize tracker and load persisted changes
     */
    async initialize(): Promise<void> {
        await this.loadPersistedChanges();
    }

    /**
     * Get current offline status
     */
    get isOffline(): boolean {
        return this._isOffline;
    }

    /**
     * Set offline status
     */
    setOffline(offline: boolean): void {
        const wasOffline = this._isOffline;
        this._isOffline = offline;

        if (wasOffline && !offline) {
            // Just came online - persist changes before sync
            this.persistChanges();
            Logger(`Came online with ${this.pendingChanges.size} pending changes`, LOG_LEVEL_INFO);
        }

        if (!wasOffline && offline) {
            Logger("Now tracking changes for offline sync", LOG_LEVEL_INFO);
        }
    }

    /**
     * Track a file change that occurred while offline
     */
    trackChange(path: FilePath, type: "create" | "modify" | "delete"): void {
        if (!this._isOffline) return; // Only track when offline

        const change: OfflineChange = {
            path,
            type,
            timestamp: Date.now(),
        };

        this.pendingChanges.set(path, change);
        Logger(`Tracked offline change: ${type} ${path}`, LOG_LEVEL_VERBOSE);

        // Persist immediately for safety
        this.persistChanges();
    }

    /**
     * Get all pending offline changes
     */
    getPendingChanges(): OfflineChange[] {
        return Array.from(this.pendingChanges.values());
    }

    /**
     * Get count of pending changes
     */
    get pendingCount(): number {
        return this.pendingChanges.size;
    }

    /**
     * Clear all pending changes (after successful sync)
     */
    async clearPendingChanges(): Promise<void> {
        this.pendingChanges.clear();
        await this.kvDB.delete(OFFLINE_CHANGES_KEY);
        Logger("Offline changes cleared", LOG_LEVEL_VERBOSE);
    }

    /**
     * Apply offline changes after reconnection
     * Source: livesync CmdHiddenFileSync.applyOfflineChanges()
     */
    async applyOfflineChanges(showNotice: boolean = true): Promise<void> {
        const changes = this.getPendingChanges();
        if (changes.length === 0) {
            if (showNotice) {
                Logger("No offline changes to apply", LOG_LEVEL_INFO);
            }
            return;
        }

        Logger(`Applying ${changes.length} offline changes...`,
            showNotice ? LOG_LEVEL_NOTICE : LOG_LEVEL_INFO);

        let applied = 0;
        let errors = 0;

        for (const change of changes) {
            try {
                await this.applyChange(change);
                applied++;
            } catch (error) {
                errors++;
                Logger(`Failed to apply offline change for ${change.path}: ${error}`, LOG_LEVEL_VERBOSE);
            }
        }

        await this.clearPendingChanges();

        Logger(`Applied ${applied} offline changes (${errors} errors)`,
            showNotice ? LOG_LEVEL_NOTICE : LOG_LEVEL_INFO);
    }

    /**
     * Apply a single offline change
     */
    private async applyChange(change: OfflineChange): Promise<void> {
        const storageManager = this.core.storageEventManager;
        if (!storageManager) return;

        // Trigger the appropriate sync action
        // The storage event manager will handle the actual database operation
        switch (change.type) {
            case "create":
            case "modify":
                await storageManager.processFileEventDirect({
                    type: "CHANGED",
                    path: change.path,
                });
                break;
            case "delete":
                await storageManager.processFileEventDirect({
                    type: "DELETE",
                    path: change.path,
                });
                break;
        }
    }

    /**
     * Persist changes to kvDB for crash recovery
     */
    private async persistChanges(): Promise<void> {
        try {
            const changes = Array.from(this.pendingChanges.entries());
            await this.kvDB.set(OFFLINE_CHANGES_KEY, changes);
        } catch (error) {
            Logger(`Failed to persist offline changes: ${error}`, LOG_LEVEL_VERBOSE);
        }
    }

    /**
     * Load persisted changes from kvDB
     */
    private async loadPersistedChanges(): Promise<void> {
        try {
            const stored = await this.kvDB.get<[string, OfflineChange][]>(OFFLINE_CHANGES_KEY);
            if (stored && Array.isArray(stored)) {
                this.pendingChanges = new Map(stored);
                if (this.pendingChanges.size > 0) {
                    Logger(`Loaded ${this.pendingChanges.size} persisted offline changes`, LOG_LEVEL_INFO);
                }
            }
        } catch (error) {
            Logger(`Failed to load persisted offline changes: ${error}`, LOG_LEVEL_VERBOSE);
        }
    }

    /**
     * Check if there are pending changes
     */
    hasPendingChanges(): boolean {
        return this.pendingChanges.size > 0;
    }

    /**
     * Get a summary of pending changes
     */
    getPendingChangesSummary(): { creates: number; modifies: number; deletes: number } {
        let creates = 0, modifies = 0, deletes = 0;
        for (const change of this.pendingChanges.values()) {
            switch (change.type) {
                case "create": creates++; break;
                case "modify": modifies++; break;
                case "delete": deletes++; break;
            }
        }
        return { creates, modifies, deletes };
    }
}

