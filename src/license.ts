/**
 * License Service for Friday Plugin
 * 
 * Handles license key validation, device fingerprinting, and license activation.
 * User only needs to input the license key once - everything else is automatic.
 */

import { requestUrl, type RequestUrlResponse } from "obsidian";

// IndexedDB database name for storing device ID
const DEVICE_DB_NAME = 'friday-device-store';
const DEVICE_STORE_NAME = 'device';
const DEVICE_ID_KEY = 'device_id';

/**
 * License features returned from activation
 */
export interface LicenseFeatures {
    max_devices: number;
    max_ips: number;
    sync_enabled: boolean;
    sync_quota: number;
    publish_enabled: boolean;
    max_sites: number;
    max_storage: number;
    custom_domain: boolean;
    custom_sub_domain: boolean;
    validity_days: number;
}

/**
 * Sync configuration returned from activation
 */
export interface LicenseSyncConfig {
    db_endpoint: string;
    db_name: string;
    db_password: string;
    email: string;
    status: string;
}

/**
 * User info returned from activation
 */
export interface LicenseUserInfo {
    email: string;
    user_dir: string;
}

/**
 * License activation response
 */
export interface LicenseActivationResponse {
    activated: boolean;
    first_time: boolean;
    expires_at: number;
    features: LicenseFeatures;
    license_key: string;
    plan: string;
    success: boolean;
    sync: LicenseSyncConfig;
    user: LicenseUserInfo;
}

/**
 * Stored license data
 */
export interface StoredLicenseData {
    key: string;
    plan: string;
    expiresAt: number;
    features: LicenseFeatures;
    activatedAt: number;
}

/**
 * Stored sync configuration
 */
export interface StoredSyncData {
    enabled: boolean;
    endpoint: string;
    dbName: string;
    email: string;
    dbPassword: string;
}

/**
 * Stored user data
 */
export interface StoredUserData {
    email: string;
    userDir: string;
}

/**
 * Disk usage information
 */
export interface DiskUsage {
    couchdb_disk_usage: string;
    publish_disk_usage: string;
    total_disk_usage: string;
    unit: string;
}

/**
 * License usage response
 */
export interface LicenseUsageResponse {
    devices: {
        count: number;
        devices: Array<{
            access_count: number;
            device_id: string;
            device_name: string;
            device_type: string;
            first_seen_at: number;
            last_seen_at: number;
            status: string;
        }>;
    };
    disks: DiskUsage;
    features: LicenseFeatures;
    ips: {
        count: number;
        ips: Array<{
            access_count: number;
            city: string;
            country: string;
            first_seen_at: number;
            ip_address: string;
            last_seen_at: number;
            region: string;
            status: string;
        }>;
    };
    license_key: string;
    plan: string;
}

/**
 * Stored usage data
 */
export interface StoredUsageData {
    totalDiskUsage: number; // in MB
    maxStorage: number; // in MB
    unit: string;
    lastUpdated: number; // timestamp
}

/**
 * Subdomain information from API
 */
export interface DomainInfo {
    subdomain: string;
    full_domain: string;
    cus_domain: string;
    folder: string;
    created_at: number;
}

/**
 * Subdomain availability check response
 */
export interface SubdomainCheckResponse {
    available: boolean;
    message?: string;
}

/**
 * Subdomain update response
 */
export interface SubdomainUpdateResponse {
    new_subdomain: string;
    old_subdomain: string;
    full_domain: string;
    message: string;
}

/**
 * Convert license key to email
 * License Key format: MDF-XXXX-XXXX-XXXX
 */
export function licenseKeyToEmail(licenseKey: string): string {
    const key = licenseKey.replace(/^MDF-/i, "").toLowerCase();
    return `${key}@mdfriday.com`;
}

/**
 * Convert license key to password
 * Uses base64 encoding of the key portion
 */
export function licenseKeyToPassword(licenseKey: string): string {
    const key = licenseKey.replace(/^MDF-/i, "").toLowerCase();
    return btoa(key);
}

/**
 * Validate license key format
 * Expected format: MDF-XXXX-XXXX-XXXX (alphanumeric)
 */
export function isValidLicenseKeyFormat(licenseKey: string): boolean {
    const pattern = /^MDF-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/i;
    return pattern.test(licenseKey);
}

/**
 * Mask license key for display
 * Shows only last 4 characters: MDF-••••-••••-XXXX
 */
export function maskLicenseKey(licenseKey: string): string {
    if (!licenseKey || licenseKey.length < 4) return licenseKey;
    const parts = licenseKey.split('-');
    if (parts.length === 4) {
        return `MDF-••••-••••-${parts[3]}`;
    }
    return licenseKey.slice(0, -4).replace(/./g, '•') + licenseKey.slice(-4);
}

/**
 * Format expiration date for display
 */
export function formatExpirationDate(timestamp: number): string {
    const date = new Date(timestamp);
    return date.toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric'
    });
}

/**
 * Check if license is expired
 */
export function isLicenseExpired(expiresAt: number): boolean {
    return Date.now() > expiresAt;
}

/**
 * Get days until expiration
 */
export function getDaysUntilExpiration(expiresAt: number): number {
    const diff = expiresAt - Date.now();
    return Math.max(0, Math.ceil(diff / (1000 * 60 * 60 * 24)));
}

/**
 * Generate a stable device fingerprint
 * Uses browser/system characteristics that remain stable across sessions
 */
