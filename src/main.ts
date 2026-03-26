import {App, Modal, Plugin, PluginSettingTab, Setting, TFolder, TFile, Notice, MarkdownView, setIcon, Platform, FileSystemAdapter} from 'obsidian';
import {User} from "./user";
import './styles/license-settings.css';
import {I18nService} from "./i18n";
import {SyncService, SyncStatusDisplay, type SyncConfig, clearSyncHandlerCache} from "./sync";
import {
    type StoredLicenseData,
    type StoredSyncData,
    type StoredUserData,
    type StoredUsageData,
    isValidLicenseKeyFormat,
    licenseKeyToEmail,
    licenseKeyToPassword,
    maskLicenseKey,
    formatExpirationDate,
    formatPlanName,
    isLicenseExpired,
    generateEncryptionPassphrase
} from "./license";
import {
	createObsidianWorkspaceService,
	type ObsidianWorkspaceService,
	createObsidianProjectService,
	type ObsidianProjectService,
	createObsidianBuildService,
	type ObsidianBuildService,
	createObsidianGlobalConfigService,
	type ObsidianGlobalConfigService,
	createObsidianProjectConfigService,
	type ObsidianProjectConfigService,
	createObsidianServeService,
	type ObsidianServeService,
	createObsidianPublishService,
	type ObsidianPublishService,
	type ObsidianProjectInfo,
	type FTPConfig,
	type NetlifyConfig,
	createObsidianAuthService,
	type ObsidianAuthService,
	createObsidianLicenseService,
	type ObsidianLicenseService,
	createObsidianDomainService,
	type ObsidianDomainService,
} from '@mdfriday/foundry';
import { createObsidianHttpClient, createObsidianIdentityHttpClient } from './http';
import { LicenseServiceManager } from './services/license';
import { DomainServiceManager } from './services/domain';
import { LicenseStateManager } from './services/licenseState';
import { ProjectServiceManager } from './services/project';
import type { SiteEventType, SiteEventData, ProjectState } from './types/events';
import type { PublishMethod, ValidPublishMethod } from './types/publish';
import { DEFAULT_PUBLISH_METHOD, normalizePublishMethod } from './types/publish';
import { generateRandomId } from './utils/common';
import { getDefaultTheme, shouldUseInternalRenderer } from './utils/theme';

// PC-only module types (dynamically imported)
import type {Hugoverse} from "./hugoverse";
import type {NetlifyAPI} from "./netlify";
import type {FTPUploader} from "./ftp";
import type {Site} from "./site";
import type {ProjectService} from "./projects/service";
import type {ProjectConfig} from "./projects/types";
import type {ThemeSelectionModal} from "./theme/modal";
import type {ProjectManagementModal} from "./projects/modal";
import type ServerView from './server';
import {validateSubdomainFormat, isReservedSubdomain} from "./domain";

// Export view type for dynamic import
export const FRIDAY_SERVER_VIEW_TYPE = 'Friday_Service';

interface FridaySettings {
	username: string;
	password: string;
	userToken: string;
	// License Settings
	license: StoredLicenseData | null;
	licenseSync: StoredSyncData | null;
	licenseUser: StoredUserData | null;
	licenseUsage: StoredUsageData | null;
	encryptionPassphrase: string;
	// Custom subdomain (only set when user modifies from default)
	// If null/undefined, use licenseUser.userDir as default
	customSubdomain: string | null;
	// Custom domain for publishing
	customDomain: string | null;
	// General Settings
	downloadServer: 'global' | 'east';
	// Publish Settings
	publishMethod: PublishMethod;
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
	// UI Display Settings
	showEditorStatusDisplay: boolean;
	// Enterprise Settings
	enterpriseServerUrl: string;
}

const DEFAULT_SETTINGS: FridaySettings = {
	username: '',
	password: '',
	userToken: '',
	// License Settings defaults
	license: null,
	licenseSync: null,
	licenseUser: null,
	licenseUsage: null,
	encryptionPassphrase: '',
	customSubdomain: null,
	customDomain: null,
	// General Settings defaults
	downloadServer: 'global',
	// Publish Settings defaults
	publishMethod: 'mdf-share',
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
	// UI Display Settings defaults
	showEditorStatusDisplay: false,
	// Enterprise Settings defaults
	enterpriseServerUrl: '',
}

export const FRIDAY_ICON = 'dice-5';
export const API_URL_DEV = 'http://127.0.0.1:1314';
export const API_URL_PRO = 'https://app.mdfriday.com';

/**
 * Get base URL for API requests
 * Priority: Enterprise Server URL > Development Mode > Production
 */
export function GetBaseUrl(settings?: FridaySettings): string {
	if (process.env.NODE_ENV === 'development') {
		return API_URL_DEV
	}

	if (settings?.enterpriseServerUrl && settings.enterpriseServerUrl.trim()) {
		return settings.enterpriseServerUrl.trim();
	}
	
	return API_URL_PRO;
}

export default class FridayPlugin extends Plugin {
	settings: FridaySettings;
	statusBar: HTMLElement

	pluginDir: string
	absWorkspacePath: string
	apiUrl: string
	
	// Core services (always available)
	user: User
	i18n: I18nService
	syncService: SyncService
	syncStatusDisplay: SyncStatusDisplay | null = null
	
	// PC-only services (optional, only loaded on desktop)
	hugoverse?: Hugoverse
	netlify?: NetlifyAPI
	ftp?: FTPUploader | null
	site?: Site
	projectService?: ProjectService
	workspaceService?: ObsidianWorkspaceService | null
	// Foundry services
	foundryProjectService?: ObsidianProjectService | null
	foundryBuildService?: ObsidianBuildService | null
	foundryGlobalConfigService?: ObsidianGlobalConfigService | null
	foundryProjectConfigService?: ObsidianProjectConfigService | null
	foundryServeService?: ObsidianServeService | null
	foundryPublishService?: ObsidianPublishService | null
	foundryAuthService?: ObsidianAuthService | null
	foundryLicenseService?: ObsidianLicenseService | null
	foundryDomainService?: ObsidianDomainService | null
	licenseServiceManager?: LicenseServiceManager | null
	domainServiceManager?: DomainServiceManager | null
	projectServiceManager?: ProjectServiceManager | null
	// License state manager (unified license state from Foundry)
	licenseState?: LicenseStateManager | null
	// Current project name for tracking
	currentProjectName?: string | null
	
	// Site.svelte component reference (for new event-driven architecture)
	siteComponent?: any | null
	
	// Project initialization flag (prevents auto-save during new project creation)
	isProjectInitializing: boolean = false
	
	// PC-only callbacks (optional)
	// TODO: These are for Project Management Modal - will be removed when that feature is refactored
	applyProjectConfigurationToPanel: ((project: ProjectConfig) => void) | null = null
	exportHistoryBuild: ((previewId: string) => Promise<void>) | null = null
	clearPreviewHistory: ((projectId: string) => Promise<void>) | null = null
	
	// PC-only state
	private previousDownloadServer: 'global' | 'east' = 'global'
	
	// View management state
	private viewInitialized: boolean = false
	
	// Dynamic module references for PC-only features
	private ThemeSelectionModalClass?: typeof ThemeSelectionModal
	private ProjectManagementModalClass?: typeof ProjectManagementModal
	private themeApiService?: typeof import("./theme/themeApiService").themeApiService

	async onload() {
		this.pluginDir = `${this.manifest.dir}`;
		await this.loadSettings();
		
		// Initialize core services (always needed)
		await this.initCore();
		
		// Platform-specific initialization
		if (Platform.isDesktop) {
			// Initialize absolute workspace path (PC-only)
			const adapter = this.app.vault.adapter;
			if (adapter instanceof FileSystemAdapter) {
				const basePath = adapter.getBasePath();
				this.absWorkspacePath = `${basePath}/${this.pluginDir}/workspace`;
			}

			await this.initDesktopFeatures();
		} else {
			await this.initMobileFeatures();
		}
		
		// Initialize Sync Service (common for both platforms)
		setTimeout(() => {
			void this.initializeSyncService();
		}, 0);
		
		// Register sync commands (common for both platforms)
		this.registerSyncCommands();

		this.statusBar = this.addStatusBarItem();
		this.addSettingTab(new FridaySettingTab(this.app, this));
	}

