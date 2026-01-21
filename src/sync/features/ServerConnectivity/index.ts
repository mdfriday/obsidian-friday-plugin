/**
 * ServerConnectivityChecker - Lightweight server connectivity checking
 * 
 * This module provides a pre-check mechanism to verify server reachability
 * before any sync operations. This enables:
 * 1. Accurate error attribution (network vs. sync issues)
 * 2. Proper offline mode support
 * 3. Prevention of misleading error messages
 */

import { Logger, LOG_LEVEL_INFO, LOG_LEVEL_VERBOSE } from "../../core/common/logger";
import type { RemoteDBSettings } from "../../core/common/types";

export type ServerStatus = "REACHABLE" | "UNREACHABLE" | "UNKNOWN";

export interface ConnectivityCheckResult {
    status: ServerStatus;
    error?: string;
    latency?: number;
}

export class ServerConnectivityChecker {
    private _lastCheckTime: number = 0;
    private _lastStatus: ServerStatus = "UNKNOWN";
    private _checkCooldown: number = 5000; // 5 seconds
    private _lastError: string | undefined = undefined;

    /**
     * Current server status based on last check
     */
    get currentStatus(): ServerStatus {
        return this._lastStatus;
    }

    /**
     * Whether server is reachable
     */
    get isServerReachable(): boolean {
        return this._lastStatus === "REACHABLE";
    }

    /**
     * Last error message (if any)
     */
    get lastError(): string | undefined {
        return this._lastError;
    }

    /**
     * Check server connectivity
     * This is a lightweight check that only verifies server reachability
     * 
     * @param setting - Remote database settings
     * @param forceCheck - If true, bypass cooldown and force a fresh check
     * @returns Connectivity check result
     */
    async checkConnectivity(
        setting: RemoteDBSettings,
        forceCheck: boolean = false
    ): Promise<ConnectivityCheckResult> {
        const now = Date.now();

        // Check cooldown (unless force check)
        if (!forceCheck && now - this._lastCheckTime < this._checkCooldown) {
            return { 
                status: this._lastStatus,
                error: this._lastError 
            };
        }

        // Check browser network status first
        if (!navigator.onLine) {
            this._lastStatus = "UNREACHABLE";
            this._lastCheckTime = now;
            this._lastError = "Browser is offline";
            Logger("Server connectivity check: Browser is offline", LOG_LEVEL_INFO);
            return { status: "UNREACHABLE", error: "Browser is offline" };
        }

        const startTime = Date.now();

        try {
            const result = await this.pingServer(setting);

            if (result.ok) {
                this._lastStatus = "REACHABLE";
                this._lastCheckTime = now;
                this._lastError = undefined;
                const latency = Date.now() - startTime;
                Logger(`Server connectivity check passed (${latency}ms)`, LOG_LEVEL_VERBOSE);
                return { status: "REACHABLE", latency };
            } else {
                this._lastStatus = "UNREACHABLE";
                this._lastCheckTime = now;
                this._lastError = result.error;
                Logger(`Server connectivity check failed: ${result.error}`, LOG_LEVEL_INFO);
                return { status: "UNREACHABLE", error: result.error };
            }
        } catch (ex: any) {
            this._lastStatus = "UNREACHABLE";
            this._lastCheckTime = now;
            const error = ex?.message || String(ex);
            this._lastError = error;
            Logger(`Server connectivity check error: ${error}`, LOG_LEVEL_VERBOSE);
            return { status: "UNREACHABLE", error };
        }
    }

    /**
     * Lightweight ping to server
     * Only checks if server responds - doesn't verify database or auth
     * Note: Even 401/403 responses mean server is reachable
     */
    private async pingServer(
        setting: RemoteDBSettings
    ): Promise<{ ok: boolean; error?: string }> {
        try {
            const uri = setting.couchDB_URI;
            if (!uri) {
                return { ok: false, error: "No server URI configured" };
            }

            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 10000); // 10s timeout

            const response = await fetch(uri, {
                method: "GET",
                signal: controller.signal,
                headers: this.getAuthHeaders(setting),
            });

            clearTimeout(timeoutId);

            // Server is reachable if we get any response (even auth errors)
            // 401/403 means server is there but auth failed - still "reachable"
            if (response.ok || response.status === 401 || response.status === 403) {
                return { ok: true };
            } else if (response.status === 404) {
                // 404 could mean database doesn't exist but server is up
                return { ok: true };
            } else {
                return { ok: false, error: `HTTP ${response.status}` };
            }
        } catch (ex: any) {
            if (ex.name === "AbortError") {
                return { ok: false, error: "Connection timeout (10s)" };
            }
            // Network errors
            const message = ex.message || "Connection failed";
            if (message.includes("Failed to fetch") || message.includes("NetworkError")) {
                return { ok: false, error: "Cannot reach server" };
            }
            return { ok: false, error: message };
        }
    }

    /**
     * Get authentication headers for the request
     */
    private getAuthHeaders(setting: RemoteDBSettings): HeadersInit {
        const headers: HeadersInit = {};
        if (setting.couchDB_USER && setting.couchDB_PASSWORD) {
            const auth = btoa(`${setting.couchDB_USER}:${setting.couchDB_PASSWORD}`);
            headers["Authorization"] = `Basic ${auth}`;
        }
        return headers;
    }

    /**
     * Reset status to unknown
     * Call this when settings change or on explicit user action
     */
    reset(): void {
        this._lastStatus = "UNKNOWN";
        this._lastCheckTime = 0;
        this._lastError = undefined;
        Logger("Server connectivity checker reset", LOG_LEVEL_VERBOSE);
    }

    /**
     * Force status update (for when we know server state from other operations)
     */
    setStatus(status: ServerStatus, error?: string): void {
        this._lastStatus = status;
        this._lastCheckTime = Date.now();
        this._lastError = error;
    }
}

