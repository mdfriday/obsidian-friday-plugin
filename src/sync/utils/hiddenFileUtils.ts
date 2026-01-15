/**
 * Hidden File Sync Utility Functions
 * 
 * Ported from livesync/src/common/utils.ts for hidden file synchronization.
 */

import { ICHeader, ICHeaderLength } from "../types";
import type { FilePath, LoadedEntry, MetaEntry, UXStat } from "../types";

// ==================== Comparison Constants ====================

export const TARGET_IS_NEW = 1;
export const BASE_IS_NEW = -1;
export const EVEN = 0;
export type CompareResult = typeof TARGET_IS_NEW | typeof BASE_IS_NEW | typeof EVEN;

// ==================== Internal Metadata Functions ====================

/**
 * Check if a document ID represents internal metadata (hidden file)
 * @param id Document ID to check
 * @returns true if ID has the internal file prefix "i:"
 */
export function isInternalMetadata(id: string): boolean {
    return id.startsWith(ICHeader);
}

/**
 * Strip the internal metadata prefix from an ID
 * @param id Document ID with potential prefix
 * @returns ID without the prefix
 */
export function stripInternalMetadataPrefix<T extends string>(id: T): T {
    if (id.startsWith(ICHeader)) {
        return id.substring(ICHeaderLength) as T;
    }
    return id;
}

/**
 * Add internal metadata prefix to a path
 * @param path File path
 * @returns Path with "i:" prefix
 */
export function addInternalPrefix(path: string): string {
    if (path.startsWith(ICHeader)) {
        return path;
    }
    return ICHeader + path;
}

// ==================== Time Comparison Functions ====================

/**
 * Compare two modification times with tolerance for filesystem precision
 * @param baseMTime Base modification time
 * @param targetMTime Target modification time  
 * @returns CompareResult indicating which is newer
 */
export function compareMTime(baseMTime: number, targetMTime: number): CompareResult {
    // Allow 2 second tolerance for filesystem time precision differences
    const tolerance = 2000;
    const diff = targetMTime - baseMTime;
    
    if (diff > tolerance) {
        return TARGET_IS_NEW;
    } else if (diff < -tolerance) {
        return BASE_IS_NEW;
    }
    return EVEN;
}

// ==================== Change Tracking ====================

// Global map to track same changes (prevents unnecessary sync)
const sameChangePairs = new Map<string, [number, number]>();

/**
 * Mark that two mtimes represent the same content
 * @param path File path
 * @param mtime1 First modification time
 * @param mtime2 Second modification time
 */
export function markChangesAreSame(path: string, mtime1: number, mtime2: number): void {
    sameChangePairs.set(path, [mtime1, mtime2]);
}

/**
 * Check if changes are marked as same
 * @param path File path
 * @param mtime1 First modification time
 * @param mtime2 Second modification time
 * @returns true if marked as same
 */
export function isChangesMarkedAsSame(path: string, mtime1: number, mtime2: number): boolean {
    const pair = sameChangePairs.get(path);
    if (!pair) return false;
    return (pair[0] === mtime1 && pair[1] === mtime2) || 
           (pair[0] === mtime2 && pair[1] === mtime1);
}

/**
 * Remove change marking for a path
 * @param path File path
 */
export function unmarkChanges(path: string): void {
    sameChangePairs.delete(path);
}

// ==================== Document Property Helpers ====================

/**
 * Extract document properties for logging
 * @param doc Document entry
 * @returns Object with path, revision display, and shortened ID
 */
export function getDocProps(doc: LoadedEntry | MetaEntry): {
    path: string;
    revDisplay: string;
    shortenedId: string;
} {
    const path = (doc as any).path || "";
    const rev = doc._rev || "";
    const id = doc._id || "";
    
    return {
        path: stripInternalMetadataPrefix(path),
        revDisplay: rev.substring(0, 8),
        shortenedId: id.substring(0, 8),
    };
}

/**
 * Get comparing mtime from a document or stat
 * @param doc Document or stat object
 * @param includeDeleted Include deleted docs in comparison
 * @returns mtime value or 0 if invalid/deleted
 */
export function getComparingMTime(
    doc: (MetaEntry | LoadedEntry | false) | { mtime?: number; stat?: UXStat } | UXStat | null | undefined,
    includeDeleted = false
): number {
    if (doc === null || doc === false || doc === undefined) return 0;
    
    if (!includeDeleted) {
        if ("deleted" in doc && doc.deleted) return 0;
        if ("_deleted" in doc && (doc as any)._deleted) return 0;
    }
    
    if ("stat" in doc && doc.stat) return doc.stat.mtime ?? 0;
    if ("mtime" in doc) return (doc as any).mtime ?? 0;
    
    return 0;
}

// ==================== Progress Helpers ====================

/**
 * Create a progress notifier that only fires every N calls
 * @param n Fire every N calls
 * @param fn Function to call with progress count
 * @returns Progress function to call
 */
export function onlyInNTimes(n: number, fn: (progress: number) => void): () => void {
    let count = 0;
    return () => {
        count++;
        if (count % n === 0) {
            fn(count);
        }
    };
}

// ==================== Stat/Key Helpers ====================

/**
 * Convert file stat to cache key
 * @param stat File stat object
 * @returns String key for caching
 */
export function statToKey(stat: UXStat | null): string {
    return `${stat?.mtime ?? 0}-${stat?.size ?? 0}`;
}

/**
 * Convert document to cache key
 * @param doc Document entry
 * @returns String key for caching
 */
export function docToKey(doc: LoadedEntry | MetaEntry): string {
    const deleted = (doc as any)._deleted || (doc as any).deleted || false;
    return `${(doc as any).mtime || 0}-${(doc as any).size || 0}-${doc._rev || ""}-${deleted ? "0" : "1"}`;
}

// ==================== RegExp Helpers ====================

/**
 * Parse comma-separated pattern string into RegExp array
 * @param patterns Comma-separated pattern string
 * @returns Array of compiled RegExp objects
 */
export function parsePatterns(patterns: string): RegExp[] {
    if (!patterns || patterns.trim() === "") {
        return [];
    }
    
    return patterns
        .split(",")
        .map(p => p.trim())
        .filter(p => p.length > 0)
        .map(p => {
            try {
                return new RegExp(p);
            } catch {
                console.warn(`Invalid regex pattern: ${p}`);
                return null;
            }
        })
        .filter((r): r is RegExp => r !== null);
}

/**
 * Test if path matches any pattern in array
 * @param path Path to test
 * @param patterns Array of patterns
 * @returns true if any pattern matches
 */
export function matchesAnyPattern(path: string, patterns: RegExp[]): boolean {
    return patterns.some(pattern => pattern.test(path));
}

// ==================== Path Helpers ====================

/**
 * Get the id2path conversion for internal files
 * Strips prefix and normalizes path
 */
export function getPath(entry: { _id?: string; path?: string }): string {
    if (entry.path) {
        return stripInternalMetadataPrefix(entry.path);
    }
    if (entry._id) {
        return stripInternalMetadataPrefix(entry._id);
    }
    return "";
}