	/**
	 * Initialize core services (common for all platforms)
	 */
	private async initCore(): Promise<void> {
		this.apiUrl = GetBaseUrl(this.settings);
		
		// Initialize i18n service first
		this.i18n = new I18nService(this);
		await this.i18n.init();
		
		this.user = new User(this);
		
		// Initialize Hugoverse for license-related API calls (works on both platforms)
		// Note: Some Hugoverse methods are desktop-only, but license activation works on mobile
		const { Hugoverse } = await import('./hugoverse');
		this.hugoverse = new Hugoverse(this);
		
		// Note: License usage is fetched when user opens Settings page (not on startup)
		// This improves plugin startup performance
	}

	/**
	 * Initialize desktop-only features
	 */
	private async initDesktopFeatures(): Promise<void> {
		// Dynamically import PC-only modules
		// Note: Hugoverse is already initialized in initCore for license operations
		const [
			{ default: ServerView },
			{ ThemeSelectionModal },
			{ ProjectManagementModal },
			{ ProjectService },
			{ Site },
			{ NetlifyAPI },
			{ FTPUploader },
			{ themeApiService }
		] = await Promise.all([
			import('./server'),
			import('./theme/modal'),
			import('./projects/modal'),
			import('./projects/service'),
			import('./site'),
			import('./netlify'),
			import('./ftp'),
			import('./theme/themeApiService')
		]);
		
		// Import PC-only styles
		await Promise.all([
			import('./styles/theme-modal.css'),
			import('./styles/publish-settings.css'),
			import('./styles/project-modal.css'),
			import('./styles/live-sync.css')
		]);
		
		// Store dynamic module references
		this.ThemeSelectionModalClass = ThemeSelectionModal;
		this.ProjectManagementModalClass = ProjectManagementModal;
		this.themeApiService = themeApiService;
		
		// Initialize PC-only services (hugoverse already initialized in initCore)
		this.netlify = new NetlifyAPI(this);
		this.site = new Site(this);
		this.projectService = new ProjectService(this);
		await this.projectService.initialize();
		
		// Initialize FTP uploader
		this.initializeFTP();

		// Initialize workspace service (PC-only)
		await this.initializeWorkspace();
		
		// Register view with protection against duplicate registration
		try {
			this.registerView(FRIDAY_SERVER_VIEW_TYPE, leaf => new ServerView(leaf, this));
		} catch (e) {
			console.error('[Friday] View already registered, skipping');
		}
		this.app.workspace.onLayoutReady(() => this.initLeaf());
		
		// Add ribbon icon for project management
		this.addRibbonIcon(FRIDAY_ICON, this.i18n.t('projects.manage_projects'), async () => {
			if (this.applyProjectConfigurationToPanel && this.exportHistoryBuild && this.clearPreviewHistory) {
				this.showProjectManagementModal(
					this.applyProjectConfigurationToPanel,
					this.exportHistoryBuild,
					this.clearPreviewHistory
				);
			}
		});
		
		// Add internet icon to markdown view header
		this.registerEvent(
			this.app.workspace.on('active-leaf-change', (leaf) => {
				if (leaf?.view instanceof MarkdownView) {
					this.addInternetIconToView(leaf.view);
				}
			})
		);
		
		// Also add to currently active view on load
		this.app.workspace.onLayoutReady(() => {
			const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
			if (activeView) {
				this.addInternetIconToView(activeView);
			}
		});
		
		// Register export HTML command (PC-only)
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
		
		// Register context menu for files and folders (PC-only)
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

	/**
	 * Initialize workspace and Foundry services (PC-only)
	 */
	private async initializeWorkspace(): Promise<void> {
		try {
			// Create workspace service
			this.workspaceService = createObsidianWorkspaceService();
			
			// Get relative workspace path for Obsidian adapter
			const relativeWorkspacePath = `${this.pluginDir}/workspace`;
			
			// Ensure workspace directory exists using Obsidian's adapter
			if (!await this.app.vault.adapter.exists(relativeWorkspacePath)) {
				await this.app.vault.adapter.mkdir(relativeWorkspacePath);
				console.log('[Friday] Created workspace directory:', relativeWorkspacePath);
			}
			
			// Check if workspace is already initialized (using absolute path)
			const existsResult = await this.workspaceService.workspaceExists(this.absWorkspacePath);
			
			if (existsResult.success && !existsResult.data) {
				// Workspace doesn't exist, initialize it
				const initResult = await this.workspaceService.initWorkspace(this.absWorkspacePath);
				
				if (initResult.success) {
					console.log('[Friday] Workspace initialized successfully at:', this.absWorkspacePath);
				} else {
					console.error('[Friday] Failed to initialize workspace:', initResult.error);
				}
			} else if (existsResult.success) {
				console.log('[Friday] Workspace already exists at:', this.absWorkspacePath);
			} else {
				console.error('[Friday] Failed to check workspace existence:', existsResult.error);
			}
			
		// Initialize Foundry services
		this.foundryProjectService = createObsidianProjectService();
		this.foundryBuildService = createObsidianBuildService();
		this.foundryGlobalConfigService = createObsidianGlobalConfigService();
		this.foundryProjectConfigService = createObsidianProjectConfigService();
		
		// Create HTTP client for Serve service (with publish support)
		const httpClient = createObsidianHttpClient();
		this.foundryServeService = createObsidianServeService(httpClient);
		this.foundryPublishService = createObsidianPublishService(httpClient);
		
		// Create Identity HTTP client for Auth, License, and Domain services
		const identityHttpClient = createObsidianIdentityHttpClient();
		this.foundryAuthService = createObsidianAuthService(identityHttpClient);
		this.foundryLicenseService = createObsidianLicenseService(identityHttpClient);
		this.foundryDomainService = createObsidianDomainService(identityHttpClient);
		
		// Create License Service Manager
		if (this.foundryLicenseService && this.foundryAuthService && this.foundryGlobalConfigService) {
			this.licenseServiceManager = new LicenseServiceManager(
				this.foundryLicenseService,
				this.foundryAuthService,
				this.foundryGlobalConfigService,
				this.absWorkspacePath
			);
		}
		
	// Create Domain Service Manager
	if (this.foundryDomainService) {
		this.domainServiceManager = new DomainServiceManager(
			this.foundryDomainService,
			this.absWorkspacePath
		);
	}

	// Create Project Service Manager
	if (this.foundryProjectService && this.foundryProjectConfigService) {
		this.projectServiceManager = new ProjectServiceManager(this);
		console.log('[Friday] Project Service Manager initialized');
	}

	// Create License State Manager (unified license state from Foundry)
	if (this.foundryLicenseService && this.foundryAuthService && this.foundryDomainService) {
		this.licenseState = new LicenseStateManager(
			this.foundryLicenseService,
			this.foundryAuthService,
			this.foundryDomainService,
			this.absWorkspacePath
		);
		
		// Initialize license state
		const initResult = await this.licenseState.initialize();
		
		if (initResult.isActivated) {
			console.log('[Friday] License activated:', initResult.licenseKey);
			
			// Sync to settings (for UI display only)
			await this.syncLicenseToSettings();
			
			// If has sync feature, initialize sync service
			if (this.licenseState.hasFeature('syncEnabled')) {
				console.log('[Friday] Sync feature enabled, will initialize sync service');
				// Sync service will be initialized in setTimeout later
			}
		} else {
			console.log('[Friday] No license activated or license check failed');
			if (initResult.error) {
				console.warn('[Friday] License initialization error:', initResult.error);
			}
		}
	}

	// Load enterprise server URL from AuthService config
	if (this.foundryAuthService) {
		try {
			const configResult = await this.foundryAuthService.getConfig(this.absWorkspacePath);
			if (configResult.success && configResult.data) {
				// Only load to settings if local setting is empty (local settings have priority)
				if (!this.settings.enterpriseServerUrl && configResult.data.apiUrl) {
					this.settings.enterpriseServerUrl = configResult.data.apiUrl;
					console.log('[Friday] Loaded enterprise server URL from Foundry:', configResult.data.apiUrl);
				}
			}
		} catch (error) {
			console.error('[Friday] Error loading enterprise server URL from Foundry:', error);
		}
	}

	console.log('[Friday] Foundry services initialized successfully');

		// Load settings from Foundry Global Config (merge with local settings)
		await this.loadSettingsFromFoundryGlobalConfig();
		} catch (error) {
			console.error('[Friday] Error initializing workspace:', error);
		}
	}

	/**
	 * Initialize mobile-only features
	 */
	private async initMobileFeatures(): Promise<void> {
		// Mobile currently only needs sync functionality
		// which is already handled by initializeSyncService()
		// Additional mobile-specific UI can be added here in the future
	}

	/**
	 * Register sync commands (common for both platforms)
	 */
	private registerSyncCommands(): void {
		this.addCommand({
			id: "sync-pull-from-server",
			name: "Sync: Pull from Server",
			callback: async () => {
				if (!this.settings.syncEnabled) {
					new Notice(this.i18n.t('messages.sync_not_enabled'));
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
					new Notice(this.i18n.t('messages.sync_not_enabled'));
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
					new Notice(this.i18n.t('messages.sync_not_enabled'));
					return;
				}
				if (!this.syncService.isInitialized) {
					await this.syncService.initialize(this.settings.syncConfig);
				}
				await this.syncService.startSync(true);
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
	}

	async openPublishPanel(folder: TFolder | null, file: TFile | null) {
		if (!Platform.isDesktop || !this.site) {
			new Notice(this.i18n.t('messages.publishing_desktop_only'));
			return;
		}
		
		// Check if Foundry services are initialized
		if (!this.foundryProjectService || !this.foundryProjectConfigService) {
			new Notice('Foundry services not initialized');
			return;
		}
		
		const rightSplit = this.app.workspace.rightSplit;
		if (!rightSplit) {
			return;
		}
		if (rightSplit.collapsed) {
			rightSplit.expand();
		}

		// Get project name from folder/file
		const projectName = this.getProjectNameFromSelection(folder, file);
		if (!projectName) {
			new Notice('Unable to determine project name');
			return;
		}

		// Check if project already exists
		const existingProject = await this.getFoundryProject(projectName);
		
		if (existingProject) {
			// Project exists, load its configuration and apply to panel
			await this.applyFoundryProjectToPanel(existingProject, folder, file);
		} else {
			// Project doesn't exist, create it first
			const created = await this.createFoundryProject(projectName, folder, file);
			
			if (created) {
				// After creation, get the project and apply to panel (same flow as existing project)
				const newProject = await this.getFoundryProject(projectName);
				if (newProject) {
					this.isProjectInitializing = true; // Set flag to prevent auto-saving during initialization
					await this.applyFoundryProjectToPanel(newProject, folder, file);
					this.isProjectInitializing = false; // Reset flag after initialization
				} else {
					console.error('[Friday] Failed to retrieve newly created project');
					new Notice('Project created but failed to load');
				}
			}
		}

		// Open or reveal the publish panel using unified method
		await this.activateView();
	}

	/**
	 * Get project name from folder or file selection
	 */
	private getProjectNameFromSelection(folder: TFolder | null, file: TFile | null): string | null {
		if (folder) {
			// Use folder name as project name
			return folder.name;
		} else if (file) {
			// Use file name (without extension) as project name
			return file.basename;
		}
		return null;
	}

	/**
	 * Get Foundry project by name
	 */
	private async getFoundryProject(projectName: string): Promise<ObsidianProjectInfo | null> {
		if (!this.foundryProjectService) {
			return null;
		}

		try {
			const result = await this.foundryProjectService.getProjectInfo(this.absWorkspacePath, projectName);
			if (result.success && result.data) {
				return result.data;
			}
		} catch (error) {
			console.error('[Friday] Error getting project:', error);
		}
		return null;
	}

	/**
	 * Register Site component
	 */
	/**
	 * Register Site.svelte component for direct method calls
	 * Part of new event-driven architecture
	 */
	registerSiteComponent(component: any) {
		this.siteComponent = component;
		console.log('[Friday] Site component registered for new architecture');
	}

	/**
	 * Handle Site component events
	 */
	async handleSiteEvent<T extends SiteEventType>(
		type: T,
		data: SiteEventData[T]
	): Promise<void> {
		console.log('[Friday] Handling site event:', type, data);

		switch (type) {
			case 'initialized':
				await this.onSiteInitialized(data as SiteEventData['initialized']);
				break;

			case 'configChanged':
				await this.onConfigChanged(data as SiteEventData['configChanged']);
				break;

			case 'buildRequested':
				await this.onBuildRequested(data as SiteEventData['buildRequested']);
				break;

			case 'previewRequested':
				await this.onPreviewRequested(data as SiteEventData['previewRequested']);
				break;

			case 'publishRequested':
				await this.onPublishRequested(data as SiteEventData['publishRequested']);
				break;

			case 'testConnection':
				await this.onTestConnection(data as SiteEventData['testConnection']);
				break;

			case 'stopPreview':
				await this.onStopPreview(data as SiteEventData['stopPreview']);
				break;
		}
	}

	// ==================== Event Handlers ====================

	private async onSiteInitialized(data: SiteEventData['initialized']) {
		console.log('[Friday] Site component initialized for project:', data.projectName);
	}

	private async onConfigChanged(data: SiteEventData['configChanged']) {
		if (!this.currentProjectName || !this.projectServiceManager) {
			return;
		}

		// Save configuration to Foundry
		const success = await this.projectServiceManager.saveConfig(
			this.currentProjectName,
			data.key,
			data.value
		);

		if (!success) {
			new Notice(`Failed to save configuration: ${data.key}`);
		}
	}

	private async onBuildRequested(data: SiteEventData['buildRequested']) {
		if (!this.projectServiceManager) {
			return;
		}

		// Create progress callback
		const onProgress = (progress: any) => {
			// Send progress updates to Site component
			this.siteComponent?.updateBuildProgress?.(progress);
		};

		// Execute build
		const result = await this.projectServiceManager.build(
			data.projectName,
			onProgress
		);

		if (result.success) {
			new Notice('Build completed successfully');
			this.siteComponent?.onBuildComplete?.(result);
		} else {
			new Notice(`Build failed: ${result.error}`);
			this.siteComponent?.onBuildError?.(result.error);
		}
	}

	private async onPreviewRequested(data: SiteEventData['previewRequested']) {
		if (!this.projectServiceManager) {
			return;
		}

		const { projectName, port, renderer } = data;

		// Create progress callback
		const onProgress = (progress: any) => {
			// Send progress updates to Site component
			this.siteComponent?.updateBuildProgress?.(progress);
		};

		// Start preview
		const result = await this.projectServiceManager.startPreview(
			projectName,
			{ port, renderer, onProgress }
		);

		if (result.success) {
			new Notice(`Preview started: ${result.url}`);
			this.siteComponent?.onPreviewStarted?.(result);
		} else {
			new Notice(`Preview failed: ${result.error}`);
			this.siteComponent?.onPreviewError?.(result.error);
		}
	}

	private async onPublishRequested(data: SiteEventData['publishRequested']) {
		if (!this.projectServiceManager) {
			return;
		}

		const { projectName, method, config } = data;

		// Create progress callback
		const onProgress = (progress: any) => {
			// Send progress updates to Site component
			this.siteComponent?.updatePublishProgress?.(progress);
		};

		// Execute publish
		const result = await this.projectServiceManager.publish(
			projectName,
			{ method, config, onProgress }
		);

		if (result.success) {
			new Notice(`Published successfully: ${result.url}`);
			this.siteComponent?.onPublishComplete?.(result);
		} else {
			new Notice(`Publish failed: ${result.error}`);
			this.siteComponent?.onPublishError?.(result.error);
		}
	}

	private async onTestConnection(data: SiteEventData['testConnection']) {
		if (!this.projectServiceManager) {
			return;
		}

		const result = await this.projectServiceManager.testConnection(
			data.projectName,
			data.config
		);

		if (result.success) {
			new Notice('Connection test successful');
			this.siteComponent?.onConnectionTestSuccess?.(result.message);
		} else {
			new Notice(`Connection test failed: ${result.error}`);
			this.siteComponent?.onConnectionTestError?.(result.error);
		}
	}

	private async onStopPreview(data: SiteEventData['stopPreview']) {
		if (!this.projectServiceManager) {
			return;
		}

		const success = await this.projectServiceManager.stopPreview(data.projectName);

		if (success) {
			this.siteComponent?.onPreviewStopped?.();
		}
	}

	// ==================== Project Management ====================

	/**
	 * Create new Foundry project (simplified - only creates project)
	 */
	private async createFoundryProject(projectName: string, folder: TFolder | null, file: TFile | null): Promise<boolean> {
		if (!this.projectServiceManager) {
			console.error('[Friday] ProjectServiceManager not available');
			new Notice('Project service not available');
			return false;
		}

		try {
			console.log('[Friday] Creating new project:', projectName);

			// Collect initial configuration with project context
			const initialConfig = this.collectInitialConfig(projectName, folder, file);

			// Create project through ProjectServiceManager
			const result = await this.projectServiceManager.createProject({
				name: projectName,
				folder,
				file,
				initialConfig
			});

			if (!result.success) {
				throw new Error(result.error);
			}

			console.log('[Friday] Project created successfully:', projectName);
			new Notice(`Project "${projectName}" created successfully`);
			
			return true;

		} catch (error) {
			console.error('[Friday] Error creating project:', error);
			new Notice(`Error creating project: ${error}`);
			return false;
		}
	}

	/**
	 * Collect initial configuration for new project
	 * Prepares complete configuration including baseURL, title, theme, etc.
	 * 
	 * @param projectName - Project name
	 * @param folder - Selected folder (if folder project)
	 * @param file - Selected file (if file project)
	 * @returns Complete initial configuration
	 */
	private collectInitialConfig(projectName: string, folder: TFolder | null, file: TFile | null): Record<string, any> {
		const publishMethod = normalizePublishMethod(this.settings.publishMethod);
		
		// Determine if this is a folder project
		const isFolder = folder !== null;
		
		// Get default theme based on project type
		const defaultTheme = getDefaultTheme(isFolder);
		
		// Calculate baseURL
		let baseURL = '/';
		if (publishMethod === 'mdf-share') {
			const userDir = this.settings.licenseUser?.userDir || '';
			if (userDir) {
				const previewId = generateRandomId();
				baseURL = `/s/${userDir}/${previewId}`;
			}
		}
		
		// Check if user has publish permission (affects branding)
		const hasPublishPermission = this.licenseState?.hasPublishPermission() || false;
		
		// Build complete configuration
		const config: Record<string, any> = {
			// Basic settings
			baseURL,
			title: projectName,
			contentDir: 'content',
			publishDir: 'public',
			defaultContentLanguage: 'en',
			
			// Taxonomies (default Hugo taxonomies)
			taxonomies: {
				tag: 'tags',
				category: 'categories'
			},
			
			// Theme configuration
			module: {
				imports: [
					{
						path: defaultTheme.downloadUrl
					}
				]
			},
			
			// Markdown renderer settings
			markdown: {
				useInternalRenderer: shouldUseInternalRenderer(defaultTheme.tags)
			},
			
			// Site parameters
			params: {
				branding: !hasPublishPermission  // Show branding if no publish permission
				// password can be added later by user through UI
			},
			
			// Publish configuration
			publish: {
				method: publishMethod
			}
		};
		
		// Apply default FTP configuration if available
		if (this.settings.ftpServer || this.settings.ftpUsername) {
			config.publish.ftp = {
				host: this.settings.ftpServer || '',
				username: this.settings.ftpUsername || '',
				password: this.settings.ftpPassword || '',
				remotePath: this.settings.ftpRemoteDir || '/',
			};
		}

		// Apply default Netlify configuration if available
		if (this.settings.netlifyAccessToken || this.settings.netlifyProjectId) {
			config.publish.netlify = {
				accessToken: this.settings.netlifyAccessToken || '',
				siteId: this.settings.netlifyProjectId || '',
			};
		}

		return config;
	}

	/**
	 * Apply existing Foundry project configuration to panel
	 * Uses new architecture: Main.ts as Controller, Site.svelte as View
	 */
	private async applyFoundryProjectToPanel(project: ObsidianProjectInfo, folder: TFolder | null, file: TFile | null) {
		if (!this.foundryProjectConfigService) {
			return;
		}

		try {
			console.log('[Friday] Applying project to panel:', project.name);
			
			// Step 1: Set current project name FIRST before any operations
			this.currentProjectName = project.name;
			
			// Step 2: Initialize content selection (site.ts data management)
			this.site.initializeContent(folder, file);
			
			// Step 3: Get complete project configuration from Foundry
			if (!this.projectServiceManager) {
				console.error('[Friday] ProjectServiceManager not available');
				return;
			}
			
			const config = await this.projectServiceManager.getConfig(project.name);
			
			// Step 4: Prepare complete ProjectState
			const projectState: ProjectState = {
				name: project.name,
				folder,
				file,
				config,
				status: 'active'
			};
			
			// Step 5: Call Site.svelte's initialize method (NEW ARCHITECTURE)
			if (this.siteComponent?.initialize) {
				await this.siteComponent.initialize(projectState);
				console.log('[Friday] Project configuration applied to UI via new architecture');
			} else {
				console.error('[Friday] Site component not registered - cannot apply configuration');
			}
			
			new Notice(`Loaded project: ${project.name}`);
			
		} catch (error) {
			console.error('[Friday] Error applying project to panel:', error);
			// Fallback: at least initialize content
			this.site.initializeContent(folder, file);
		}
	}

	/**
	 * 为新创建的项目应用初始配置
	 * 收集所有初始配置，一次性写入（不包括动态 sitePath，由 UI reactive 处理）
	 */
	/**
	 * Save project configuration from panel settings
	 * Call this method when user modifies settings in the panel
	 * 
	 * Note: Skips saving during project initialization to prevent write conflicts
	 */
	async saveFoundryProjectConfig(projectName: string, configKey: string, configValue: any) {
		if (!this.foundryProjectConfigService) {
			console.error('[Friday] Project config service not initialized');
			return;
		}

		// Skip saving during project initialization
		if (this.isProjectInitializing) {
			console.log('[Friday] Skipping save during project initialization');
			return;
		}

		try {
			const result = await this.foundryProjectConfigService.set(
				this.absWorkspacePath,
				projectName,
				configKey,
				configValue
			);

			if (result.success) {
				console.log(`[Friday] Saved config: ${configKey} = ${configValue}`);
			} else {
				console.error('[Friday] Failed to save config:', result.error);
			}
		} catch (error) {
			console.error('[Friday] Error saving project config:', error);
		}
	}

	/**
	 * Start preview server using Foundry serve service
	 */
	async startFoundryPreviewServer(
		projectName?: string, 
		port: number = 8080,
		markdownRenderer?: any,
		onProgress?: (progress: { phase: string; percentage: number; message: string }) => void
	) {
		if (!this.foundryServeService) {
			new Notice('Serve service not initialized');
			return null;
		}

		// Use provided project name or current project name
		const targetProjectName = projectName || this.currentProjectName;
		if (!targetProjectName) {
			new Notice('No project selected');
			return null;
		}

		try {
			// Check if server is already running
			if (this.foundryServeService.isRunning()) {
				const confirmRestart = confirm('Preview server is already running. Restart it?');
				if (!confirmRestart) {
					return null;
				}
				await this.foundryServeService.stopServer();
			}

			new Notice(`Starting preview server for: ${targetProjectName}...`);
			
			const serverOptions: any = {
				workspacePath: this.absWorkspacePath,
				projectName: targetProjectName,
				port: port,
				host: 'localhost',
				livereload: true,
				livereloadPort: 35729,
			};
			
			// Add custom markdown renderer if provided
			if (markdownRenderer) {
				serverOptions.markdown = markdownRenderer;
				console.log('[Friday] Using custom Markdown renderer');
			}
			
			const result = await this.foundryServeService.startServer(
				serverOptions,
				(progress) => {
					console.log(`[Friday] Preview: ${progress.phase} - ${progress.percentage}%`);
					console.log(`[Friday] ${progress.message}`);
					
					// Call user-provided progress callback
					if (onProgress) {
						onProgress(progress);
					}
				}
			);

			if (result.success && result.data) {
				new Notice(`Preview server started at: ${result.data.url}`);
				console.log('[Friday] Preview server:', {
					url: result.data.url,
					port: result.data.port,
				});
				
				// Open preview URL in default browser
				window.open(result.data.url, '_blank');
				
				return result.data.url;
			} else {
				new Notice(`Failed to start preview server: ${result.error}`);
				console.error('[Friday] Serve error:', result.error);
			}
		} catch (error) {
			console.error('[Friday] Error starting preview server:', error);
			new Notice(`Preview server error: ${error}`);
		}
		return null;
	}

	/**
	 * Stop preview server
	 */
	async stopFoundryPreviewServer() {
		if (!this.foundryServeService) {
			return;
		}

		try {
			if (!this.foundryServeService.isRunning()) {
				new Notice('Preview server is not running');
				return;
			}

			const stopped = await this.foundryServeService.stopServer();
			if (stopped) {
				new Notice('Preview server stopped');
				console.log('[Friday] Preview server stopped');
			}
		} catch (error) {
			console.error('[Friday] Error stopping preview server:', error);
			new Notice(`Error stopping server: ${error}`);
		}
	}

	/**
	 * Sync multiple config values at once
	 * 
	 * @deprecated 使用 setAllProjectConfig 替代（避免并发写入竞争）
	 * 保留此方法仅用于向后兼容
	 */
	async syncFoundryProjectConfig(projectName: string, configMap: Record<string, any>) {
		if (!this.foundryProjectConfigService) {
			console.error('[Friday] Project config service not initialized');
			return;
		}

		try {
			const promises = Object.entries(configMap).map(([key, value]) =>
				this.foundryProjectConfigService!.set(
					this.absWorkspacePath,
					projectName,
					key,
					value
				)
			);

			const results = await Promise.all(promises);
			const failed = results.filter(r => !r.success);

			if (failed.length === 0) {
				console.log('[Friday] All configs saved successfully');
			} else {
				console.error('[Friday] Some configs failed to save:', failed);
			}
		} catch (error) {
			console.error('[Friday] Error syncing project config:', error);
		}
	}

	/**
	 * Get Foundry project config as a map
	 */
	async getFoundryProjectConfigMap(projectName: string): Promise<Record<string, any>> {
		if (!this.foundryProjectConfigService) {
			return {};
		}

		try {
			const result = await this.foundryProjectConfigService.list(
				this.absWorkspacePath,
				projectName
			);

			if (result.success && result.data) {
				return result.data.config || {};
			}
		} catch (error) {
			console.error('[Friday] Error getting project config:', error);
		}
		return {};
	}


	async setSiteAssets(folder: TFolder) {
		if (!Platform.isDesktop || !this.site) {
			new Notice(this.i18n.t('messages.site_assets_desktop_only'));
			return;
		}
		
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

			// Use unified method to activate view
			await this.activateView();
		}
	}

	showThemeSelectionModal(selectedTheme: string, onSelect: (themeUrl: string, themeName?: string, themeId?: string) => void, isForSingleFile: boolean = false) {
		if (!Platform.isDesktop || !this.ThemeSelectionModalClass) {
			new Notice(this.i18n.t('messages.theme_selection_desktop_only'));
			return;
		}
		const modal = new this.ThemeSelectionModalClass(this.app, selectedTheme, onSelect, this, isForSingleFile);
		modal.open();
	}

	showProjectManagementModal(
		onApply: (project: ProjectConfig) => void, 
		onExport: (previewId: string) => Promise<void>,
		onClearHistory: (projectId: string) => Promise<void>
	) {
		if (!Platform.isDesktop || !this.ProjectManagementModalClass || !this.projectService) {
			new Notice(this.i18n.t('messages.project_management_desktop_only'));
			return;
		}
		const modal = new this.ProjectManagementModalClass(this.app, this, this.projectService, onApply, onExport, onClearHistory);
		modal.open();
	}

	/**
	 * Add internet icon to markdown view header (left of the book icon)
	 * Clicking this icon will automatically:
	 * 1. Open publish panel with current file
	 * 2. Set sitePath to "/s" for MDFriday Share
	 * 3. Generate preview
	 * 4. Select MDFriday Share publish option
	 */
	private addInternetIconToView(view: MarkdownView) {
		const viewActionsEl = view.containerEl.querySelector('.view-actions');
		if (!viewActionsEl) return;

		// Remove existing icon if present (ensures click handler is updated)
		const existingIcon = viewActionsEl.querySelector('.friday-internet-icon');
		if (existingIcon) {
			existingIcon.remove();
		}

		// Create the internet icon button
		const iconEl = document.createElement('a');
		iconEl.className = 'clickable-icon view-action friday-internet-icon';
		iconEl.setAttribute('aria-label', this.i18n.t('menu.quick_share'));
		setIcon(iconEl, 'globe');

		// Add click handler for quick share
		iconEl.addEventListener('click', async (e) => {
			e.preventDefault();
			await this.quickShareCurrentFile(view);
		});

		// Insert at the beginning of view-actions (left side)
		viewActionsEl.insertBefore(iconEl, viewActionsEl.firstChild);
	}

	/**
	 * Quick share current file - automated workflow (Desktop only)
	 * 1. Open publish panel with current file
	 * 2. Set sitePath to "/s"
	 * 3. Generate preview
	 * 4. Select MDFriday Share publish option
	 */
	private async quickShareCurrentFile(view: MarkdownView) {
		if (!Platform.isDesktop) {
			new Notice(this.i18n.t('messages.quick_share_desktop_only'));
			return;
		}
		
		const file = view.file;
		if (!file || file.extension !== 'md') {
			new Notice(this.i18n.t('messages.no_markdown_file'), 3000);
			return;
		}

		// Check if license is activated
		if (!this.settings.license || !this.settings.licenseUser?.userDir) {
			new Notice(this.i18n.t('messages.license_required_for_share'), 5000);
			return;
		}

		try {
			// Show starting notice
			new Notice(this.i18n.t('messages.quick_share_starting'), 2000);

			// Step 1: Open publish panel with current file (simulates right-click -> publish)
			await this.openPublishPanel(null, file);

			// Wait a bit for the panel to initialize
			await new Promise(resolve => setTimeout(resolve, 500));

			// Step 2: Select MDFriday Share publish option first
			if (this.siteComponent?.selectMDFShare) {
				this.siteComponent.selectMDFShare();
			} else {
				console.error('[Friday] Site component not available for selectMDFShare');
				new Notice('Site component not ready', 3000);
				return;
			}

			// Step 3: Set sitePath to "/s/{userDir}" for MDFriday Share (previewId will be added in startPreview)
			if (this.siteComponent?.setSitePath && this.settings.licenseUser?.userDir) {
				this.siteComponent.setSitePath(`/s/${this.settings.licenseUser.userDir}`);
			}

			// Wait a bit for sitePath to be set
			await new Promise(resolve => setTimeout(resolve, 100));

			// Step 4: Generate preview
			if (this.siteComponent?.startPreviewAndWait) {
				const previewSuccess = await this.siteComponent.startPreviewAndWait();
				if (!previewSuccess) {
					new Notice(this.i18n.t('messages.preview_failed_generic'), 5000);
					return;
				}
			}

			// Show completion notice
			new Notice(this.i18n.t('messages.quick_share_ready'), 3000);

		} catch (error) {
			console.error('Quick share failed:', error);
			new Notice(this.i18n.t('messages.quick_share_failed', { error: (error as Error).message }), 5000);
		}
	}


	// ==================== View Management Methods ====================
	// These methods manage the Friday Service view lifecycle and ensure only one instance exists
	
	/**
	 * Initialize the Friday Service view on plugin load
	 * Called automatically during desktop features initialization
	 * Only creates the view once per plugin load session
	 */
	initLeaf(): void {
		// Only initialize once per plugin load
		if (this.viewInitialized) {
			return;
		}
		
		this.activateView();
		this.viewInitialized = true;
	}

	/**
	 * Unified method to activate/reveal Friday Service view
	 * This should be used by all features that need to show the panel
	 * 
	 * Behavior:
	 * - If view exists: reveals the first instance
	 * - If no view exists: creates a new one in the right sidebar
	 * 
	 * @returns Promise that resolves when view is activated
	 */
	async activateView(): Promise<void> {
		const leaves = this.app.workspace.getLeavesOfType(FRIDAY_SERVER_VIEW_TYPE);
		
		// If view exists, reveal the first one
		if (leaves.length > 0) {
			await this.app.workspace.revealLeaf(leaves[0]);
			return;
		}
		
		// Create new view if none exists
		const leaf = this.app.workspace.getRightLeaf(false);
		if (leaf) {
			await leaf.setViewState({
				type: FRIDAY_SERVER_VIEW_TYPE,
				active: true,
			});
		}
	}

	/**
	 * Check if Friday Service view is currently open
	 * @returns true if at least one view instance exists
	 */
	isViewOpen(): boolean {
		return this.app.workspace.getLeavesOfType(FRIDAY_SERVER_VIEW_TYPE).length > 0;
	}

	/**
	 * Get all Friday Service view leaves
	 * Useful for advanced view management
	 * @returns Array of WorkspaceLeaf instances
	 */
	getViewLeaves() {
		return this.app.workspace.getLeavesOfType(FRIDAY_SERVER_VIEW_TYPE);
	}

	async onunload() {
		// Clean up Friday Service views
		this.app.workspace.detachLeavesOfType(FRIDAY_SERVER_VIEW_TYPE);
		
		// Reset view initialization state
		this.viewInitialized = false;
		
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
		
		// Initialize default ignore patterns based on selectiveSync settings
		this.initializeDefaultIgnorePatterns();
	}
	
	/**
	 * Initialize default sync settings
	 * This ensures selectiveSync and internal patterns are properly set even if user never opened settings
	 */
	private initializeDefaultIgnorePatterns(): void {
		// Initialize selectiveSync with defaults if not exists
		if (!this.settings.syncConfig.selectiveSync) {
			this.settings.syncConfig.selectiveSync = {
				syncImages: false,
				syncAudio: false,
				syncVideo: false,
				syncPdf: false,
				syncThemes: false,
				syncSnippets: false,
				syncPlugins: false,
			};
		}
		
		// Initialize ignorePatterns as empty array if not set (user-defined patterns only)
		if (!this.settings.syncConfig.ignorePatterns) {
			this.settings.syncConfig.ignorePatterns = [];
		}
		
		// Build internal ignore patterns for .obsidian folder
		const selectiveSync = this.settings.syncConfig.selectiveSync;
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
		
		if (!(selectiveSync.syncThemes ?? true)) {
			internalPatterns.push("\\.obsidian\\/themes");
		}
		if (!(selectiveSync.syncSnippets ?? true)) {
			internalPatterns.push("\\.obsidian\\/snippets");
		}
		if (!(selectiveSync.syncPlugins ?? true)) {
			internalPatterns.push("\\.obsidian\\/plugins");
		}
		
		// Update internal patterns if not set
		if (!this.settings.syncConfig.syncInternalFilesIgnorePatterns) {
			this.settings.syncConfig.syncInternalFilesIgnorePatterns = internalPatterns.join(", ");
		}
	}

	/**
	 * Refresh license usage information from API
	 */
	async refreshLicenseUsage() {
		// Check if license service is available
		if (!this.licenseServiceManager) {
			return;
		}

		const { license } = this.settings;
		
		// Only fetch usage if license is active and not expired
		if (!license || isLicenseExpired(license.expiresAt)) {
			return;
		}

		try {
			const result = await this.licenseServiceManager.getLicenseUsage();
			
			if (result.success && result.data) {
				const usage = result.data;
				
				// Store disk usage information
				if (usage.disk) {
					this.settings.licenseUsage = {
						totalDiskUsage: usage.disk.totalUsage || 0,
						maxStorage: usage.disk.maxStorage || 1024,
						unit: usage.disk.unit || 'MB',
						lastUpdated: Date.now()
					};
					
					await this.saveData(this.settings);
				}
			}
		} catch (error) {
			console.warn('[Friday] Failed to fetch license usage:', error);
			// Don't throw error - usage is not critical for plugin functionality
		}
	}

	/**
	 * Get effective subdomain (custom or default from userDir)
	 */
	getEffectiveSubdomain(): string {
		return this.settings.customSubdomain ?? this.settings.licenseUser?.userDir ?? '';
	}

	/**
	 * Refresh subdomain information from API
	 * Called when user clicks refresh in settings
	 */
	async refreshSubdomainInfo(): Promise<void> {
		// Check if domain service is available
		if (!this.domainServiceManager) {
			return;
		}

		const { license } = this.settings;
		
		// Only fetch if license is active and not expired
		if (!license || isLicenseExpired(license.expiresAt)) {
			return;
		}

		try {
			const result = await this.domainServiceManager.getDomainInfo();
			if (result.success && result.data) {
				const domainInfo = result.data;
				let updated = false;
				
				if (domainInfo.subdomain) {
					// Only update customSubdomain if it differs from the default (userDir)
					// This handles the case where user's subdomain was changed from another device
					if (domainInfo.subdomain !== this.settings.licenseUser?.userDir) {
						this.settings.customSubdomain = domainInfo.subdomain;
						updated = true;
					}
				}
				
				if (domainInfo.customDomain) {
					this.settings.customDomain = domainInfo.customDomain;
					updated = true;
				}

				if (updated) {
					await this.saveData(this.settings);
				}
			}
		} catch (error) {
			console.warn('[Friday] Failed to refresh subdomain info:', error);
		}
	}

	async saveSettings() {
		// Check if download server changed
		const downloadServerChanged = this.previousDownloadServer !== this.settings.downloadServer;
		
		// Check if enterprise server URL changed
		const newApiUrl = GetBaseUrl(this.settings);
		if (this.apiUrl !== newApiUrl) {
			this.apiUrl = newApiUrl;
			
			// Reinitialize Hugoverse with new URL
			if (this.hugoverse) {
				const { Hugoverse } = await import('./hugoverse');
				this.hugoverse = new Hugoverse(this);
			}
		}
		
		// Save to Obsidian's local storage
		await this.saveData(this.settings);
		
		// Save to Foundry Global Config (desktop only)
		if (Platform.isDesktop && this.foundryGlobalConfigService && this.absWorkspacePath) {
			await this.saveSettingsToFoundryGlobalConfig();
		}
		
		// Clear theme cache if download server changed (desktop only)
		if (downloadServerChanged && Platform.isDesktop && this.themeApiService) {
			this.themeApiService.clearCache();
			this.previousDownloadServer = this.settings.downloadServer;
		}
		
		// Reinitialize FTP uploader when settings change (desktop only)
		if (Platform.isDesktop) {
			this.initializeFTP();
		}
	}
	
	/**
	 * Save settings to Foundry Global Config
	 * This allows Foundry services to access publish configurations
	 */
	/**
	 * Save settings to Foundry Global Config
	 * 
	 * Data Storage Rules:
	 * ✅ Global Config: Only stores DEFAULT publishing configurations
	 *    - FTP settings (host, username, password, remotePath, ignoreCert)
	 *    - Netlify settings (accessToken, siteId)
	 *    - MDFriday publish settings (managed by LicenseServiceManager)
	 *    - Publish method (ftp/netlify/mdfriday)
	 *    - Download server preference
	 * 
	 * ❌ NOT stored in Global Config:
	 *    - Domain settings (use DomainService)
	 *    - Auth config (use AuthService)
	 *    - License data (use LicenseService)
	 * 
	 * Data Flow:
	 * - Foundry Services (Auth, License, Domain) = Single Source of Truth
	 * - Global Config = Default publish settings for new projects
	 * - Obsidian Settings = UI display cache only
	 */
	private async saveSettingsToFoundryGlobalConfig() {
		if (!this.foundryGlobalConfigService || !this.absWorkspacePath) {
			return;
		}
		
		try {
			const config = this.foundryGlobalConfigService;
			const workspace = this.absWorkspacePath;
			
			console.log('[Friday] Saving default publish settings to Global Config...');
			
			// ========================================
			// FTP Publish Settings (Default)
			// ========================================
			if (this.settings.ftpServer) {
				await config.set(workspace, 'publish.ftp.host', this.settings.ftpServer);
			}
			if (this.settings.ftpUsername) {
				await config.set(workspace, 'publish.ftp.username', this.settings.ftpUsername);
			}
			if (this.settings.ftpPassword) {
				await config.set(workspace, 'publish.ftp.password', this.settings.ftpPassword);
			}
			if (this.settings.ftpRemoteDir) {
				await config.set(workspace, 'publish.ftp.remotePath', this.settings.ftpRemoteDir);
			}
			await config.set(workspace, 'publish.ftp.ignoreCert', this.settings.ftpIgnoreCert);
			
			// ========================================
			// Netlify Publish Settings (Default)
			// ========================================
			if (this.settings.netlifyAccessToken) {
				await config.set(workspace, 'publish.netlify.accessToken', this.settings.netlifyAccessToken);
			}
			if (this.settings.netlifyProjectId) {
				await config.set(workspace, 'publish.netlify.siteId', this.settings.netlifyProjectId);
			}
			
			// ========================================
			// General Publish Settings
			// ========================================
			await config.set(workspace, 'site.downloadServer', this.settings.downloadServer);
			await config.set(workspace, 'publish.method', this.settings.publishMethod);
			
			// ========================================
			// NOTE: The following are NOT saved here anymore:
			// ========================================
			// ❌ Domain settings (customDomain, customSubdomain)
			//    → Use DomainService.getDomainInfo() / updateSubdomain() / addCustomDomain()
			//    → Read from: licenseState.getSubdomain() / getCustomDomain()
			//
			// ❌ Auth configuration (enterpriseServerUrl)
			//    → Use AuthService.getConfig() / updateConfig()
			//    → Managed by AuthService in workspace/.mdfriday/user-data.json
			//
			// ❌ License data (license, licenseUser, licenseSync)
			//    → Use LicenseService.getLicenseInfo() / activateLicense()
			//    → Read from: licenseState (unified license state manager)
			//
			// ❌ MDFriday publish license key
			//    → Managed by LicenseServiceManager.saveLicenseKeyToConfig()
			//    → Automatically saved during license activation
			
			console.log('[Friday] Default publish settings saved to Global Config');
		} catch (error) {
			console.error('[Friday] Error saving settings to Global Config:', error);
			// Don't throw error - this is not critical, settings are already saved to Obsidian storage
		}
	}
	
	/**
	 * Sync license state from Foundry to Obsidian settings
	 * (Settings are used for UI display only, not for logic decisions)
	 */
	async syncLicenseToSettings(): Promise<void> {
		if (!this.licenseState) {
			return;
		}
		
		try {
			const licenseInfo = this.licenseState.getLicenseInfo();
			const authStatus = this.licenseState.getAuthStatus();
			
			// Update license data (for UI display)
			if (licenseInfo) {
				this.settings.license = {
					key: this.licenseState.getLicenseKey() || '',
					plan: licenseInfo.plan,
					expiresAt: licenseInfo.expiresAt || 0,
					features: licenseInfo.features,
					activatedAt: Date.now()
				};
				console.log('[Friday] Synced license to settings:', {
					plan: licenseInfo.plan,
					expiresAt: licenseInfo.expiresAt
				});
			}
			
			// Update user data (for UI display)
			if (authStatus?.email) {
				this.settings.licenseUser = {
					email: authStatus.email,
					userDir: this.licenseState.getUserDir() || ''
				};
				console.log('[Friday] Synced user to settings:', authStatus.email);
			}
			
			// Update sync config data (for UI display)
			// Sync config comes from authService.getStatus() in Foundry 26.3.16+
			if (this.licenseState.hasSyncConfig()) {
				const syncConfig = this.licenseState.getSyncConfig();
				if (syncConfig) {
					this.settings.licenseSync = {
						enabled: true,
						endpoint: syncConfig.dbEndpoint,
						dbName: syncConfig.dbName,
						email: syncConfig.email,
						dbPassword: syncConfig.dbPassword || '' // Password might not be included in getStatus
					};
					console.log('[Friday] Synced sync config to settings:', {
						dbName: syncConfig.dbName,
						email: syncConfig.email,
						userDir: syncConfig.userDir,
						isActive: syncConfig.isActive
					});
				}
			}
			
			// Note: We don't call saveSettings() here because this is just in-memory cache
			// The real data source is always Foundry
			
		} catch (error) {
			console.error('[Friday] Error syncing license to settings:', error);
		}
	}

	/**
	 * Load settings from Foundry Global Config
	 * 
	 * Data Loading Rules:
	 * ✅ Load from Global Config: Only DEFAULT publishing configurations
	 *    - FTP settings (as default for new projects)
	 *    - Netlify settings (as default for new projects)
	 *    - Publish method preference
	 *    - Download server preference
	 * 
	 * ❌ NOT loaded from Global Config anymore:
	 *    - Domain settings → Use licenseState.getSubdomain() / getCustomDomain()
	 *    - Auth config → Loaded by AuthService during initialization
	 *    - License data → Loaded by licenseState.initialize()
	 * 
	 * Priority: Local Obsidian settings > Global Config (for publish settings)
	 */
	private async loadSettingsFromFoundryGlobalConfig() {
		if (!this.foundryGlobalConfigService || !this.absWorkspacePath) {
			return;
		}
		
		try {
			const config = this.foundryGlobalConfigService;
			const workspace = this.absWorkspacePath;
			
			// Get all global config
			const listResult = await config.list(workspace);
			
			if (!listResult.success || !listResult.data?.config) {
				console.log('[Friday] No Foundry Global Config found, using local settings');
				return;
			}
			
			const foundryConfig = listResult.data.config;
			console.log('[Friday] Loading default publish settings from Global Config');

			if (!this.settings.publishMethod) {
				this.settings.publishMethod = foundryConfig['publish']?.method || 'mdf-app';
			}
			
			// ========================================
			// Load FTP Settings (only if local setting is empty)
			// ========================================
			if (!this.settings.ftpServer && foundryConfig['publish']?.ftp?.host) {
				this.settings.ftpServer = foundryConfig['publish'].ftp.host;
			}
			if (!this.settings.ftpUsername && foundryConfig['publish']?.ftp?.username) {
				this.settings.ftpUsername = foundryConfig['publish'].ftp.username;
			}
			if (!this.settings.ftpPassword && foundryConfig['publish']?.ftp?.password) {
				this.settings.ftpPassword = foundryConfig['publish'].ftp.password;
			}
			if (!this.settings.ftpRemoteDir && foundryConfig['publish']?.ftp?.remotePath) {
				this.settings.ftpRemoteDir = foundryConfig['publish'].ftp.remotePath;
			}
			if (foundryConfig['publish']?.ftp?.ignoreCert !== undefined) {
				this.settings.ftpIgnoreCert = foundryConfig['publish'].ftp.ignoreCert;
			}
			
			// ========================================
			// Load Netlify Settings (only if local setting is empty)
			// ========================================
			if (!this.settings.netlifyAccessToken && foundryConfig['publish']?.netlify?.accessToken) {
				this.settings.netlifyAccessToken = foundryConfig['publish'].netlify.accessToken;
			}
			if (!this.settings.netlifyProjectId && foundryConfig['publish']?.netlify?.siteId) {
				this.settings.netlifyProjectId = foundryConfig['publish'].netlify.siteId;
			}
			
			// ========================================
			// NOTE: The following are NOT loaded here anymore:
			// ========================================
			// ❌ Domain settings (customDomain, customSubdomain)
			//    → Read from: licenseState.getSubdomain() / getCustomDomain()
			//    → DomainService is the single source of truth
			//
			// ❌ Auth configuration (enterpriseServerUrl)
			//    → Loaded by: AuthService during initialization
			//    → Already available via authService.getConfig()
			//
			// ❌ License data (license, licenseUser)
			//    → Loaded by: licenseState.initialize() during plugin initialization
			//    → LicenseState is the single source of truth
			//    → Data is synced to settings by syncLicenseToSettings() for UI display only
			
			console.log('[Friday] Default publish settings loaded from Global Config');
		} catch (error) {
			console.error('[Friday] Error loading settings from Global Config:', error);
			// Don't throw error - we can still use local settings
		}
	}

	/**
	 * Initialize FTP uploader with current settings (desktop only)
	 */
	async initializeFTP(preferredSecure?: boolean) {
		if (!Platform.isDesktop) {
			return;
		}
		
		const { ftpServer, ftpUsername, ftpPassword, ftpRemoteDir, ftpIgnoreCert } = this.settings;
		
		if (ftpServer && ftpUsername && ftpPassword) {
			// Dynamically import FTPUploader if not already loaded
			const { FTPUploader } = await import('./ftp');
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
	 * 
	 * Network monitoring will be started based on the scenario:
	 * - First-time upload/download: Started after successful operation
	 * - Normal scenarios: Started automatically during initialization
	 */
	async initializeSyncService() {
		try {
			// Clean up existing status display before creating new one
			if (this.syncStatusDisplay) {
				this.syncStatusDisplay.onunload();
				this.syncStatusDisplay = null;
			}
			
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
					
					// ✨ Connect status display to core for progress tracking
					this.syncService.syncCore.setStatusDisplay(this.syncStatusDisplay);
					
					// Connect log callback to status display
					// All logs are displayed in logMessage area, only NOTICE shows popup
					this.syncService.syncCore.setLogCallback((message, level, key) => {
						this.syncStatusDisplay?.addLog(message, level, key);
					});
					
					// Start LiveSync (continuous replication) by default
					if (this.settings.syncConfig.syncOnStart) {
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
	 * Clear sync database (IndexedDB) and related localStorage data to start fresh
	 * This is useful when switching to a new vault or re-downloading from cloud
	 */
	async clearSyncDatabase(): Promise<void> {
		try {
			// Get vault name (e.g., "ob-d12")
			// @ts-ignore - accessing internal Obsidian API
			const vaultName = this.app.vault.getName() || "friday-vault";
			
			// Construct the database name following livesync's pattern:
			// vaultName + "-livesync-v2"
			// Then PouchDB idb adapter adds "_pouch_" prefix
			// Final IndexedDB name: "_pouch_" + vaultName + "-livesync-v2"
			// Example: "_pouch_ob-d12-livesync-v2"
			const SuffixDatabaseName = "-livesync-v2";
			const indexedDBName = `_pouch_${vaultName}${SuffixDatabaseName}`;

			// Step 1: Clear localStorage items with "friday-kv-" prefix
			// These contain sync-related data like PBKDF2 salt cache
			this.clearSyncLocalStorage();

			// Step 2: Delete the IndexedDB database
			return new Promise((resolve, reject) => {
				const deleteRequest = indexedDB.deleteDatabase(indexedDBName);
				
				deleteRequest.onsuccess = () => {
					resolve();
				};
				
				deleteRequest.onerror = (event) => {
					console.error(`[Friday] Error deleting IndexedDB: ${indexedDBName}`, event);
					reject(new Error(`Failed to delete database: ${indexedDBName}`));
				};
				
				deleteRequest.onblocked = () => {
					console.warn(`[Friday] Delete blocked for IndexedDB: ${indexedDBName}`);
					// Try to resolve anyway as the next initialization will handle it
					resolve();
				};
			});
		} catch (error) {
			console.error('[Friday] Error in clearSyncDatabase:', error);
			throw error;
		}
	}

	/**
	 * Clear sync-related localStorage items
	 * This removes cached encryption data like PBKDF2 salt
	 */
	private clearSyncLocalStorage(): void {
		try {
			const keysToRemove: string[] = [];
			
			// Find all keys with sync-related prefixes:
			// - "friday-kv-" for general key-value storage
			// - "friday-friday-sync-salt-" for salt storage (from openSimpleStore with kind="friday-sync-salt")
			for (let i = 0; i < localStorage.length; i++) {
				const key = localStorage.key(i);
				if (key && (key.startsWith('friday-kv-') || key.startsWith('friday-friday-sync-salt-'))) {
					keysToRemove.push(key);
				}
			}
			
			// Remove found keys
			keysToRemove.forEach(key => {
				localStorage.removeItem(key);
			});
			
		} catch (error) {
			console.warn('[Friday] Error clearing sync localStorage:', error);
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
	 * Test FTP connection (Desktop only)
	 */
	async testFTPConnection(): Promise<{ success: boolean; message: string }> {
		if (!Platform.isDesktop) {
			return {
				success: false,
				message: 'FTP is only available on desktop'
			};
		}
		
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
		const {publishMethod, netlifyAccessToken, netlifyProjectId, ftpServer, ftpUsername, ftpPassword, ftpRemoteDir, ftpIgnoreCert, license, licenseUser, customSubdomain, userToken} = this.plugin.settings;

		// Publish Settings Section
		containerEl.createEl("h2", {text: this.plugin.i18n.t('settings.publish_settings')});
		
	// Create containers for dynamic content
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
				.addOption('mdf-share', this.plugin.i18n.t('settings.publish_method_mdfriday_share'))
				.addOption('mdf-app', this.plugin.i18n.t('settings.publish_method_mdfriday'))
				.addOption('mdf-custom', this.plugin.i18n.t('settings.publish_method_mdfriday_custom'))
				.addOption('mdf-enterprise', this.plugin.i18n.t('settings.publish_method_mdfriday_enterprise'))
				.addOption('netlify', this.plugin.i18n.t('settings.publish_method_netlify'))
				.addOption('ftp', this.plugin.i18n.t('settings.publish_method_ftp'))
				.setValue(publishMethod || 'mdf-share')
				.onChange(async (value) => {
					this.plugin.settings.publishMethod = value as 'mdf-share' | 'mdf-app' | 'mdf-custom' | 'mdf-enterprise' | 'netlify' | 'ftp';
					await this.plugin.saveSettings();
					showPublishSettings(value as 'mdf-share' | 'mdf-app' | 'mdf-custom' | 'mdf-enterprise' | 'netlify' | 'ftp');
				});
		});

	// Create containers for different publish methods
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
	const showPublishSettings = (method: 'mdfriday' | 'netlify' | 'ftp' | 'mdf-share' | 'mdf-app' | 'mdf-custom' | 'mdf-enterprise') => {
		const isMdfridayShare = method === 'mdf-share';
		const isMdfriday = method === 'mdfriday' || method === 'mdf-app';
		const isMdfridayCustom = method === 'mdf-custom';
		const isMdfridayEnterprise = method === 'mdf-enterprise';
		mdfridayShareContainer.style.display = isMdfridayShare ? 'block' : 'none';
		mdfridaySettingsContainer.style.display = isMdfriday ? 'block' : 'none';
		mdfridayCustomDomainContainer.style.display = isMdfridayCustom ? 'block' : 'none';
		mdfridayEnterpriseContainer.style.display = isMdfridayEnterprise ? 'block' : 'none';
		netlifySettingsContainer.style.display = method === 'netlify' ? 'block' : 'none';
		ftpSettingsContainer.style.display = method === 'ftp' ? 'block' : 'none';
	};

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

			// Create subdomain setting - description shows full domain
			const subdomainSetting = new Setting(mdfridaySettingsContainer)
				.setName(this.plugin.i18n.t('settings.subdomain_desc'))
				.setDesc(currentSubdomain ? `${currentSubdomain}.mdfriday.com` : '');

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
					subdomainSetting.setDesc(inputSubdomain ? `${inputSubdomain}.mdfriday.com` : '');
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
							subdomainSetting.setDesc(`${currentSubdomain}.mdfriday.com`);
							
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
							const result = await this.plugin.hugoverse?.checkCustomDomain(
								userToken, license.key, inputDomain
							);

							if (result && result.dns_valid && result.ready) {
								checkStatus = 'success';
								statusMessage = result.message || this.plugin.i18n.t('settings.domain_check_success');
							} else {
								checkStatus = 'error';
								statusMessage = result?.message || this.plugin.i18n.t('settings.domain_check_failed');
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
							const result = await this.plugin.hugoverse?.addCustomDomain(
								userToken, license.key, inputDomain
							);

							if (result && result.domain) {
								currentDomain = result.domain;
								domainSetting.setDesc(currentDomain);
								
								// Save custom domain to settings
								this.plugin.settings.customDomain = result.domain;
								await this.plugin.saveSettings();
								
								checkStatus = null;
								httpsStatus = result.status === 'active' ? 'active' : 'pending';
								statusMessage = result.message || this.plugin.i18n.t('settings.domain_saved');
								
								new Notice(this.plugin.i18n.t('settings.domain_saved'));
							} else {
								statusMessage = this.plugin.i18n.t('settings.domain_save_failed');
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
							const result = await this.plugin.hugoverse?.checkCustomDomainHttpsStatus(
								userToken, license.key, currentDomain
							);

							if (result) {
								if (result.status === 'active' && result.tls_ready) {
									httpsStatus = 'active';
									statusMessage = result.message || this.plugin.i18n.t('settings.domain_https_ready');
								} else if (result.status === 'cert_pending') {
									httpsStatus = 'pending';
									statusMessage = result.message || this.plugin.i18n.t('settings.domain_https_pending');
								} else {
									httpsStatus = 'error';
									statusMessage = result.message || this.plugin.i18n.t('settings.domain_https_error');
								}
							} else {
								httpsStatus = 'error';
								statusMessage = this.plugin.i18n.t('settings.domain_https_check_failed');
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
								
								const result = await this.plugin.licenseServiceManager.requestTrial(email);
								
								if (result.success && result.data?.key) {
									// Success - fill the license key in the input above
									inputEl.value = result.data.key;
									
									// Show success message
									trialStatusEl.setText(this.plugin.i18n.t('settings.trial_request_success'));
									trialStatusEl.addClass('friday-license-success');
									
									// Also show a notice
									new Notice(this.plugin.i18n.t('settings.trial_request_success'));
									
									// Clear the email field
									trialEmailEl.value = '';
									
									// Refresh display to show activated license
									this.display();
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

