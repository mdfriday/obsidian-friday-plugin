import {App, Plugin, PluginSettingTab, Setting, TFolder, TFile, Notice} from 'obsidian';
import ServerView, {FRIDAY_SERVER_VIEW_TYPE} from './server';
import {User} from "./user";
import './styles/theme-modal.css';
import './styles/publish-settings.css';
import './styles/project-modal.css';
import './styles/license-settings.css';
import {ThemeSelectionModal} from "./theme/modal";
import {Hugoverse} from "./hugoverse";
import {NetlifyAPI} from "./netlify";
import {I18nService} from "./i18n";
import {FTPUploader} from "./ftp";
import {Site} from "./site";
import {themeApiService} from "./theme/themeApiService";
import {ProjectManagementModal} from "./projects/modal";
import {ProjectService} from "./projects/service";
import type {ProjectConfig} from "./projects/types";
import {SyncService, SyncStatusDisplay, type SyncConfig} from "./sync";
import {
    type StoredLicenseData,
    type StoredSyncData,
    type StoredUserData,
    isValidLicenseKeyFormat,
    licenseKeyToEmail,
    licenseKeyToPassword,
    maskLicenseKey,
    formatExpirationDate,
    formatPlanName,
    isLicenseExpired,
    generateEncryptionPassphrase
} from "./license";

interface FridaySettings {
	username: string;
	password: string;
	userToken: string;
	// License Settings
	license: StoredLicenseData | null;
	licenseSync: StoredSyncData | null;
	licenseUser: StoredUserData | null;
	encryptionPassphrase: string;
	// General Settings
	downloadServer: 'global' | 'east';
	// Publish Settings
	publishMethod: 'netlify' | 'ftp';
	netlifyAccessToken: string;
	netlifyProjectId: string;
	// FTP Settings
	ftpServer: string;
	ftpUsername: string;
	ftpPassword: string;
	ftpRemoteDir: string;
	ftpIgnoreCert: boolean;
	// CouchDB Sync Settings (legacy, to be replaced by license-based sync)
	syncEnabled: boolean;
	syncConfig: SyncConfig;
}

const DEFAULT_SETTINGS: FridaySettings = {
	username: '',
	password: '',
	userToken: '',
	// License Settings defaults
	license: null,
	licenseSync: null,
	licenseUser: null,
	encryptionPassphrase: '',
	// General Settings defaults
	downloadServer: 'global',
	// Publish Settings defaults
	publishMethod: 'netlify',
	netlifyAccessToken: '',
	netlifyProjectId: '',
	// FTP Settings defaults
	ftpServer: '',
	ftpUsername: '',
	ftpPassword: '',
	ftpRemoteDir: '',
	ftpIgnoreCert: true, // Default to true for easier setup with self-signed certs
	// CouchDB Sync Settings defaults
	syncEnabled: false,
	syncConfig: SyncService.getDefaultConfig(),
}

export const FRIDAY_ICON = 'dice-5';
export const API_URL_DEV = 'http://127.0.0.1:1314';
export const API_URL_PRO = 'https://mdfriday.sunwei.xyz';
export function GetBaseUrl(): string {
	return process.env.NODE_ENV === 'development' ? API_URL_DEV : API_URL_PRO;
}

export default class FridayPlugin extends Plugin {
	settings: FridaySettings;
	statusBar: HTMLElement

	pluginDir: string
	apiUrl: string
	user: User
	hugoverse: Hugoverse
	netlify: NetlifyAPI
	i18n: I18nService
	ftp: FTPUploader | null = null
	site: Site
	projectService: ProjectService
	syncService: SyncService
	syncStatusDisplay: SyncStatusDisplay | null = null
	applyProjectConfigurationToPanel: ((project: ProjectConfig) => void) | null = null
	private previousDownloadServer: 'global' | 'east' = 'global'

