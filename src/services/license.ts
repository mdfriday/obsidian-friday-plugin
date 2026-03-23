/**
 * Foundry License Service Integration
 * 
 * Provides license management functionality using Foundry's License Service,
 * including trial requests, activation, info queries, and usage monitoring.
 */

import type {
	ObsidianLicenseService,
	ObsidianAuthService,
	ObsidianGlobalConfigService,
} from '@mdfriday/foundry';

/**
 * License service wrapper for Friday Plugin
 * Handles all license-related operations and configuration syncing
 */
export class LicenseServiceManager {
	constructor(
		private licenseService: ObsidianLicenseService,
		private authService: ObsidianAuthService,
		private globalConfigService: ObsidianGlobalConfigService,
		private workspacePath: string
	) {}

	/**
	 * Request trial license using Foundry License Service
	 * Saves the license key to global config for publishing
	 */
	async requestTrial(email: string): Promise<{ success: boolean; error?: string; data?: any }> {
		try {
			const result = await this.licenseService.requestTrial(this.workspacePath, email);
			
			if (result.success && result.data) {
				console.log('[Friday] Trial license requested successfully:', result.data);
				
				// Save license key to global config for MDFriday publishing
				if (result.data.key) {
					await this.saveLicenseKeyToConfig(result.data.key);
					console.log('[Friday] Trial license key saved to global config');
				}
				
				// Note: Auth and license data are now managed by Foundry Services
				// No need to manually sync - use licenseState.initialize() to refresh
				
				return { success: true, data: result.data };
			}
			
			return { success: false, error: result.error || 'Failed to request trial' };
		} catch (error) {
			console.error('[Friday] Error requesting trial license:', error);
			return { success: false, error: error.message };
		}
	}

	/**
	 * Login with license key (获取 token)
	 * This should be called before activateLicense
	 */
	async loginWithLicense(licenseKey: string): Promise<{ success: boolean; error?: string; data?: any }> {
		try {
			const result = await this.licenseService.loginWithLicense(this.workspacePath, licenseKey);
			
			if (result.success) {
				console.log('[Friday] Logged in with license successfully');
				return { success: true, data: result.data };
			}
			
			return { success: false, error: result.error || 'Login with license failed' };
		} catch (error) {
			console.error('[Friday] Error logging in with license:', error);
			return { success: false, error: error.message };
		}
	}

	/**
	 * Activate license using license key
	 * Saves the license key to global config for publishing
	 */
	async activateLicense(licenseKey: string): Promise<{ success: boolean; error?: string; data?: any }> {
		try {
			const result = await this.licenseService.activateLicense(this.workspacePath, licenseKey);
			
			if (result.success && result.data) {
				console.log('[Friday] License activated successfully');
				
				// Save license key to global config for MDFriday publishing
				await this.saveLicenseKeyToConfig(licenseKey);
				console.log('[Friday] License key saved to global config');
				
				// Note: Auth and license data are now managed by Foundry Services
				// No need to manually sync - use licenseState.initialize() to refresh
				
				return { success: true, data: result.data };
			}
			
			return { success: false, error: result.error || 'Failed to activate license' };
		} catch (error) {
			console.error('[Friday] Error activating license:', error);
			return { success: false, error: error.message };
		}
	}

	/**
	 * Get license information from Foundry License Service
	 */
	async getLicenseInfo(): Promise<{ success: boolean; error?: string; data?: any }> {
		try {
			const result = await this.licenseService.getLicenseInfo(this.workspacePath);
			return result;
		} catch (error) {
			console.error('[Friday] Error getting license info:', error);
			return { success: false, error: error.message };
		}
	}

	/**
	 * Get license usage information
	 */
	async getLicenseUsage(): Promise<{ success: boolean; error?: string; data?: any }> {
		try {
			const result = await this.licenseService.getLicenseUsage(this.workspacePath);
			return result;
		} catch (error) {
			console.error('[Friday] Error getting license usage:', error);
			return { success: false, error: error.message };
		}
	}

	/**
	 * Reset license usage (requires confirmation)
	 */
	async resetUsage(force: boolean = false): Promise<{ success: boolean; error?: string }> {
		if (!force) {
			return { success: false, error: 'Force parameter required for safety' };
		}

		try {
			const result = await this.licenseService.resetUsage(this.workspacePath, force);
			return result;
		} catch (error) {
			console.error('[Friday] Error resetting license usage:', error);
			return { success: false, error: error.message };
		}
	}

	/**
	 * Check if user has an active license
	 */
	async hasActiveLicense(): Promise<boolean> {
		try {
			return await this.licenseService.hasActiveLicense(this.workspacePath);
		} catch (error) {
			console.error('[Friday] Error checking active license:', error);
			return false;
		}
	}

	/**
	 * Save license key to global config for MDFriday publishing
	 * This is the ONLY data that should be saved to global config from license service
	 * 
	 * Purpose: Stores default license key for MDFriday publishing method
	 * Location: workspace/.mdfriday/config.json under publish.mdfriday
	 * 
	 * Note: All other license/auth data is managed by Foundry Services in user-data.json
	 */
	private async saveLicenseKeyToConfig(licenseKey: string): Promise<void> {
		await this.globalConfigService.set(
			this.workspacePath,
			'publish.mdfriday.licenseKey',
			licenseKey
		);
		await this.globalConfigService.set(
			this.workspacePath,
			'publish.mdfriday.type',
			'share'
		);
		await this.globalConfigService.set(
			this.workspacePath,
			'publish.mdfriday.enabled',
			true
		);
	}
}
