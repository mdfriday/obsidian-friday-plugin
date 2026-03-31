import {App, Modal, Plugin, TFolder, TFile, Notice, MarkdownView, setIcon, Platform, FileSystemAdapter} from 'obsidian';
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
import {FridaySettingTab} from "./setting";
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
import type {Site} from "./site";
import type {ThemeSelectionModal} from "./theme/modal";
import type {FoundryProjectManagementModal} from "./projects/foundryModal";
import type ServerView from './server';
import {nameToId} from "src/utils/hash.ts";

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
	vaultBasePath: string
	apiUrl: string
	
	// Core services (always available)
	user: User
	i18n: I18nService
	syncService: SyncService
	syncStatusDisplay: SyncStatusDisplay | null = null
	
	// PC-only services (optional, only loaded on desktop)
	hugoverse?: Hugoverse
	site?: Site
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
	
	// PC-only state
	private previousDownloadServer: 'global' | 'east' = 'global'
	
	// View management state
	private viewInitialized: boolean = false
	
	// Dynamic module references for PC-only features
	private ThemeSelectionModalClass?: typeof ThemeSelectionModal
	private FoundryProjectManagementModalClass?: typeof FoundryProjectManagementModal
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
				this.vaultBasePath = basePath;
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
			{ FoundryProjectManagementModal },
			{ Site },
			{ themeApiService }
		] = await Promise.all([
			import('./server'),
			import('./theme/modal'),
			import('./projects/foundryModal'),
			import('./site'),
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
		this.FoundryProjectManagementModalClass = FoundryProjectManagementModal;
		this.themeApiService = themeApiService;
		
		// Initialize PC-only services (hugoverse already initialized in initCore)
		this.site = new Site(this);

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
			// Use new Foundry-based project management modal
			if (this.FoundryProjectManagementModalClass) {
				const modal = new this.FoundryProjectManagementModalClass(this.app, this);
				modal.open();
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
		
		// Register open project management command (PC-only)
		this.addCommand({
			id: "open-project-management",
			name: this.i18n.t('projects.manage_projects'),
			callback: () => {
				if (this.FoundryProjectManagementModalClass) {
					const modal = new this.FoundryProjectManagementModalClass(this.app, this);
					modal.open();
				}
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
		const previewId = nameToId(projectName);
		if (publishMethod === 'mdf-free') {
			baseURL = `/f/${previewId}`;
		} else if (publishMethod === 'mdf-share') {
			const userDir = this.settings.licenseUser?.userDir || '';
			if (userDir) {
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

	async status(text: string) {
		this.statusBar.setText(text)
	}

	isValidLicenseKeyFormat(licenseKey: string): boolean {
		return isValidLicenseKeyFormat(licenseKey);
	}
}
