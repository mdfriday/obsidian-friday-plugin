/**
 * Foundry Domain Service Integration
 * 
 * Provides domain management functionality using Foundry's Domain Service,
 * including subdomain and custom domain management.
 */

import type { ObsidianDomainService } from '@mdfriday/foundry';

/**
 * Domain service wrapper for Friday Plugin
 * Handles all domain-related operations
 */
export class DomainServiceManager {
	constructor(
		private domainService: ObsidianDomainService,
		private workspacePath: string
	) {}

	/**
	 * Get domain information (subdomain, custom domain, etc.)
	 */
	async getDomainInfo(): Promise<{ success: boolean; error?: string; data?: any }> {
		try {
			const result = await this.domainService.getDomainInfo(this.workspacePath);
			return result;
		} catch (error) {
			console.error('[Friday] Error getting domain info:', error);
			return { success: false, error: error.message };
		}
	}

	/**
	 * Check if subdomain is available
	 */
	async checkSubdomain(subdomain: string): Promise<{ success: boolean; error?: string; data?: any }> {
		try {
			const result = await this.domainService.checkSubdomain(this.workspacePath, subdomain);
			return result;
		} catch (error) {
			console.error('[Friday] Error checking subdomain:', error);
			return { success: false, error: error.message };
		}
	}

	/**
	 * Update subdomain
	 */
	async updateSubdomain(newSubdomain: string): Promise<{ success: boolean; error?: string; data?: any }> {
		try {
			const result = await this.domainService.updateSubdomain(this.workspacePath, newSubdomain);
			return result;
		} catch (error) {
			console.error('[Friday] Error updating subdomain:', error);
			return { success: false, error: error.message };
		}
	}

	/**
	 * Check if custom domain is available and valid
	 */
	async checkCustomDomain(domain: string): Promise<{ success: boolean; error?: string; data?: any }> {
		try {
			const result = await this.domainService.checkCustomDomain(this.workspacePath, domain);
			return result;
		} catch (error) {
			console.error('[Friday] Error checking custom domain:', error);
			return { success: false, error: error.message };
		}
	}

	/**
	 * Add custom domain
	 */
	async addCustomDomain(domain: string): Promise<{ success: boolean; error?: string; data?: any }> {
		try {
			const result = await this.domainService.addCustomDomain(this.workspacePath, domain);
			return result;
		} catch (error) {
			console.error('[Friday] Error adding custom domain:', error);
			return { success: false, error: error.message };
		}
	}

	/**
	 * Check HTTPS status for a domain
	 */
	async checkHttpsStatus(domain: string): Promise<{ success: boolean; error?: string; data?: any }> {
		try {
			const result = await this.domainService.checkHttpsStatus(this.workspacePath, domain);
			return result;
		} catch (error) {
			console.error('[Friday] Error checking HTTPS status:', error);
			return { success: false, error: error.message };
		}
	}
}
