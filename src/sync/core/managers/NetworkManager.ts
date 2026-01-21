/**
 * NetworkManager - Network status management
 * 
 * Enhanced to support:
 * - Basic online/offline detection via navigator.onLine
 * - Server reachability tracking (firewall detection)
 * - Consecutive failure tracking for exponential backoff
 * - Status change callbacks
 */

export abstract class NetworkManager {
    abstract get isOnline(): boolean;
    abstract checkActualConnectivity(): Promise<boolean>;
    abstract onStatusChange(callback: (online: boolean) => void): void;
    abstract setServerReachable(reachable: boolean): void;
    abstract get consecutiveFailures(): number;
    abstract get serverReachable(): boolean | null;
}

export class NetworkManagerBrowser extends NetworkManager {
    private _statusCallbacks: ((online: boolean) => void)[] = [];
    private _lastKnownStatus: boolean = true;
    private _consecutiveFailures: number = 0;
    private _serverReachable: boolean | null = null;

    override get isOnline(): boolean {
        // Basic check - network interface is up
        return navigator.onLine;
    }

    /**
     * Get the number of consecutive connection failures
     * Used for exponential backoff calculation
     */
    override get consecutiveFailures(): number {
        return this._consecutiveFailures;
    }

    /**
     * Get server reachability status
     * null = unknown, true = reachable, false = unreachable
     */
    override get serverReachable(): boolean | null {
        return this._serverReachable;
    }

    /**
     * Check if we can actually reach the sync server
     * This detects firewall blocking that navigator.onLine misses
     */
    override async checkActualConnectivity(): Promise<boolean> {
        if (!navigator.onLine) {
            this._serverReachable = false;
            return false;
        }
        // Actual server connectivity is checked by replicator
        // This returns the cached result from the last check
        return this._serverReachable ?? true;
    }

    /**
     * Set server reachability status
     * Called by replicator after connection attempts
     */
    override setServerReachable(reachable: boolean): void {
        const wasReachable = this._serverReachable;
        this._serverReachable = reachable;

        if (reachable) {
            this._consecutiveFailures = 0;
        } else {
            this._consecutiveFailures++;
        }

        // Notify if status changed
        if (wasReachable !== reachable) {
            this._notifyStatusChange(reachable);
        }
    }

    /**
     * Register a callback for status changes
     */
    override onStatusChange(callback: (online: boolean) => void): void {
        this._statusCallbacks.push(callback);
    }

    /**
     * Remove a status change callback
     */
    removeStatusChangeCallback(callback: (online: boolean) => void): void {
        const index = this._statusCallbacks.indexOf(callback);
        if (index > -1) {
            this._statusCallbacks.splice(index, 1);
        }
    }

    /**
     * Notify all registered callbacks about status change
     */
    private _notifyStatusChange(online: boolean): void {
        for (const cb of this._statusCallbacks) {
            try {
                cb(online);
            } catch (e) {
                console.error("[NetworkManager] Error in status callback:", e);
            }
        }
    }

    /**
     * Reset failure count (e.g., after manual reconnect)
     */
    resetFailureCount(): void {
        this._consecutiveFailures = 0;
    }
}
