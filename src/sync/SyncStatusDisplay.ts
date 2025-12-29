/**
 * SyncStatusDisplay - Manages sync status display in status bar and editor
 * Based on livesync's ModuleLog implementation
 */

import { Plugin, Notice } from "obsidian";
import type { SyncStatus, SyncStatusCallback } from "./SyncService";

export interface ReplicationStat {
    sent: number;
    arrived: number;
    maxPullSeq: number;
    maxPushSeq: number;
    lastSyncPullSeq: number;
    lastSyncPushSeq: number;
    syncStatus: SyncStatus;
}

export const MARK_DONE = "\u{2009}\u{2009}";

export class SyncStatusDisplay {
    private plugin: Plugin;
    private statusBar: HTMLElement | null = null;
    private statusDiv: HTMLElement | null = null;
    private statusLine: HTMLDivElement | null = null;
    private logMessage: HTMLDivElement | null = null;
    private messageArea: HTMLDivElement | null = null;
    
    // Status tracking
    private currentStatus: SyncStatus = "NOT_CONNECTED";
    private replicationStat: ReplicationStat = {
        sent: 0,
        arrived: 0,
        maxPullSeq: 0,
        maxPushSeq: 0,
        lastSyncPullSeq: 0,
        lastSyncPushSeq: 0,
        syncStatus: "NOT_CONNECTED",
    };
    
    // Counters for display
    private requestCount = 0;
    private responseCount = 0;
    private processingCount = 0;
    private queuedCount = 0;
    private dbQueueCount = 0;
    private storageApplyingCount = 0;
    
    // Animation frame handling
    private nextFrameQueue: ReturnType<typeof requestAnimationFrame> | undefined = undefined;
    
    // Notification handling
    private notifies: { [key: string]: { notice: Notice; count: number } } = {};
    
    constructor(plugin: Plugin) {
        this.plugin = plugin;
    }
    
    /**
     * Initialize the status display
     */
    initialize() {
        // Create status bar item
        this.statusBar = this.plugin.addStatusBarItem();
        this.statusBar.addClass("friday-sync-statusbar");
        
        // Create status div for editor display
        this.createStatusDiv();
        
        // Initial status update
        this.updateDisplay();
    }
    
    /**
     * Create the status div that appears in the editor
     */
    private createStatusDiv() {
        // Remove any existing status divs
        document.querySelectorAll(".friday-sync-status")?.forEach((e) => e.remove());
        
        // Create new status div
        const workspace = this.plugin.app.workspace;
        this.statusDiv = workspace.containerEl.createDiv({ cls: "friday-sync-status" });
        this.statusLine = this.statusDiv.createDiv({ cls: "friday-sync-status-statusline" });
        this.messageArea = this.statusDiv.createDiv({ cls: "friday-sync-status-messagearea" });
        this.logMessage = this.statusDiv.createDiv({ cls: "friday-sync-status-logmessage" });
        
        // Position the status div
        this.adjustStatusDivPosition();
        
        // Re-position when layout changes
        this.plugin.registerEvent(
            workspace.on("layout-change", () => {
                this.adjustStatusDivPosition();
            })
        );
        
        this.plugin.registerEvent(
            workspace.on("active-leaf-change", () => {
                this.adjustStatusDivPosition();
            })
        );
    }
    
    /**
     * Adjust the position of the status div to the active leaf
     */
    private adjustStatusDivPosition() {
        const mdv = this.plugin.app.workspace.getMostRecentLeaf();
        if (mdv && this.statusDiv) {
            this.statusDiv.remove();
            const container = mdv.view.containerEl;
            container.insertBefore(this.statusDiv, container.lastChild);
        }
    }
    
    /**
     * Update sync status
     */
    setStatus(status: SyncStatus, message?: string) {
        this.currentStatus = status;
        this.replicationStat.syncStatus = status;
        
        if (message) {
            this.showLogMessage(message);
        }
        
        this.updateDisplay();
    }
    
    /**
     * Update replication statistics
     */
    updateReplicationStat(stat: Partial<ReplicationStat>) {
        this.replicationStat = { ...this.replicationStat, ...stat };
        this.updateDisplay();
    }
    
    /**
     * Update counters
     */
    updateCounters(counters: {
        requestCount?: number;
        responseCount?: number;
        processingCount?: number;
        queuedCount?: number;
        dbQueueCount?: number;
        storageApplyingCount?: number;
    }) {
        if (counters.requestCount !== undefined) this.requestCount = counters.requestCount;
        if (counters.responseCount !== undefined) this.responseCount = counters.responseCount;
        if (counters.processingCount !== undefined) this.processingCount = counters.processingCount;
        if (counters.queuedCount !== undefined) this.queuedCount = counters.queuedCount;
        if (counters.dbQueueCount !== undefined) this.dbQueueCount = counters.dbQueueCount;
        if (counters.storageApplyingCount !== undefined) this.storageApplyingCount = counters.storageApplyingCount;
        this.updateDisplay();
    }
    
