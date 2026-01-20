/**
 * Domain validation utilities
 * Frontend implementation of backend subdomain validation rules
 */

/**
 * Reserved subdomains that cannot be used
 */
const RESERVED_SUBDOMAINS: Set<string> = new Set([
    "www",
    "api",
    "admin",
    "cdb",
    "mail",
    "ftp",
    "smtp",
    "pop",
    "imap",
    "ns1",
    "ns2",
    "ns3",
    "mx",
    "mx1",
    "mx2",
    "webmail",
    "cpanel",
    "whm",
    "autodiscover",
    "autoconfig",
    "test",
    "dev",
    "staging",
    "prod",
    "beta",
    "alpha",
    "demo",
    "preview",
    "support",
    "help",
    "docs",
    "blog",
    "shop",
    "store",
    "app",
    "apps",
    "mobile",
    "status",
    "cdn",
    "static",
    "assets",
    "img",
    "images",
    "video",
    "videos",
    "media",
    "download",
    "downloads",
    "upload",
    "uploads",
    "file",
    "files",
    "secure",
    "ssl",
    "vpn",
    "proxy",
    "git",
    "svn",
    "repo",
    "jenkins",
    "ci",
    "build",
    "deploy",
    "monitor",
    "log",
    "logs",
    "analytics",
    "stats",
    "db",
    "database",
    "mysql",
    "postgres",
    "redis",
    "mongo",
    "elastic",
    "kafka",
    "rabbit",
    "mdfriday",
]);

/**
 * Subdomain validation result
 */
export interface SubdomainValidationResult {
    valid: boolean;
    error?: string;
}

/**
 * Validate subdomain format
 * - Minimum length: 4 characters
 * - Maximum length: 32 characters
 * - Only lowercase letters, numbers, and hyphens allowed
 * - Cannot start or end with a hyphen
 * 
 * @param subdomain The subdomain to validate
 * @returns Validation result with error message if invalid
 */
export function validateSubdomainFormat(subdomain: string): SubdomainValidationResult {
    // Minimum length: 4
    if (subdomain.length < 4) {
        return {
            valid: false,
            error: "Subdomain must be at least 4 characters long"
        };
    }

    // Maximum length: 32
    if (subdomain.length > 32) {
        return {
            valid: false,
            error: "Subdomain must be at most 32 characters long"
        };
    }

    // Only lowercase letters, numbers, and hyphens allowed
    // Cannot start or end with a hyphen
    // Pattern: ^[a-z0-9][a-z0-9-]{2,30}[a-z0-9]$
    const pattern = /^[a-z0-9][a-z0-9-]{2,30}[a-z0-9]$/;
    if (!pattern.test(subdomain)) {
        return {
            valid: false,
            error: "Subdomain can only contain lowercase letters, numbers, and hyphens, and cannot start or end with a hyphen"
        };
    }

    return { valid: true };
}

/**
 * Check if a subdomain is reserved
 * 
 * @param subdomain The subdomain to check
 * @returns true if the subdomain is reserved
 */
export function isReservedSubdomain(subdomain: string): boolean {
    return RESERVED_SUBDOMAINS.has(subdomain);
}

/**
 * Validate subdomain completely (format + reserved check)
 * 
 * @param subdomain The subdomain to validate
 * @returns Validation result with error message if invalid
 */
export function validateSubdomain(subdomain: string): SubdomainValidationResult {
    // First, validate format
    const formatResult = validateSubdomainFormat(subdomain);
    if (!formatResult.valid) {
        return formatResult;
    }

    // Then, check if reserved
    if (isReservedSubdomain(subdomain)) {
        return {
            valid: false,
            error: "This subdomain is reserved and cannot be used"
        };
    }

    return { valid: true };
}
