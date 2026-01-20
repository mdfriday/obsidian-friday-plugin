import {App, Modal, Plugin, PluginSettingTab, Setting, TFolder, TFile, Notice, MarkdownView, setIcon, Platform} from 'obsidian';
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
	// General Settings
	downloadServer: 'global' | 'east';
	// Publish Settings
	publishMethod: 'mdfriday' | 'netlify' | 'ftp';
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
	licenseUsage: null,
	encryptionPassphrase: '',
	customSubdomain: null,
	// General Settings defaults
	downloadServer: 'global',
	// Publish Settings defaults
	publishMethod: 'mdfriday',
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
export const API_URL_PRO = 'https://app.mdfriday.com';
export function GetBaseUrl(): string {
	return process.env.NODE_ENV === 'development' ? API_URL_DEV : API_URL_PRO;
}

export default class FridayPlugin extends Plugin {
	settings: FridaySettings;
	statusBar: HTMLElement

	pluginDir: string
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
	
	// PC-only callbacks (optional)
	applyProjectConfigurationToPanel: ((project: ProjectConfig) => void) | null = null
	exportHistoryBuild: ((previewId: string) => Promise<void>) | null = null
	clearPreviewHistory: ((projectId: string) => Promise<void>) | null = null
	// Quick share methods for internet icon (PC-only)
	setSitePath: ((path: string) => void) | null = null
	startPreviewAndWait: (() => Promise<boolean>) | null = null
	selectMDFShare: (() => void) | null = null
	refreshLicenseState: (() => void) | null = null
	