    /**
     * Show a log message in the status area
     */
    showLogMessage(message: string) {
        if (this.logMessage) {
            this.logMessage.innerText = message;
        }
        
        // Clear message after 3 seconds
        setTimeout(() => {
            if (this.logMessage) {
                this.logMessage.innerText = "";
            }
        }, 3000);
    }
    
    /**
     * Show a warning message in the message area
     */
    showWarning(message: string) {
        if (this.messageArea) {
            this.messageArea.innerText = message ? `⚠️ ${message}` : "";
        }
    }
    
    /**
     * Show a notification
     */
    notify(message: string, key?: string, timeout = 5000) {
        if (!key) key = message;
        
        if (key in this.notifies) {
            // Update existing notice
            // @ts-ignore - noticeEl may not be typed
            const isShown = this.notifies[key].notice.noticeEl?.isShown();
            if (!isShown) {
                this.notifies[key].notice = new Notice(message, 0);
            }
            
            if (key === message) {
                this.notifies[key].count++;
                this.notifies[key].notice.setMessage(`(${this.notifies[key].count}): ${message}`);
            } else {
                this.notifies[key].notice.setMessage(message);
            }
        } else {
            // Create new notice
            const notice = new Notice(message, 0);
            this.notifies[key] = {
                count: 0,
                notice: notice,
            };
        }
        
        // Schedule hide
        if (!key.startsWith("keepalive-") || message.indexOf(MARK_DONE) !== -1) {
            setTimeout(() => {
                if (this.notifies[key]) {
                    const notice = this.notifies[key].notice;
                    delete this.notifies[key];
                    try {
                        notice.hide();
                    } catch {
                        // NO OP
                    }
                }
            }, timeout);
        }
    }
    
    /**
     * Update the display (throttled via requestAnimationFrame)
     */
    private updateDisplay() {
        if (this.nextFrameQueue) {
            return;
        }
        
        this.nextFrameQueue = requestAnimationFrame(() => {
            this.nextFrameQueue = undefined;
            this.renderStatus();
        });
    }
    
    /**
     * Render the status to the UI elements
     */
    private renderStatus() {
        const { message, statusText } = this.buildStatusLabels();
        
        // Update status bar
        if (this.statusBar) {
            this.statusBar.setText(message.split("\n")[0]);
        }
        
        // Update status line in editor
        if (this.statusLine) {
            this.statusLine.innerText = message;
        }
    }
    
    /**
     * Build status labels based on current state
     */
    private buildStatusLabels(): { message: string; statusText: string } {
        const { sent, arrived, maxPullSeq, maxPushSeq, lastSyncPullSeq, lastSyncPushSeq, syncStatus } = this.replicationStat;
        
        // Status icon
        let statusIcon = "?";
        let pushLast = "";
        let pullLast = "";
        
        switch (syncStatus) {
            case "CLOSED":
            case "COMPLETED":
            case "NOT_CONNECTED":
                statusIcon = "⏹";
                break;
            case "STARTED":
                statusIcon = "🌀";
                break;
            case "PAUSED":
                statusIcon = "💤";
                break;
            case "CONNECTED":
                statusIcon = "⚡";
                pushLast = lastSyncPushSeq === 0 
                    ? "" 
                    : lastSyncPushSeq >= maxPushSeq 
                        ? " (LIVE)" 
                        : ` (${maxPushSeq - lastSyncPushSeq})`;
                pullLast = lastSyncPullSeq === 0 
                    ? "" 
                    : lastSyncPullSeq >= maxPullSeq 
                        ? " (LIVE)" 
                        : ` (${maxPullSeq - lastSyncPullSeq})`;
                break;
            case "ERRORED":
                statusIcon = "⚠";
                break;
        }
        
        // Network activity indicator
        const networkActivity = (this.requestCount - this.responseCount) !== 0 ? "📲 " : "";
        
        // Counter labels
        const counters = this.buildCounterLabels();
        
        // Build message
        const message = `${networkActivity}Sync: ${statusIcon} ↑ ${sent}${pushLast} ↓ ${arrived}${pullLast}${counters}`;
        
        return { message, statusText: syncStatus };
    }
    
    /**
     * Build counter labels for display
     */
    private buildCounterLabels(): string {
        const labels: string[] = [];
        
        if (this.processingCount > 0) {
            labels.push(`⏳${this.processingCount}`);
        }
        if (this.queuedCount > 0) {
            labels.push(`🛫${this.queuedCount}`);
        }
        if (this.dbQueueCount > 0) {
            labels.push(`📄${this.dbQueueCount}`);
        }
        if (this.storageApplyingCount > 0) {
            labels.push(`💾${this.storageApplyingCount}`);
        }
        
        return labels.length > 0 ? " " + labels.join(" ") : "";
    }
    
    /**
     * Clean up the status display
     */
    destroy() {
        if (this.statusDiv) {
            this.statusDiv.remove();
            this.statusDiv = null;
        }
        
        document.querySelectorAll(".friday-sync-status")?.forEach((e) => e.remove());
        
        // Hide all notifications
        for (const key in this.notifies) {
            try {
                this.notifies[key].notice.hide();
            } catch {
                // NO OP
            }
        }
        this.notifies = {};
    }
}

