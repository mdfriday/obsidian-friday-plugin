/**
 * FridayNetworkEvents - Network event handling module
 * 
 * Registers and handles browser network events:
 * - window.online / window.offline
 * - document.visibilitychange
 * - window.focus / window.blur
 * 
 * Source: livesync ModuleObsidianEvents.ts lines 77-141
 */

import { Plugin } from "obsidian";
import { Logger } from "../../core/common/logger";
import { LOG_LEVEL_INFO, LOG_LEVEL_VERBOSE } from "../../core/common/types";
import { scheduleTask } from "octagonal-wheels/concurrency/task";
import { fireAndForget } from "octagonal-wheels/promises";
import type { FridaySyncCore } from "../../FridaySyncCore";

export class FridayNetworkEvents {
    private plugin: Plugin;
    private core: FridaySyncCore;
    private hasFocus: boolean = true;
    private isLastHidden: boolean = false;
    private boundHandlers: {
        online: () => void;
        offline: () => void;
        visibilityChange: () => void;
        focus: () => void;
        blur: () => void;
    } | null = null;

    constructor(plugin: Plugin, core: FridaySyncCore) {
        this.plugin = plugin;
        this.core = core;
    }

    /**
     * Register all network-related event listeners
     * Matching livesync's ModuleObsidianEvents.registerWatchEvents()
     */
    registerEvents(): void {
        this.boundHandlers = {
            online: this.watchOnline.bind(this),
            offline: this.watchOnline.bind(this),
            visibilityChange: this.watchWindowVisibility.bind(this),
            focus: () => this.setHasFocus(true),
            blur: () => this.setHasFocus(false),
        };

        // Register DOM events through Obsidian's event system for proper cleanup
        this.plugin.registerDomEvent(window, "online", this.boundHandlers.online);
        this.plugin.registerDomEvent(window, "offline", this.boundHandlers.offline);
        this.plugin.registerDomEvent(document, "visibilitychange", this.boundHandlers.visibilityChange);
        this.plugin.registerDomEvent(window, "focus", this.boundHandlers.focus);
        this.plugin.registerDomEvent(window, "blur", this.boundHandlers.blur);

        Logger("Network event listeners registered", LOG_LEVEL_VERBOSE);
    }

    private setHasFocus(hasFocus: boolean): void {
        this.hasFocus = hasFocus;
        this.watchWindowVisibility();
    }

    /**
     * Handle online/offline events
     * Source: livesync ModuleObsidianEvents.watchOnline()
     */
    private watchOnline(): void {
        scheduleTask("watch-online", 500, () => fireAndForget(() => this.watchOnlineAsync()));
    }

    private async watchOnlineAsync(): Promise<void> {
        const isOnline = navigator.onLine;
        Logger(`Network status changed: ${isOnline ? "online" : "offline"}`, LOG_LEVEL_INFO);

        if (isOnline) {
            // Check current sync status before attempting recovery
            const currentStatus = this.core.replicationStat.value.syncStatus;
            
            if (currentStatus === "LIVE") {
                // Already in LIVE state, no need to reconnect
                Logger("Network online but sync already active", LOG_LEVEL_VERBOSE);
                return;
            }
            
            // Network recovered - trigger reconnection
            Logger("Network recovered, attempting reconnection", LOG_LEVEL_INFO);
            await this.core.handleNetworkRecovery();
        } else {
            // Network lost - update status
            if (this.core.managers?.networkManager) {
                this.core.managers.networkManager.setServerReachable(false);
            }
            // Notify offline tracker
            if (this.core.offlineTracker) {
                this.core.offlineTracker.setOffline(true);
            }
        }
    }

    /**
     * Handle visibility changes (tab switching, minimize)
     * Source: livesync ModuleObsidianEvents.watchWindowVisibility()
     */
    private watchWindowVisibility(): void {
        scheduleTask("watch-window-visibility", 100, () =>
            fireAndForget(() => this.watchWindowVisibilityAsync())
        );
    }

    private async watchWindowVisibilityAsync(): Promise<void> {
        const settings = this.core.getSettings();
        if (settings.suspendFileWatching) return;
        if (!settings.isConfigured) return;

        if (this.isLastHidden && !this.hasFocus) {
            // NO OP while non-focused after made hidden
            return;
        }

        const isHidden = document.hidden;
        if (this.isLastHidden === isHidden) {
            return;
        }
        this.isLastHidden = isHidden;

        if (isHidden) {
            // Window hidden - could suspend sync
            Logger("Window hidden, sync continues in background", LOG_LEVEL_VERBOSE);
        } else {
            // Window visible again
            if (!this.hasFocus) return;
            
            // Check current sync status - only reconnect if needed
            const currentStatus = this.core.replicationStat.value.syncStatus;
            
            // If already in LIVE state, no need to reconnect
            if (currentStatus === "LIVE") {
                Logger("Window visible, sync already active", LOG_LEVEL_VERBOSE);
                return;
            }
            
            // If status is NOT_CONNECTED or ERRORED, attempt recovery
            if (currentStatus === "NOT_CONNECTED" || currentStatus === "ERRORED") {
                Logger("Window visible, checking for sync recovery", LOG_LEVEL_VERBOSE);
                
                // Avoid duplicate reconnection attempts if already scheduled
                if (this.core.connectionMonitor?.isReconnectScheduled()) {
                    Logger("Reconnect already scheduled, skipping duplicate attempt", LOG_LEVEL_VERBOSE);
                    return;
                }
                
                await this.core.handleNetworkRecovery();
            } else {
                // Other states (STARTED, PAUSED, CLOSED), just log
                Logger(`Window visible, current status: ${currentStatus}`, LOG_LEVEL_VERBOSE);
            }
        }
    }

    /**
     * Unload and cleanup event listeners
     * Note: Events registered via registerDomEvent are auto-cleaned by Obsidian
     */
    unload(): void {
        this.boundHandlers = null;
        Logger("Network event listeners unloaded", LOG_LEVEL_VERBOSE);
    }
}