	async onload() {
		this.pluginDir = `${this.manifest.dir}`;
		await this.loadSettings();
		await this.initFriday()

		// Initialize FTP uploader
		this.initializeFTP();

		// Initialize Sync Service
		this.initializeSyncService();

		this.statusBar = this.addStatusBarItem();

		this.addSettingTab(new FridaySettingTab(this.app, this));

		// Register view with protection against duplicate registration (can happen during hot reload)
		try {
			this.registerView(FRIDAY_SERVER_VIEW_TYPE, leaf => new ServerView(leaf, this))
		} catch (e) {
			console.log('[Friday] View already registered, skipping');
		}
		this.app.workspace.onLayoutReady(() => this.initLeaf())

		// Register export HTML command
		this.addCommand({
			id: "export-current-note-with-css",
			name: this.i18n.t('menu.publish_to_web'),
			checkCallback: (checking) => {
				const file = this.app.workspace.getActiveFile();
				if (file && file.extension === 'md') {
					if (!checking) {
						this.openPublishPanel(null, file);
					}
					return true;
				}
				return false;
			}
		});

		// Register sync commands
		this.addCommand({
			id: "sync-pull-from-server",
			name: "Sync: Pull from Server",
			callback: async () => {
				if (!this.settings.syncEnabled) {
					new Notice("Sync is not enabled. Please enable it in settings first.");
					return;
				}
				if (!this.syncService.isInitialized) {
					await this.syncService.initialize(this.settings.syncConfig);
				}
				await this.syncService.pullFromServer();
			}
		});

		this.addCommand({
			id: "sync-push-to-server",
			name: "Sync: Push to Server",
			callback: async () => {
				if (!this.settings.syncEnabled) {
					new Notice("Sync is not enabled. Please enable it in settings first.");
					return;
				}
				if (!this.syncService.isInitialized) {
					await this.syncService.initialize(this.settings.syncConfig);
				}
				await this.syncService.pushToServer();
			}
		});

		this.addCommand({
			id: "sync-start-live-sync",
			name: "Sync: Start Live Sync",
			callback: async () => {
				if (!this.settings.syncEnabled) {
					new Notice("Sync is not enabled. Please enable it in settings first.");
					return;
				}
				if (!this.syncService.isInitialized) {
					await this.syncService.initialize(this.settings.syncConfig);
				}
				await this.syncService.startSync(true); // continuous = true for live sync
			}
		});

		this.addCommand({
			id: "sync-stop",
			name: "Sync: Stop Synchronization",
			callback: async () => {
				if (this.syncService) {
					await this.syncService.stopSync();
				}
			}
		});

		// Register context menu for files and folders
		this.registerEvent(
			this.app.workspace.on('file-menu', (menu, file) => {
				if (file instanceof TFolder) {
					menu.addItem(item => {
						item
							.setTitle(this.i18n.t('menu.publish_to_web'))
							.setIcon(FRIDAY_ICON)
							.onClick(async () => {
								await this.openPublishPanel(file, null);
							});
					});
					
					// Add site assets menu item
					menu.addItem(item => {
						item
							.setTitle(this.i18n.t('menu.set_as_site_assets'))
							.setIcon('folder-plus')
							.onClick(async () => {
								await this.setSiteAssets(file);
							});
					});
				} else if (file instanceof TFile && file.extension === 'md') {
					// Add publish option for markdown files (unified behavior)
					menu.addItem(item => {
						item
							.setTitle(this.i18n.t('menu.publish_to_web'))
							.setIcon(FRIDAY_ICON)
							.onClick(async () => {
								await this.openPublishPanel(null, file);
							});
					});
				}
			})
		);
	}

	async openPublishPanel(folder: TFolder | null, file: TFile | null) {
		const rightSplit = this.app.workspace.rightSplit;
		if (!rightSplit) {
			return;
		}
		if (rightSplit.collapsed) {
			rightSplit.expand();
		}

		// Check if project configuration exists for this folder/file
		// If yes, apply the entire project configuration (like clicking "Apply to Panel")
		const projectId = await this.tryGetProjectId(folder, file);
		if (projectId) {
			const existingProject = this.projectService.getProject(projectId);
			if (existingProject) {
				// Apply the entire project configuration
				await this.applyExistingProjectToPanel(existingProject);
				return;
			}
		}

		// No existing project found, continue with normal logic
		// Handle multilingual content selection
		if (this.site.hasContent()) {
			// Add to existing multilingual content
			const success = this.site.addLanguageContent(folder, file);
			if (!success) {
				return; // Error message already shown by addLanguageContent
			}
		} else {
			// Smart detection for structured folders when no content exists
			if (folder && await this.detectStructuredFolder(folder)) {
				// Structured folder detected, process it automatically
				await this.processStructuredFolder(folder);
			} else {
				// Initialize first content normally
				this.site.initializeContent(folder, file);
			}
		}

		const leaves = this.app.workspace.getLeavesOfType(FRIDAY_SERVER_VIEW_TYPE);
		if (leaves.length > 0) {
			await this.app.workspace.revealLeaf(leaves[0]);
		} else {
			// If no existing view, create a new one
			const leaf = this.app.workspace.getRightLeaf(false);
			if (leaf) {
				await leaf.setViewState({
					type: FRIDAY_SERVER_VIEW_TYPE,
					active: true,
				});
			}
		}
	}

