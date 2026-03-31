import {App, PluginSettingTab, Setting, Notice, Platform} from 'obsidian';
import type FridayPlugin from './main';
import {validateSubdomainFormat, isReservedSubdomain} from "./domain";
import {generateEncryptionPassphrase, maskLicenseKey, formatPlanName} from "./license";
import {clearSyncHandlerCache} from "./sync";

export class FridaySettingTab extends PluginSettingTab {
	plugin: FridayPlugin;
	private isActivating: boolean = false;
	private activationError: string = '';
	private firstTimeSync: boolean = false;
	private isRefreshingLicenseInfo: boolean = false;
	private lastLicenseInfoRefresh: number = 0;

	constructor(app: App, plugin: FridayPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	/**
	 * Format storage size for display
	 * @param sizeMB Size in MB
	 * @returns Formatted string (e.g. "6.16 MB", "1.5 GB")
	 */
	private formatStorageSize(sizeMB: number): string {
		if (sizeMB >= 1024) {
			return `${(sizeMB / 1024).toFixed(2)} GB`;
		}
		return `${sizeMB.toFixed(2)} MB`;
	}

	display(): void {
		const {containerEl} = this;

		containerEl.empty();

		const {license, licenseSync} = this.plugin.settings;
		
		// =========================================
		// License Section (Always at top - both platforms)
		// =========================================
		this.renderLicenseSection(containerEl);

		// If license is activated, show Sync and Security sections (both platforms)
		if (license && licenseSync?.enabled) {
			this.renderSyncSection(containerEl);
			this.renderSecuritySection(containerEl);
		}

		// =========================================
		// Desktop-only settings
		// =========================================
		if (Platform.isDesktop) {
			this.renderPublishSettings(containerEl);
			this.renderGeneralSettings(containerEl);
		}

		// =========================================
		// Enterprise Settings (both platforms)
		// =========================================
		this.renderEnterpriseSettings(containerEl);
	}

	/**
	 * Render Publish Settings Section (Desktop only)
	 */
	private renderPublishSettings(containerEl: HTMLElement): void {
		const {publishMethod, netlifyAccessToken, netlifyProjectId, ftpServer, ftpUsername, ftpPassword, ftpRemoteDir, ftpIgnoreCert} = this.plugin.settings;

		// Publish Settings Section
		containerEl.createEl("h2", {text: this.plugin.i18n.t('settings.publish_settings')});
		
	// Create containers for dynamic content
	let mdfridayFreeContainer: HTMLElement;
	let mdfridayShareContainer: HTMLElement;
	let mdfridaySettingsContainer: HTMLElement;
	let mdfridayCustomDomainContainer: HTMLElement;
	let mdfridayEnterpriseContainer: HTMLElement;
	let netlifySettingsContainer: HTMLElement;
	let ftpSettingsContainer: HTMLElement;
		
	// Publish Method Dropdown
	new Setting(containerEl)
		.setName(this.plugin.i18n.t('settings.publish_method'))
		.setDesc(this.plugin.i18n.t('settings.publish_method_desc'))
		.addDropdown((dropdown) => {
			dropdown
				.addOption('mdf-free', this.plugin.i18n.t('settings.publish_method_mdfriday_free'))
				.addOption('mdf-share', this.plugin.i18n.t('settings.publish_method_mdfriday_share'))
				.addOption('mdf-app', this.plugin.i18n.t('settings.publish_method_mdfriday'))
				.addOption('mdf-custom', this.plugin.i18n.t('settings.publish_method_mdfriday_custom'))
				.addOption('mdf-enterprise', this.plugin.i18n.t('settings.publish_method_mdfriday_enterprise'))
				.addOption('netlify', this.plugin.i18n.t('settings.publish_method_netlify'))
				.addOption('ftp', this.plugin.i18n.t('settings.publish_method_ftp'))
				.setValue(publishMethod || 'mdf-share')
				.onChange(async (value) => {
					this.plugin.settings.publishMethod = value as 'mdf-free' | 'mdf-share' | 'mdf-app' | 'mdf-custom' | 'mdf-enterprise' | 'netlify' | 'ftp';
					await this.plugin.saveSettings();
					showPublishSettings(value as 'mdf-free' | 'mdf-share' | 'mdf-app' | 'mdf-custom' | 'mdf-enterprise' | 'netlify' | 'ftp');
				});
		});

	// Create containers for different publish methods
	mdfridayFreeContainer = containerEl.createDiv('mdfriday-free-container');
	mdfridayShareContainer = containerEl.createDiv('mdfriday-share-container');
	mdfridaySettingsContainer = containerEl.createDiv('mdfriday-settings-container');
	mdfridayCustomDomainContainer = containerEl.createDiv('mdfriday-custom-domain-container');
	mdfridayEnterpriseContainer = containerEl.createDiv('mdfriday-enterprise-container');
	netlifySettingsContainer = containerEl.createDiv('netlify-settings-container');
	ftpSettingsContainer = containerEl.createDiv('ftp-settings-container');

	// Function to show/hide publish settings based on selected method
	// Note: 'mdf-share' and 'mdf-app' from Site.svelte map to 'mdfriday' settings container
	// 'mdf-custom' maps to 'mdfridayCustomDomainContainer'
	// 'mdf-enterprise' maps to 'mdfridayEnterpriseContainer'
	// 'mdf-free' maps to 'mdfridayFreeContainer'
	const showPublishSettings = (method: 'mdfriday' | 'netlify' | 'ftp' | 'mdf-free' | 'mdf-share' | 'mdf-app' | 'mdf-custom' | 'mdf-enterprise') => {
		const isMdfridayFree = method === 'mdf-free';
		const isMdfridayShare = method === 'mdf-share';
		const isMdfriday = method === 'mdfriday' || method === 'mdf-app';
		const isMdfridayCustom = method === 'mdf-custom';
		const isMdfridayEnterprise = method === 'mdf-enterprise';
		mdfridayFreeContainer.style.display = isMdfridayFree ? 'block' : 'none';
		mdfridayShareContainer.style.display = isMdfridayShare ? 'block' : 'none';
		mdfridaySettingsContainer.style.display = isMdfriday ? 'block' : 'none';
		mdfridayCustomDomainContainer.style.display = isMdfridayCustom ? 'block' : 'none';
		mdfridayEnterpriseContainer.style.display = isMdfridayEnterprise ? 'block' : 'none';
		netlifySettingsContainer.style.display = method === 'netlify' ? 'block' : 'none';
		ftpSettingsContainer.style.display = method === 'ftp' ? 'block' : 'none';
	};

	// =========================================
	// MDFriday Free Settings
	// =========================================
	mdfridayFreeContainer.createEl("h3", {text: this.plugin.i18n.t('settings.mdfriday_free')});
	
	// MDFriday Free is available to everyone (no license check needed)
	// Show description for MDFriday Free
	new Setting(mdfridayFreeContainer)
		.setName(this.plugin.i18n.t('settings.mdfriday_free'))
		.setDesc(this.plugin.i18n.t('settings.mdfriday_free_desc'));

	// =========================================
	// MDFriday Share Settings
	// =========================================
	mdfridayShareContainer.createEl("h3", {text: this.plugin.i18n.t('settings.mdfriday_share')});
	
	// Check if license is active and has publish permission (use licenseState)
	const hasSharePermission = this.plugin.licenseState?.isActivated() && 
		!this.plugin.licenseState.isExpired() && 
		this.plugin.licenseState.hasFeature('publishEnabled');
	
	if (hasSharePermission) {
		// Show description for MDFriday Share
		new Setting(mdfridayShareContainer)
			.setName(this.plugin.i18n.t('settings.mdfriday_share'))
			.setDesc(this.plugin.i18n.t('settings.mdfriday_share_desc'));
	} else {
		// Show message to activate license
		new Setting(mdfridayShareContainer)
			.setName(this.plugin.i18n.t('settings.mdfriday_share'))
			.setDesc(this.plugin.i18n.t('settings.upgrade_for_mdfshare'));
	}

	// =========================================
	// MDFriday Subdomain Settings
	// =========================================
	mdfridaySettingsContainer.createEl("h3", {text: this.plugin.i18n.t('settings.mdfriday_app')});
	
	// Check if license is active and has customSubDomain permission (use licenseState)
	const hasSubdomainPermission = this.plugin.licenseState?.isActivated() && 
		!this.plugin.licenseState.isExpired() && 
		this.plugin.licenseState.hasFeature('customSubDomain');
	
	if (hasSubdomainPermission) {
			// Get effective subdomain from licenseState
			const effectiveSubdomain = this.plugin.licenseState.getSubdomain() || '';
			
			// State variables
			let currentSubdomain = effectiveSubdomain;
			let inputSubdomain = effectiveSubdomain;
			let isChecking = false;
			let isUpdating = false;
			let availabilityStatus: 'available' | 'unavailable' | 'error' | null = null;
			let statusMessage = '';
			
			// UI elements
			let subdomainInput: HTMLInputElement;
			let checkButton: HTMLButtonElement;
			let updateButton: HTMLButtonElement;
			let statusEl: HTMLElement | null = null;

			// Helper to update status display
			const updateStatusDisplay = () => {
				// Remove existing status
				if (statusEl) {
					statusEl.remove();
					statusEl = null;
				}

				if (availabilityStatus && statusMessage) {
					statusEl = mdfridaySettingsContainer.createDiv({
						cls: `subdomain-status ${availabilityStatus}`,
						text: statusMessage
					});
				}
			};

			// Helper to update button states
			const updateButtonStates = () => {
				// Check button
				checkButton.disabled = isChecking || isUpdating || !inputSubdomain.trim() || 
					inputSubdomain === currentSubdomain;
				checkButton.textContent = isChecking 
					? this.plugin.i18n.t('settings.subdomain_checking')
					: this.plugin.i18n.t('settings.subdomain_check');

				// Update button - only enabled when subdomain is available
				updateButton.disabled = isUpdating || isChecking || 
					availabilityStatus !== 'available' || !inputSubdomain.trim();
				updateButton.textContent = isUpdating
					? this.plugin.i18n.t('settings.subdomain_updating')
					: this.plugin.i18n.t('settings.subdomain_update');
			};

			// Helper to validate subdomain using domain.ts validation rules
			const validateSubdomain = (subdomain: string): { valid: boolean; message?: string } => {
				// Check if same as current first
				if (subdomain === currentSubdomain) {
					return { valid: false, message: this.plugin.i18n.t('settings.subdomain_same') };
				}
				
				// Use domain.ts validation for format
				const formatResult = validateSubdomainFormat(subdomain);
				if (!formatResult.valid) {
					// Map error messages to i18n keys
					if (formatResult.error?.includes('at least 4')) {
						return { valid: false, message: this.plugin.i18n.t('settings.subdomain_too_short') };
					}
					if (formatResult.error?.includes('at most 32')) {
						return { valid: false, message: this.plugin.i18n.t('settings.subdomain_too_long') };
					}
					// Default to invalid format message (covers hyphen rules)
					return { valid: false, message: this.plugin.i18n.t('settings.subdomain_invalid_format') };
				}
				
				// Check reserved subdomains
				if (isReservedSubdomain(subdomain)) {
					return { valid: false, message: this.plugin.i18n.t('settings.subdomain_reserved') };
				}
				
				return { valid: true };
			};

			// Helper to extract root domain from hostname
			const extractRootDomain = (hostname: string): string => {
				const parts = hostname.split('.');
				// For standard domains, take last 2 parts (e.g., sunwei.xyz)
				// For special TLDs like .co.uk, this simple approach might need adjustment
				if (parts.length >= 2) {
					return parts.slice(-2).join('.');
				}
				return hostname;
			};

			// Helper to get host for subdomain (from enterpriseServerUrl or default)
			const getSubdomainHost = (): string => {
				if (this.plugin.settings.enterpriseServerUrl) {
					try {
						const url = new URL(this.plugin.settings.enterpriseServerUrl);
						// Extract root domain from hostname
						// e.g., app.sunwei.xyz -> sunwei.xyz
						return extractRootDomain(url.hostname);
					} catch (error) {
						console.error('[Friday Settings] Invalid enterpriseServerUrl:', error);
					}
				}
				return 'mdfriday.com';
			};

			// Create subdomain setting - description shows full domain
			const subdomainSetting = new Setting(mdfridaySettingsContainer)
				.setName(this.plugin.i18n.t('settings.subdomain_desc'))
				.setDesc(currentSubdomain ? `${currentSubdomain}.${getSubdomainHost()}` : '');

			// Subdomain input
			subdomainSetting.addText((text) => {
				subdomainInput = text.inputEl;
				text.setPlaceholder(this.plugin.i18n.t('settings.subdomain_placeholder'));
				text.setValue(currentSubdomain);
				text.onChange((value) => {
					inputSubdomain = value.toLowerCase().trim();
					text.setValue(inputSubdomain);
					
					// Reset availability when input changes
					availabilityStatus = null;
					statusMessage = '';
					updateStatusDisplay();
					updateButtonStates();
					
					// Update full domain preview in description
					subdomainSetting.setDesc(inputSubdomain ? `${inputSubdomain}.${getSubdomainHost()}` : '');
				});
			});

			// Check button
			subdomainSetting.addButton((button) => {
				checkButton = button.buttonEl;
				button
					.setButtonText(this.plugin.i18n.t('settings.subdomain_check'))
					.onClick(async () => {
						// Validate input first
						const validation = validateSubdomain(inputSubdomain);
						if (!validation.valid) {
							availabilityStatus = 'error';
							statusMessage = validation.message!;
							updateStatusDisplay();
							return;
						}

						isChecking = true;
						updateButtonStates();

					try {
						const result = await this.plugin.domainServiceManager?.checkSubdomain(inputSubdomain);

						if (result && result.success && result.data) {
							availabilityStatus = result.data.available ? 'available' : 'unavailable';
							statusMessage = result.data.available 
								? this.plugin.i18n.t('settings.subdomain_available')
								: this.plugin.i18n.t('settings.subdomain_unavailable');
						} else {
							availabilityStatus = 'error';
							statusMessage = result?.error || this.plugin.i18n.t('settings.subdomain_check_failed');
						}
					} catch (error) {
						availabilityStatus = 'error';
						statusMessage = this.plugin.i18n.t('settings.subdomain_check_failed');
					} finally {
						isChecking = false;
						updateStatusDisplay();
						updateButtonStates();
					}
					});
			});

			// Update button
			subdomainSetting.addButton((button) => {
				updateButton = button.buttonEl;
				button
					.setButtonText(this.plugin.i18n.t('settings.subdomain_update'))
					.setCta()
					.onClick(async () => {
						if (availabilityStatus !== 'available') return;

						isUpdating = true;
						updateButtonStates();

					try {
						const result = await this.plugin.domainServiceManager?.updateSubdomain(inputSubdomain);

						if (result && result.success && result.data) {
							currentSubdomain = result.data.newSubdomain;
							inputSubdomain = currentSubdomain;
							subdomainInput.value = currentSubdomain;
							subdomainSetting.setDesc(`${currentSubdomain}.${getSubdomainHost()}`);
							
							// Save custom subdomain to settings
							this.plugin.settings.customSubdomain = result.data.newSubdomain;
							await this.plugin.saveSettings();
							
							availabilityStatus = null;
							statusMessage = '';
							
							new Notice(this.plugin.i18n.t('settings.subdomain_updated'));
						} else {
							availabilityStatus = 'error';
							statusMessage = result?.error || this.plugin.i18n.t('settings.subdomain_update_failed', { error: 'Unknown error' });
						}
					} catch (error) {
						availabilityStatus = 'error';
						statusMessage = this.plugin.i18n.t('settings.subdomain_update_failed', { 
							error: error instanceof Error ? error.message : String(error) 
						});
					} finally {
						isUpdating = false;
						updateStatusDisplay();
						updateButtonStates();
					}
				});
		});

			// Initial button states
			updateButtonStates();
		} else {
			// Show message to activate license
			new Setting(mdfridaySettingsContainer)
				.setName(this.plugin.i18n.t('settings.subdomain_desc'))
				.setDesc(this.plugin.i18n.t('settings.license_required'));
		}

		// =========================================
		// MDFriday Custom Domain Settings (Independent Container)
		// =========================================
		mdfridayCustomDomainContainer.createEl("h3", {text: this.plugin.i18n.t('settings.mdfriday_custom_domain')});

		// Check if license is active and has customDomain permission (use licenseState)
		const hasCustomDomainPermission = this.plugin.licenseState?.isActivated() && 
			!this.plugin.licenseState.isExpired() && 
			this.plugin.licenseState.hasFeature('customDomain');

		if (hasCustomDomainPermission) {
			// Get custom domain from licenseState or settings
			let currentDomain = this.plugin.licenseState.getCustomDomain() || this.plugin.settings.customDomain || '';
			let inputDomain = currentDomain;
			let isChecking = false;
			let isSaving = false;
			let isCheckingHttps = false;
			let checkStatus: 'success' | 'error' | null = null;
			let httpsStatus: 'active' | 'pending' | 'error' | null = null;
			let statusMessage = '';
			
			// UI elements
			let domainInput: HTMLInputElement;
			let checkButton: HTMLButtonElement;
			let saveButton: HTMLButtonElement;
			let httpsButton: HTMLButtonElement;
			let statusEl: HTMLElement | null = null;
			
			// Helper to update status display
			const updateStatusDisplay = () => {
				// Remove existing status
				if (statusEl) {
					statusEl.remove();
					statusEl = null;
				}

				if (statusMessage) {
					const statusClass = checkStatus === 'success' ? 'subdomain-status available' : 
									   checkStatus === 'error' ? 'subdomain-status error' :
									   httpsStatus === 'active' ? 'subdomain-status available' :
									   httpsStatus === 'pending' ? 'subdomain-status unavailable' :
									   httpsStatus === 'error' ? 'subdomain-status error' : 'subdomain-status';
					
					statusEl = mdfridayCustomDomainContainer.createDiv({
						cls: statusClass,
						text: statusMessage
					});
				}
			};

			// Helper to update button states
			const updateButtonStates = () => {
				// Check button
				checkButton.disabled = isChecking || isSaving || !inputDomain.trim();
				checkButton.textContent = isChecking 
					? this.plugin.i18n.t('settings.domain_checking')
					: this.plugin.i18n.t('settings.domain_check');

				// Save button - only enabled when check is successful
				saveButton.disabled = isSaving || isChecking || checkStatus !== 'success';
				saveButton.textContent = isSaving 
					? this.plugin.i18n.t('settings.domain_saving')
					: this.plugin.i18n.t('settings.domain_save');

				// HTTPS button
				httpsButton.disabled = isCheckingHttps || !currentDomain.trim();
				httpsButton.textContent = isCheckingHttps 
					? this.plugin.i18n.t('settings.domain_https_checking')
					: this.plugin.i18n.t('settings.domain_https_check');
			};

			const domainSetting = new Setting(mdfridayCustomDomainContainer)
				.setName(this.plugin.i18n.t('settings.custom_domain_desc'))
				.setDesc(currentDomain ? currentDomain : this.plugin.i18n.t('settings.custom_domain_placeholder'));

			// Domain input
			domainSetting.addText((text) => {
				domainInput = text.inputEl;
				text
					.setPlaceholder('example.com')
					.setValue(currentDomain)
					.onChange((value) => {
						inputDomain = value.trim();
						// Reset check status when input changes
						if (inputDomain !== currentDomain) {
							checkStatus = null;
							statusMessage = '';
							updateStatusDisplay();
							updateButtonStates();
						}
					});
				text.inputEl.style.width = '200px';
			});

			// Check button
			domainSetting.addButton((button) => {
				checkButton = button.buttonEl;
				button
					.setButtonText(this.plugin.i18n.t('settings.domain_check'))
					.onClick(async () => {
						if (!inputDomain.trim()) return;

						isChecking = true;
						checkStatus = null;
						statusMessage = '';
						updateStatusDisplay();
						updateButtonStates();

						try {
							const result = await this.plugin.domainServiceManager?.checkCustomDomain(inputDomain);

							if (result && result.success && result.data) {
								// Use correct field names: dnsValid and ready (camelCase, not snake_case)
								if (result.data.dnsValid && result.data.ready) {
									checkStatus = 'success';
									statusMessage = result.data.message || this.plugin.i18n.t('settings.domain_check_success');
								} else {
									checkStatus = 'error';
									statusMessage = result.data.message || this.plugin.i18n.t('settings.domain_check_failed');
								}
							} else {
								checkStatus = 'error';
								statusMessage = result?.error || this.plugin.i18n.t('settings.domain_check_failed');
							}
						} catch (error) {
							checkStatus = 'error';
							statusMessage = this.plugin.i18n.t('settings.domain_check_failed');
						} finally {
							isChecking = false;
							updateStatusDisplay();
							updateButtonStates();
						}
					});
			});

			// Save button
			domainSetting.addButton((button) => {
				saveButton = button.buttonEl;
				button
					.setButtonText(this.plugin.i18n.t('settings.domain_save'))
					.setCta()
					.onClick(async () => {
						if (checkStatus !== 'success') return;

						isSaving = true;
						updateButtonStates();

						try {
							const result = await this.plugin.domainServiceManager?.addCustomDomain(inputDomain);

							if (result && result.success && result.data && result.data.domain) {
								currentDomain = result.data.domain;
								domainSetting.setDesc(currentDomain);
								
								// Save custom domain to settings
								this.plugin.settings.customDomain = result.data.domain;
								await this.plugin.saveSettings();
								
								checkStatus = null;
								httpsStatus = result.data.status === 'active' ? 'active' : 'pending';
								statusMessage = result.data.message || this.plugin.i18n.t('settings.domain_saved');
								
								new Notice(this.plugin.i18n.t('settings.domain_saved'));
							} else {
								statusMessage = result?.error || this.plugin.i18n.t('settings.domain_save_failed');
							}
						} catch (error) {
							statusMessage = this.plugin.i18n.t('settings.domain_save_failed');
						} finally {
							isSaving = false;
							updateStatusDisplay();
							updateButtonStates();
						}
					});
			});

			// HTTPS status button
			domainSetting.addButton((button) => {
				httpsButton = button.buttonEl;
				button
					.setButtonText(this.plugin.i18n.t('settings.domain_https_check'))
					.onClick(async () => {
						if (!currentDomain.trim()) return;

						isCheckingHttps = true;
						httpsStatus = null;
						statusMessage = '';
						updateStatusDisplay();
						updateButtonStates();

						try {
							const result = await this.plugin.domainServiceManager?.checkHttpsStatus(currentDomain);

							if (result && result.success && result.data) {
								// Use correct field name: tlsReady (camelCase)
								if (result.data.status === 'active' && result.data.tlsReady) {
									httpsStatus = 'active';
									statusMessage = result.data.message || this.plugin.i18n.t('settings.domain_https_ready');
								} else if (result.data.status === 'cert_pending') {
									httpsStatus = 'pending';
									statusMessage = result.data.message || this.plugin.i18n.t('settings.domain_https_pending');
								} else {
									httpsStatus = 'error';
									statusMessage = result.data.message || this.plugin.i18n.t('settings.domain_https_error');
								}
							} else {
								httpsStatus = 'error';
								statusMessage = result?.error || this.plugin.i18n.t('settings.domain_https_check_failed');
							}
						} catch (error) {
							httpsStatus = 'error';
							statusMessage = this.plugin.i18n.t('settings.domain_https_check_failed');
						} finally {
							isCheckingHttps = false;
							updateStatusDisplay();
							updateButtonStates();
						}
					});
			});

			// Initial button states
			updateButtonStates();
		} else {
			// Show upgrade message - user needs to upgrade their plan
			new Setting(mdfridayCustomDomainContainer)
				.setName(this.plugin.i18n.t('settings.custom_domain_desc'))
				.setDesc(this.plugin.i18n.t('settings.upgrade_for_custom_domain'));
		}

		// Netlify Settings
		netlifySettingsContainer.createEl("h3", {text: this.plugin.i18n.t('settings.netlify_settings')});
		
		// Netlify Access Token
		new Setting(netlifySettingsContainer)
			.setName(this.plugin.i18n.t('settings.netlify_access_token'))
			.setDesc(this.plugin.i18n.t('settings.netlify_access_token_desc'))
			.addText((text) => {
				text
					.setPlaceholder(this.plugin.i18n.t('settings.netlify_access_token_placeholder'))
					.setValue(netlifyAccessToken || "")
					.onChange(async (value) => {
						this.plugin.settings.netlifyAccessToken = value;
						await this.plugin.saveSettings();
					});
				text.inputEl.type = "password";
			});

		// Netlify Project ID
		new Setting(netlifySettingsContainer)
			.setName(this.plugin.i18n.t('settings.netlify_project_id'))
			.setDesc(this.plugin.i18n.t('settings.netlify_project_id_desc'))
			.addText((text) =>
				text
					.setPlaceholder(this.plugin.i18n.t('settings.netlify_project_id_placeholder'))
					.setValue(netlifyProjectId || "")
					.onChange(async (value) => {
						this.plugin.settings.netlifyProjectId = value;
						await this.plugin.saveSettings();
					})
			);

		// FTP Settings
		ftpSettingsContainer.createEl("h3", {text: this.plugin.i18n.t('settings.ftp_settings')});

		// FTP Server
		new Setting(ftpSettingsContainer)
			.setName(this.plugin.i18n.t('settings.ftp_server'))
			.setDesc(this.plugin.i18n.t('settings.ftp_server_desc'))
			.addText((text) =>
				text
					.setPlaceholder(this.plugin.i18n.t('settings.ftp_server_placeholder'))
					.setValue(ftpServer || "")
					.onChange(async (value) => {
						this.plugin.settings.ftpServer = value;
						await this.plugin.saveSettings();
					})
			);

		// FTP Username
		new Setting(ftpSettingsContainer)
			.setName(this.plugin.i18n.t('settings.ftp_username'))
			.setDesc(this.plugin.i18n.t('settings.ftp_username_desc'))
			.addText((text) =>
				text
					.setPlaceholder(this.plugin.i18n.t('settings.ftp_username_placeholder'))
					.setValue(ftpUsername || "")
					.onChange(async (value) => {
						this.plugin.settings.ftpUsername = value;
						await this.plugin.saveSettings();
					})
			);

		// FTP Password
		new Setting(ftpSettingsContainer)
			.setName(this.plugin.i18n.t('settings.ftp_password'))
			.setDesc(this.plugin.i18n.t('settings.ftp_password_desc'))
			.addText((text) => {
				text
					.setPlaceholder(this.plugin.i18n.t('settings.ftp_password_placeholder'))
					.setValue(ftpPassword || "")
					.onChange(async (value) => {
						this.plugin.settings.ftpPassword = value;
						await this.plugin.saveSettings();
					});
				text.inputEl.type = "password";
			});

		// FTP Remote Directory
		new Setting(ftpSettingsContainer)
			.setName(this.plugin.i18n.t('settings.ftp_remote_dir'))
			.setDesc(this.plugin.i18n.t('settings.ftp_remote_dir_desc'))
			.addText((text) =>
				text
					.setPlaceholder(this.plugin.i18n.t('settings.ftp_remote_dir_placeholder'))
					.setValue(ftpRemoteDir || "")
					.onChange(async (value) => {
						this.plugin.settings.ftpRemoteDir = value;
						await this.plugin.saveSettings();
					})
			);

		// FTP Ignore Certificate Verification
		new Setting(ftpSettingsContainer)
			.setName(this.plugin.i18n.t('settings.ftp_ignore_cert'))
			.setDesc(this.plugin.i18n.t('settings.ftp_ignore_cert_desc'))
			.addToggle((toggle) =>
				toggle
					.setValue(ftpIgnoreCert)
					.onChange(async (value) => {
						this.plugin.settings.ftpIgnoreCert = value;
						await this.plugin.saveSettings();
					})
			);

	// =========================================
	// MDFriday Enterprise Settings
	// =========================================
	mdfridayEnterpriseContainer.createEl("h3", {text: this.plugin.i18n.t('settings.mdfriday_enterprise')});
	
	// Check if license is active and has enterprise permission (use licenseState)
	const hasEnterprisePermissionSetting = this.plugin.licenseState?.isActivated() && 
		!this.plugin.licenseState.isExpired() && 
		this.plugin.licenseState.getPlan() === 'enterprise' &&
		!!this.plugin.settings.enterpriseServerUrl;
	
	if (hasEnterprisePermissionSetting) {
		// Show description for MDFriday Enterprise
		new Setting(mdfridayEnterpriseContainer)
			.setName(this.plugin.i18n.t('settings.mdfriday_enterprise'))
			.setDesc(this.plugin.i18n.t('settings.mdfriday_enterprise_desc'));
	} else {
		// Show message to upgrade to enterprise
		new Setting(mdfridayEnterpriseContainer)
			.setName(this.plugin.i18n.t('settings.mdfriday_enterprise'))
			.setDesc(this.plugin.i18n.t('settings.upgrade_for_enterprise'));
	}

	// Initialize the display based on current publish method
	showPublishSettings(publishMethod || 'mdf-share');
	}

	/**
	 * Render General Settings Section (Desktop only)
	 */
	private renderGeneralSettings(containerEl: HTMLElement): void {
		const {downloadServer} = this.plugin.settings;

		// =========================================
		// General Settings Section (at the bottom)
		// =========================================
		containerEl.createEl("h2", {text: this.plugin.i18n.t('settings.general_settings')});
		
		// Download Server Setting
		new Setting(containerEl)
			.setName(this.plugin.i18n.t('settings.download_server'))
			.setDesc(this.plugin.i18n.t('settings.download_server_desc'))
			.addDropdown((dropdown) => {
				dropdown
					.addOption('global', this.plugin.i18n.t('settings.download_server_global'))
					.addOption('east', this.plugin.i18n.t('settings.download_server_east'))
					.setValue(downloadServer || 'global')
					.onChange(async (value) => {
						this.plugin.settings.downloadServer = value as 'global' | 'east';
						await this.plugin.saveSettings();
					});
			});

		// CouchDB Sync Settings - Hidden from UI but functionality preserved
		// Settings fields (syncEnabled, syncConfig) are still stored and used
		// Sync is now configured automatically through License activation

		// MDFriday Account Section - Hidden from UI
		// Users should only use License Key activation, not direct login
		// Login functionality is preserved but not exposed in settings
	}

	/**
	 * Render Enterprise Settings Section (All platforms)
	 * For enterprise users to configure custom server URL
	 */
	private renderEnterpriseSettings(containerEl: HTMLElement): void {
		const { enterpriseServerUrl } = this.plugin.settings;

		// =========================================
		// Enterprise Settings Section (at the bottom)
		// =========================================
		containerEl.createEl("h2", { text: this.plugin.i18n.t('settings.enterprise_settings') });
		
		// Enterprise Server URL Setting
		new Setting(containerEl)
			.setName(this.plugin.i18n.t('settings.enterprise_server_url'))
			.setDesc(this.plugin.i18n.t('settings.enterprise_server_url_desc'))
			.addText((text) => {
				text
					.setPlaceholder('https://your-enterprise-server.com')
					.setValue(enterpriseServerUrl || '')
					.onChange(async (value) => {
						const trimmedValue = value.trim();
						this.plugin.settings.enterpriseServerUrl = trimmedValue;
						await this.plugin.saveSettings();
						
						// Also update to Foundry AuthService config
						if (this.plugin.foundryAuthService && this.plugin.absWorkspacePath) {
							try {
								const configResult = await this.plugin.foundryAuthService.updateConfig(
									this.plugin.absWorkspacePath,
									{
										apiUrl: trimmedValue || undefined
									}
								);
								
								if (configResult.success) {
									console.log('[Friday] Enterprise server URL updated to Foundry:', trimmedValue);
								} else {
									console.error('[Friday] Failed to update enterprise server URL to Foundry:', configResult.error);
								}
							} catch (error) {
								console.error('[Friday] Error updating enterprise server URL to Foundry:', error);
							}
						}
					});
				text.inputEl.style.width = '100%';
			});
	}

	/**
	 * Render License Section
	 * Shows license key input when not activated, or license status when activated
	 * 
	 * Uses licenseState as the single source of truth
	 */
	private renderLicenseSection(containerEl: HTMLElement): void {
		containerEl.createEl("h2", {text: this.plugin.i18n.t('settings.license')});

		// Use licenseState for all license-related checks
		if (this.plugin.licenseState?.isActivated() && !this.plugin.licenseState.isExpired()) {
			// ========== License Active State ==========
			
			const licenseInfo = this.plugin.licenseState.getLicenseInfo();
			if (!licenseInfo) {
				console.warn('[Settings] License is activated but no license info available');
				return;
			}
			
			// Row 1: License Key (masked) + Valid Until + Plan Badge (clickable)
			const licenseKeySetting = new Setting(containerEl)
				.setName(maskLicenseKey(this.plugin.licenseState.getLicenseKey() || ''))
				.setDesc(this.plugin.i18n.t('settings.valid_until') + ': ' + licenseInfo.expires);
			
			// Add clickable plan badge to the right
			const planBadge = licenseKeySetting.controlEl.createSpan({
				cls: `friday-plan-badge ${licenseInfo.plan.toLowerCase()} clickable`,
				text: formatPlanName(licenseInfo.plan)
			});
			
			// Make plan badge clickable to refresh license info
			planBadge.style.cursor = 'pointer';
			planBadge.title = this.plugin.i18n.t('settings.click_to_refresh_license_info') || 'Click to refresh license info';
			
			planBadge.addEventListener('click', async () => {
				// Check 5 second cooldown
				const now = Date.now();
				if (this.isRefreshingLicenseInfo || (now - this.lastLicenseInfoRefresh < 5000)) {
					return;
				}
				
				// Set refreshing state
				this.isRefreshingLicenseInfo = true;
				this.lastLicenseInfoRefresh = now;
				
				// Update UI to show loading state
				const originalText = planBadge.textContent || '';
				planBadge.textContent = this.plugin.i18n.t('settings.refreshing') || 'Refreshing...';
				planBadge.addClass('refreshing');
				
				try {
					// Refresh from Foundry
					await this.plugin.licenseState?.refresh();
					
					// Sync to settings (for UI display)
					await this.plugin.syncLicenseToSettings();
					
					// Refresh usage data (if still using old method)
					await this.plugin.refreshLicenseUsage();

					// Refresh subdomain info if applicable
					await this.plugin.refreshSubdomainInfo();
					
					// Show success notification
					new Notice(this.plugin.i18n.t('settings.license_info_refreshed') || 'License info updated');
					
					// Refresh display to show updated data
					this.display();
				} catch (error) {
					// Show error notification
					new Notice(this.plugin.i18n.t('settings.refresh_failed') || 'Failed to refresh license info');
					console.error('Failed to refresh license info:', error);
					
					// Restore original state
					planBadge.textContent = originalText;
					planBadge.removeClass('refreshing');
				} finally {
					this.isRefreshingLicenseInfo = false;
				}
			});

			// Add "Pricing Details" button next to the Plan Badge (only for Free plan)
			if (licenseInfo.plan.toLowerCase() === 'free') {
				const pricingBtn = licenseKeySetting.controlEl.createEl('button', {
					cls: 'friday-premium-btn',
					text: this.plugin.i18n.t('settings.pricing_details') || '套餐详情'
				});
				
				pricingBtn.addEventListener('click', () => {
					window.open('https://mdfriday.com/pricing.html', '_blank');
				});
			}

			// Row 2: Storage Usage
			const usage = this.plugin.settings.licenseUsage;
			const usedStorage = usage?.totalDiskUsage || 0;
			const maxStorage = this.plugin.licenseState.getMaxStorage();
			const usagePercentage = maxStorage > 0 ? (usedStorage / maxStorage) * 100 : 0;
			
			const storageSetting = new Setting(containerEl)
				.setName(this.plugin.i18n.t('settings.storage_usage'))
				.setDesc(this.plugin.i18n.t('settings.storage_usage_desc'));
			
			// Create progress bar container
			const progressContainer = storageSetting.controlEl.createDiv({ cls: 'friday-storage-progress-container' });
			
			// Usage text
			const usageText = progressContainer.createDiv({ cls: 'friday-storage-usage-text' });
			usageText.setText(this.formatStorageSize(usedStorage) + ' / ' + this.formatStorageSize(maxStorage));
			
			// Progress bar
			const progressBarOuter = progressContainer.createDiv({ cls: 'friday-storage-progress-bar' });
			const progressBarInner = progressBarOuter.createDiv({ cls: 'friday-storage-progress-fill' });
			progressBarInner.style.width = `${Math.min(usagePercentage, 100).toFixed(1)}%`;

		} else {
			// ========== License Input State ==========
			let inputEl: HTMLInputElement;
			let activateBtn: HTMLButtonElement;
			let statusEl: HTMLElement;

			const licenseSetting = new Setting(containerEl)
				.setName(this.plugin.i18n.t('settings.license_key'))
				.setDesc(this.plugin.i18n.t('settings.license_key_placeholder'))
				.addText((text) => {
					inputEl = text.inputEl;
					text
						.setPlaceholder(this.plugin.i18n.t('settings.license_key_placeholder'))
						.onChange((value) => {
							// Auto uppercase
							text.setValue(value.toUpperCase());
						});
				})
				.addButton((button) => {
					activateBtn = button.buttonEl;
					button
						.setButtonText(this.plugin.i18n.t('settings.activate'))
						.setCta()
						.onClick(async () => {
							const licenseKey = inputEl.value.trim().toUpperCase();

							// Clear previous status
							if (statusEl) {
								statusEl.setText('');
								statusEl.removeClass('friday-license-error', 'friday-license-success');
							}

							// Validate format
							if (!this.plugin.isValidLicenseKeyFormat(licenseKey)) {
								statusEl.setText(this.plugin.i18n.t('settings.license_invalid_format'));
								statusEl.addClass('friday-license-error');
								return;
							}

							// Start activation
							activateBtn.setText(this.plugin.i18n.t('settings.activating'));
							activateBtn.disabled = true;
							inputEl.disabled = true;

							try {
								await this.activateLicense(licenseKey);
								
								// Success - refresh the entire settings display
								new Notice(this.plugin.i18n.t('settings.license_activated_success'));
								this.display();
							} catch (error) {
								// Show error
								statusEl.setText(this.plugin.i18n.t('settings.license_activation_failed'));
								statusEl.addClass('friday-license-error');
								console.error('License activation error:', error);
							} finally {
								activateBtn.setText(this.plugin.i18n.t('settings.activate'));
								activateBtn.disabled = false;
								inputEl.disabled = false;
							}
						});
				});

			// Add "Pricing Details" button next to the Activate button
			const pricingBtn = licenseSetting.controlEl.createEl('button', {
				cls: 'friday-premium-btn',
				text: this.plugin.i18n.t('settings.pricing_details') || '套餐详情'
			});
			
			pricingBtn.addEventListener('click', () => {
				window.open('https://mdfriday.com/pricing.html', '_blank');
			});

			// Add status element
			statusEl = licenseSetting.descEl.createSpan({cls: 'friday-license-status-text'});
			
			// ========== Trial License Request State ==========
			let trialEmailEl: HTMLInputElement;
			let trialRequestBtn: HTMLButtonElement;
			let trialStatusEl: HTMLElement;
			
			const trialSetting = new Setting(containerEl)
				.setName(this.plugin.i18n.t('settings.trial_license'))
				.setDesc(this.plugin.i18n.t('settings.trial_email'))
				.addText((text) => {
					trialEmailEl = text.inputEl;
					text
						.setPlaceholder(this.plugin.i18n.t('settings.trial_email_placeholder'))
						.setValue('');
				})
				.addButton((button) => {
					trialRequestBtn = button.buttonEl;
					button
						.setButtonText(this.plugin.i18n.t('settings.trial_request'))
						.onClick(async () => {
							const email = trialEmailEl.value.trim();
							
							// Clear previous status
							if (trialStatusEl) {
								trialStatusEl.setText('');
								trialStatusEl.removeClass('friday-license-error', 'friday-license-success');
							}
							
							// Validate email format
							const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
							if (!email || !emailRegex.test(email)) {
								trialStatusEl.setText(this.plugin.i18n.t('settings.trial_invalid_email'));
								trialStatusEl.addClass('friday-license-error');
								return;
							}
							
							// Start trial request
							trialRequestBtn.setText(this.plugin.i18n.t('settings.trial_requesting'));
							trialRequestBtn.disabled = true;
							trialEmailEl.disabled = true;
							
						try {
							// Use Foundry License Service
							if (!this.plugin.licenseServiceManager) {
								throw new Error('License service not available');
							}
							
							// Step 1: Request trial license
							const result = await this.plugin.licenseServiceManager.requestTrial(email);
							
							if (result.success && result.data?.licenseKey) {
								const licenseKey = result.data.licenseKey;
								
								// Fill the license key in the input (for user reference)
								inputEl.value = licenseKey;
								
								// Show trial request success
								trialStatusEl.setText(this.plugin.i18n.t('settings.trial_request_success'));
								trialStatusEl.addClass('friday-license-success');
								
								// Step 2: Automatically activate the trial license
								try {
									await this.activateLicense(licenseKey);
									
									// Show activation success
									new Notice(this.plugin.i18n.t('settings.license_activated_success'));
									
									// Clear the email field
									trialEmailEl.value = '';
									
									// Refresh display to show activated license
									this.display();
								} catch (activationError) {
									// If activation fails, still show trial request success
									// User can manually click the activate button
									console.error('Auto-activation failed:', activationError);
									new Notice(this.plugin.i18n.t('settings.trial_request_success'));
									
									// Refresh display to show the activate button
									this.display();
								}
							} else {
								throw new Error(result.error || 'Invalid trial response');
							}
						} catch (error) {
							// Show error
							trialStatusEl.setText(this.plugin.i18n.t('settings.trial_request_failed'));
							trialStatusEl.addClass('friday-license-error');
							console.error('Trial license request error:', error);
						} finally {
							trialRequestBtn.setText(this.plugin.i18n.t('settings.trial_request'));
							trialRequestBtn.disabled = false;
							trialEmailEl.disabled = false;
						}
						});
				});
			
			// Add trial status element
			trialStatusEl = trialSetting.descEl.createSpan({cls: 'friday-license-status-text'});
		}
	}

	/**
	 * Render Sync Section (only shown when license is activated)
	 * Includes Security subsection and Selective Sync subsection
	 */
	private renderSyncSection(containerEl: HTMLElement): void {
		const license = this.plugin.settings.license;
		const licenseSync = this.plugin.settings.licenseSync;

		if (!license || !licenseSync?.enabled) return;

		containerEl.createEl("h2", {text: this.plugin.i18n.t('settings.sync')});

		// ========== Security Subsection ==========
		const securityContainer = containerEl.createDiv('friday-security-container');
		securityContainer.createEl("h3", {text: this.plugin.i18n.t('settings.security')});

		// Encryption Password (editable for non-first-time, readonly for first-time with show/hide)
		let passwordVisible = false;
		const encryptionPassphrase = this.plugin.settings.encryptionPassphrase;
		
		if (this.firstTimeSync && encryptionPassphrase) {
			// First time: show readonly password with show/hide toggle
			new Setting(securityContainer)
				.setName(this.plugin.i18n.t('settings.encryption_password'))
				.setDesc(this.plugin.i18n.t('settings.encryption_enabled'))
				.addText((text) => {
					text.inputEl.type = 'password';
					text.inputEl.readOnly = true;
					text.setValue(encryptionPassphrase);
				})
				.addButton((button) => {
					button
						.setButtonText(this.plugin.i18n.t('settings.show_password'))
						.onClick(() => {
							passwordVisible = !passwordVisible;
							const inputEl = button.buttonEl.parentElement?.querySelector('input');
							if (inputEl) {
								inputEl.type = passwordVisible ? 'text' : 'password';
							}
							button.setButtonText(passwordVisible 
								? this.plugin.i18n.t('settings.hide_password') 
								: this.plugin.i18n.t('settings.show_password')
							);
						});
				});
		} else {
			// Non-first-time: editable password field
			new Setting(securityContainer)
				.setName(this.plugin.i18n.t('settings.encryption_password'))
				.setDesc(this.plugin.i18n.t('settings.encryption_password_desc'))
				.addText((text) => {
					text.inputEl.type = 'password';
					text.inputEl.placeholder = this.plugin.i18n.t('settings.encryption_password_placeholder');
					text.setValue(encryptionPassphrase || '');
					text.onChange(async (value) => {
						this.plugin.settings.encryptionPassphrase = value;
						this.plugin.settings.syncConfig.passphrase = value;
						await this.plugin.saveSettings();
					});
				})
				.addButton((button) => {
					button
						.setButtonText(this.plugin.i18n.t('settings.show_password'))
						.onClick(() => {
							passwordVisible = !passwordVisible;
							const inputEl = button.buttonEl.parentElement?.querySelector('input');
							if (inputEl) {
								inputEl.type = passwordVisible ? 'text' : 'password';
							}
							button.setButtonText(passwordVisible 
								? this.plugin.i18n.t('settings.hide_password') 
								: this.plugin.i18n.t('settings.show_password')
							);
						});
				});
		}

		// First time sync - Upload option (in security container)
		if (this.firstTimeSync) {
			new Setting(securityContainer)
				.setName(this.plugin.i18n.t('settings.sync_first_time_title'))
				.setDesc(this.plugin.i18n.t('settings.sync_description'))
				.addButton((button) => {
					button
						.setButtonText(this.plugin.i18n.t('settings.upload_local_to_cloud'))
						.setCta()
						.onClick(async () => {
							button.setButtonText(this.plugin.i18n.t('settings.sync_uploading'));
							button.setDisabled(true);
							try {
								if (!this.plugin.syncService.isInitialized) {
									await this.plugin.syncService.initialize(this.plugin.settings.syncConfig);
								}
								await this.plugin.syncService.rebuildRemote();
								
								// Restart LiveSync after rebuildRemote (which terminates existing sync)
								// This ensures continuous sync is running for new file changes
								if (this.plugin.settings.syncConfig?.syncOnStart) {
									await this.plugin.syncService.startSync(true);
								}
								
								new Notice(this.plugin.i18n.t('settings.sync_upload_success'));
								this.firstTimeSync = false;
								this.display();
							} catch (error) {
								new Notice(this.plugin.i18n.t('settings.sync_operation_failed'));
								button.setButtonText(this.plugin.i18n.t('settings.upload_local_to_cloud'));
								button.setDisabled(false);
							}
						});
				});
		} else {
			// Non-first-time - Download option with IndexedDB cleanup (in security container)
			new Setting(securityContainer)
				.setName(this.plugin.i18n.t('settings.sync_data_available'))
				.setDesc(this.plugin.i18n.t('settings.sync_description'))
				.addButton((button) => {
					button
						.setButtonText(this.plugin.i18n.t('settings.download_from_cloud'))
						.setCta()
						.onClick(async () => {
							// Validate passphrase is entered
							if (!this.plugin.settings.encryptionPassphrase) {
								new Notice(this.plugin.i18n.t('settings.encryption_password_required'));
								return;
							}

							button.setButtonText(this.plugin.i18n.t('settings.sync_downloading'));
							button.setDisabled(true);
							try {
								// Close existing sync service if initialized
								if (this.plugin.syncService?.isInitialized) {
									await this.plugin.syncService.close();
								}

								// Clear IndexedDB to start fresh
								await this.plugin.clearSyncDatabase();

								// Re-initialize sync service with the passphrase
								await this.plugin.initializeSyncService();

								// Fetch from server
								if (this.plugin.syncService.isInitialized) {
									await this.plugin.syncService.fetchFromServer();
									new Notice(this.plugin.i18n.t('settings.sync_download_success'));
									this.display();
								} else {
									throw new Error('Sync service initialization failed');
								}
							} catch (error) {
								console.error('Download failed:', error);
								new Notice(`${this.plugin.i18n.t('settings.sync_operation_failed')}: ${error.message || error}`);
								button.setButtonText(this.plugin.i18n.t('settings.download_from_cloud'));
								button.setDisabled(false);
							}
						});
				});
		}

		// ========== Selective Sync Subsection ==========
		const selectiveSyncContainer = containerEl.createDiv('friday-security-container');
		selectiveSyncContainer.createEl("h3", {text: this.plugin.i18n.t('settings.selective_sync')});

		// Initialize syncConfig.selectiveSync if not exists
		if (!this.plugin.settings.syncConfig.selectiveSync) {
			this.plugin.settings.syncConfig.selectiveSync = {
				syncImages: false,
				syncAudio: false,
				syncVideo: false,
				syncPdf: false,
				syncThemes: false,
				syncSnippets: false,
				syncPlugins: false,
			};
		}
		const selectiveSync = this.plugin.settings.syncConfig.selectiveSync;

		// Sync Images
		new Setting(selectiveSyncContainer)
			.setName(this.plugin.i18n.t('settings.sync_images'))
			.setDesc(this.plugin.i18n.t('settings.sync_images_desc'))
			.addToggle((toggle) => {
				toggle.setValue(selectiveSync.syncImages ?? true);
				toggle.onChange(async (value) => {
					selectiveSync.syncImages = value;
					await this.plugin.saveSettings();
					await this.updateSelectiveSyncSettings();
				});
			});

		// Sync Audio
		new Setting(selectiveSyncContainer)
			.setName(this.plugin.i18n.t('settings.sync_audio'))
			.setDesc(this.plugin.i18n.t('settings.sync_audio_desc'))
			.addToggle((toggle) => {
				toggle.setValue(selectiveSync.syncAudio ?? false);
				toggle.onChange(async (value) => {
					selectiveSync.syncAudio = value;
					await this.plugin.saveSettings();
					await this.updateSelectiveSyncSettings();
				});
			});

		// Sync Video
		new Setting(selectiveSyncContainer)
			.setName(this.plugin.i18n.t('settings.sync_video'))
			.setDesc(this.plugin.i18n.t('settings.sync_video_desc'))
			.addToggle((toggle) => {
				toggle.setValue(selectiveSync.syncVideo ?? false);
				toggle.onChange(async (value) => {
					selectiveSync.syncVideo = value;
					await this.plugin.saveSettings();
					await this.updateSelectiveSyncSettings();
				});
			});

		// Sync PDF
		new Setting(selectiveSyncContainer)
			.setName(this.plugin.i18n.t('settings.sync_pdf'))
			.setDesc(this.plugin.i18n.t('settings.sync_pdf_desc'))
			.addToggle((toggle) => {
				toggle.setValue(selectiveSync.syncPdf ?? false);
				toggle.onChange(async (value) => {
					selectiveSync.syncPdf = value;
					await this.plugin.saveSettings();
					await this.updateSelectiveSyncSettings();
				});
			});

		// Sync Themes
		new Setting(selectiveSyncContainer)
			.setName(this.plugin.i18n.t('settings.sync_themes'))
			.setDesc(this.plugin.i18n.t('settings.sync_themes_desc'))
			.addToggle((toggle) => {
				toggle.setValue(selectiveSync.syncThemes ?? true);
				toggle.onChange(async (value) => {
					selectiveSync.syncThemes = value;
					await this.plugin.saveSettings();
					await this.updateSelectiveSyncSettings();
				});
			});

		// Sync Snippets
		new Setting(selectiveSyncContainer)
			.setName(this.plugin.i18n.t('settings.sync_snippets'))
			.setDesc(this.plugin.i18n.t('settings.sync_snippets_desc'))
			.addToggle((toggle) => {
				toggle.setValue(selectiveSync.syncSnippets ?? true);
				toggle.onChange(async (value) => {
					selectiveSync.syncSnippets = value;
					await this.plugin.saveSettings();
					await this.updateSelectiveSyncSettings();
				});
			});

		// Sync Plugins
		new Setting(selectiveSyncContainer)
			.setName(this.plugin.i18n.t('settings.sync_plugins'))
			.setDesc(this.plugin.i18n.t('settings.sync_plugins_desc'))
			.addToggle((toggle) => {
				toggle.setValue(selectiveSync.syncPlugins ?? true);
				toggle.onChange(async (value) => {
					selectiveSync.syncPlugins = value;
					await this.plugin.saveSettings();
					await this.updateSelectiveSyncSettings();
				});
			});

		// Ignore Patterns setting - dynamic list using native Setting components
		const currentPatterns = this.plugin.settings.syncConfig?.ignorePatterns || [];
		
		// Container for pattern rows (inserted after the header setting)
		const patternsListContainer = selectiveSyncContainer.createDiv();
		
		// Helper function to save all patterns
		const savePatterns = async () => {
			const patterns: string[] = [];
			const inputs = patternsListContainer.querySelectorAll<HTMLInputElement>('input[type="text"]');
			inputs.forEach((input) => {
				const value = input.value.trim();
				if (value) {
					patterns.push(value);
				}
			});
			
			this.plugin.settings.syncConfig.ignorePatterns = patterns;
			await this.plugin.saveSettings();
			
			if (this.plugin.syncService?.isInitialized) {
				this.plugin.syncService.updateIgnorePatterns(patterns);
			}
		};
		
		// Helper function to create a pattern row using native Setting
		const createPatternRow = (pattern: string = '') => {
			const setting = new Setting(patternsListContainer)
				.setDesc(this.plugin.i18n.t('settings.ignore_patterns_custom_rule'))
				.addText((text) => {
					text.setPlaceholder(this.plugin.i18n.t('settings.ignore_patterns_placeholder'));
					text.setValue(pattern);
					text.onChange(() => savePatterns());
				})
				.addExtraButton((button) => {
					button
						.setIcon('trash-2')
						.setTooltip(this.plugin.i18n.t('settings.ignore_patterns_delete'))
						.onClick(() => {
							setting.settingEl.remove();
							savePatterns();
						});
				});
		};
		
		// Header row with title and add button
		new Setting(selectiveSyncContainer)
			.setName(this.plugin.i18n.t('settings.ignore_patterns'))
			.setDesc(this.plugin.i18n.t('settings.ignore_patterns_desc'))
			.addButton((button) => {
				button
					.setButtonText(this.plugin.i18n.t('settings.ignore_patterns_add'))
					.onClick(() => {
						createPatternRow('');
					});
			});
		
		// Move the list container after the header setting
		selectiveSyncContainer.appendChild(patternsListContainer);
		
		// Initialize with existing patterns
		currentPatterns.forEach((pattern) => {
			createPatternRow(pattern);
		});
		
		// ========== UI Display Settings (Desktop only) ==========
		// Mobile always shows editor status (no status bar), so no setting needed
		if (Platform.isDesktop) {
			const uiDisplayContainer = containerEl.createDiv('friday-ui-display-container');
			uiDisplayContainer.createEl("h3", {text: "显示设置"});
			
			// Show Editor Status Display toggle
			new Setting(uiDisplayContainer)
				.setName(this.plugin.i18n.t('settings.show_editor_status'))
				.setDesc(this.plugin.i18n.t('settings.show_editor_status_desc'))
				.addToggle((toggle) => {
					toggle.setValue(this.plugin.settings.showEditorStatusDisplay ?? false);
					toggle.onChange(async (value) => {
						this.plugin.settings.showEditorStatusDisplay = value;
						await this.plugin.saveSettings();
						// Apply visibility immediately
						if (this.plugin.syncStatusDisplay) {
							// @ts-ignore - access method
							this.plugin.syncStatusDisplay.applyEditorStatusVisibility();
						}
					});
				});
		}

		// ========== Danger Zone ==========
		this.renderDangerZone(containerEl);
	}

	/**
	 * Update selective sync settings
	 * 
	 * This method handles:
	 * 1. selectiveSync: Controls file type sync (images, audio, video, PDF) - directly via settings
	 * 2. syncInternalFilesIgnorePatterns: Controls .obsidian folder sync (themes, plugins)
	 * 
	 * Note: ignorePatterns is separate and only for user-defined patterns (folders, custom rules)
	 */
	private async updateSelectiveSyncSettings(): Promise<void> {
		const selectiveSync = this.plugin.settings.syncConfig.selectiveSync;
		if (!selectiveSync) return;

		// Build internal ignore patterns for .obsidian folder (themes, plugins)
		const defaultInternalPatterns = [
			"\\.obsidian\\/workspace",
			"\\.obsidian\\/workspace\\.json",
			"\\.obsidian\\/workspace-mobile\\.json",
			"\\.obsidian\\/cache",
			"\\/node_modules\\/",
			"\\/\\.git\\/",
			"plugins\\/mdfriday\\/main\\.js",
			"plugins\\/mdfriday\\/styles\\.css",
			"plugins\\/mdfriday\\/manifest\\.json",
			"plugins\\/mdfriday\\/preview",
			"plugins\\/mdfriday\\/themes",
		];
		
		let internalPatterns = [...defaultInternalPatterns];
		
		// Add themes folder to ignore if not syncing themes
		if (!(selectiveSync.syncThemes ?? true)) {
			internalPatterns.push("\\.obsidian\\/themes");
		}
		
		// Add snippets folder to ignore if not syncing snippets
		if (!(selectiveSync.syncSnippets ?? true)) {
			internalPatterns.push("\\.obsidian\\/snippets");
		}
		
		// Add plugins folder to ignore if not syncing plugins
		if (!(selectiveSync.syncPlugins ?? true)) {
			internalPatterns.push("\\.obsidian\\/plugins");
		}
		
		// Update settings
		this.plugin.settings.syncConfig.syncInternalFilesIgnorePatterns = internalPatterns.join(", ");
		await this.plugin.saveSettings();

		// Update sync service if initialized (changes take effect immediately)
		if (this.plugin.syncService?.isInitialized) {
			// Update file type filtering (images, audio, video, pdf)
			this.plugin.syncService.updateSelectiveSync({
				syncImages: selectiveSync.syncImages,
				syncAudio: selectiveSync.syncAudio,
				syncVideo: selectiveSync.syncVideo,
				syncPdf: selectiveSync.syncPdf,
			});
			
			// Update internal file patterns (themes, plugins)
			this.plugin.syncService.updateInternalFilesIgnorePatterns(internalPatterns.join(", "));
		}
	}

	/**
	 * Render Danger Zone section with reset functionality
	 */
	private renderDangerZone(containerEl: HTMLElement): void {
		const dangerZone = containerEl.createDiv('friday-danger-zone');
		dangerZone.createEl('h3', { 
			text: this.plugin.i18n.t('settings.danger_zone'), 
			cls: 'friday-danger-zone-title' 
		});

		let resetInput = '';
		let resetButton: HTMLButtonElement;

		new Setting(dangerZone)
			.setName(this.plugin.i18n.t('settings.reset_sync_title'))
			.setDesc(this.plugin.i18n.t('settings.reset_sync_message'))
			.addText((text) => {
				text.inputEl.placeholder = this.plugin.i18n.t('settings.reset_input_placeholder');
				text.onChange((value) => {
					resetInput = value;
					// Enable button only when user types "RESET"
					if (resetButton) {
						resetButton.disabled = value !== 'RESET';
					}
				});
			})
			.addButton((button) => {
				button
					.setButtonText(this.plugin.i18n.t('settings.reset_sync_button'))
					.setWarning();
				
				// Store reference and set initial disabled state after setting up the button
				resetButton = button.buttonEl;
				resetButton.disabled = true;
				
				// Add click handler directly to the button element
				resetButton.addEventListener('click', async () => {
					if (resetInput === 'RESET' && !resetButton.disabled) {
						resetButton.disabled = true;
						resetButton.textContent = this.plugin.i18n.t('settings.sync_resetting');
						try {
							await this.performReset();
						} catch (error) {
							resetButton.disabled = false;
							resetButton.textContent = this.plugin.i18n.t('settings.reset_sync_button');
						}
					}
				});
			});
	}

	/**
	 * Perform the actual reset operation
	 */
	private async performReset(): Promise<void> {
		try {
			const { license } = this.plugin.settings;
			if (!license) {
				throw new Error('No license found');
			}

			// Step 1: Call Foundry License Service to reset cloud data
			if (!this.plugin.licenseServiceManager) {
				throw new Error('License service not available');
			}
			
			const result = await this.plugin.licenseServiceManager.resetUsage(true);
			if (!result.success) {
				throw new Error(result.error || 'Failed to reset usage');
			}

			// Step 2: Close existing sync service
			if (this.plugin.syncService?.isInitialized) {
				await this.plugin.syncService.close();
			}

			// Step 3: Clear in-memory handler cache (contains old PBKDF2 salt)
			// This is critical - without clearing, the old salt would be reused with new passphrase
			clearSyncHandlerCache();

			// Step 4: Clear local IndexedDB and localStorage
			await this.plugin.clearSyncDatabase();

			// Step 5: Generate new encryption passphrase (same as first-time activation)
			this.plugin.settings.encryptionPassphrase = generateEncryptionPassphrase();
			this.plugin.settings.syncConfig.passphrase = this.plugin.settings.encryptionPassphrase;

			// Step 6: Save settings
			await this.plugin.saveSettings();

			// Step 7: Re-initialize sync service
			// Network monitoring will be started after user clicks "Upload to Cloud"
			await this.plugin.initializeSyncService();

			// Step 8: Set first time flag to show upload option
			this.firstTimeSync = true;

			// Step 9: Show success message and refresh display
			new Notice(this.plugin.i18n.t('settings.reset_sync_success'));
			this.display();

		} catch (error) {
			console.error('Reset failed:', error);
			new Notice(this.plugin.i18n.t('settings.reset_sync_failed', { 
				error: error instanceof Error ? error.message : String(error) 
			}));
		}
	}

	/**
	 * Render Security Section - Now integrated into Sync Section
	 * This method is kept for backwards compatibility but does nothing
	 */
	private renderSecuritySection(containerEl: HTMLElement): void {
		// Security is now part of Sync section
	}

	/**
	 * Activate license key using Foundry License Service
	 * This is the main license activation flow:
	 * 1. Login with license key (get token)
	 * 2. Activate license (Foundry uses the token automatically)
	 * 3. Store license data
	 * 4. Configure sync if enabled
	 */
	/**
	 * Activate License
	 * 
	 * Simplified flow using licenseState as single source of truth
	 */
	private async activateLicense(licenseKey: string): Promise<void> {
		if (!this.plugin.licenseServiceManager) {
			throw new Error('License service not available');
		}

		try {
			// Step 1: Login with license key to get token
			const loginResult = await this.plugin.licenseServiceManager.loginWithLicense(licenseKey);
			
			if (!loginResult.success) {
				throw new Error(loginResult.error || 'Login with license failed');
			}
			
			console.log('[Friday] Login successful, proceeding with activation');

			// Step 2: Activate license using Foundry (uses the token from login)
			const activateResult = await this.plugin.licenseServiceManager.activateLicense(licenseKey);
			
			if (!activateResult.success || !activateResult.data) {
				throw new Error(activateResult.error || 'License activation failed');
			}

			const licenseInfo = activateResult.data;
			console.log('[Friday] License activation succeeded:', {
				plan: licenseInfo.plan,
				firstTime: licenseInfo.activation?.firstTime
			});

			// Step 3: Reinitialize license state from Foundry (single source of truth)
			if (this.plugin.licenseState) {
				const initResult = await this.plugin.licenseState.initialize();
				
				if (!initResult.isActivated) {
					throw new Error('License activation succeeded but state initialization failed');
				}
				
				console.log('[Friday] License state initialized successfully');
			}

			// Step 4: Sync to settings (for UI display only)
			await this.plugin.syncLicenseToSettings();

			// Step 5: Configure sync if enabled
			const isFirstTime = licenseInfo.activation?.firstTime || false;
			
			if (licenseInfo.sync && licenseInfo.features.syncEnabled) {
				// Store sync configuration
				this.plugin.settings.licenseSync = {
					enabled: true,
					endpoint: licenseInfo.sync.dbEndpoint,
					dbName: licenseInfo.sync.dbName,
					email: licenseInfo.sync.email,
					dbPassword: licenseInfo.sync.dbPassword
				};

				// Configure the actual sync config
				this.plugin.settings.syncEnabled = true;
				this.plugin.settings.syncConfig = {
					...this.plugin.settings.syncConfig,
					couchDB_URI: licenseInfo.sync.dbEndpoint.replace(`/${licenseInfo.sync.dbName}`, ''),
					couchDB_DBNAME: licenseInfo.sync.dbName,
					couchDB_USER: licenseInfo.sync.email,
					couchDB_PASSWORD: licenseInfo.sync.dbPassword,
					encrypt: true,
					syncOnStart: true,
					syncOnSave: true,
					liveSync: true
				};

				// Generate encryption passphrase if not exists (only for first time)
				if (!this.plugin.settings.encryptionPassphrase && isFirstTime) {
					this.plugin.settings.encryptionPassphrase = generateEncryptionPassphrase();
					this.plugin.settings.syncConfig.passphrase = this.plugin.settings.encryptionPassphrase;
				}
			}

			// Step 6: Save settings
			await this.plugin.saveSettings();

			// Step 7: Fetch license usage information
			await this.plugin.refreshLicenseUsage();

			// Step 8: Set first time flag
			this.firstTimeSync = isFirstTime;

			// Step 9: Initialize sync service only for first-time activation
			if (this.plugin.settings.syncEnabled && isFirstTime) {
				await this.plugin.initializeSyncService();
			}

			console.log('[Friday] License activation completed successfully');
			
		} catch (error) {
			console.error('[Friday] License activation failed:', error);
			throw error;
		}
	}
}