async function generateDeviceFingerprint(): Promise<string> {
    const components: string[] = [];
    
    // Screen characteristics
    if (typeof screen !== 'undefined') {
        components.push(`${screen.width}x${screen.height}`);
        components.push(`${screen.colorDepth}`);
        components.push(`${screen.pixelDepth || 0}`);
    }
    
    // Navigator characteristics
    if (typeof navigator !== 'undefined') {
        components.push(navigator.language || '');
        components.push(navigator.platform || '');
        components.push(String(navigator.hardwareConcurrency || 0));
        components.push(String(navigator.maxTouchPoints || 0));
    }
    
    // Timezone
    try {
        components.push(Intl.DateTimeFormat().resolvedOptions().timeZone || '');
    } catch {
        components.push('');
    }
    
    // User agent (partial, for stability)
    const ua = navigator?.userAgent || '';
    const uaHash = ua.split(' ').slice(0, 3).join(' ');
    components.push(uaHash);
    
    // Create a hash from components
    const fingerprint = components.join('|');
    const encoder = new TextEncoder();
    const data = encoder.encode(fingerprint);
    
    // Use Web Crypto API for hashing if available
    if (typeof crypto !== 'undefined' && crypto.subtle) {
        const hashBuffer = await crypto.subtle.digest('SHA-256', data);
        const hashArray = Array.from(new Uint8Array(hashBuffer));
        return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    }
    
    // Fallback: simple hash function
    let hash = 0;
    for (let i = 0; i < fingerprint.length; i++) {
        const char = fingerprint.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash = hash & hash; // Convert to 32bit integer
    }
    return Math.abs(hash).toString(16).padStart(8, '0');
}

/**
 * Open IndexedDB database
 */
function openDeviceDB(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DEVICE_DB_NAME, 1);
        
        request.onerror = () => reject(request.error);
        request.onsuccess = () => resolve(request.result);
        
        request.onupgradeneeded = (event) => {
            const db = (event.target as IDBOpenDBRequest).result;
            if (!db.objectStoreNames.contains(DEVICE_STORE_NAME)) {
                db.createObjectStore(DEVICE_STORE_NAME);
            }
        };
    });
}

/**
 * Get device ID from IndexedDB
 */
async function getStoredDeviceId(): Promise<string | null> {
    try {
        const db = await openDeviceDB();
        return new Promise((resolve, reject) => {
            const transaction = db.transaction(DEVICE_STORE_NAME, 'readonly');
            const store = transaction.objectStore(DEVICE_STORE_NAME);
            const request = store.get(DEVICE_ID_KEY);
            
            request.onerror = () => {
                db.close();
                reject(request.error);
            };
            request.onsuccess = () => {
                db.close();
                resolve(request.result || null);
            };
        });
    } catch {
        return null;
    }
}

/**
 * Store device ID in IndexedDB
 */
async function storeDeviceId(deviceId: string): Promise<void> {
    try {
        const db = await openDeviceDB();
        return new Promise((resolve, reject) => {
            const transaction = db.transaction(DEVICE_STORE_NAME, 'readwrite');
            const store = transaction.objectStore(DEVICE_STORE_NAME);
            const request = store.put(deviceId, DEVICE_ID_KEY);
            
            request.onerror = () => {
                db.close();
                reject(request.error);
            };
            request.onsuccess = () => {
                db.close();
                resolve();
            };
        });
    } catch (error) {
        console.warn('Failed to store device ID:', error);
    }
}

/**
 * Get or create a stable device ID
 * - First checks IndexedDB for existing ID
 * - If not found, generates a new fingerprint and stores it
 */
export async function getDeviceId(): Promise<string> {
    // Try to get stored device ID first
    let deviceId = await getStoredDeviceId();
    
    if (!deviceId) {
        // Generate new fingerprint
        deviceId = await generateDeviceFingerprint();
        // Store it for future use
        await storeDeviceId(deviceId);
    }
    
    return deviceId;
}

/**
 * Get device name for display
 */
export function getDeviceName(): string {
    const platform = navigator?.platform || 'Unknown';
    const ua = navigator?.userAgent || '';
    
    // Try to extract OS info
    let osName = 'Unknown OS';
    if (ua.includes('Mac')) osName = 'macOS';
    else if (ua.includes('Windows')) osName = 'Windows';
    else if (ua.includes('Linux')) osName = 'Linux';
    else if (ua.includes('iPhone') || ua.includes('iPad')) osName = 'iOS';
    else if (ua.includes('Android')) osName = 'Android';
    
    return `Obsidian on ${osName}`;
}

/**
 * Get device type
 */
export function getDeviceType(): string {
    const ua = navigator?.userAgent || '';
    
    if (ua.includes('Mobile') || ua.includes('Android') || ua.includes('iPhone')) {
        return 'mobile';
    }
    if (ua.includes('Tablet') || ua.includes('iPad')) {
        return 'tablet';
    }
    return 'desktop';
}

/**
 * Generate a random encryption passphrase
 * Used for end-to-end encryption of sync data
 */
export function generateEncryptionPassphrase(): string {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    const array = new Uint8Array(24);
    crypto.getRandomValues(array);
    return Array.from(array, byte => chars[byte % chars.length]).join('');
}

/**
 * Capitalize first letter of plan name
 */
export function formatPlanName(plan: string): string {
    if (!plan) return 'Unknown';
    return plan.charAt(0).toUpperCase() + plan.slice(1).toLowerCase();
}