	/**
	 * Try to get project ID from folder or file
	 * Returns the project ID if it can be determined
	 */
	async tryGetProjectId(folder: TFolder | null, file: TFile | null): Promise<string | null> {
		if (!folder && !file) {
			return null;
		}

		let projectId = folder?.path || file?.path || '';
		
		// Try to get parent folder for better project identification
		const contentFolder = folder || (file ? file.parent : null);
		if (contentFolder && contentFolder.parent) {
			// Check if this looks like a content subfolder (content, content.en, etc.)
			const folderName = contentFolder.name.toLowerCase();
			if (folderName === 'content' || folderName.startsWith('content.')) {
				// Use parent folder path as project ID
				projectId = contentFolder.parent.path;
			}
		}
		
		return projectId || null;
	}

	/**
	 * Apply existing project configuration to panel
	 * This mimics clicking "Apply to Panel" button
	 */
	async applyExistingProjectToPanel(project: ProjectConfig) {
		try {
			// Use the registered method from Site.svelte to apply complete project configuration
			if (this.applyProjectConfigurationToPanel) {
				this.applyProjectConfigurationToPanel(project);
			} else {
				console.error('applyProjectConfigurationToPanel method not registered yet');
			}
		} catch (error) {
			console.error('Failed to apply project configuration:', error);
		}
	}

	/**
	 * Detect if a folder has structured content (content directories and static folder)
	 */
	async detectStructuredFolder(folder: TFolder): Promise<boolean> {
		try {
			const children = folder.children;
			const childNames = children.map(child => child.name.toLowerCase());
			
			// Check for content directories (content, content.en, content.zh, etc.)
			const hasContentDirs = childNames.some(name => 
				name === 'content' || name.startsWith('content.')
			);
			
			// Check for static directory
			const hasStaticDir = childNames.includes('static');
			
			// Consider it structured if it has at least content directories
			return hasContentDirs;
		} catch (error) {
			console.warn('Error detecting structured folder:', error);
			return false;
		}
	}

	/**
	 * Process a structured folder by automatically adding content directories and static folder
	 */
	async processStructuredFolder(folder: TFolder) {
		try {
			const children = folder.children;
			const contentFolders: { folder: TFolder; languageCode: string; weight: number }[] = [];
			let staticFolder: TFolder | null = null;

			// Analyze child directories
			for (const child of children) {
				if (!(child instanceof TFolder)) continue;
				
				const childName = child.name.toLowerCase();
				
				// Check for content directories
				if (childName === 'content') {
					contentFolders.push({
						folder: child,
						languageCode: 'en', // Default language for 'content'
						weight: 0 // Highest priority for default content
					});
				} else if (childName.startsWith('content.')) {
					const langCode = childName.split('.')[1];
					const mappedLangCode = this.mapLanguageCode(langCode);
					contentFolders.push({
						folder: child,
						languageCode: mappedLangCode,
						weight: 1 // Lower priority for language-specific content
					});
				}
				
				// Check for static directory
				if (childName === 'static') {
					staticFolder = child;
				}
			}

			// Sort content folders: 'content' first, then others by folder name
			contentFolders.sort((a, b) => {
				// 'content' (weight 0) always comes first
				if (a.weight !== b.weight) {
					return a.weight - b.weight;
				}
				// For language-specific folders, sort by folder name alphabetically
				return a.folder.name.localeCompare(b.folder.name);
			});

			// Add content folders to multilingual content
			if (contentFolders.length > 0) {
				// Initialize with first content folder (should be 'content' due to sorting)
				this.site.initializeContentWithLanguage(
					contentFolders[0].folder, 
					null, 
					contentFolders[0].languageCode
				);

				// Add remaining content folders with proper weight assignment
				for (let i = 1; i < contentFolders.length; i++) {
					this.site.addLanguageContentWithCode(
						contentFolders[i].folder,
						null,
						contentFolders[i].languageCode
					);
				}
			}

			// Set static folder as site assets
			if (staticFolder) {
				this.site.setSiteAssets(staticFolder);
			}

			// Show success message
			const contentCount = contentFolders.length;
			const hasStatic = staticFolder !== null;
			
			let message = this.i18n.t('messages.structured_folder_processed', {
				contentCount,
				folderName: folder.name
			});
			
			if (hasStatic) {
				message += ' ' + this.i18n.t('messages.static_folder_detected');
			}
			
			new Notice(message, 5000);

		} catch (error) {
			console.error('Error processing structured folder:', error);
			// Fallback to normal folder processing
			this.site.initializeContent(folder, null);
		}
	}

