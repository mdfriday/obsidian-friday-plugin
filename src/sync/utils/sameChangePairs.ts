/**
 * Same Change Pairs - Persistent storage for mtime comparison optimization
 * 
 * Based on LiveSync's implementation (livesync/src/common/stores.ts and livesync/src/common/utils.ts)
 * This module tracks mtime pairs that correspond to identical file content,
 * preventing unnecessary content comparisons and sync operations.
 * 
 * Core Concept:
 * When a file's mtime changes but content remains the same (e.g., Obsidian indexing),
 * we mark the old and new mtime as "same changes". On subsequent comparisons,
 * we can skip content reading and immediately recognize them as identical.
 */

import { PersistentMap } from "octagonal-wheels/dataobject/PersistentMap";
import { Logger, LOG_LEVEL_VERBOSE } from "../core/common/logger";
import type { AnyEntry, MetaEntry } from "../core/common/types";

/**
 * Persistent storage for mtime pairs
 * Key: file path (without prefix)
 * Value: array of mtimes that correspond to the same content
 */
let sameChangePairs: PersistentMap<number[]> | null = null;

/**
 * Initialize the sameChangePairs storage
 * Should be called once during FridaySyncCore initialization
 * 
 * @param vaultName - Name of the vault (used to isolate storage per vault)
 */
export function initializeSameChangePairs(vaultName: string): void {
    // Use "friday-" prefix to distinguish from LiveSync's storage
    sameChangePairs = new PersistentMap<number[]>(`friday-persist-same-changes-${vaultName}`);
    Logger(`sameChangePairs initialized for vault: ${vaultName}`, LOG_LEVEL_VERBOSE);
}

/**
 * Get the sameChangePairs storage instance
 * @throws Error if not initialized
 */
function getSameChangePairs(): PersistentMap<number[]> {
    if (!sameChangePairs) {
        throw new Error("sameChangePairs not initialized. Call initializeSameChangePairs() first.");
    }
    return sameChangePairs;
}

/**
 * Extract file path key from various file types
 * Strips prefixes to get the canonical path
 * 
 * @param file - File entry, path string, or file info
 * @returns Canonical file path
 */
function getKey(file: AnyEntry | string | { path: string }): string {
    if (typeof file === "string") {
        return stripAllPrefixes(file);
    }
    return stripAllPrefixes(file.path);
}

/**
 * Strip all path prefixes (h:, i:, etc.)
 * Copied from LiveSync's stripAllPrefixes implementation
 */
function stripAllPrefixes(path: string): string {
    return path.replace(/^[hi]:/g, "");
}

/**
 * Mark two mtimes as corresponding to the same content
 * 
 * This is called when:
 * 1. Storage → DB: mtime differs but content is identical
 * 2. DB → Storage: remote mtime differs from local but content is identical
 * 
 * @param file - File path or entry
 * @param mtime1 - First mtime (e.g., local file)
 * @param mtime2 - Second mtime (e.g., database entry)
 * 
 * @example
 * ```typescript
 * // After comparing content and finding it identical:
 * if (await isDocContentSame(localContent, remoteContent)) {
 *     markChangesAreSame(filePath, localMtime, remoteMtime);
 * }
 * ```
 */
export function markChangesAreSame(
    file: AnyEntry | string | { path: string },
    mtime1: number,
    mtime2: number
): void {
    // If mtimes are identical, no need to mark
    if (mtime1 === mtime2) return;

    try {
        const store = getSameChangePairs();
        const key = getKey(file);
        const pairs = store.get(key, []) || [];

        // If either mtime already exists in pairs, merge them all together
        // This handles cases like: [T1, T2] + [T2, T3] -> [T1, T2, T3]
        if (pairs.some((e) => e === mtime1 || e === mtime2)) {
            store.set(key, [...new Set([...pairs, mtime1, mtime2])]);
        } else {
            // Create a new pair
            store.set(key, [mtime1, mtime2]);
        }

        Logger(
            `Marked same changes: ${key} [${mtime1}, ${mtime2}]`,
            LOG_LEVEL_VERBOSE
        );
    } catch (error) {
        Logger(`Failed to mark same changes: ${error}`, LOG_LEVEL_VERBOSE);
    }
}

/**
 * Clear the marked mtimes for a file
 * Should be called when file content actually changes
 * 
 * @param file - File path or entry
 * 
 * @example
 * ```typescript
 * // When content differs:
 * if (!await isDocContentSame(localContent, remoteContent)) {
 *     unmarkChanges(filePath); // Clear old marks
 *     // ... proceed with sync
 * }
 * ```
 */
export function unmarkChanges(file: AnyEntry | string | { path: string }): void {
    try {
        const store = getSameChangePairs();
        const key = getKey(file);
        store.delete(key);
        Logger(`Unmarked changes for: ${key}`, LOG_LEVEL_VERBOSE);
    } catch (error) {
        Logger(`Failed to unmark changes: ${error}`, LOG_LEVEL_VERBOSE);
    }
}

/**
 * Check if all specified mtimes are marked as same changes
 * Returns a symbol (EVEN) if marked, undefined otherwise
 * 
 * This is used by compareFileFreshness to skip content comparison
 * when mtimes are known to correspond to identical content
 * 
 * @param file - File path or entry
 * @param mtimes - Array of mtimes to check
 * @returns EVEN symbol if all mtimes are marked as same, undefined otherwise
 * 
 * @example
 * ```typescript
 * // Before comparing content:
 * if (isMarkedAsSameChanges(file, [localMtime, remoteMtime])) {
 *     return "EVEN"; // Skip content comparison!
 * }
 * ```
 */
export function isMarkedAsSameChanges(
    file: { path: string } | AnyEntry | string,
    mtimes: number[]
): typeof EVEN | undefined {
    try {
        const store = getSameChangePairs();
        const key = getKey(file);
        const pairs = store.get(key, []) || [];

        // Check if ALL mtimes exist in the pairs array
        if (mtimes.every((e) => pairs.indexOf(e) !== -1)) {
            return EVEN;
        }
    } catch (error) {
        Logger(`Failed to check marked changes: ${error}`, LOG_LEVEL_VERBOSE);
    }
    return undefined;
}

/**
 * Cleanup old sameChangePairs records for files that no longer exist
 * Should be called periodically to prevent unbounded growth
 * 
 * @param existingPaths - Set of paths that currently exist in the vault
 * @returns Number of records cleaned up
 */
export async function cleanupSameChangePairs(
    existingPaths: Set<string>
): Promise<number> {
    try {
        const store = getSameChangePairs();
        // Note: PersistentMap doesn't expose keys() method in the same way
        // This is a simplified version - full implementation would need
        // to iterate through the internal storage
        Logger("sameChangePairs cleanup skipped (not fully implemented)", LOG_LEVEL_VERBOSE);
        return 0;
    } catch (error) {
        Logger(`Failed to cleanup sameChangePairs: ${error}`, LOG_LEVEL_VERBOSE);
        return 0;
    }
}

// Symbol constants (matching LiveSync's implementation)
export const BASE_IS_NEW = Symbol("base");
export const TARGET_IS_NEW = Symbol("target");
export const EVEN = Symbol("even");

