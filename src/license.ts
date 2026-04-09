/**
 * License Service for Friday Plugin
 * 
 * Handles license key validation, device fingerprinting, and license activation.
 * User only needs to input the license key once - everything else is automatic.
 */

/**
 * License features returned from activation
 */
export interface LicenseFeatures {
    maxDevices: number;
    maxIps: number;
    syncEnabled: boolean;
    syncQuota: number;
    publishEnabled: boolean;
    maxSites: number;
    maxStorage: number;
    customDomain: boolean;
    customSubDomain: boolean;
    validityDays: number;
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
 * Stored usage data
 */
export interface StoredUsageData {
    totalDiskUsage: number; // in MB
    maxStorage: number; // in MB
    unit: string;
    lastUpdated: number; // timestamp
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
 * Check if license is expired
 */
export function isLicenseExpired(expiresAt: number): boolean {
    return Date.now() > expiresAt;
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
