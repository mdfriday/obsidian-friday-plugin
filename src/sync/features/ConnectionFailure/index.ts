/**
 * FridayConnectionFailureHandler - Connection failure handling
 * 
 * Handles connection failures with Notice notifications (no UI dialogs needed).
 * 
 * Key Design Decision:
 * - Friday uses Salt-based database reset detection (not MILESTONE document)
 * - Database reset is detected via checkSaltConsistency() in LiveSyncAbstractReplicator
 * - User recovery action: Settings page → "Fetch from Server"
 * - Only one option available, so no dialog choice needed
 * 
 * Source: Simplified from livesync ModuleResolveMismatchedTweaks.ts
 */

import { Logger } from "../../core/common/logger";
import { LOG_LEVEL_INFO, LOG_LEVEL_NOTICE, LOG_LEVEL_VERBOSE } from "../../core/common/types";
import { $msg } from "../../core/common/i18n";
import type { FridaySyncCore } from "../../FridaySyncCore";

export type ConnectionFailureResult = boolean | "CHECKAGAIN" | undefined;

export class FridayConnectionFailureHandler {
    private core: FridaySyncCore;
    private _lastFailureNotified: number = 0;
    private _failureNotificationCooldown: number = 30000; // 30 seconds

    constructor(core: FridaySyncCore) {
        this.core = core;
    }

    /**
     * Check connection failure and determine action
     * 
     * NOTE: Unlike livesync which uses MILESTONE document for database reset detection,
     * Friday uses Salt consistency check. This is more suitable for our backend-controlled
     * database reset scenario where:
     * - Backend rebuilds database with same config but new salt
     * - Salt change is the only indicator of reset
     * - No MILESTONE document management needed
     */
    async checkConnectionFailure(): Promise<ConnectionFailureResult> {
        // Salt-based reset detection is handled in openOneShotReplication()
        // via checkSaltConsistency() - no additional check needed here

        // For network errors, just return false to allow auto-retry
        return false;
    }

    /**
     * Notify user about database reset (Notice only, no dialog)
     * User should go to Settings → "Fetch from Server" to recover
     */
    notifyDatabaseReset(): void {
        const now = Date.now();
        if (now - this._lastFailureNotified < this._failureNotificationCooldown) {
            return; // Avoid notification spam
        }
        this._lastFailureNotified = now;

        // Notice notification - user goes to Settings to take action
        Logger(
            $msg("fridaySync.saltChanged.message") ||
            "Remote database has been reset. Please use 'Fetch from Server' in Settings to re-sync.",
            LOG_LEVEL_NOTICE
        );
    }

    /**
     * Handle replication error with retry logic
     * @returns Action to take: 'retry', 'abort', or 'ignore'
     */
    async handleReplicationError(error: any, showNotice: boolean): Promise<'retry' | 'abort' | 'ignore'> {
        const errorMessage = error?.message || String(error);

        // Check for network-related errors
        if (this.isNetworkError(error)) {
            if (this.core.managers?.networkManager) {
                this.core.managers.networkManager.setServerReachable(false);
            }

            if (showNotice && this.shouldShowNotification()) {
                Logger(
                    $msg("fridaySync.error.networkUnavailable") ||
                    "Cannot connect to sync server. Will retry when network is available.",
                    LOG_LEVEL_NOTICE
                );
            }
            return 'retry';
        }

        // Check for authentication errors
        if (this.isAuthError(error)) {
            Logger(
                $msg("fridaySync.error.authFailed") ||
                "Authentication failed. Please check your credentials in Settings.",
                LOG_LEVEL_NOTICE
            );
            return 'abort';
        }

        // Check for timeout errors
        if (this.isTimeoutError(error)) {
            Logger("Connection timeout, will retry...", LOG_LEVEL_INFO);
            return 'retry';
        }

        // Unknown error
        Logger(`Sync error: ${errorMessage}`, LOG_LEVEL_VERBOSE);
        return 'ignore';
    }

    /**
     * Check if error is network-related
     */
    private isNetworkError(error: any): boolean {
        if (!error) return false;
        const message = error?.message?.toLowerCase() || '';
        return (
            (error.name === 'TypeError' && message.includes('fetch')) ||
            message.includes('network') ||
            message.includes('econnrefused') ||
            message.includes('enotfound') ||
            message.includes('etimedout') ||
            message.includes('failed to fetch') ||
            error.status === 0
        );
    }

    /**
     * Check if error is authentication-related
     */
    private isAuthError(error: any): boolean {
        return error?.status === 401 || error?.status === 403;
    }

    /**
     * Check if error is timeout-related
     */
    private isTimeoutError(error: any): boolean {
        if (!error) return false;
        const message = error?.message?.toLowerCase() || '';
        return (
            message.includes('timeout') ||
            error.name === 'TimeoutError' ||
            error.status === 408
        );
    }

    /**
     * Check if we should show a notification (avoid spam)
     */
    private shouldShowNotification(): boolean {
        const now = Date.now();
        if (now - this._lastFailureNotified < this._failureNotificationCooldown) {
            return false;
        }
        this._lastFailureNotified = now;
        return true;
    }

    /**
     * Calculate retry delay with exponential backoff
     */
    getRetryDelay(): number {
        const failures = this.core.managers?.networkManager?.consecutiveFailures ?? 1;
        const baseDelay = 5000; // 5 seconds
        const maxDelay = 300000; // 5 minutes
        const delay = Math.min(baseDelay * Math.pow(2, failures - 1), maxDelay);
        return delay;
    }

    /**
     * Reset notification cooldown (e.g., after successful connection)
     */
    resetNotificationCooldown(): void {
        this._lastFailureNotified = 0;
    }
}