	// PC-only state
	private previousDownloadServer: 'global' | 'east' = 'global'
	
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
			await this.initDesktopFeatures();
		} else {
			await this.initMobileFeatures();
		}
		
		// Initialize Sync Service (common for both platforms)
		await this.initializeSyncService();
		
		// Register sync commands (common for both platforms)
		this.registerSyncCommands();

		this.statusBar = this.addStatusBarItem();
		this.addSettingTab(new FridaySettingTab(this.app, this));
	}

	/**
	 * Initialize core services (common for all platforms)
	 */
	private async initCore(): Promise<void> {
		this.apiUrl = process.env.NODE_ENV === 'development' ? API_URL_DEV : API_URL_PRO;
		
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
			import('./styles/project-modal.css')
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
		if (!Platform.isDesktop || !this.site || !this.projectService) {
			new Notice(this.i18n.t('messages.publishing_desktop_only'));
			return;
		}
		
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
	 * (Desktop only)
	 */
	async processStructuredFolder(folder: TFolder) {
		if (!Platform.isDesktop || !this.site) {
			return;
		}
		
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
			if (this.selectMDFShare) {
				this.selectMDFShare();
			}

			// Step 3: Set sitePath to "/s/{userDir}" for MDFriday Share (previewId will be added in startPreview)
			if (this.setSitePath && this.settings.licenseUser?.userDir) {
				this.setSitePath(`/s/${this.settings.licenseUser.userDir}`);
			}

			// Wait a bit for sitePath to be set
			await new Promise(resolve => setTimeout(resolve, 100));

			// Step 4: Generate preview
			if (this.startPreviewAndWait) {
				const previewSuccess = await this.startPreviewAndWait();
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
	 * Automatically re-login with license key if token is expired
	 */
	async refreshLicenseUsage() {
		// Check if dependencies are initialized
		if (!this.user || !this.hugoverse) {
			return;
		}

		const hugoverse = this.hugoverse;
		const { license, userToken } = this.settings;
		
		// Only fetch usage if license is active and not expired
		if (!license || isLicenseExpired(license.expiresAt)) {
			return;
		}

		let currentToken = userToken;

		try {
			// Try to fetch usage with current token
			const usageResponse = await hugoverse.getLicenseUsage(currentToken, license.key);
			if (usageResponse && usageResponse.disks) {
				// Parse disk usage (convert string to number)
				const totalDiskUsage = parseFloat(usageResponse.disks.total_disk_usage) || 0;
				const maxStorage = license.features.max_storage || 1024;
				
				this.settings.licenseUsage = {
					totalDiskUsage,
					maxStorage,
					unit: usageResponse.disks.unit || 'MB',
					lastUpdated: Date.now()
				};
				
				await this.saveData(this.settings);
			}
		} catch (error) {
			// If failed, try to re-login with license key (token might be expired)
			console.error('[Friday] Failed to fetch usage, attempting to refresh token...');
			
			try {
				// Re-login with license key
				const email = licenseKeyToEmail(license.key);
				const password = licenseKeyToPassword(license.key);
				const newToken = await this.user.loginWithCredentials(email, password);
				
				if (newToken) {
					// Retry with new token
					const usageResponse = await hugoverse.getLicenseUsage(newToken, license.key);
					if (usageResponse && usageResponse.disks) {
						const totalDiskUsage = parseFloat(usageResponse.disks.total_disk_usage) || 0;
						const maxStorage = license.features.max_storage || 1024;
						
						this.settings.licenseUsage = {
							totalDiskUsage,
							maxStorage,
							unit: usageResponse.disks.unit || 'MB',
							lastUpdated: Date.now()
						};
						
						await this.saveData(this.settings);
					}
				} else {
					console.warn('[Friday] Failed to refresh token, usage fetch skipped');
				}
			} catch (retryError) {
				console.warn('[Friday] Failed to fetch license usage after token refresh:', retryError);
				// Don't throw error, just log it - usage is not critical for plugin functionality
			}
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
	 * Called when Settings page is displayed (lazy loading)
	 */
	async refreshSubdomainInfo(): Promise<void> {
		// Check if dependencies are initialized
		if (!this.hugoverse) {
			return;
		}

		const { license, userToken } = this.settings;
		
		// Only fetch if license is active and not expired
		if (!license || isLicenseExpired(license.expiresAt)) {
			return;
		}

		try {
			const subdomainInfo = await this.hugoverse.getSubdomain(userToken, license.key);
			if (subdomainInfo && subdomainInfo.subdomain) {
				// Only update customSubdomain if it differs from the default (userDir)
				// This handles the case where user's subdomain was changed from another device
				if (subdomainInfo.subdomain !== this.settings.licenseUser?.userDir) {
					this.settings.customSubdomain = subdomainInfo.subdomain;
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
		
		await this.saveData(this.settings);
		
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
	private isRefreshingUsage: boolean = false;
	private isRefreshingSubdomain: boolean = false;
	private lastSubdomainRefresh: number = 0;

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
		
		// Refresh license usage in background when settings page opens
		// Only fetch if last update was more than 5 seconds ago to avoid excessive API calls
		const existingUsage = this.plugin.settings.licenseUsage;
		const usageStale = !existingUsage?.lastUpdated || (Date.now() - existingUsage.lastUpdated > 5000);
		
		if (!this.isRefreshingUsage && license && !isLicenseExpired(license.expiresAt) && usageStale) {
			this.isRefreshingUsage = true;
			this.plugin.refreshLicenseUsage().then(() => {
				// Refresh display to show updated usage data
				this.display();
				this.isRefreshingUsage = false;
			}).catch(() => {
				this.isRefreshingUsage = false;
			});
		}

		// Refresh subdomain info in background when settings page opens
		// Only fetch if last update was more than 5 seconds ago
		const subdomainStale = !this.lastSubdomainRefresh || (Date.now() - this.lastSubdomainRefresh > 5000);
		
		if (!this.isRefreshingSubdomain && license && !isLicenseExpired(license.expiresAt) && subdomainStale) {
			this.isRefreshingSubdomain = true;
			this.plugin.refreshSubdomainInfo().then(() => {
				this.lastSubdomainRefresh = Date.now();
				this.isRefreshingSubdomain = false;
				// Re-render to show updated subdomain
				this.display();
			}).catch(() => {
				this.isRefreshingSubdomain = false;
			});
		}

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
	}

	/**
	 * Render Publish Settings Section (Desktop only)
	 */
	private renderPublishSettings(containerEl: HTMLElement): void {
		const {publishMethod, netlifyAccessToken, netlifyProjectId, ftpServer, ftpUsername, ftpPassword, ftpRemoteDir, ftpIgnoreCert, license, licenseUser, customSubdomain, userToken} = this.plugin.settings;

		// Publish Settings Section
		containerEl.createEl("h2", {text: this.plugin.i18n.t('settings.publish_settings')});
		
		// Create containers for dynamic content
		let mdfridaySettingsContainer: HTMLElement;
		let netlifySettingsContainer: HTMLElement;
		let ftpSettingsContainer: HTMLElement;
		
		// Publish Method Dropdown
		new Setting(containerEl)
			.setName(this.plugin.i18n.t('settings.publish_method'))
			.setDesc(this.plugin.i18n.t('settings.publish_method_desc'))
			.addDropdown((dropdown) => {
				dropdown
					.addOption('mdfriday', this.plugin.i18n.t('settings.publish_method_mdfriday'))
					.addOption('netlify', this.plugin.i18n.t('settings.publish_method_netlify'))
					.addOption('ftp', this.plugin.i18n.t('settings.publish_method_ftp'))
					.setValue(publishMethod || 'mdfriday')
					.onChange(async (value) => {
						this.plugin.settings.publishMethod = value as 'mdfriday' | 'netlify' | 'ftp';
						await this.plugin.saveSettings();
						showPublishSettings(value as 'mdfriday' | 'netlify' | 'ftp');
					});
			});

		// Create containers for different publish methods
		mdfridaySettingsContainer = containerEl.createDiv('mdfriday-settings-container');
		netlifySettingsContainer = containerEl.createDiv('netlify-settings-container');
		ftpSettingsContainer = containerEl.createDiv('ftp-settings-container');

		// Function to show/hide publish settings based on selected method
		const showPublishSettings = (method: 'mdfriday' | 'netlify' | 'ftp') => {
			mdfridaySettingsContainer.style.display = method === 'mdfriday' ? 'block' : 'none';
			netlifySettingsContainer.style.display = method === 'netlify' ? 'block' : 'none';
			ftpSettingsContainer.style.display = method === 'ftp' ? 'block' : 'none';
		};

		// =========================================
		// MDFriday App Settings
		// =========================================
		mdfridaySettingsContainer.createEl("h3", {text: this.plugin.i18n.t('settings.mdfriday_app')});
		
		// Only show subdomain settings if license is active
		if (license && !isLicenseExpired(license.expiresAt)) {
			// Get effective subdomain: customSubdomain (if set) or default userDir
			const effectiveSubdomain = customSubdomain ?? licenseUser?.userDir ?? '';
			
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
							const result = await this.plugin.hugoverse?.checkSubdomainAvailability(
								userToken, license.key, inputSubdomain
							);

							if (result) {
								availabilityStatus = result.available ? 'available' : 'unavailable';
								statusMessage = result.available 
									? this.plugin.i18n.t('settings.subdomain_available')
									: this.plugin.i18n.t('settings.subdomain_unavailable');
							} else {
								availabilityStatus = 'error';
								statusMessage = this.plugin.i18n.t('settings.subdomain_check_failed');
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
							const result = await this.plugin.hugoverse?.updateSubdomain(
								userToken, license.key, inputSubdomain
							);

							if (result && result.new_subdomain) {
								currentSubdomain = result.new_subdomain;
								inputSubdomain = currentSubdomain;
								subdomainInput.value = currentSubdomain;
								subdomainSetting.setDesc(`${currentSubdomain}.mdfriday.com`);
								
								// Save custom subdomain to settings
								this.plugin.settings.customSubdomain = result.new_subdomain;
								await this.plugin.saveSettings();
								
								availabilityStatus = null;
								statusMessage = '';
								
								new Notice(this.plugin.i18n.t('settings.subdomain_updated'));
							} else {
								availabilityStatus = 'error';
								statusMessage = this.plugin.i18n.t('settings.subdomain_update_failed', { error: 'Unknown error' });
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
		showPublishSettings(publishMethod || 'mdfriday');
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

			// Row 2: Storage Usage
			const usage = this.plugin.settings.licenseUsage;
			const usedStorage = usage?.totalDiskUsage || 0;
			const maxStorage = license.features.max_storage || 1024;
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

			// Add status element
			statusEl = licenseSetting.descEl.createSpan({cls: 'friday-license-status-text'});
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
			const inputs = patternsListContainer.querySelectorAll('input[type="text"]');
			inputs.forEach((input: HTMLInputElement) => {
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
						resetButton.textContent = this.plugin.i18n.t('settings.sync_uploading');
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
			const { license, userToken } = this.plugin.settings;
			if (!license) {
				throw new Error('No license found');
			}

			// Step 1: Call backend API to reset cloud data
			await this.plugin.hugoverse.resetUsage(userToken, license.key);

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

		// Step 8: Generate encryption passphrase if not exists (only for first time)
		// For non-first-time activation, user needs to manually input the passphrase
		if (!this.plugin.settings.encryptionPassphrase && response.first_time) {
			this.plugin.settings.encryptionPassphrase = generateEncryptionPassphrase();
			// Set in sync config too
			this.plugin.settings.syncConfig.passphrase = this.plugin.settings.encryptionPassphrase;
		}

		// Step 9: Save all settings
		await this.plugin.saveSettings();

		// Step 10: Fetch license usage information
		await this.plugin.refreshLicenseUsage();

		// Step 11: Set first time flag
		this.firstTimeSync = response.first_time;

		// Step 12: Initialize sync service only for first-time activation
		// For non-first-time, user needs to input passphrase first, then manually download
		if (this.plugin.settings.syncEnabled && response.first_time) {
			await this.plugin.initializeSyncService();
		}

		// Step 13: Refresh license state in Site panel (if open)
		if (this.plugin.refreshLicenseState) {
			this.plugin.refreshLicenseState();
		}
	}
}

