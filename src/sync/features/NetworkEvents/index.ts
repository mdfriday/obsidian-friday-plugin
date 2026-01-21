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
            // Network recovered - trigger reconnection
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
            Logger("Window visible, checking for sync updates", LOG_LEVEL_VERBOSE);
            // Trigger a sync check on resume
            await this.core.handleNetworkRecovery();
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

