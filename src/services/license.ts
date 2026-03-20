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
				
				// Get full license info and save to auth user info
				await this.syncLicenseInfoToAuth();
				
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
	 * Saves the license key to global config
	 */
	async activateLicense(licenseKey: string): Promise<{ success: boolean; error?: string; data?: any }> {
		try {
			const result = await this.licenseService.activateLicense(this.workspacePath, licenseKey);
			
			if (result.success && result.data) {
				console.log('[Friday] License activated successfully');
				
				// Save license key to global config
				await this.saveLicenseKeyToConfig(licenseKey);
				console.log('[Friday] License key saved to global config');
				
				// Sync license info to auth
				await this.syncLicenseInfoToAuth();
				
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
	 * Save license key to global config for publishing
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

	/**
	 * Sync license info to auth user data
	 * This stores license information in the auth workspace structure
	 */
	private async syncLicenseInfoToAuth(): Promise<void> {
		try {
			// Get license info
			const licenseResult = await this.licenseService.getLicenseInfo(this.workspacePath);
			if (!licenseResult.success || !licenseResult.data) {
				console.warn('[Friday] No license info to sync');
				return;
			}

			// Get auth status (includes token and email)
			const authResult = await this.authService.getStatus(this.workspacePath);
			if (!authResult.success || !authResult.data) {
				console.warn('[Friday] No auth status to sync');
				return;
			}

			// Get server config
			const configResult = await this.authService.getConfig(this.workspacePath);
			
			const licenseData = licenseResult.data;
			
			// Parse expires field to timestamp
			// Foundry returns 'expires' as formatted string, we need timestamp for storage
			let expiresAtTimestamp = 0;
			if (licenseData.expires) {
				const parsed = Date.parse(licenseData.expires);
				if (!isNaN(parsed)) {
					expiresAtTimestamp = parsed;
				}
			}
			
			// Build the combined auth user info structure
			const authUserInfo = {
				serverConfig: configResult.success && configResult.data ? {
					apiUrl: configResult.data.apiUrl,
					websiteUrl: configResult.data.websiteUrl || ''
				} : {},
				token: authResult.data.token ? {
					token: authResult.data.token
				} : {},
				license: {
					key: licenseData.key, // This is masked key from Foundry
					plan: licenseData.plan,
					expiresAt: expiresAtTimestamp, // Convert expires string to timestamp
					features: licenseData.features || {},
					activatedAt: Date.now() // Use current time as fallback
				},
				email: authResult.data.email || ''
			};

			// Save to global config under a special key
			await this.globalConfigService.set(
				this.workspacePath,
				'auth.userInfo',
				authUserInfo
			);
			
			console.log('[Friday] License info synced to auth user data');
		} catch (error) {
			console.error('[Friday] Error syncing license info to auth:', error);
		}
	}
}
