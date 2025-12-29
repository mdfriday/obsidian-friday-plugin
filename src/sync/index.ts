/**
 * Friday Sync Module
 * 
 * CouchDB synchronization module based on Self-hosted LiveSync
 * Provides sync functionality for the Friday Obsidian plugin
 */

// Export the main SyncService
export { SyncService, type SyncConfig, type SyncStatus, type SyncStatusCallback } from "./SyncService";

// Export the sync core (for advanced usage)
export { FridaySyncCore } from "./FridaySyncCore";

// Export the status display component
export { SyncStatusDisplay, type ReplicationStat } from "./SyncStatusDisplay";

// Export types from the core library
export * from "./types";