	/**
	 * Map language codes to supported language codes
	 */
	private mapLanguageCode(code: string): string {
		const languageMap: { [key: string]: string } = {
			'en': 'en',
			'zh': 'zh',
			'zh-cn': 'zh',
			'zh-hans': 'zh',
			'es': 'es',
			'fr': 'fr',
			'de': 'de',
			'ja': 'ja',
			'ko': 'ko',
			'pt': 'pt'
		};
		
		return languageMap[code.toLowerCase()] || 'en';
	}

	async setSiteAssets(folder: TFolder) {
		// Set the site assets folder
		const success = this.site.setSiteAssets(folder);
		
		if (success) {
			// Open the publish panel to show the updated assets
			const rightSplit = this.app.workspace.rightSplit;
			if (!rightSplit) {
				return;
			}
			if (rightSplit.collapsed) {
				rightSplit.expand();
			}

			const leaves = this.app.workspace.getLeavesOfType(FRIDAY_SERVER_VIEW_TYPE);
			if (leaves.length > 0) {
				await this.app.workspace.revealLeaf(leaves[0]);
			} else {
				// If no existing view, create a new one
				const leaf = this.app.workspace.getRightLeaf(false);
				if (leaf) {
					await leaf.setViewState({
						type: FRIDAY_SERVER_VIEW_TYPE,
						active: true,
					});
				}
			}
		}
	}

	showThemeSelectionModal(selectedTheme: string, onSelect: (themeUrl: string, themeName?: string, themeId?: string) => void, isForSingleFile: boolean = false) {
		const modal = new ThemeSelectionModal(this.app, selectedTheme, onSelect, this, isForSingleFile);
		modal.open();
	}

	showProjectManagementModal(
		onApply: (project: ProjectConfig) => void, 
		onExport: (previewId: string) => Promise<void>,
		onClearHistory: (projectId: string) => Promise<void>
	) {
		const modal = new ProjectManagementModal(this.app, this, this.projectService, onApply, onExport, onClearHistory);
		modal.open();
	}

	async initFriday(): Promise<void> {
		this.apiUrl = process.env.NODE_ENV === 'development' ? API_URL_DEV : API_URL_PRO;
		
		// Initialize i18n service first
		this.i18n = new I18nService(this);
		await this.i18n.init();
		
		this.user = new User(this);
		this.hugoverse = new Hugoverse(this);
		this.netlify = new NetlifyAPI(this);
		this.site = new Site(this);
		
		// Initialize project service
		this.projectService = new ProjectService(this);
		await this.projectService.initialize();
	}

	initLeaf(): void {
		if (this.app.workspace.getLeavesOfType(FRIDAY_SERVER_VIEW_TYPE).length > 0) return

		this.app.workspace.getRightLeaf(false)?.setViewState({
			type: FRIDAY_SERVER_VIEW_TYPE,
			active: true,
		}).then(r => {})
	}

