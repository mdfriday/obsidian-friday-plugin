/**
 * SyncStatusDisplay - Status display module from livesync
 * 
 * This is a direct port of livesync's ModuleLog status display functionality
 */

import { Plugin, Notice } from "obsidian";
import { computed, reactive, reactiveSource, type ReactiveValue } from "octagonal-wheels/dataobject/reactive";
import type { DatabaseConnectingStatus } from "./core/common/types";
import type { ReplicationStat } from "./core/replication/LiveSyncAbstractReplicator";
import type { FridaySyncCore } from "./FridaySyncCore";

export const MARK_DONE = "\u{2009}\u{2009}";

export class SyncStatusDisplay {
    private plugin: Plugin;
    private core: FridaySyncCore | null = null;
    
    // UI Elements
    statusBar?: HTMLElement;
    statusDiv?: HTMLElement;
    statusLine?: HTMLDivElement;
    logMessage?: HTMLDivElement;
    messageArea?: HTMLDivElement;
    logHistory?: HTMLDivElement;
    
    // Reactive sources
    statusLog = reactiveSource("");
    activeFileStatus = reactiveSource("");
    statusBarLabels!: ReactiveValue<{ message: string; status: string }>;
    
    // Notification handling
    notifies: { [key: string]: { notice: Notice; count: number } } = {};
    
    // Animation frame handling
    nextFrameQueue: ReturnType<typeof requestAnimationFrame> | undefined = undefined;
    logLines: { ttl: number; message: string }[] = [];
    
    constructor(plugin: Plugin) {
        this.plugin = plugin;
    }
    
    /**
     * Set the sync core reference
     */
    setCore(core: FridaySyncCore) {
        this.core = core;
    }
    
    /**
     * Initialize the status display
     */
    initialize() {
        // Remove any existing status divs
        document.querySelectorAll(".livesync-status")?.forEach((e) => e.remove());
        
        // Set up reactive observers
        this.observeForLogs();
        
        // Create status div
        this.statusDiv = this.plugin.app.workspace.containerEl.createDiv({ cls: "livesync-status" });
        this.statusLine = this.statusDiv.createDiv({ cls: "livesync-status-statusline" });
        this.messageArea = this.statusDiv.createDiv({ cls: "livesync-status-messagearea" });
        this.logMessage = this.statusDiv.createDiv({ cls: "livesync-status-logmessage" });
        this.logHistory = this.statusDiv.createDiv({ cls: "livesync-status-loghistory" });
        
        // Create status bar
        this.statusBar = this.plugin.addStatusBarItem();
        this.statusBar.addClass("syncstatusbar");
        
        // Position the status div
        this.adjustStatusDivPosition();
        
        // Register layout change event
        this.plugin.registerEvent(
            this.plugin.app.workspace.on("layout-change", () => {
                this.adjustStatusDivPosition();
            })
        );
        
        this.plugin.registerEvent(
            this.plugin.app.workspace.on("active-leaf-change", () => {
                this.adjustStatusDivPosition();
            })
        );
    }
    
