/**
 * Friday Sync Module
 * 
 * CouchDB synchronization module based on Self-hosted LiveSync
 * Provides sync functionality for the Friday Obsidian plugin
 */

// Export the main SyncService
export { SyncService, type SyncConfig, type SyncStatus, type SyncStatusCallback } from "./SyncService";

// Export types from the core library
export * from "./types";