	async onunload() {
		// Clean up sync status display
		if (this.syncStatusDisplay) {
			this.syncStatusDisplay.onunload();
			this.syncStatusDisplay = null;
		}
		
		// Stop sync service
		if (this.syncService) {
			await this.syncService.stopSync();
		}
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
		this.previousDownloadServer = this.settings.downloadServer;
	}

	async saveSettings() {
		// Check if download server changed
		const downloadServerChanged = this.previousDownloadServer !== this.settings.downloadServer;
		
		await this.saveData(this.settings);
		
		// Clear theme cache if download server changed
		if (downloadServerChanged) {
			themeApiService.clearCache();
			this.previousDownloadServer = this.settings.downloadServer;
		}
		
		// Reinitialize FTP uploader when settings change
		this.initializeFTP();
	}

	/**
	 * Initialize FTP uploader with current settings
	 */
	initializeFTP(preferredSecure?: boolean) {
		const { ftpServer, ftpUsername, ftpPassword, ftpRemoteDir, ftpIgnoreCert } = this.settings;
		
		if (ftpServer && ftpUsername && ftpPassword) {
			this.ftp = new FTPUploader({
				server: ftpServer,
				username: ftpUsername,
				password: ftpPassword,
				remoteDir: ftpRemoteDir || '/',
				ignoreCert: ftpIgnoreCert,
				preferredSecure: preferredSecure
			});
		} else {
			this.ftp = null;
		}
	}

	/**
	 * Initialize Sync Service with current settings
	 */
	async initializeSyncService() {
		try {
			this.syncService = new SyncService(this);
			
			// Initialize status display (using livesync's ModuleLog implementation)
			this.syncStatusDisplay = new SyncStatusDisplay(this);

			// Initialize if sync is enabled
			if (this.settings.syncEnabled && this.settings.syncConfig) {
				const initialized = await this.syncService.initialize(this.settings.syncConfig);
				
				// Connect status display to sync core after initialization
				if (initialized && this.syncService.syncCore && this.syncStatusDisplay) {
					this.syncStatusDisplay.setCore(this.syncService.syncCore);
					this.syncStatusDisplay.initialize();
					
					// Connect log callback to status display
					// All logs are displayed in logMessage area, only NOTICE shows popup
					this.syncService.syncCore.setLogCallback((message, level, key) => {
						this.syncStatusDisplay?.addLog(message, level, key);
					});
					
					// Start LiveSync (continuous replication) by default
					if (this.settings.syncConfig.syncOnStart) {
						console.log('[Friday Sync] Starting LiveSync on startup...');
						await this.syncService.startSync(true); // true = liveSync mode
					}
				}
			} else if (this.syncStatusDisplay) {
				// Initialize status display even if sync is not enabled
				this.syncStatusDisplay.initialize();
			}
		} catch (error) {
			console.error('[Friday] Error initializing sync service:', error);
		}
	}

	/**
	 * Test CouchDB Sync connection
	 */
	async testSyncConnection(): Promise<{ success: boolean; message: string }> {
		if (!this.syncService || !this.syncService.isInitialized) {
			// Initialize with current config for testing
			this.syncService = new SyncService(this);
			await this.syncService.initialize(this.settings.syncConfig);
		}
		return await this.syncService.testConnection();
	}

	/**
	 * Test FTP connection
	 */
	async testFTPConnection(): Promise<{ success: boolean; message: string }> {
		if (!this.ftp) {
			return {
				success: false,
				message: 'FTP not configured'
			};
		}

		try {
			const result = await this.ftp.testConnection();
			if (result.success) {
				const secureInfo = result.usedSecure ? 'FTPS' : 'FTP (Plain)';
				return {
					success: true,
					message: `Connection successful using ${secureInfo}`
				};
			} else {
				return {
					success: false,
					message: result.error || 'Connection failed'
				};
			}
		} catch (error) {
			return {
				success: false,
				message: error instanceof Error ? error.message : String(error)
			};
		}
	}

	async status(text: string) {
		this.statusBar.setText(text)
	}
}

class FridaySettingTab extends PluginSettingTab {
	plugin: FridayPlugin;
	private isActivating: boolean = false;
	private activationError: string = '';
	private firstTimeSync: boolean = false;