    /**
     * Set up reactive observers for log display (from livesync's ModuleLog)
     */
    observeForLogs() {
        const padSpaces = `\u{2007}`.repeat(10);
        
        // Helper function to create padded counter labels
        function padLeftSpComputed(numI: ReactiveValue<number>, mark: string) {
            const formatted = reactiveSource("");
            let timer: ReturnType<typeof setTimeout> | undefined = undefined;
            let maxLen = 1;
            numI.onChanged((numX) => {
                const num = numX.value;
                const numLen = `${Math.abs(num)}`.length + 1;
                maxLen = maxLen < numLen ? numLen : maxLen;
                if (timer) clearTimeout(timer);
                if (num == 0) {
                    timer = setTimeout(() => {
                        formatted.value = "";
                        maxLen = 1;
                    }, 3000);
                }
                formatted.value = ` ${mark}${`${padSpaces}${num}`.slice(-maxLen)}`;
            });
            return computed(() => formatted.value);
        }
        
        // Create counter labels if core is available
        const replicationResultCount = this.core?.replicationResultCount ?? reactiveSource(0);
        const databaseQueueCount = this.core?.databaseQueueCount ?? reactiveSource(0);
        const storageApplyingCount = this.core?.storageApplyingCount ?? reactiveSource(0);
        const processing = this.core?.processing ?? reactiveSource(0);
        const totalQueued = this.core?.totalQueued ?? reactiveSource(0);
        const batched = this.core?.batched ?? reactiveSource(0);
        const requestCount = this.core?.requestCount ?? reactiveSource(0);
        const responseCount = this.core?.responseCount ?? reactiveSource(0);
        
        const labelReplication = padLeftSpComputed(replicationResultCount, `📥`);
        const labelDBCount = padLeftSpComputed(databaseQueueCount, `📄`);
        const labelStorageCount = padLeftSpComputed(storageApplyingCount, `💾`);
        
        const queueCountLabelX = reactive(() => {
            return `${labelReplication()}${labelDBCount()}${labelStorageCount()}`;
        });
        const queueCountLabel = () => queueCountLabelX.value;
        
        const requestingStatLabel = computed(() => {
            const diff = requestCount.value - responseCount.value;
            return diff != 0 ? "📲 " : "";
        });
        
        const replicationStat = this.core?.replicationStat ?? reactiveSource({
            sent: 0,
            arrived: 0,
            maxPullSeq: 0,
            maxPushSeq: 0,
            lastSyncPullSeq: 0,
            lastSyncPushSeq: 0,
            syncStatus: "NOT_CONNECTED" as DatabaseConnectingStatus,
        });
        
        const replicationStatLabel = computed(() => {
            const e = replicationStat.value;
            const sent = e.sent;
            const arrived = e.arrived;
            const maxPullSeq = e.maxPullSeq;
            const maxPushSeq = e.maxPushSeq;
            const lastSyncPullSeq = e.lastSyncPullSeq;
            const lastSyncPushSeq = e.lastSyncPushSeq;
            let pushLast = "";
            let pullLast = "";
            let w = "";
            
            const labels: Partial<Record<DatabaseConnectingStatus, string>> = {
                CONNECTED: "⚡",
                JOURNAL_SEND: "📦↑",
                JOURNAL_RECEIVE: "📦↓",
            };
            
            switch (e.syncStatus) {
                case "CLOSED":
                case "COMPLETED":
                case "NOT_CONNECTED":
                    w = "⏹";
                    break;
                case "STARTED":
                    w = "🌀";
                    break;
                case "PAUSED":
                    w = "💤";
                    break;
                case "CONNECTED":
                case "JOURNAL_SEND":
                case "JOURNAL_RECEIVE":
                    w = labels[e.syncStatus] || "⚡";
                    pushLast =
                        lastSyncPushSeq == 0
                            ? ""
                            : lastSyncPushSeq >= maxPushSeq
                              ? " (LIVE)"
                              : ` (${maxPushSeq - lastSyncPushSeq})`;
                    pullLast =
                        lastSyncPullSeq == 0
                            ? ""
                            : lastSyncPullSeq >= maxPullSeq
                              ? " (LIVE)"
                              : ` (${maxPullSeq - lastSyncPullSeq})`;
                    break;
                case "ERRORED":
                    w = "⚠";
                    break;
                default:
                    w = "?";
            }
            return { w, sent, pushLast, arrived, pullLast };
        });
        
        const labelProc = padLeftSpComputed(processing, `⏳`);
        const labelPend = padLeftSpComputed(totalQueued, `🛫`);
        const labelInBatchDelay = padLeftSpComputed(batched, `📬`);
        
        const waitingLabel = computed(() => {
            return `${labelProc()}${labelPend()}${labelInBatchDelay()}`;
        });
        
        const statusLineLabel = computed(() => {
            const { w, sent, pushLast, arrived, pullLast } = replicationStatLabel();
            const queued = queueCountLabel();
            const waiting = waitingLabel();
            const networkActivity = requestingStatLabel();
            return {
                message: `${networkActivity}Sync: ${w} ↑ ${sent}${pushLast} ↓ ${arrived}${pullLast}${waiting}${queued}`,
            };
        });
        
        const statusBarLabels = reactive(() => {
            const { message } = statusLineLabel();
            const status = this.statusLog.value;
            return {
                message: `${message}`,
                status,
            };
        });
        this.statusBarLabels = statusBarLabels;
        
        // Throttled update
        let updateTimer: ReturnType<typeof setTimeout> | undefined;
        const applyToDisplay = (label: typeof statusBarLabels.value) => {
            if (updateTimer) return;
            updateTimer = setTimeout(() => {
                updateTimer = undefined;
                this.applyStatusBarText();
            }, 20);
        };
        statusBarLabels.onChanged((label) => applyToDisplay(label.value));
    }
    
