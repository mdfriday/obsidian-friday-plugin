/**
 * FridayConnectionMonitor - Connection health monitoring
 * 
 * Monitors connection health and schedules reconnection attempts:
 * - Periodic health checks
 * - Scheduled reconnection with exponential backoff
 * - Integration with NetworkManager status
 */

import { Logger } from "../../core/common/logger";
import { LOG_LEVEL_INFO, LOG_LEVEL_NOTICE, LOG_LEVEL_VERBOSE } from "../../core/common/types";
import type { FridaySyncCore } from "../../FridaySyncCore";

export class FridayConnectionMonitor {
    private core: FridaySyncCore;
    private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    private healthCheckTimer: ReturnType<typeof setInterval> | null = null;
    private isMonitoring: boolean = false;
    private healthCheckInterval: number = 60000; // 1 minute

    constructor(core: FridaySyncCore) {
        this.core = core;
    }

    /**
     * Start monitoring connection health
     */
    startMonitoring(): void {
        if (this.isMonitoring) return;
        this.isMonitoring = true;

        // Periodic health check
        this.healthCheckTimer = setInterval(() => {
            this.performHealthCheck();
        }, this.healthCheckInterval);

        Logger("Connection monitoring started", LOG_LEVEL_VERBOSE);
    }

    /**
     * Stop monitoring
     */
    stopMonitoring(): void {
        this.isMonitoring = false;
        this.cancelReconnect();

        if (this.healthCheckTimer) {
            clearInterval(this.healthCheckTimer);
            this.healthCheckTimer = null;
        }

        Logger("Connection monitoring stopped", LOG_LEVEL_VERBOSE);
    }

    /**
     * Perform a health check on the connection
     */
    private async performHealthCheck(): Promise<void> {
        if (!this.core.replicator) return;

        const status = this.core.replicationStat.value.syncStatus;

        // If we're supposed to be connected but status is problematic
        if (status === "ERRORED" || status === "CLOSED") {
            const networkOnline = navigator.onLine;
            if (networkOnline) {
                Logger("Connection appears unhealthy, scheduling reconnect", LOG_LEVEL_VERBOSE);
                this.scheduleReconnect(5000);
            }
        }
    }

    /**
     * Schedule a reconnection attempt
     */
    scheduleReconnect(delay: number): void {
        this.cancelReconnect();

        Logger(`Scheduling reconnect in ${delay}ms`, LOG_LEVEL_VERBOSE);

        this.reconnectTimer = setTimeout(async () => {
            this.reconnectTimer = null;
            await this.attemptReconnect();
        }, delay);
    }

    /**
     * Cancel any pending reconnection
     */
    cancelReconnect(): void {
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
        }
    }

    /**
     * Attempt to reconnect
     */
    private async attemptReconnect(): Promise<void> {
        if (!navigator.onLine) {
            Logger("Network offline, skipping reconnect attempt", LOG_LEVEL_VERBOSE);
            return;
        }

        Logger("Attempting to reconnect...", LOG_LEVEL_INFO);

        try {
            // Test connection first
            const testResult = await this.core.testConnection();

            if (testResult.success) {
                if (this.core.managers?.networkManager) {
                    this.core.managers.networkManager.setServerReachable(true);
                }

                // Restart sync if configured
                const settings = this.core.getSettings();
                if (settings.liveSync) {
                    await this.core.startSync(true);
                    Logger("Reconnected and sync restarted", LOG_LEVEL_NOTICE);
                }
            } else {
                if (this.core.managers?.networkManager) {
                    this.core.managers.networkManager.setServerReachable(false);
                }

                // Schedule another attempt with exponential backoff
                const delay = this.calculateBackoffDelay();
                Logger(`Reconnect failed, will retry in ${delay / 1000}s`, LOG_LEVEL_INFO);
                this.scheduleReconnect(delay);
            }
        } catch (error) {
            if (this.core.managers?.networkManager) {
                this.core.managers.networkManager.setServerReachable(false);
            }
            Logger(`Reconnect error: ${error}`, LOG_LEVEL_VERBOSE);

            const delay = this.calculateBackoffDelay();
            this.scheduleReconnect(delay);
        }
    }

    /**
     * Calculate backoff delay based on consecutive failures
     */
    private calculateBackoffDelay(): number {
        const failures = this.core.managers?.networkManager?.consecutiveFailures ?? 1;
        const baseDelay = 10000; // 10 seconds
        const maxDelay = 300000; // 5 minutes
        return Math.min(baseDelay * Math.pow(1.5, failures), maxDelay);
    }

    /**
     * Force an immediate reconnect attempt
     */
    async forceReconnect(): Promise<boolean> {
        this.cancelReconnect();
        Logger("Forcing reconnection attempt...", LOG_LEVEL_INFO);

        try {
            const testResult = await this.core.testConnection();
            if (testResult.success) {
                if (this.core.managers?.networkManager) {
                    this.core.managers.networkManager.setServerReachable(true);
                }
                return true;
            }
        } catch (error) {
            Logger(`Force reconnect failed: ${error}`, LOG_LEVEL_VERBOSE);
        }

        if (this.core.managers?.networkManager) {
            this.core.managers.networkManager.setServerReachable(false);
        }
        return false;
    }

    /**
     * Check if a reconnect is currently scheduled
     */
    isReconnectScheduled(): boolean {
        return this.reconnectTimer !== null;
    }

    /**
     * Get time until next reconnect attempt (ms)
     */
    getTimeUntilReconnect(): number | null {
        // Note: We can't easily get the remaining time from setTimeout
        // This would need additional tracking if needed
        return this.reconnectTimer ? -1 : null;
    }
}