	constructor(app: App, plugin: FridayPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const {containerEl} = this;

		containerEl.empty();

		const {license, licenseSync, downloadServer, publishMethod, netlifyAccessToken, netlifyProjectId, ftpServer, ftpUsername, ftpPassword, ftpRemoteDir, ftpIgnoreCert} = this.plugin.settings;

		// =========================================
		// License Section (Always at top)
		// =========================================
		this.renderLicenseSection(containerEl);

		// If license is activated, show Sync and Security sections
		if (license && licenseSync?.enabled) {
			this.renderSyncSection(containerEl);
			this.renderSecuritySection(containerEl);
		}

		// Publish Settings Section
		containerEl.createEl("h2", {text: this.plugin.i18n.t('settings.publish_settings')});
		
		// Create containers for dynamic content
		let netlifySettingsContainer: HTMLElement;
		let ftpSettingsContainer: HTMLElement;
		
		// Publish Method Dropdown
		new Setting(containerEl)
			.setName(this.plugin.i18n.t('settings.publish_method'))
			.setDesc(this.plugin.i18n.t('settings.publish_method_desc'))
			.addDropdown((dropdown) => {
				dropdown
					.addOption('netlify', this.plugin.i18n.t('settings.publish_method_netlify'))
					.addOption('ftp', this.plugin.i18n.t('settings.publish_method_ftp'))
					.setValue(publishMethod || 'netlify')
					.onChange(async (value) => {
						this.plugin.settings.publishMethod = value as 'netlify' | 'ftp';
						await this.plugin.saveSettings();
						showPublishSettings(value as 'netlify' | 'ftp');
					});
			});

		// Create containers for different publish methods
		netlifySettingsContainer = containerEl.createDiv('netlify-settings-container');
		ftpSettingsContainer = containerEl.createDiv('ftp-settings-container');

		// Function to show/hide publish settings based on selected method
		const showPublishSettings = (method: 'netlify' | 'ftp') => {
			if (method === 'netlify') {
				netlifySettingsContainer.style.display = 'block';
				ftpSettingsContainer.style.display = 'none';
			} else {
				netlifySettingsContainer.style.display = 'none';
				ftpSettingsContainer.style.display = 'block';
			}
		};

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
		
		// Declare resetButtonState function first (will be defined later)
		let resetButtonState: (() => void) | undefined;

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
						if (resetButtonState) resetButtonState();
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
						if (resetButtonState) resetButtonState();
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
						if (resetButtonState) resetButtonState();
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
						if (resetButtonState) resetButtonState();
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
						if (resetButtonState) resetButtonState();
					})
			);

		// FTP Test Connection Button
		const testConnectionSetting = new Setting(ftpSettingsContainer)
			.setName(this.plugin.i18n.t('settings.ftp_test_connection'))
			.setDesc(this.plugin.i18n.t('settings.ftp_test_connection_desc'));

		let testButton: HTMLButtonElement;
		let testResultEl: HTMLElement | null = null;

		// Function to check if all required FTP settings are filled
		const isFTPConfigured = () => {
			return !!(this.plugin.settings.ftpServer?.trim() && 
					 this.plugin.settings.ftpUsername?.trim() && 
					 this.plugin.settings.ftpPassword?.trim());
		};

		// Function to update button state
		const updateButtonState = (state: 'idle' | 'testing' | 'success' | 'error', message?: string) => {
			// Remove existing result element
			if (testResultEl) {
				testResultEl.remove();
				testResultEl = null;
			}

			switch (state) {
				case 'idle':
					testButton.textContent = this.plugin.i18n.t('settings.ftp_test_connection');
					testButton.disabled = !isFTPConfigured();
					testButton.removeClass('ftp-test-success', 'ftp-test-error');
					break;
				case 'testing':
					testButton.textContent = this.plugin.i18n.t('settings.ftp_test_connection_testing');
					testButton.disabled = true;
					testButton.removeClass('ftp-test-success', 'ftp-test-error');
					break;
				case 'success':
					testButton.textContent = this.plugin.i18n.t('settings.ftp_test_connection_success');
					testButton.disabled = false;
					testButton.removeClass('ftp-test-error');
					testButton.addClass('ftp-test-success');
					if (message) {
						// Insert after the setting element
						testResultEl = ftpSettingsContainer.createEl('div', { 
							text: `✅ ${message}`,
							cls: 'ftp-test-result ftp-test-result-success'
						});
						// Insert the result element right after the test connection setting
						testConnectionSetting.settingEl.insertAdjacentElement('afterend', testResultEl);
					}
					break;
				case 'error':
					testButton.textContent = this.plugin.i18n.t('settings.ftp_test_connection_failed');
					testButton.disabled = false;
					testButton.removeClass('ftp-test-success');
					testButton.addClass('ftp-test-error');
					if (message) {
						// Insert after the setting element
						testResultEl = ftpSettingsContainer.createEl('div', { 
							text: `❌ ${message}`,
							cls: 'ftp-test-result ftp-test-result-error'
						});
						// Insert the result element right after the test connection setting
						testConnectionSetting.settingEl.insertAdjacentElement('afterend', testResultEl);
					}
					break;
			}
		};

		// Function to reset button state when settings change
		resetButtonState = () => {
			updateButtonState('idle');
		};

		testConnectionSetting.addButton((button) => {
			testButton = button.buttonEl;
			updateButtonState('idle');
			
			button.onClick(async () => {
				updateButtonState('testing');
				
				try {
					// Refresh FTP configuration with latest settings
					this.plugin.initializeFTP();
					const result = await this.plugin.testFTPConnection();
					
					if (result.success) {
						updateButtonState('success', result.message);
					} else {
						updateButtonState('error', result.message);
					}
				} catch (error) {
					const errorMessage = error instanceof Error ? error.message : String(error);
					updateButtonState('error', errorMessage);
				}
			});
		});

		// Initialize the display based on current publish method
		showPublishSettings(publishMethod || 'netlify');

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
	 * Render License Section
	 * Shows license key input when not activated, or license status when activated
	 */
	private renderLicenseSection(containerEl: HTMLElement): void {
		const license = this.plugin.settings.license;

		containerEl.createEl("h2", {text: this.plugin.i18n.t('settings.license')});

		if (license && !isLicenseExpired(license.expiresAt)) {
			// ========== License Active State ==========
			
			// Row 1: License Key (masked) + Valid Until + Plan Badge
			const licenseKeySetting = new Setting(containerEl)
				.setName(maskLicenseKey(license.key))
				.setDesc(this.plugin.i18n.t('settings.valid_until') + ': ' + formatExpirationDate(license.expiresAt));
			
			// Add plan badge to the right
			const planBadge = licenseKeySetting.controlEl.createSpan({
				cls: `friday-plan-badge ${license.plan.toLowerCase()}`,
				text: formatPlanName(license.plan)
			});

			// Row 2: Devices
			const devicesSetting = new Setting(containerEl)
				.setName(this.plugin.i18n.t('settings.devices'))
				.setDesc(this.plugin.i18n.t('settings.devices_registered'));
			
			// Add device count to the right
			devicesSetting.controlEl.createSpan({
				cls: 'friday-device-count',
				text: `1 / ${license.features.max_devices}`
			});

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
							if (!isValidLicenseKeyFormat(licenseKey)) {
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

			// Add status element
			statusEl = licenseSetting.descEl.createSpan({cls: 'friday-license-status-text'});
		}
	}

	/**
	 * Render Sync Section (only shown when license is activated)
	 * Includes Security subsection with Netlify-style container
	 */
	private renderSyncSection(containerEl: HTMLElement): void {
		const license = this.plugin.settings.license;
		const licenseSync = this.plugin.settings.licenseSync;

		if (!license || !licenseSync?.enabled) return;

		containerEl.createEl("h2", {text: this.plugin.i18n.t('settings.sync')});

		// First time sync - Upload option
		if (this.firstTimeSync) {
			new Setting(containerEl)
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
			// Non-first-time - Download option
			new Setting(containerEl)
				.setName(this.plugin.i18n.t('settings.sync_data_available'))
				.setDesc(this.plugin.i18n.t('settings.sync_description'))
				.addButton((button) => {
					button
						.setButtonText(this.plugin.i18n.t('settings.download_from_cloud'))
						.onClick(async () => {
							button.setButtonText(this.plugin.i18n.t('settings.sync_downloading'));
							button.setDisabled(true);
							try {
								if (!this.plugin.syncService.isInitialized) {
									await this.plugin.syncService.initialize(this.plugin.settings.syncConfig);
								}
								await this.plugin.syncService.fetchFromServer();
								new Notice(this.plugin.i18n.t('settings.sync_download_success'));
								this.display();
							} catch (error) {
								new Notice(this.plugin.i18n.t('settings.sync_operation_failed'));
								button.setButtonText(this.plugin.i18n.t('settings.download_from_cloud'));
								button.setDisabled(false);
							}
						});
				});
		}

		// ========== Security Subsection (Netlify-style container) ==========
		const encryptionPassphrase = this.plugin.settings.encryptionPassphrase;
		if (encryptionPassphrase) {
			const securityContainer = containerEl.createDiv('friday-security-container');
			securityContainer.createEl("h3", {text: this.plugin.i18n.t('settings.security')});

			// Encryption Password (with show/hide toggle)
			let passwordVisible = false;
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
	 * Activate license key
	 * This is the main license activation flow:
	 * 1. Convert license key to email/password
	 * 2. Login with credentials
	 * 3. Activate license with device info
	 * 4. Store license data and configure sync
	 */
	private async activateLicense(licenseKey: string): Promise<void> {
		// Import required functions
		const { getDeviceId, getDeviceName, getDeviceType } = await import('./license');

		// Step 1: Convert license key to credentials
		const email = licenseKeyToEmail(licenseKey);
		const password = licenseKeyToPassword(licenseKey);

		// Step 2: Login with credentials
		const token = await this.plugin.user.loginWithCredentials(email, password);
		if (!token) {
			throw new Error('Login failed');
		}

		// Step 3: Get device info
		const deviceId = await getDeviceId();
		const deviceName = getDeviceName();
		const deviceType = getDeviceType();

		// Step 4: Activate license
		const response = await this.plugin.hugoverse.activateLicense(
			token,
			licenseKey,
			deviceId,
			deviceName,
			deviceType
		);

		if (!response || !response.success) {
			throw new Error('License activation failed');
		}

		// Step 5: Store license data
		this.plugin.settings.license = {
			key: licenseKey,
			plan: response.plan,
			expiresAt: response.expires_at,
			features: response.features,
			activatedAt: Date.now()
		};

		// Step 6: Store sync configuration
		if (response.sync && response.features.sync_enabled) {
			this.plugin.settings.licenseSync = {
				enabled: true,
				endpoint: response.sync.db_endpoint,
				dbName: response.sync.db_name,
				email: response.sync.email,
				dbPassword: response.sync.db_password
			};

			// Configure the actual sync config
			this.plugin.settings.syncEnabled = true;
			this.plugin.settings.syncConfig = {
				...this.plugin.settings.syncConfig,
				couchDB_URI: response.sync.db_endpoint.replace(`/${response.sync.db_name}`, ''),
				couchDB_DBNAME: response.sync.db_name,
				couchDB_USER: response.sync.email,
				couchDB_PASSWORD: response.sync.db_password,
				encrypt: true,
				syncOnStart: true,
				syncOnSave: true,
				liveSync: true
			};
		}

		// Step 7: Store user data
		if (response.user) {
			this.plugin.settings.licenseUser = {
				email: response.user.email,
				userDir: response.user.user_dir
			};
		}

		// Step 8: Generate encryption passphrase if not exists
		if (!this.plugin.settings.encryptionPassphrase) {
			this.plugin.settings.encryptionPassphrase = generateEncryptionPassphrase();
			// Set in sync config too
			this.plugin.settings.syncConfig.passphrase = this.plugin.settings.encryptionPassphrase;
		}

		// Step 9: Save all settings
		await this.plugin.saveSettings();

		// Step 10: Set first time flag
		this.firstTimeSync = response.first_time;

		// Step 11: Initialize sync service
		if (this.plugin.settings.syncEnabled) {
			await this.plugin.initializeSyncService();
		}
	}
}