    /**
     * Adjust status div position to active leaf
     */
    adjustStatusDivPosition() {
        const mdv = this.plugin.app.workspace.getMostRecentLeaf();
        if (mdv && this.statusDiv) {
            this.statusDiv.remove();
            const container = mdv.view.containerEl;
            container.insertBefore(this.statusDiv, container.lastChild);
        }
    }
    
    /**
     * Apply status text to UI elements
     */
    applyStatusBarText() {
        if (this.nextFrameQueue) {
            return;
        }
        this.nextFrameQueue = requestAnimationFrame(() => {
            this.nextFrameQueue = undefined;
            const { message, status } = this.statusBarLabels.value;
            const newMsg = message;
            let newLog = status;
            const moduleTagEnd = newLog.indexOf(`]\u{200A}`);
            if (moduleTagEnd != -1) {
                newLog = newLog.substring(moduleTagEnd + 2);
            }
            
            this.statusBar?.setText(newMsg.split("\n")[0]);
            if (this.statusDiv) {
                const now = new Date().getTime();
                this.logLines = this.logLines.filter((e) => e.ttl > now);
                const minimumNext = this.logLines.reduce(
                    (a, b) => (a < b.ttl ? a : b.ttl),
                    Number.MAX_SAFE_INTEGER
                );
                if (this.logLines.length > 0) setTimeout(() => this.applyStatusBarText(), minimumNext - now);
                const recent = this.logLines.map((e) => e.message);
                const recentLogs = recent.reverse().join("\n");
                if (this.logHistory) this.logHistory.innerText = recentLogs;
                if (this.statusLine) this.statusLine.innerText = newMsg;
                if (this.logMessage) this.logMessage.innerText = newLog;
            }
        });
        
        // Schedule status log clear
        setTimeout(() => {
            this.statusLog.value = "";
        }, 3000);
    }
    
    /**
     * Add a log message
     */
    addLog(message: string, level: number = 0) {
        const now = new Date();
        const timestamp = now.toLocaleString();
        const newMessage = timestamp + " -> " + message;
        
        console.log(`[Friday Sync] ${message}`);
        
        this.statusLog.value = message;
        this.logLines.push({ ttl: now.getTime() + 3000, message: newMessage });
        this.applyStatusBarText();
        
        // Show notice for important messages
        if (level >= 2) { // LOG_LEVEL_NOTICE
            this.showNotice(message);
        }
    }
    
    /**
     * Show a notice
     */
    showNotice(message: string, key?: string, timeout = 5000) {
        if (!key) key = message;
        
        if (key in this.notifies) {
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
     * Clean up
     */
    onunload() {
        if (this.statusDiv) {
            this.statusDiv.remove();
        }
        document.querySelectorAll(".livesync-status")?.forEach((e) => e.remove());
        
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
