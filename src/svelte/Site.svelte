<script lang="ts">
	import {App, Notice, TFolder, TFile, FileSystemAdapter, requestUrl} from "obsidian";
	import FridayPlugin from "../main";
	import ProgressBar from "./ProgressBar.svelte";
	import {onMount, onDestroy, tick} from "svelte";
	import type { ValidPublishMethod } from "../types/publish";
	import { normalizePublishMethod, VALID_PUBLISH_METHODS, DEFAULT_PUBLISH_METHOD } from "../types/publish";
	import * as path from "path";
	import * as fs from "fs";
	import JSZip from "jszip";
	import {GetBaseUrl} from "../main";
	import {createStyleRenderer, OBStyleRenderer} from "../markdown";
	import {themeApiService} from "../theme/themeApiService";
	import type { ProjectState, ProgressUpdate } from "../types/events";
	import {nameToId} from "src/utils/hash.ts";

	// Receive props
	export let app: App;
	export let plugin: FridayPlugin;
	
	// 获取 site 实例
	$: site = plugin.site;
	$: languageContents = site ? site.languageContents : null;
	$: siteAssets = site ? site.siteAssets : null;
	
	// Reactive translation function
	$: t = plugin.i18n?.t || ((key: string) => key);

	const BOOK_THEME_URL = "https://gohugo.net/book-ob.zip?version=1.1"
	const BOOK_THEME_ID = "3"
	const BOOK_THEME_NAME = "Obsidian Book"
	const NOTE_THEME_URL = "https://gohugo.net/note.zip?version=1.2"
	const NOTE_THEME_ID = "2"
	const NOTE_THEME_NAME = "Note";

	const isWindows = process.platform === 'win32';
	const FRIDAY_ROOT_FOLDER = 'MDFriday';

	// State variables
	let basePath = plugin.pluginDir;
	let absSelectedFolderPath = [];
	let absProjContentPath = [];
	let contentPath = '';
	
	// 从 site 实例获取响应式数据
	$: currentContents = $languageContents || [];
	$: currentAssets = $siteAssets || null;
	$: isForSingleFile = site ? site.isForSingleFile() : false;
	$: defaultContentLanguage = site ? site.getDefaultContentLanguage() : 'en';

	let projectName = '';

	// 用户可编辑的站点名称
	let siteName = '';
	
	// 跟踪之前的内容长度，用于检测首次添加内容
	let previousContentLength = 0;
	
	// 其他配置保持在本地管理
	let sitePath = '/';
	let selectedThemeDownloadUrl = BOOK_THEME_URL;
	let selectedThemeName = BOOK_THEME_NAME;
	let selectedThemeId = BOOK_THEME_ID;
	
	// 标志用户是否手动选择过主题
	let userHasSelectedTheme = false;
	
	// 响应式主题设置 - 只在用户未手动选择主题时根据内容类型自动设置
	$: {
		if (currentContents.length > 0 && !userHasSelectedTheme) {
			const firstContent = currentContents[0];
			if (firstContent.file && !selectedThemeDownloadUrl.includes('note')) {
				// 单文件 - 设置为 Note 主题
				selectedThemeDownloadUrl = NOTE_THEME_URL;
				selectedThemeName = NOTE_THEME_NAME;
				selectedThemeId = NOTE_THEME_ID;
			} else if (firstContent.folder && !selectedThemeDownloadUrl.includes('book')) {
				// 文件夹 - 设置为 Book 主题
				selectedThemeDownloadUrl = BOOK_THEME_URL;
				selectedThemeName = BOOK_THEME_NAME;
				selectedThemeId = BOOK_THEME_ID;
			}
		}
	}

	// Advanced settings state
	let showAdvancedSettings = false;
	let googleAnalyticsId = '';
	let disqusShortname = '';
	let sitePassword = '';
	
	// UI state for new layout
	let autoPublishEnabled = false;
	let showSettingsPanel = false; // Settings panel collapsed by default
	let showAdvancedInSettings = false; // Advanced settings in settings panel collapsed

	let themesDir = ''; // Directory for themes

	// Preview related state
	let isBuilding = false;
	let buildProgress = 0;
	let previewUrl = '';
	let previewId = '';
	let hasPreview = false;
	let absPreviewDir = '';

	// Publish related state
	let isPublishing = false;
	let publishProgress = 0;
	let publishSuccess = false;
	let publishUrl = '';
	let selectedPublishOption: ValidPublishMethod = normalizePublishMethod(plugin.settings.publishMethod);
	
	// Netlify configuration (project-specific)
	let netlifyAccessToken = '';
	let netlifyProjectId = '';
	
	// FTP configuration (project-specific)
	let ftpServer = '';
	let ftpUsername = '';
	let ftpPassword = '';
	let ftpRemoteDir = '';
	let ftpIgnoreCert = true;
	let ftpPreferredSecure: boolean | undefined = undefined; // Remember last successful connection type
	
	// FTP test connection state
	let ftpTestState: 'idle' | 'testing' | 'success' | 'error' = 'idle';
	let ftpTestMessage = '';

	// Export related state
	let isExporting = false;
	
	// Sample download related state
	let isDownloadingSample = false;
	let sampleDownloadProgress = 0;
	let currentThemeWithSample: any = null;

	let hasOBTag = false;
	
	// Debounce timeout for auto-saving language configuration
	let languageConfigSaveTimeout: ReturnType<typeof setTimeout> | null = null;
	// Prevent infinite loop when saving language configuration
	let isSavingLanguageConfig: boolean = false;
	// Track last saved configuration to avoid unnecessary saves
	let lastSavedLanguageConfig: string = '';
	
	// License state - directly use plugin.licenseState methods in UI
	let publishOptions: Array<{ value: string; label: string }> = [];

	// Reactive block to update publish options
	$: {
		// Update publish options - always show all 7 options
		publishOptions = [
			{ value: 'netlify', label: t('ui.publish_option_netlify') },
			{ value: 'ftp', label: t('ui.publish_option_ftp') },
			{ value: 'mdf-free', label: t('ui.publish_option_mdfriday_free') },
			{ value: 'mdf-share', label: t('ui.publish_option_mdfriday_share') },
			{ value: 'mdf-app', label: t('ui.publish_option_mdfriday_app') },
			{ value: 'mdf-custom', label: t('ui.publish_option_mdfriday_custom') },
			{ value: 'mdf-enterprise', label: t('ui.publish_option_mdfriday_enterprise') },
		];
	}

	// Helper function to check if current publish option has required permission
	function hasCurrentPublishPermission(): boolean {
		const licenseState = plugin.licenseState;
		
		// mdf-free, netlify, and ftp don't require license
		if (selectedPublishOption === 'mdf-free' || selectedPublishOption === 'netlify' || selectedPublishOption === 'ftp') {
			return true;
		}
		
		// Other options require valid license
		if (!licenseState || !licenseState.isActivated() || licenseState.isExpired()) {
			return false;
		}
		
		switch (selectedPublishOption) {
			case 'mdf-share':
				return licenseState.hasPublishPermission();
			case 'mdf-app':
				return licenseState.hasFeature('customSubDomain');
			case 'mdf-custom':
				return licenseState.hasFeature('customDomain');
			case 'mdf-enterprise':
				return licenseState.getPlan() === 'enterprise' && !!plugin.settings.enterpriseServerUrl;
			default:
				return false;
		}
	}

	// Check if publish button should be disabled
	$: isPublishDisabled = !hasCurrentPublishPermission();

	/**
	 * Apply language configuration from Foundry config to UI
	 */
	async function applyLanguageConfiguration(
		languages: Record<string, any>, 
		defaultLang: string,
		skipSave: boolean = false
	) {
		try {
			// Wait for current contents to be available
			await tick();

			if (currentContents.length === 0) {
				console.log('[Site] No contents to apply language configuration');
				return;
			}

			// Build a mapping from contentDir to languageCode
			const contentDirToLang: Record<string, string> = {};
			for (const [langCode, langConfig] of Object.entries(languages)) {
				contentDirToLang[langConfig.contentDir] = langCode;
			}

			// The first content should use the default language
			// content -> defaultContentLanguage
			// content.zh -> zh
			// content.en -> en

			// Apply language to each content based on their index
			currentContents.forEach((content, index) => {
				let expectedLangCode: string;

				if (index === 0) {
					// First content uses default language
					expectedLangCode = defaultLang;
				} else {
					// Try to find language from contentDir mapping
					// This is tricky because we don't have contentDir in currentContents yet
					// So we need to iterate through languages to find non-default one
					const otherLangs = Object.keys(languages).filter(lang => lang !== defaultLang);
					if (otherLangs.length > index - 1) {
						expectedLangCode = otherLangs[index - 1];
					} else {
						// Fallback: keep current language
						expectedLangCode = content.languageCode;
					}
				}
				
				// Update language code if different
				if (content.languageCode !== expectedLangCode) {
					console.log(`[Site] Updating content ${index} language: ${content.languageCode} -> ${expectedLangCode}`);
					site.updateLanguageCode(content.id, expectedLangCode);
				}
			});
			
			// Wait for updates to complete
			await tick();
			
			console.log('[Site] Language configuration applied to UI');
			
			// Save if not skipped
			if (!skipSave) {
				console.log('[Site] Saving language configuration after apply');
			}
		} catch (error) {
			console.error('[Site] Error applying language configuration:', error);
		}
	}
	
	/**
	 * Save single config value to Foundry
	 * Skips during project initialization
	 */
	/**
	 * Save single config value to Foundry
	 * Uses event system to notify Main.ts
	 */
	async function saveFoundryConfig(key: string, value: any) {
		if (!plugin.currentProjectName) {
			return;
		}
		
		// Skip saving during project initialization
		if (plugin.isProjectInitializing) {
			console.log('[Site] Skipping save during initialization');
			return;
		}
		
		try {
			// Handle complex nested structures
			let actualKey = key;
			let actualValue = value;
			
			if (key === 'module.imports.0.path') {
				// Save module.imports as an array
				actualKey = 'module';
				actualValue = {
					imports: [{ path: value }]
				};
			} else if (key === 'services.googleAnalytics.id') {
				// Save services as a nested object
				actualKey = 'services';
				actualValue = {
					googleAnalytics: { id: value }
				};
			} else if (key === 'params.disqusShortname' || key === 'params.password') {
				// For params, we need to merge with existing params
				const existingConfig = await plugin.getFoundryProjectConfigMap(plugin.currentProjectName);
				const params = existingConfig['params'] || {};
				
				if (key === 'params.disqusShortname') {
					params.disqusShortname = value;
				} else if (key === 'params.password') {
					params.password = value;
				}
				
				actualKey = 'params';
				actualValue = params;
			}
			
			// Notify Main.ts to save configuration
			if (plugin.handleSiteEvent) {
				await plugin.handleSiteEvent('configChanged', {
					key: actualKey,
					value: actualValue
				});
			}
			
			console.log(`[Site] Saved config: ${key} = ${value}`);
		} catch (error) {
			console.error('[Site] Error saving config:', error);
		}
	}

	/**
	 * Initialize component with project state
	 * Called by Main.ts after project creation or when loading existing project
	 */
	export async function initialize(state: ProjectState) {
		console.log('[Site] Initializing with project state:', state.name);
		projectName = state.name;

		// Load configuration to UI
		if (state.config) {
			// 1. Load basic information
			if (state.config.title) {
				siteName = state.config.title;
			}
			if (state.config.baseURL) {
				sitePath = state.config.baseURL;
			}

			// 2. Load theme configuration
			if (state.config.module?.imports?.[0]?.path) {
				const themeUrl = state.config.module.imports[0].path;
				selectedThemeDownloadUrl = themeUrl;
				userHasSelectedTheme = true;
				
				// Find theme by download URL to get complete theme info
				try {
					const allThemes = await themeApiService.getAllThemes(plugin);
					const matchedTheme = allThemes.find(theme => theme.download_url === themeUrl);
					
					if (matchedTheme) {
						selectedThemeId = matchedTheme.id;
						selectedThemeName = matchedTheme.title || matchedTheme.name;
						console.log('[Site] Loaded theme:', selectedThemeName, 'ID:', selectedThemeId);
					} else {
						// Fallback: determine from URL
						if (themeUrl.includes('book')) {
							selectedThemeName = BOOK_THEME_NAME;
							selectedThemeId = BOOK_THEME_ID;
					} else if (themeUrl.includes('note')) {
						selectedThemeName = NOTE_THEME_NAME;
						selectedThemeId = NOTE_THEME_ID;
					} else if (themeUrl.includes('quartz')) {
						selectedThemeName = 'Quartz';
						selectedThemeId = "17";
					}
						console.warn('[Site] Theme not found by URL, used fallback:', themeUrl);
					}
				} catch (error) {
					console.error('[Site] Error finding theme by URL:', error);
				}
			}

			// 3. Load publish configuration
			if (state.config.publish) {
				// Load publish method
				if (state.config.publish.method) {
					selectedPublishOption = normalizePublishMethod(state.config.publish.method);
				}
				
				// Load FTP configuration
				if (state.config.publish.ftp) {
					ftpServer = state.config.publish.ftp.host || '';
					ftpUsername = state.config.publish.ftp.username || '';
					ftpPassword = state.config.publish.ftp.password || '';
					ftpRemoteDir = state.config.publish.ftp.remotePath || '';
					
					// Load secure preference (new API)
					if (state.config.publish.ftp.secure !== undefined) {
						ftpPreferredSecure = state.config.publish.ftp.secure;
					}
					
					// Backward compatibility: also check old ignoreCert field
					if (state.config.publish.ftp.ignoreCert !== undefined) {
						ftpIgnoreCert = state.config.publish.ftp.ignoreCert;
					}
				}

				// Load Netlify configuration
				if (state.config.publish.netlify) {
					netlifyAccessToken = state.config.publish.netlify.accessToken || '';
					netlifyProjectId = state.config.publish.netlify.siteId || '';
				}
			}

			// 4. Load advanced settings
			if (state.config.services?.googleAnalytics?.id) {
				googleAnalyticsId = state.config.services.googleAnalytics.id;
			}
			if (state.config.params?.disqusShortname) {
				disqusShortname = state.config.params.disqusShortname;
			}
			if (state.config.params?.password) {
				sitePassword = state.config.params.password;
			}

			// 5. Load language configuration
			if (state.config.languages && state.config.defaultContentLanguage) {
				console.log('[Site] Loading language configuration:', state.config.languages);
				console.log('[Site] Default content language:', state.config.defaultContentLanguage);
				
				// Apply language configuration (with initializing flag to prevent saves)
				await applyLanguageConfiguration(
					state.config.languages,
					state.config.defaultContentLanguage,
					true // isInitializing = true
				);
			}

			console.log('[Site] Project configuration loaded to UI');
		}

		// Notify Main.ts that initialization is complete
		if (plugin.handleSiteEvent) {
			await plugin.handleSiteEvent('initialized', {
				projectName: state.name
			});
		}
	}

	/**
	 * Update build progress
	 */
	export function updateBuildProgress(progress: ProgressUpdate) {
		if (progress.phase === 'initializing') {
			buildProgress = Math.min(10, progress.percentage * 0.1);
		} else if (progress.phase === 'building') {
			buildProgress = 10 + Math.min(80, progress.percentage * 0.8);
		} else if (progress.phase === 'ready') {
			buildProgress = 100;
		}
	}

	/**
	 * Update publish progress
	 */
	export function updatePublishProgress(progress: ProgressUpdate) {
		if (progress.phase === 'building') {
			publishProgress = Math.min(50, progress.percentage * 0.5);
		} else if (progress.phase === 'publishing') {
			publishProgress = 50 + Math.min(50, progress.percentage * 0.5);
		} else if (progress.phase === 'ready') {
			publishProgress = 100;
		}
	}

	/**
	 * Build complete callback
	 */
	export function onBuildComplete(result: any) {
		buildProgress = 100;
		isBuilding = false;
		console.log('[Site] Build completed:', result);
	}

	/**
	 * Build error callback
	 */
	export function onBuildError(error: string) {
		buildProgress = 0;
		isBuilding = false;
		console.error('[Site] Build error:', error);
	}

	/**
	 * Preview started callback
	 */
	export function onPreviewStarted(result: any) {
		serverRunning = true;
		hasPreview = true;
		buildProgress = 100;
		isBuilding = false;
		previewUrl = result.url || '';
		absPreviewDir = result.path || ''; // Set preview directory path
		console.log('[Site] Preview started:', result.url, 'Path:', result.path);
	}

	/**
	 * Preview error callback
	 */
	export function onPreviewError(error: string) {
		serverRunning = false;
		hasPreview = false;
		buildProgress = 0;
		isBuilding = false;
		absPreviewDir = ''; // Clear preview directory path on error
		console.error('[Site] Preview error:', error);
	}

	/**
	 * Preview stopped callback
	 */
	export function onPreviewStopped() {
		serverRunning = false;
		hasPreview = false;
		absPreviewDir = ''; // Clear preview directory path when stopped
		console.log('[Site] Preview stopped');
	}

	/**
	 * Extract root domain from hostname
	 * e.g., app.sunwei.xyz -> sunwei.xyz
	 */
	function extractRootDomain(hostname: string): string {
		const parts = hostname.split('.');
		// For standard domains, take last 2 parts
		// For special TLDs like .co.uk, this simple approach might need adjustment
		if (parts.length >= 2) {
			return parts.slice(-2).join('.');
		}
		return hostname;
	}

	/**
	 * Build publish URL based on publish method and result
	 * @param method - Publish method
	 * @param resultUrl - URL returned from publish service (may be full URL or just path)
	 * @returns Full publish URL or empty string
	 */
	function buildPublishUrl(method: ValidPublishMethod, resultUrl: string): string {
		if (!resultUrl) {
			return '';
		}

		switch (method) {
			case 'netlify':
			case 'mdf-free':
			case 'mdf-share':
				// Return full URL as-is
				return resultUrl;

			case 'ftp':
				// FTP doesn't have a URL to display
				return '';

			case 'mdf-app': {
				// result.url is path only, need to build: https://{customSubdomain}.{host}{path}
				const customSubdomain = plugin.settings.customSubdomain;
				if (!customSubdomain) {
					console.warn('[Site] No custom subdomain configured for mdf-app');
					return '';
				}

				// Get host from enterpriseServerUrl or default to mdfriday.com
				let host = 'mdfriday.com';
				if (plugin.settings.enterpriseServerUrl) {
					try {
						const url = new URL(plugin.settings.enterpriseServerUrl);
						// Extract root domain from hostname
						// e.g., app.sunwei.xyz -> sunwei.xyz
						host = extractRootDomain(url.hostname);
					} catch (error) {
						console.error('[Site] Invalid enterpriseServerUrl:', error);
					}
				}

				// Ensure path starts with /
				const path = resultUrl.startsWith('/') ? resultUrl : `/${resultUrl}`;
				return `https://${customSubdomain}.${host}${path}`;
			}

			case 'mdf-custom': {
				// result.url is path only, need to build: https://{customDomain}{path}
				const customDomain = plugin.settings.customDomain;
				if (!customDomain) {
					console.warn('[Site] No custom domain configured for mdf-custom');
					return '';
				}

				// Ensure path starts with /
				const path = resultUrl.startsWith('/') ? resultUrl : `/${resultUrl}`;
				return `https://${customDomain}${path}`;
			}

			case 'mdf-enterprise': {
				// result.url is path only, need to build: https://{enterpriseHost}{path}
				const enterpriseServerUrl = plugin.settings.enterpriseServerUrl;
				if (!enterpriseServerUrl) {
					console.warn('[Site] No enterprise server URL configured for mdf-enterprise');
					return '';
				}

				let host: string;
				try {
					const url = new URL(enterpriseServerUrl);
					host = url.hostname;
				} catch (error) {
					console.error('[Site] Invalid enterpriseServerUrl:', error);
					return '';
				}

				// Ensure path starts with /
				const path = resultUrl.startsWith('/') ? resultUrl : `/${resultUrl}`;
				return `https://${host}${path}`;
			}

			default:
				console.warn('[Site] Unknown publish method:', method);
				return resultUrl;
		}
	}

	/**
	 * Publish complete callback
	 */
	export function onPublishComplete(result: any) {
		publishProgress = 100;
		isPublishing = false;
		publishSuccess = true;

		// Build publish URL based on publish method
		publishUrl = buildPublishUrl(selectedPublishOption, result.url || '');
		
		if (publishUrl) {
			console.log('[Site] Publish completed:', publishUrl);
		} else {
			console.log('[Site] Publish completed (no URL to display)');
		}

		// Reset after a delay
		setTimeout(() => {
			publishSuccess = false;
			publishProgress = 0;
		}, 3000);
	}

	/**
	 * Publish error callback
	 */
	export function onPublishError(error: string) {
		publishProgress = 0;
		isPublishing = false;
		publishSuccess = false;
		console.error('[Site] Publish error:', error);
	}

	/**
	 * Connection test success callback
	 */
	export function onConnectionTestSuccess(message?: string) {
		console.log('[Site] Connection test success:', message);
		new Notice('Connection test successful');
	}

	/**
	 * Connection test error callback
	 */
	export function onConnectionTestError(error: string) {
		console.error('[Site] Connection test error:', error);
		new Notice(`Connection test failed: ${error}`);
	}

	// ==================== End Public Interface Methods ====================

	// HTTP server related
	let serverRunning = false;
	let serverPort = 8090;

	onMount(async () => {
		themesDir = path.join(plugin.pluginDir, 'themes')
		await createThemesDirectory()

		const adapter = app.vault.adapter;
		if (adapter instanceof FileSystemAdapter) {
			basePath = adapter.getBasePath()
		}
		
		// ==================== NEW ARCHITECTURE: Register component ====================
		// Register this component to Main.ts for direct method calls
		if (plugin.registerSiteComponent) {
			plugin.registerSiteComponent({
				// Core lifecycle methods
				initialize,
				
				// Progress and callback methods
				updateBuildProgress,
				updatePublishProgress,
				onBuildComplete,
				onBuildError,
				onPreviewStarted,
				onPreviewError,
				onPreviewStopped,
				onPublishComplete,
				onPublishError,
				onConnectionTestSuccess,
				onConnectionTestError,
				
				// Quick share and utility methods (migrated from old architecture)
				setSitePath: setSitePathExternal,
				startPreviewAndWait,
				selectMDFShare
			});
		}

		// Notify Main.ts that component is ready
		if (plugin.handleSiteEvent && plugin.currentProjectName) {
			await plugin.handleSiteEvent('initialized', {
				projectName: plugin.currentProjectName
			});
		}
	});
	
	// External method to set site path
	function setSitePathExternal(newPath: string) {
		sitePath = newPath;
	}
	
	// Start preview and return a promise that resolves when done
	async function startPreviewAndWait(): Promise<boolean> {
		try {
			await startPreview();
			return hasPreview;
		} catch (error) {
			console.error('Preview failed:', error);
			return false;
		}
	}
	
	// Select MDFriday Share publish option
	function selectMDFShare() {
		selectedPublishOption = 'mdf-share';
	}

	onDestroy(() => {
		// Clean up language config save timeout
		if (languageConfigSaveTimeout) {
			clearTimeout(languageConfigSaveTimeout);
			languageConfigSaveTimeout = null;
		}
		
		// Clean up server
		if (serverRunning) {
			stopPreview();
			serverRunning = false;
		}
	});

	// 支持的语言列表
	const SUPPORTED_LANGUAGES = [
		{
			code: 'en',
			name: 'English',
			direction: 'ltr',
			englishName: 'English'
		},
		{
			code: 'zh',
			name: '中文',
			direction: 'ltr',
			englishName: 'Chinese'
		},
		{
			code: 'es',
			name: 'Español',
			direction: 'ltr',
			englishName: 'Spanish'
		},
		{
			code: 'fr',
			name: 'Français',
			direction: 'ltr',
			englishName: 'French'
		},
		{
			code: 'de',
			name: 'Deutsch',
			direction: 'ltr',
			englishName: 'German'
		},
		{
			code: 'ja',
			name: '日本語',
			direction: 'ltr',
			englishName: 'Japanese'
		},
		{
			code: 'ko',
			name: '한국어',
			direction: 'ltr',
			englishName: 'Korean'
		},
		{
			code: 'pt',
			name: 'Português',
			direction: 'ltr',
			englishName: 'Portuguese'
		}
	];

	// Reactive update: update related state when content changes
	$: contentPath = currentContents.length > 0 
		? (currentContents[0].folder?.name || currentContents[0].file?.name || '') 
		: '';
	
	// 只在首次添加内容时设置站点名称和加载默认发布配置（从0变为有内容）
	$: {
		if (previousContentLength === 0 && currentContents.length > 0 && !siteName) {
			const firstContent = currentContents[0];
			let defaultName = firstContent.folder?.name || firstContent.file?.basename || '';
			
			// If this is a content subfolder, use parent folder name as site name
			if (firstContent.folder) {
				const folderName = firstContent.folder.name.toLowerCase();
				if ((folderName === 'content' || folderName.startsWith('content.')) && firstContent.folder.parent) {
					defaultName = firstContent.folder.parent.name;
				}
			}
			
			siteName = defaultName;
		}
		previousContentLength = currentContents.length;
	}
	
	// 预览状态重置逻辑
	$: if (currentContents.length === 0) {
		hasPreview = false;
		previewUrl = '';
		previewId = '';
		siteName = ''; // 清空内容时也清空站点名称
		userHasSelectedTheme = false; // 重置主题选择标志，允许重新自动选择
		previousContentLength = 0; // 重置内容长度跟踪，允许下次首次添加时设置站点名称
		
		// Reset language config save state
		lastSavedLanguageConfig = '';
		isSavingLanguageConfig = false;
		
		// 清空发布配置
		netlifyAccessToken = '';
		netlifyProjectId = '';
		ftpServer = '';
		ftpUsername = '';
		ftpPassword = '';
		ftpRemoteDir = '';
		ftpIgnoreCert = true;
		ftpPreferredSecure = undefined;
		ftpTestState = 'idle';
		ftpTestMessage = '';
	}

	// 监听语言内容变化，自动保存语言配置
	// 当添加、删除或修改语言内容时触发
	$: {
		if (currentContents.length > 0 
			&& !plugin.isProjectInitializing 
			&& plugin.currentProjectName
			&& !isSavingLanguageConfig) {  // Prevent infinite loop
			
			// Build current configuration string for comparison
			const currentConfig = JSON.stringify({
				languages: currentContents.map(c => ({
					code: c.languageCode,
					contentDir: currentContents.indexOf(c) === 0 ? "content" : `content.${c.languageCode}`,
					weight: c.weight || (currentContents.indexOf(c) + 1)
				})),
				defaultLang: currentContents[0]?.languageCode || 'en'
			});
			
			// Only save if configuration actually changed
			if (currentConfig !== lastSavedLanguageConfig) {
				// Clear previous timeout to debounce rapid changes
				if (languageConfigSaveTimeout) {
					clearTimeout(languageConfigSaveTimeout);
				}
				
				// Set new timeout to save configuration after a small delay
				languageConfigSaveTimeout = setTimeout(() => {
					saveLanguageConfiguration().catch(err => {
						console.error('[Site] Failed to auto-save language configuration:', err);
					});
					languageConfigSaveTimeout = null;
				}, 300);
			}
		}
	}


	// 多语言相关函数
	async function updateLanguageCode(contentId: string, newLanguageCode: string) {
		site.updateLanguageCode(contentId, newLanguageCode);
		
		// Wait for Svelte to update reactive variables
		await tick();
		
		// Save updated language configuration to Foundry
		await saveLanguageConfiguration();
	}
	
	/**
	 * Save language configuration to Foundry project config
	 */
	async function saveLanguageConfiguration() {
		if (!plugin.currentProjectName) {
			return;
		}
		
		// Skip saving during project initialization
		if (plugin.isProjectInitializing) {
			console.log('[Site] Skipping language config save during initialization');
			return;
		}
		
		// Prevent re-entry during save
		if (isSavingLanguageConfig) {
			console.log('[Site] Language config save already in progress, skipping');
			return;
		}
		
		// Set saving flag
		isSavingLanguageConfig = true;
		
		try {
			// Build languages configuration from current contents
			const languages: Record<string, any> = {};
			
			currentContents.forEach((content, index) => {
				const contentDir = index === 0 ? "content" : `content.${content.languageCode}`;
				languages[content.languageCode] = {
					contentDir: contentDir,
					weight: content.weight || (index + 1)
				};
			});
			
			// Get the default language (first content's language)
			const defaultLang = currentContents.length > 0 
				? currentContents[0].languageCode 
				: 'en';
			
			// Build configuration string for tracking
			const configString = JSON.stringify({
				languages: currentContents.map(c => ({
					code: c.languageCode,
					contentDir: currentContents.indexOf(c) === 0 ? "content" : `content.${c.languageCode}`,
					weight: c.weight || (currentContents.indexOf(c) + 1)
				})),
				defaultLang: defaultLang
			});
			
			// Save both languages and defaultContentLanguage using event system
			if (plugin.handleSiteEvent) {
				await plugin.handleSiteEvent('configChanged', {
					key: 'languages',
					value: languages
				});
				
				await plugin.handleSiteEvent('configChanged', {
					key: 'defaultContentLanguage',
					value: defaultLang
				});
			}
			
			// Update last saved config
			lastSavedLanguageConfig = configString;
			
			console.log('[Site] Saved language configuration:', {
				languages,
				defaultContentLanguage: defaultLang
			});
		} catch (error) {
			console.error('[Site] Error saving language configuration:', error);
		} finally {
			// Always clear the saving flag
			isSavingLanguageConfig = false;
		}
	}

	function removeLanguageContent(contentId: string) {
		site.removeLanguageContent(contentId);
	}
	
	function clearAllContent() {
		site.clearAllContent();
	}
	
	function clearSiteAssets() {
		site.clearSiteAssets();
	}

	function openThemeModal() {
		// Call plugin method to show theme selection modal
		plugin.showThemeSelectionModal(selectedThemeId, async (themeUrl: string, themeName?: string, themeId?: string) => {
			// Force reactive updates by reassigning all variables
			selectedThemeDownloadUrl = themeUrl;
			selectedThemeName = themeName || (isForSingleFile ? "Note" : "Book");
			selectedThemeId = themeId || selectedThemeId;
			
		// 标记用户已手动选择主题，防止后续自动重置
		userHasSelectedTheme = true;
		
		// Save theme to Foundry config
		await saveFoundryConfig('module.imports.0.path', themeUrl);
			
			// Get theme info to check for sample availability
			if (themeId) {
				try {
					currentThemeWithSample = await themeApiService.getThemeById(themeId, plugin);
				} catch (error) {
					console.warn('Failed to get theme info:', error);
					currentThemeWithSample = null;
				}
			}
		}, isForSingleFile);
	}

	async function downloadThemeSample() {
		if (!currentThemeWithSample || !currentThemeWithSample.demo_notes_url) {
			return;
		}

		isDownloadingSample = true;
		sampleDownloadProgress = 0;

		try {
			// Ensure MDFriday root folder exists
			await ensureRootFolderExists();

			// Generate unique folder name
			const baseName = currentThemeWithSample.name.toLowerCase().replace(/\s+/g, '-');
			const targetFolderName = await generateUniqueFolderName(baseName);
			
			// Construct absolute path using adapter.getBasePath()
			const adapter = app.vault.adapter;
			let targetFolderPath: string;
			
			if (adapter instanceof FileSystemAdapter) {
				// Use absolute path to avoid vault root interpretation issues
				const vaultBasePath = adapter.getBasePath();
				targetFolderPath = path.join(vaultBasePath, FRIDAY_ROOT_FOLDER, targetFolderName);
			} else {
				// Fallback for non-FileSystemAdapter
				targetFolderPath = path.join(FRIDAY_ROOT_FOLDER, targetFolderName);
			}
			
			// Normalize path for Windows
			if (isWindows) {
				targetFolderPath = path.normalize(targetFolderPath);
			}

			// Download and unzip sample
			await downloadAndUnzipSample(
				currentThemeWithSample.demo_notes_url,
				targetFolderPath,
				(progress) => {
					sampleDownloadProgress = progress;
				}
			);

			new Notice(t('messages.sample_downloaded_successfully', {
				themeName: currentThemeWithSample.name, 
				folderName: targetFolderName 
			}), 5000);

		} catch (error) {
			console.error('Sample download failed:', error);
			console.error('Error details:', {
				themeName: currentThemeWithSample?.name,
				downloadUrl: currentThemeWithSample?.demo_notes_url,
				platform: process.platform,
				error: error.message
			});
			new Notice(t('messages.sample_download_failed', { error: error.message }), 5000);
		} finally {
			isDownloadingSample = false;
			sampleDownloadProgress = 0;
		}
	}

	// Reactive statement to ensure theme name updates
	$: displayThemeName = selectedThemeName || BOOK_THEME_NAME;

	function toggleAdvancedSettings() {
		showAdvancedSettings = !showAdvancedSettings;
	}

	function normalizeSitePath(path: string): string {
		// Ensure path starts with / and doesn't end with / (unless it's just "/")
		if (!path.startsWith('/')) {
			path = '/' + path;
		}
		if (path.length > 1 && path.endsWith('/')) {
			path = path.slice(0, -1);
		}
		return path;
	}

	function handleSitePathChange() {
		sitePath = normalizeSitePath(sitePath);

		saveFoundryConfig('baseURL', sitePath)
	}

	/**
	 * Create renderer based on theme tags
	 * If theme has "Book" tag, use OBStyleRenderer (full-featured with plugin rendering)
	 * Otherwise, use lightweight StyleRenderer
	 */
	async function createRendererBasedOnTheme() {
		try {
			// Get theme information by ID
			const obImagesDir = path.join(absPreviewDir, 'public', 'ob-images');
			
			if (hasOBTag) {
				// Use OBStyleRenderer for themes with "Book" tag
				// This includes full CSS collection, plugin rendering, and theme styles
				const renderer = new OBStyleRenderer(plugin, {
					includeCSS: true, // Include CSS in HTML for complete styling
					waitForPlugins: true, // Wait for plugin rendering callbacks
					timeout: 200, // Shorter timeout with smart detection
					containerWidth: "1000px",
					includeTheme: true // Include theme styles
				});
				
				// Configure resource processor for app:// URLs
				renderer.getResourceProcessor().configureImageOutput(obImagesDir, sitePath, currentContents[0]?.folder?.name);
				return renderer;
			} else {
				// Use lightweight StyleRenderer for other themes
				const renderer = createStyleRenderer(plugin, {
					autoHeadingID: true,
					waitForStable: false, // Don't wait for DOM stable for better performance
				});
				
				// Configure resource processor for internal links
				if (renderer.getResourceProcessor) {
					renderer.getResourceProcessor().configureImageOutput(obImagesDir, sitePath, currentContents[0]?.folder?.name);
				}
				
				return renderer;
			}
		} catch (error) {
			console.warn('Failed to get theme info, falling back to lightweight renderer:', error);
			// Fallback to lightweight renderer
			const obImagesDir = path.join(absPreviewDir, 'public', 'ob-images');
			const renderer = createStyleRenderer(plugin, {
				autoHeadingID: true,
				waitForStable: false,
			});
			
			// Configure resource processor for internal links
			if (renderer.getResourceProcessor) {
				renderer.getResourceProcessor().configureImageOutput(obImagesDir, sitePath, currentContents[0]?.folder?.name);
			}
			
			return renderer;
		}
	}

	async function startPreview() {
		if (currentContents.length === 0) {
			new Notice(t('messages.no_folder_or_file_selected'), 3000);
			return;
		}

		if (!plugin.currentProjectName) {
			new Notice('No project selected. Please right-click a folder first.', 3000);
			return;
		}

		// Stop previous preview if running to avoid port conflicts
		if (hasPreview || serverRunning) {
			console.log('[Site] Stopping previous preview before starting new one');
			try {
				await stopPreview();
				// Wait a moment for the server to fully stop
				await new Promise(resolve => setTimeout(resolve, 500));
			} catch (error) {
				console.warn('[Site] Error stopping previous preview:', error);
				// Continue anyway, the new server start might handle the conflict
			}
		}

		isBuilding = true;
		buildProgress = 0;
		hasPreview = false;

		try {
			// Note: Configuration is auto-saved through reactive statements
			// No need for explicit saveCurrentConfiguration() call
			
			// Get theme info to check if we need custom renderer
			const themeInfo = await themeApiService.getThemeById(selectedThemeId, plugin);
			hasOBTag = themeInfo?.tags?.some(tag =>
				tag.toLowerCase() === 'obsidian'
			) || false;
			
			// Create custom Markdown renderer based on theme
			const customRenderer = await createRendererBasedOnTheme();
			
			// Use event system to request preview from Main.ts
			if (plugin.handleSiteEvent) {
				await plugin.handleSiteEvent('previewRequested', {
					projectName: plugin.currentProjectName,
					port: serverPort,
					renderer: hasOBTag ? customRenderer : undefined
				});
				
				// Note: Progress updates and completion will be handled by callbacks
				// (updateBuildProgress, onPreviewStarted, onPreviewError)
			}

			// Send counter for preview (don't wait for result)
			if (plugin.hugoverse) {
				plugin.hugoverse.sendCounter('preview').catch(error => {
					console.warn('Counter request failed (non-critical):', error);
				});
			}

		} catch (error) {
			console.error('Preview generation failed:', error);
			new Notice(t('messages.preview_failed', { error: error.message }), 5000);
			isBuilding = false;
			buildProgress = 0;
		}
		// Note: isBuilding will be set to false by onPreviewStarted/onPreviewError callbacks
	}
	
	/**
	 * Save publish configuration to Foundry project config using event system
	 */
	async function savePublishConfig() {
		if (!plugin.currentProjectName) {
			return;
		}
		
		// Skip saving during project initialization
		if (plugin.isProjectInitializing) {
			console.log('[Site] Skipping publish config save during initialization');
			return;
		}
		
		try {
			const publishConfig: any = {
				method: selectedPublishOption
			};
			
			// Only save Netlify config if any field is set
			if (netlifyAccessToken || netlifyProjectId) {
				publishConfig.netlify = {
					accessToken: netlifyAccessToken,
					siteId: netlifyProjectId
				};
			}
			
			// Only save FTP config if any field is set
			if (ftpServer || ftpUsername || ftpPassword || ftpRemoteDir) {
				publishConfig.ftp = {
					host: ftpServer,
					username: ftpUsername,
					password: ftpPassword,
					remotePath: ftpRemoteDir,
				};

				// Add secure preference if known
				if (ftpPreferredSecure !== undefined) {
					publishConfig.ftp.secure = ftpPreferredSecure;
				}
			}
			
			// Use event system to save configuration
			if (plugin.handleSiteEvent) {
				await plugin.handleSiteEvent('configChanged', {
					key: 'publish',
					value: publishConfig
				});
			}
			
			console.log('[Site] Saved publish config to Foundry:', publishConfig);
		} catch (error) {
			console.error('[Site] Error saving publish config:', error);
		}
	}
	
	/**
	 * Stop preview server
	 */
	async function stopPreview() {
		if (!plugin.currentProjectName) {
			return;
		}
		
		try {
			// Use event system to request stop preview
			if (plugin.handleSiteEvent) {
				await plugin.handleSiteEvent('stopPreview', {
					projectName: plugin.currentProjectName
				});
			}
			
			new Notice('Preview server stopped', 2000);
		} catch (error) {
			console.error('Error stopping preview:', error);
			new Notice(`Error stopping preview: ${error.message}`, 3000);
		}
	}

	async function startPublish() {
		if (!hasPreview) {
			new Notice(t('messages.please_generate_preview_first'), 3000);
			return;
		}

		// Check settings based on selected publish option
		if (selectedPublishOption === 'netlify') {
			if (!netlifyAccessToken || !netlifyProjectId) {
				new Notice(t('messages.netlify_settings_missing'), 5000);
				return;
			}
		} else if (selectedPublishOption === 'ftp') {
			if (!ftpServer || !ftpUsername || !ftpPassword) {
				new Notice(t('messages.ftp_settings_missing'), 5000);
				return;
			}
		}

		isPublishing = true;
		publishProgress = 0;
		publishSuccess = false;

		try {
			// Prepare publish configuration based on selected option
			// Note: Must match Foundry's AnyPublishConfig type definitions
			let publishConfig: any = {};

			if (selectedPublishOption === 'netlify') {
				publishConfig = {
					type: 'netlify',
					accessToken: netlifyAccessToken,
					siteId: netlifyProjectId
				};
		} else if (selectedPublishOption === 'ftp') {
			publishConfig = {
				type: 'ftp',
				host: ftpServer,
				port: 21, // Default FTP port
				username: ftpUsername,
				password: ftpPassword,
				remotePath: ftpRemoteDir || '/',
				secure: ftpPreferredSecure !== undefined ? ftpPreferredSecure : true
			};
		} else if (selectedPublishOption === 'mdf-free') {
			publishConfig = {
				type: 'mdfriday',
				deploymentType: 'free',
				path: nameToId(projectName),
				enabled: true,
				accessToken: plugin.licenseState?.getAccessToken() || '',
				licenseKey: plugin.licenseState?.getLicenseKey() || '',
				apiUrl: plugin.licenseState?.getApiUrl() || GetBaseUrl(plugin.settings)
			};

			console.log("--990--", publishConfig);
		} else if (selectedPublishOption === 'mdf-share') {
			publishConfig = {
				type: 'mdfriday',
				deploymentType: 'share',
				path: nameToId(projectName),
				enabled: true,
				accessToken: plugin.licenseState?.getAccessToken() || '',
				licenseKey: plugin.licenseState?.getLicenseKey() || '',
				apiUrl: plugin.licenseState?.getApiUrl() || GetBaseUrl(plugin.settings)
			};
		} else if (selectedPublishOption === 'mdf-app') {
			publishConfig = {
				type: 'mdfriday',
				deploymentType: 'sub',
				path: sitePath,
				enabled: true,
				accessToken: plugin.licenseState?.getAccessToken() || '',
				licenseKey: plugin.licenseState?.getLicenseKey() || '',
				apiUrl: plugin.licenseState?.getApiUrl() || GetBaseUrl(plugin.settings)
			};
		} else if (selectedPublishOption === 'mdf-custom') {
			publishConfig = {
				type: 'mdfriday',
				deploymentType: 'custom',
				path: sitePath,
				enabled: true,
				accessToken: plugin.licenseState?.getAccessToken() || '',
				licenseKey: plugin.licenseState?.getLicenseKey() || '',
				apiUrl: plugin.licenseState?.getApiUrl() || GetBaseUrl(plugin.settings)
			};
		} else if (selectedPublishOption === 'mdf-enterprise') {
			publishConfig = {
				type: 'mdfriday',
				deploymentType: 'enterprise',
				path: sitePath,
				enabled: true,
				accessToken: plugin.licenseState?.getAccessToken() || '',
				licenseKey: plugin.licenseState?.getLicenseKey() || '',
				apiUrl: plugin.settings.enterpriseServerUrl || plugin.licenseState?.getApiUrl() || GetBaseUrl(plugin.settings)
			};
		}

			// Use event system to request publish from Main.ts
			if (plugin.handleSiteEvent) {
				await plugin.handleSiteEvent('publishRequested', {
					projectName: plugin.currentProjectName!,
					method: selectedPublishOption,
					config: publishConfig
				});
				
				// Note: Progress updates and completion will be handled by callbacks
				// (updatePublishProgress, onPublishComplete, onPublishError)
			}

		} catch (error) {
			console.error('Publish failed:', error);
			new Notice(t('messages.publish_failed', { error: error.message }), 5000);
			isPublishing = false;
			publishProgress = 0;
			publishSuccess = false;
		}
		// Note: isPublishing will be set to false by onPublishComplete/onPublishError callbacks
	}

	// Reactive: Check if FTP is configured
	$: isFTPConfigured = !!(ftpServer.trim() && ftpUsername.trim() && ftpPassword.trim());

	// Test FTP connection
	async function testFTPConnection() {
		// Check if Project Service Manager is available
		if (!plugin.projectServiceManager) {
			ftpTestState = 'error';
			ftpTestMessage = 'Project service manager not initialized';
			return;
		}
		
		// Validate that we have a project to test with
		if (!plugin.currentProjectName) {
			ftpTestState = 'error';
			ftpTestMessage = 'No project selected. Please right-click a folder first.';
			return;
		}
		
		ftpTestState = 'testing';
		ftpTestMessage = '';
		
		try {
			// Prepare FTP configuration
			const ftpConfig = {
				type: 'ftp',
				host: ftpServer,
				username: ftpUsername,
				password: ftpPassword,
				remotePath: ftpRemoteDir || '/',
				secure: ftpPreferredSecure !== undefined ? ftpPreferredSecure : true,
			};
			
			// Use Project Service Manager to test connection
			const result = await plugin.projectServiceManager.testConnection(
				plugin.currentProjectName,
				ftpConfig
			);
			
			if (result.success) {
				ftpTestState = 'success';
				ftpTestMessage = result.message || t('settings.ftp_test_connection_success');
			} else {
				ftpTestState = 'error';
				ftpTestMessage = result.error || result.message || t('settings.ftp_test_connection_failed');
			}
		} catch (error) {
			console.error('FTP test error:', error);
			ftpTestState = 'error';
			ftpTestMessage = error.message || t('settings.ftp_test_connection_failed');
		}
	}

	// Track FTP config changes to reset test state
	let previousFtpConfig = '';
	$: {
		const currentFtpConfig = `${ftpServer}|${ftpUsername}|${ftpPassword}|${ftpRemoteDir}|${ftpIgnoreCert}`;
		if (previousFtpConfig && previousFtpConfig !== currentFtpConfig && ftpTestState !== 'idle') {
			// Config changed while test result is showing, reset to idle
			ftpTestState = 'idle';
			ftpTestMessage = '';
		}
		previousFtpConfig = currentFtpConfig;
	}

	async function createThemesDirectory() {
		if (!await app.vault.adapter.exists(themesDir)) {
			await app.vault.adapter.mkdir(themesDir);
		}
	}

	async function exportSite() {
		if (!hasPreview || !absPreviewDir) {
			new Notice(t('messages.please_generate_preview_first'), 3000);
			return;
		}

		isExporting = true;

		try {
			// Create ZIP from public directory
			const publicDir = path.join(absPreviewDir, 'public');
			const zipContent = await createZipFromDirectory(publicDir);

			// Use Electron's dialog API to show save dialog
			const { dialog } = require('@electron/remote') || require('electron').remote;
			const { canceled, filePath } = await dialog.showSaveDialog({
				title: t('ui.export_site_dialog_title'),
				defaultPath: 'mdfriday-site.zip',
				filters: [
					{ name: 'ZIP Files', extensions: ['zip'] },
					{ name: 'All Files', extensions: ['*'] }
				]
			});

			if (!canceled && filePath) {
				// Save the ZIP file to the selected path
				await fs.promises.writeFile(filePath, zipContent);
				new Notice(t('messages.site_exported_successfully', { path: filePath }), 3000);
			}

		} catch (error) {
			console.error('Export failed:', error);
			new Notice(t('messages.export_failed', { error: error.message }), 5000);
		} finally {
			isExporting = false;
		}
	}

	async function ensureRootFolderExists() {
		// Ensure we're working with the vault root for the MDFriday folder
		const adapter = app.vault.adapter;
		let rootFolderPath: string;
		
		if (adapter instanceof FileSystemAdapter) {
			// Use absolute path
			const vaultBasePath = adapter.getBasePath();
			rootFolderPath = path.join(vaultBasePath, FRIDAY_ROOT_FOLDER);
		} else {
			// Fallback for non-FileSystemAdapter
			rootFolderPath = FRIDAY_ROOT_FOLDER;
		}
		
		// For additional safety on Windows, ensure the path is properly normalized
		if (isWindows) {
			rootFolderPath = path.normalize(rootFolderPath);
		}

		if (!(await adapter.exists(rootFolderPath))) {
			// Use Node.js fs for absolute paths, adapter for relative paths
			if (adapter instanceof FileSystemAdapter && path.isAbsolute(rootFolderPath)) {
				await fs.promises.mkdir(rootFolderPath, { recursive: true });
			} else {
				await adapter.mkdir(rootFolderPath);
			}
		}
	}

	async function generateUniqueFolderName(baseName: string): Promise<string> {
		let folderName = baseName;
		let counter = 0;
		
		// Get the correct root folder path
		const adapter = app.vault.adapter;
		let rootFolderPath: string;
		
		if (adapter instanceof FileSystemAdapter) {
			// Use absolute path
			const vaultBasePath = adapter.getBasePath();
			rootFolderPath = path.join(vaultBasePath, FRIDAY_ROOT_FOLDER);
		} else {
			// Fallback for non-FileSystemAdapter
			rootFolderPath = FRIDAY_ROOT_FOLDER;
		}
		
		// Normalize the base folder path for consistency
		if (isWindows) {
			rootFolderPath = path.normalize(rootFolderPath);
		}

		while (await checkFolderExists(path.join(rootFolderPath, folderName))) {
			counter++;
			folderName = `${baseName} ${counter}`;
		}

		return folderName;
	}
	
	async function checkFolderExists(folderPath: string): Promise<boolean> {
		const adapter = app.vault.adapter;
		
		if (adapter instanceof FileSystemAdapter && path.isAbsolute(folderPath)) {
			// Use Node.js fs for absolute paths
			try {
				await fs.promises.access(folderPath);
				return true;
			} catch {
				return false;
			}
		} else {
			// Use adapter for relative paths
			return await adapter.exists(folderPath);
		}
	}

	async function downloadAndUnzipSample(
		downloadUrl: string,
		targetFolderPath: string,
		progressCallback: (progress: number) => void
	) {
		try {
			// Download the zip file
			progressCallback(10);
			const response = await requestUrl({
				url: downloadUrl,
				method: 'GET'
			});

			if (response.status !== 200) {
				throw new Error(`Download failed with status: ${response.status}`);
			}

			progressCallback(50);

			// Parse the zip file
			const zip = new JSZip();
			const zipData = await zip.loadAsync(response.arrayBuffer);

			progressCallback(70);

			// Create target folder using appropriate method based on path type
			if (!(await checkFolderExists(targetFolderPath))) {
				if (path.isAbsolute(targetFolderPath)) {
					await fs.promises.mkdir(targetFolderPath, { recursive: true });
				} else {
					await app.vault.adapter.mkdir(targetFolderPath);
				}
			}

			// Extract files
			const files = Object.keys(zipData.files);
			let processedFiles = 0;

			for (const fileName of files) {
				const file = zipData.files[fileName];
				
				// Normalize the file path for cross-platform compatibility
				let normalizedFileName = fileName;
				if (isWindows) {
					// Replace forward slashes with backslashes for Windows
					normalizedFileName = fileName.replace(/\//g, path.sep);
				}
				// Always normalize the path to handle any remaining issues
				normalizedFileName = path.normalize(normalizedFileName);
				
				if (file.dir) {
					// Create directory
					const dirPath = path.join(targetFolderPath, normalizedFileName);
					if (!(await checkFolderExists(dirPath))) {
						if (path.isAbsolute(dirPath)) {
							await fs.promises.mkdir(dirPath, { recursive: true });
						} else {
							await app.vault.adapter.mkdir(dirPath);
						}
					}
				} else {
					// Extract file
					const filePath = path.join(targetFolderPath, normalizedFileName);
					
					// Ensure the parent directory exists before creating the file
					const parentDir = path.dirname(filePath);
					if (parentDir !== targetFolderPath && !(await checkFolderExists(parentDir))) {
						if (path.isAbsolute(parentDir)) {
							await fs.promises.mkdir(parentDir, { recursive: true });
						} else {
							await app.vault.adapter.mkdir(parentDir);
						}
					}
					
					const fileContent = await file.async('uint8array');
					
					// Write file using appropriate method
					if (path.isAbsolute(filePath)) {
						await fs.promises.writeFile(filePath, fileContent);
					} else {
						await app.vault.adapter.writeBinary(filePath, fileContent.buffer as ArrayBuffer);
					}
				}

				processedFiles++;
				const extractProgress = 70 + (processedFiles / files.length) * 30;
				progressCallback(Math.round(extractProgress));
			}

			progressCallback(100);

		} catch (error) {
			console.error('Download and unzip failed:', error);
			throw error;
		}
	}

	async function createZipFromDirectory(sourceDir: string): Promise<Uint8Array> {
		const zip = new JSZip();
		
		// Recursively add files to ZIP
		const addDirectoryToZip = async (dirPath: string, zipFolder: JSZip) => {
			const items = await fs.promises.readdir(dirPath, { withFileTypes: true });
			
			for (const item of items) {
				const itemPath = path.join(dirPath, item.name);
				
				if (item.isDirectory()) {
					const subFolder = zipFolder.folder(item.name);
					if (subFolder) {
						await addDirectoryToZip(itemPath, subFolder);
					}
				} else if (item.isFile()) {
					const fileContent = await fs.promises.readFile(itemPath);
					zipFolder.file(item.name, new Uint8Array(fileContent));
				}
			}
		};

		await addDirectoryToZip(sourceDir, zip);
		
		// Generate ZIP file
		return await zip.generateAsync({ type: 'uint8array' });
	}

	// Open publish URL in browser
	function openPublishUrl() {
		if (publishUrl) {
			window.open(publishUrl, '_blank');
		}
	}

	// Copy publish URL to clipboard
	async function copyPublishUrl() {
		if (publishUrl) {
			try {
				await navigator.clipboard.writeText(publishUrl);
				new Notice(t('messages.url_copied_to_clipboard') || 'URL copied to clipboard!');
			} catch (error) {
				console.error('Failed to copy URL:', error);
				new Notice('Failed to copy URL');
			}
		}
	}

	// Get display content path (relative to vault root)
	function getDisplayContentPath(): string {
		if (currentContents.length === 0) {
			return t('ui.no_content_selected') || 'No content selected';
		}
		const content = currentContents[0];
		if (content.folder) {
			return content.folder.path;
		} else if (content.file) {
			return content.file.path;
		}
		return '';
	}

	// Get content icon type
	function getContentIconType(): 'file' | 'folder' | null {
		if (currentContents.length === 0) return null;
		const content = currentContents[0];
		if (content.folder) return 'folder';
		if (content.file) return 'file';
		return null;
	}
</script>

<div class="site-builder">
	<!-- Quick Publish Panel -->
	<div class="quick-publish-panel">
		<!-- Header with Logo -->
		<div class="panel-header">
			<img src="https://gohugo.net/mdfriday.svg" alt="MDFriday" class="mdfriday-logo" width="20" height="20" />
			<span class="panel-title">MDFriday</span>
		</div>

		<!-- Current Content Display -->
		<div class="current-content">
			<div class="content-label">{t('ui.current_content') || 'Current Content'}</div>
			<div class="content-display">
				{#if currentContents.length > 0}
					{@const iconType = getContentIconType()}
					{#if iconType === 'folder'}
						<svg class="content-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
							<path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path>
						</svg>
					{:else if iconType === 'file'}
						<svg class="content-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
							<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
							<polyline points="14 2 14 8 20 8"></polyline>
						</svg>
					{/if}
					<span class="content-path">{getDisplayContentPath()}</span>
				{:else}
					<span class="content-empty">{t('ui.no_content_selected_hint')}</span>
				{/if}
			</div>
		</div>

		<!-- Publish Status Area -->
		<div class="publish-status-area">
			{#if isPublishing}
				<!-- Publishing in progress -->
				<div class="status-publishing">
					<div class="status-text">{t('ui.publish_building')}</div>
					<ProgressBar progress={publishProgress} />
				</div>
			{:else if publishSuccess && publishUrl}
				<!-- Published successfully with URL -->
				<div class="status-success">
					<div class="status-text success">✓ {t('ui.published_successfully')}</div>
					<a href={publishUrl} target="_blank" class="publish-url-display">{publishUrl}</a>
					<div class="url-actions">
						<button class="url-action-btn" on:click={openPublishUrl} title={t('ui.open_in_browser') || 'Open in browser'}>
							<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
								<path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path>
								<polyline points="15 3 21 3 21 9"></polyline>
								<line x1="10" y1="14" x2="21" y2="3"></line>
							</svg>
							<span>{t('ui.open') || 'Open'}</span>
						</button>
						<button class="url-action-btn" on:click={copyPublishUrl} title={t('ui.copy_url') || 'Copy URL'}>
							<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
								<rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
								<path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
							</svg>
							<span>{t('ui.copy') || 'Copy'}</span>
						</button>
					</div>
				</div>
			{:else if publishSuccess && selectedPublishOption === 'ftp'}
				<!-- FTP success (no URL) -->
				<div class="status-success">
					<div class="status-text success">✓ {t('messages.ftp_upload_success')}</div>
				</div>
			{/if}
		</div>

		<!-- Publish Actions -->
		<div class="publish-actions-row">
			<button
				class="quick-publish-btn"
				on:click={startPublish}
				disabled={!hasPreview || isPublishDisabled || isPublishing}
			>
				{#if autoPublishEnabled && isPublishing}
					{t('ui.realtime_publishing') || 'Publishing...'}
				{:else}
					{t('ui.publish')}
				{/if}
			</button>
			<label class="auto-publish-toggle">
				<input
					type="checkbox"
					class="toggle-checkbox"
					bind:checked={autoPublishEnabled}
				/>
				<span class="toggle-label">{t('ui.auto_publish') || 'Auto Publish'}</span>
			</label>
		</div>
	</div>

	<!-- Settings Panel (Collapsible) -->
	<div class="settings-panel">
		<button 
			class="panel-toggle setting-item-control" 
			on:click={() => showSettingsPanel = !showSettingsPanel}
			aria-expanded={showSettingsPanel}
		>
			<svg class="collapse-icon" class:is-collapsed={!showSettingsPanel} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
				<polyline points="6 9 12 15 18 9"></polyline>
			</svg>
			<span class="setting-item-name">{t('ui.settings') || 'Settings'}</span>
		</button>
		
		{#if showSettingsPanel}
			<div class="panel-content">
				<!-- Multi-language Content -->
				<div class="settings-section">
					<div class="section-label">{t('ui.multilingual_content')}</div>
					<div class="multilang-table">
						<div class="multilang-header">
							<div class="multilang-header-cell">{t('ui.content_path')}</div>
							<div class="multilang-header-cell">
								<span>{t('ui.language')}</span>
								{#if currentContents.length > 0}
									<button 
										class="add-language-btn"
										on:click={clearAllContent}
										title={t('ui.clear_all_content')}
									>
										{t('ui.clear')}
									</button>
								{/if}
							</div>
						</div>
						{#each currentContents as content (content.id)}
							<div class="multilang-row" class:removable={currentContents.length > 1}>
								<div class="multilang-cell content-path-cell">
									<span class="content-path">
										{content.folder ? content.folder.name : content.file ? content.file.name : t('ui.no_content_selected')}
									</span>
									{#if content.weight === 1}
										<span class="default-badge">{t('ui.default')}</span>
									{/if}
								</div>
								<div class="multilang-cell language-cell">
									<select 
										class="language-select"
										value={content.languageCode}
										on:change={(e) => updateLanguageCode(content.id, e.currentTarget.value)}
									>
										{#each SUPPORTED_LANGUAGES as lang}
											<option value={lang.code}>{lang.name} ({lang.englishName})</option>
										{/each}
									</select>
									{#if currentContents.length > 1}
										<button 
											class="remove-btn"
											on:click={() => removeLanguageContent(content.id)}
											title={t('ui.remove_language')}
										>
											<span class="remove-icon">×</span>
										</button>
									{/if}
								</div>
							</div>
						{/each}
						{#if currentContents.length === 0}
							<div class="multilang-empty">
								<span class="empty-message">{t('ui.no_content_selected_hint')}</span>
							</div>
						{/if}
					</div>
				</div>

				<!-- Site Name -->
				<div class="settings-section">
					<label class="section-label" for="site-name">{t('ui.site_name')}</label>
					<input
						type="text"
						class="form-input"
						bind:value={siteName}
						on:blur={() => saveFoundryConfig('title', siteName)}
						placeholder={t('ui.site_name_placeholder')}
					/>
				</div>

				<!-- Theme Selection -->
				<div class="settings-section">
					<label class="section-label" for="themes">{t('ui.theme')}</label>
					<div class="theme-selector">
						<div class="current-theme">
							<span class="theme-name">{displayThemeName}</span>
							<div class="theme-actions">
								<button class="change-theme-btn" on:click={openThemeModal}>
									{t('ui.change_theme')}
								</button>
								{#if currentThemeWithSample && currentThemeWithSample.demo_notes_url}
									{#if isDownloadingSample}
										<div class="sample-download-progress">
											<span class="progress-text">{t('ui.downloading_sample')}</span>
											<ProgressBar progress={sampleDownloadProgress} />
										</div>
									{:else}
										<button class="download-sample-btn" on:click={downloadThemeSample}>
											{t('ui.download_sample')}
										</button>
									{/if}
								{/if}
							</div>
						</div>
					</div>
				</div>

				<!-- Preview Section -->
				<div class="settings-section">
					<h3 class="section-title">{t('ui.preview')}</h3>
					<div class="preview-section">
						{#if isBuilding}
							<div class="progress-container">
								<p>{t('ui.preview_building')}</p>
								<ProgressBar progress={buildProgress} />
							</div>
						{:else}
							<button
								class="action-button preview-button"
								on:click={startPreview}
								disabled={currentContents.length === 0}
							>
								{hasPreview ? t('ui.regenerate_preview') : t('ui.generate_preview')}
							</button>
						{/if}

						{#if hasPreview && previewUrl}
							<div class="preview-link">
								<p>{t('ui.preview_link')}</p>
								<a href={previewUrl} target="_blank" class="preview-url">{previewUrl}</a>
								<div class="preview-actions">
									<button
										class="action-button export-button"
										on:click={exportSite}
										disabled={isExporting}
									>
										{isExporting ? t('ui.exporting') : t('ui.export_site')}
									</button>
								</div>
							</div>
						{/if}
					</div>
				</div>

				<!-- Publish Configuration -->
				<div class="settings-section">
					<h3 class="section-title">{t('ui.publish_config') || 'Publish Configuration'}</h3>
					<div class="publish-section">
						<div class="publish-select-wrapper">
							<label class="section-label" for="publish-method">{t('ui.publish_method')}</label>
							<select id="publish-method" class="form-select" bind:value={selectedPublishOption} on:change={() => savePublishConfig()}>
								{#each publishOptions as option}
									<option value={option.value}>{option.label}</option>
								{/each}
							</select>
						</div>

						<!-- Netlify Configuration -->
						{#if selectedPublishOption === 'netlify'}
							<div class="publish-config">
								<div class="config-field">
									<label class="section-label" for="netlify-token">{t('settings.netlify_access_token')}</label>
									<input
										type="password"
										class="form-input"
										bind:value={netlifyAccessToken}
										on:blur={() => savePublishConfig()}
										placeholder={t('settings.netlify_access_token_placeholder')}
									/>
									<div class="field-hint">
										{t('settings.netlify_access_token_desc')}
									</div>
								</div>
								<div class="config-field">
									<label class="section-label" for="netlify-project">{t('settings.netlify_project_id')}</label>
									<input
										type="text"
										class="form-input"
										bind:value={netlifyProjectId}
										on:blur={() => savePublishConfig()}
										placeholder={t('settings.netlify_project_id_placeholder')}
									/>
									<div class="field-hint">
										{t('settings.netlify_project_id_desc')}
									</div>
								</div>
							</div>
						{/if}

						<!-- FTP Configuration -->
						{#if selectedPublishOption === 'ftp'}
							<div class="publish-config">
								<div class="config-field">
									<label class="section-label" for="ftp-server">{t('settings.ftp_server')}</label>
									<input
										type="text"
										class="form-input"
										bind:value={ftpServer}
										on:blur={() => savePublishConfig()}
										placeholder={t('settings.ftp_server_placeholder')}
									/>
								</div>
								<div class="config-field">
									<label class="section-label" for="ftp-username">{t('settings.ftp_username')}</label>
									<input
										type="text"
										class="form-input"
										bind:value={ftpUsername}
										on:blur={() => savePublishConfig()}
										placeholder={t('settings.ftp_username_placeholder')}
									/>
								</div>
								<div class="config-field">
									<label class="section-label" for="ftp-password">{t('settings.ftp_password')}</label>
									<input
										type="password"
										class="form-input"
										bind:value={ftpPassword}
										on:blur={() => savePublishConfig()}
										placeholder={t('settings.ftp_password_placeholder')}
									/>
								</div>
								<div class="config-field">
									<label class="section-label" for="ftp-remote-dir">{t('settings.ftp_remote_dir')}</label>
									<input
										type="text"
										class="form-input"
										bind:value={ftpRemoteDir}
										on:blur={() => savePublishConfig()}
										placeholder={t('settings.ftp_remote_dir_placeholder')}
									/>
									<div class="field-hint">
										{t('settings.ftp_remote_dir_desc')}
									</div>
								</div>
								<div class="config-field">
									<label class="checkbox-label">
										<input
											type="checkbox"
											bind:checked={ftpIgnoreCert}
											on:change={() => savePublishConfig()}
										/>
										<span>{t('settings.ftp_ignore_cert')}</span>
									</label>
									<div class="field-hint">
										{t('settings.ftp_ignore_cert_desc')}
									</div>
								</div>
								
								<!-- FTP Test Connection -->
								<div class="config-field">
									<button
										class="ftp-test-btn"
										class:ftp-test-success={ftpTestState === 'success'}
										class:ftp-test-error={ftpTestState === 'error'}
										on:click={testFTPConnection}
										disabled={!isFTPConfigured || ftpTestState === 'testing'}
									>
										{#if ftpTestState === 'testing'}
											{t('settings.ftp_test_connection_testing')}
										{:else if ftpTestState === 'success'}
											{t('settings.ftp_test_connection_success')}
										{:else if ftpTestState === 'error'}
											{t('settings.ftp_test_connection_failed')}
										{:else}
											{t('settings.ftp_test_connection')}
										{/if}
									</button>
									<div class="field-hint">
										{t('settings.ftp_test_connection_desc')}
									</div>
									{#if ftpTestMessage}
										<div 
											class="ftp-test-result"
											class:ftp-test-result-success={ftpTestState === 'success'}
											class:ftp-test-result-error={ftpTestState === 'error'}
										>
											{ftpTestState === 'success' ? '✅' : '❌'} {ftpTestMessage}
										</div>
									{/if}
								</div>
							</div>
						{/if}

						<!-- MDFriday Free Info -->
						{#if selectedPublishOption === 'mdf-free'}
							<div class="publish-config">
								<div class="field-hint">
									{t('ui.mdfriday_free_hint')}
								</div>
							</div>
						{/if}

						<!-- MDFriday Share Info -->
						{#if selectedPublishOption === 'mdf-share'}
							<div class="publish-config">
								<div class="field-hint">
									{t('ui.mdfriday_share_hint')}
								</div>
								{#if !(plugin.licenseState?.hasPublishPermission())}
									<div class="license-warning">
										⚠️ {t('settings.upgrade_for_mdfshare')}
									</div>
								{/if}
							</div>
						{/if}

						<!-- MDFriday Subdomain Info -->
						{#if selectedPublishOption === 'mdf-app'}
							<div class="publish-config">
								<div class="field-hint">
									{t('ui.mdfriday_app_hint')}
								</div>
								{#if !(plugin.licenseState?.hasFeature('customSubDomain'))}
									<div class="license-warning">
										⚠️ {t('settings.upgrade_for_subdomain')}
									</div>
								{/if}
							</div>
						{/if}

						<!-- MDFriday Custom Domain Info -->
						{#if selectedPublishOption === 'mdf-custom'}
							<div class="publish-config">
								<div class="field-hint">
									{t('ui.mdfriday_custom_hint')}
								</div>
								{#if !(plugin.licenseState?.hasFeature('customDomain'))}
									<div class="license-warning">
										⚠️ {t('settings.upgrade_for_custom_domain')}
									</div>
								{/if}
							</div>
						{/if}

						<!-- MDFriday Enterprise Info -->
						{#if selectedPublishOption === 'mdf-enterprise'}
							<div class="publish-config">
								<div class="field-hint">
									{t('ui.mdfriday_enterprise_hint')}
								</div>
								{#if !(plugin.licenseState?.isActivated() && !plugin.licenseState?.isExpired() && plugin.licenseState?.getPlan() === 'enterprise' && plugin.settings.enterpriseServerUrl)}
									<div class="license-warning">
										⚠️ {t('settings.upgrade_for_enterprise')}
									</div>
								{/if}
							</div>
						{/if}
					</div>
				</div>

				<!-- Advanced Settings (Collapsible with Obsidian style) -->
				<div class="settings-section">
					<div class="collapsible-section">
						<button 
							class="subsection-toggle setting-item-control" 
							on:click={() => showAdvancedInSettings = !showAdvancedInSettings}
							aria-expanded={showAdvancedInSettings}
						>
							<svg class="collapse-icon" class:is-collapsed={!showAdvancedInSettings} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
								<polyline points="6 9 12 15 18 9"></polyline>
							</svg>
							<span class="setting-item-name">{t('ui.advanced_settings')}</span>
						</button>
						
						{#if showAdvancedInSettings}
							<div class="subsection-content">
								<!-- Site Assets -->
								<div class="advanced-field">
									<div class="section-label">{t('ui.site_assets')}</div>
									<div class="site-assets-container">
										<div class="assets-display">
											{#if currentAssets}
												<span class="assets-path">{currentAssets.folder?.name || currentAssets.path}</span>
												<button 
													class="clear-assets-btn"
													on:click={clearSiteAssets}
													title={t('ui.clear_assets')}
												>
													{t('ui.clear_assets')}
												</button>
											{:else}
												<span class="assets-placeholder">{t('ui.site_assets_placeholder')}</span>
											{/if}
										</div>
										<div class="assets-hint">
											{t('ui.site_assets_hint')}
										</div>
									</div>
								</div>

								<div class="advanced-field">
									<label class="section-label" for="site-path">{t('ui.site_path')}</label>
									<input
										type="text"
										class="form-input"
										bind:value={sitePath}
										on:blur={handleSitePathChange}
										placeholder={t('ui.site_path_placeholder')}
										title={t('ui.site_path_hint')}
									/>
									<div class="field-hint">
										{t('ui.site_path_hint')}
									</div>
								</div>

								<div class="advanced-field">
									<label class="section-label" for="site-password">{t('ui.site_password')}</label>
									<input
										type="password"
										class="form-input"
										bind:value={sitePassword}
										on:blur={() => saveFoundryConfig('params.password', sitePassword)}
										placeholder={t('ui.site_password_placeholder')}
										title={t('ui.site_password_hint')}
									/>
									<div class="field-hint">
										{t('ui.site_password_hint')}
									</div>
								</div>

								<div class="advanced-field">
									<label class="section-label" for="google-analytics">{t('ui.google_analytics_id')}</label>
									<input
										type="text"
										class="form-input"
										bind:value={googleAnalyticsId}
										on:blur={() => saveFoundryConfig('services.googleAnalytics.id', googleAnalyticsId)}
										placeholder={t('ui.google_analytics_placeholder')}
										title={t('ui.google_analytics_hint')}
									/>
									<div class="field-hint">
										{t('ui.google_analytics_hint')}
									</div>
								</div>

								<div class="advanced-field">
									<label class="section-label" for="disqus-shortname">{t('ui.disqus_shortname')}</label>
									<input
										type="text"
										class="form-input"
										bind:value={disqusShortname}
										on:blur={() => saveFoundryConfig('params.disqusShortname', disqusShortname)}
										placeholder={t('ui.disqus_placeholder')}
										title={t('ui.disqus_hint')}
									/>
									<div class="field-hint">
										{t('ui.disqus_hint')}
									</div>
								</div>
							</div>
						{/if}
					</div>
				</div>
			</div>
		{/if}
	</div>
</div>

<style>
	/* ========== Main Container ========== */
	.site-builder {
		padding: 16px;
		max-width: 100%;
		display: flex;
		flex-direction: column;
		gap: 16px;
	}

	/* ========== Quick Publish Panel ========== */
	.quick-publish-panel {
		background: var(--background-primary);
		border: 1px solid var(--background-modifier-border);
		border-radius: 6px;
		padding: 16px;
		box-shadow: 0 1px 3px rgba(0, 0, 0, 0.05);
	}

	.panel-header {
		display: flex;
		align-items: center;
		gap: 8px;
		margin-bottom: 16px;
		padding-bottom: 12px;
		border-bottom: 1px solid var(--background-modifier-border);
	}

	.mdfriday-logo {
		flex-shrink: 0;
		display: block;
	}

	.panel-title {
		font-size: 16px;
		font-weight: 600;
		color: var(--text-normal);
	}

	/* Current Content Display */
	.current-content {
		margin-bottom: 16px;
	}

	.content-label {
		font-size: 12px;
		font-weight: 500;
		color: var(--text-muted);
		margin-bottom: 6px;
	}

	.content-display {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 8px 12px;
		background: var(--background-secondary);
		border: 1px solid var(--background-modifier-border);
		border-radius: 4px;
		min-height: 36px;
	}

	.content-icon {
		color: var(--text-muted);
		flex-shrink: 0;
	}

	.content-display .content-path {
		color: var(--text-normal);
		font-size: 13px;
		flex: 1;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.content-empty {
		color: var(--text-muted);
		font-size: 13px;
		font-style: italic;
	}

	/* Publish Status Area */
	.publish-status-area {
		margin-bottom: 16px;
		min-height: 60px;
	}

	.status-publishing,
	.status-success {
		padding: 12px;
		background: var(--background-secondary);
		border: 1px solid var(--background-modifier-border);
		border-radius: 4px;
	}

	.status-text {
		font-size: 13px;
		color: var(--text-muted);
		margin-bottom: 8px;
	}

	.status-text.success {
		color: var(--text-success);
		font-weight: 500;
	}

	.publish-url-display {
		display: block;
		color: var(--interactive-accent);
		text-decoration: none;
		font-size: 12px;
		word-break: break-all;
		margin-bottom: 12px;
		padding: 6px 8px;
		background: var(--background-primary);
		border-radius: 3px;
	}

	.publish-url-display:hover {
		text-decoration: underline;
	}

	.url-actions {
		display: flex;
		justify-content: center;
		gap: 8px;
	}

	.url-action-btn {
		display: flex;
		align-items: center;
		gap: 6px;
		padding: 6px 12px;
		border: 1px solid var(--background-modifier-border);
		border-radius: 4px;
		background: var(--background-primary);
		color: var(--text-normal);
		font-size: 12px;
		cursor: pointer;
		transition: all 0.2s;
	}

	.url-action-btn:hover {
		background: var(--interactive-hover);
		border-color: var(--interactive-accent);
	}

	.url-action-btn svg {
		color: var(--text-muted);
	}

	/* Publish Actions Row */
	.publish-actions-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
	}

	.quick-publish-btn {
		flex: 0 0 140px;
		padding: 10px 16px;
		border: none;
		border-radius: 4px;
		background: var(--interactive-accent);
		color: var(--text-on-accent);
		font-size: 14px;
		font-weight: 500;
		cursor: pointer;
		transition: background-color 0.2s;
		min-height: 36px;
	}

	.quick-publish-btn:hover:not(:disabled) {
		background: var(--interactive-accent-hover);
	}

	.quick-publish-btn:disabled {
		background: var(--background-modifier-border);
		color: var(--text-muted);
		cursor: not-allowed;
		opacity: 0.6;
	}

	.auto-publish-toggle {
		display: flex;
		align-items: center;
		gap: 6px;
		cursor: pointer;
		user-select: none;
	}

	.toggle-checkbox {
		width: 16px;
		height: 16px;
		cursor: pointer;
	}

	.toggle-label {
		font-size: 13px;
		color: var(--text-normal);
	}

	/* ========== Settings Panel ========== */
	.settings-panel {
		background: var(--background-primary);
		border: 1px solid var(--background-modifier-border);
		border-radius: 6px;
		overflow: hidden;
	}

	.panel-toggle {
		width: 100%;
		padding: 12px 16px;
		border: none;
		background: transparent;
		color: var(--text-normal);
		font-size: 14px;
		font-weight: 500;
		cursor: pointer;
		display: flex;
		align-items: center;
		gap: 8px;
		transition: background-color 0.2s;
		text-align: left;
	}

	.panel-toggle:hover {
		background: var(--background-modifier-hover);
	}

	/* Obsidian-style collapse icon */
	.collapse-icon {
		color: var(--text-muted);
		flex-shrink: 0;
		transition: transform 0.2s ease;
	}

	.collapse-icon.is-collapsed {
		transform: rotate(-90deg);
	}

	.setting-item-name {
		flex: 1;
	}

	.setting-item-control {
		width: 100%;
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 10px 12px;
		border: none;
		background: transparent;
		color: var(--text-normal);
		font-size: 13px;
		font-weight: 500;
		cursor: pointer;
		transition: background-color 0.2s;
		text-align: left;
	}

	.setting-item-control:hover {
		background: var(--background-modifier-hover);
	}

	.panel-content {
		background: var(--background-secondary);
		padding: 16px;
		border-top: 1px solid var(--background-modifier-border);
	}

	/* Settings Sections */
	.settings-section {
		margin-bottom: 20px;
	}

	.settings-section:last-child {
		margin-bottom: 0;
	}

	.section-label {
		display: block;
		margin-bottom: 8px;
		font-weight: 500;
		color: var(--text-normal);
		font-size: 13px;
	}

	.section-title {
		margin: 0 0 10px 0;
		font-size: 14px;
		font-weight: 600;
		color: var(--text-normal);
	}

	/* Collapsible Subsections */
	.collapsible-section {
		border: 1px solid var(--background-modifier-border);
		border-radius: 4px;
		overflow: hidden;
		background: var(--background-primary);
	}

	.subsection-toggle {
		width: 100%;
		padding: 10px 12px;
		border: none;
		background: transparent;
		color: var(--text-normal);
		font-size: 13px;
		font-weight: 500;
		cursor: pointer;
		display: flex;
		align-items: center;
		gap: 8px;
		transition: background-color 0.2s;
		text-align: left;
	}

	.subsection-toggle:hover {
		background: var(--background-modifier-hover);
	}

	.subsection-content {
		padding: 12px;
		background: var(--background-secondary);
		border-top: 1px solid var(--background-modifier-border);
	}

	/* Preview and Publish Sections */
	.preview-section,
	.publish-section {
		padding: 12px;
		border: 1px solid var(--background-modifier-border);
		border-radius: 4px;
		background: var(--background-secondary);
		margin-top: 8px;
	}

	/* Form Inputs */
	.form-input {
		width: 100%;
		padding: 8px 12px;
		border: 1px solid var(--background-modifier-border);
		border-radius: 4px;
		background: var(--background-primary);
		color: var(--text-normal);
		font-size: 13px;
		line-height: 1.4;
		box-sizing: border-box;
		min-height: 34px;
	}

	.form-input:focus {
		outline: none;
		border-color: var(--interactive-accent);
	}

	.form-select {
		width: 100%;
		padding: 8px 12px;
		border: 1px solid var(--background-modifier-border);
		border-radius: 4px;
		background: var(--background-primary);
		color: var(--text-normal);
		font-size: 13px;
		line-height: 1.4;
		box-sizing: border-box;
		min-height: 34px;
		appearance: none;
		background-image: url("data:image/svg+xml;charset=UTF-8,%3csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3e%3cpolyline points='6,9 12,15 18,9'%3e%3c/polyline%3e%3c/svg%3e");
		background-repeat: no-repeat;
		background-position: right 10px center;
		background-size: 14px;
		padding-right: 36px;
		cursor: pointer;
	}

	.form-select:focus {
		outline: none;
		border-color: var(--interactive-accent);
	}

	/* Theme Selector */
	.theme-selector {
		width: 100%;
	}

	.current-theme {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 8px 12px;
		border: 1px solid var(--background-modifier-border);
		border-radius: 4px;
		background: var(--background-primary);
		min-height: 34px;
		box-sizing: border-box;
	}

	.theme-name {
		color: var(--text-normal);
		font-size: 13px;
		flex: 1;
	}

	.theme-actions {
		display: flex;
		align-items: center;
		gap: 6px;
	}

	.change-theme-btn,
	.download-sample-btn {
		padding: 4px 10px;
		border: 1px solid var(--interactive-accent);
		border-radius: 3px;
		background: transparent;
		color: var(--interactive-accent);
		font-size: 11px;
		cursor: pointer;
		transition: all 0.2s;
		white-space: nowrap;
	}

	.change-theme-btn:hover,
	.download-sample-btn:hover {
		background: var(--interactive-accent);
		color: var(--text-on-accent);
	}

	.sample-download-progress {
		display: flex;
		flex-direction: column;
		gap: 4px;
		min-width: 100px;
	}

	.progress-text {
		font-size: 10px;
		color: var(--text-muted);
		text-align: center;
	}

	/* Publish Configuration */
	.publish-select-wrapper {
		margin-bottom: 12px;
	}

	.publish-config {
		background: var(--background-primary);
		border: 1px solid var(--background-modifier-border);
		border-radius: 4px;
		padding: 12px;
		margin-top: 12px;
	}

	.config-field {
		margin-bottom: 12px;
	}

	.config-field:last-child {
		margin-bottom: 0;
	}

	.checkbox-label {
		display: flex;
		align-items: center;
		gap: 8px;
		cursor: pointer;
		font-size: 13px;
		color: var(--text-normal);
	}

	.checkbox-label input[type="checkbox"] {
		width: 16px;
		height: 16px;
		cursor: pointer;
	}

	.field-hint {
		font-size: 11px;
		color: var(--text-muted);
		margin-top: 4px;
		line-height: 1.4;
	}

	.license-warning {
		font-size: 11px;
		color: var(--text-accent);
		background: var(--background-modifier-error-hover);
		border: 1px solid var(--background-modifier-error);
		padding: 6px 10px;
		border-radius: 3px;
		margin-top: 8px;
		line-height: 1.4;
	}

	/* Preview Section */
	.action-button {
		width: 100%;
		padding: 8px 16px;
		border: none;
		border-radius: 4px;
		background: var(--interactive-accent);
		color: var(--text-on-accent);
		font-size: 13px;
		font-weight: 500;
		cursor: pointer;
		transition: background-color 0.2s;
		min-height: 34px;
	}

	.action-button:hover:not(:disabled) {
		background: var(--interactive-accent-hover);
	}

	.action-button:disabled {
		background: var(--background-modifier-border);
		color: var(--text-muted);
		cursor: not-allowed;
		opacity: 0.6;
	}

	.preview-button {
		margin-bottom: 12px;
	}

	.preview-link {
		margin-top: 12px;
		padding: 10px;
		background: var(--background-primary);
		border-radius: 4px;
		border: 1px solid var(--background-modifier-border);
	}

	.preview-link p {
		margin: 0 0 6px 0;
		font-size: 12px;
		color: var(--text-muted);
	}

	.preview-url {
		display: block;
		color: var(--interactive-accent);
		text-decoration: none;
		font-size: 12px;
		word-break: break-all;
		margin-bottom: 8px;
	}

	.preview-url:hover {
		text-decoration: underline;
	}

	.preview-actions {
		margin-top: 8px;
		display: flex;
		gap: 8px;
	}

	.export-button {
		background: var(--interactive-normal);
		color: var(--text-normal);
		border: 1px solid var(--background-modifier-border);
	}

	.export-button:hover:not(:disabled) {
		background: var(--interactive-hover);
	}

	.progress-container {
		margin: 8px 0;
	}

	.progress-container p {
		margin: 0 0 8px 0;
		color: var(--text-muted);
		font-size: 12px;
	}

	/* Advanced Settings */
	.advanced-field {
		margin-bottom: 16px;
	}

	.advanced-field:last-child {
		margin-bottom: 0;
	}

	/* Multi-language Table */
	.multilang-table {
		border: 1px solid var(--background-modifier-border);
		border-radius: 4px;
		overflow: hidden;
		background: var(--background-primary);
	}

	.multilang-header {
		display: grid;
		grid-template-columns: 1fr 2fr;
		background: var(--background-secondary);
		border-bottom: 1px solid var(--background-modifier-border);
	}

	.multilang-header-cell {
		padding: 8px 10px;
		font-weight: 500;
		font-size: 12px;
		color: var(--text-normal);
		border-right: 1px solid var(--background-modifier-border);
		display: flex;
		align-items: center;
		justify-content: space-between;
		overflow: hidden;
		min-width: 0;
	}

	.multilang-header-cell:last-child {
		border-right: none;
	}

	.add-language-btn {
		padding: 3px 6px;
		border: 1px solid var(--interactive-accent);
		border-radius: 3px;
		background: transparent;
		color: var(--interactive-accent);
		font-size: 10px;
		cursor: pointer;
		transition: all 0.2s;
		white-space: nowrap;
		margin-left: 6px;
	}

	.add-language-btn:hover {
		background: var(--interactive-accent);
		color: var(--text-on-accent);
	}

	.multilang-row {
		display: grid;
		grid-template-columns: 1fr 2fr;
		border-bottom: 1px solid var(--background-modifier-border);
		transition: background-color 0.2s;
	}

	.multilang-row:last-child {
		border-bottom: none;
	}

	.multilang-row:hover {
		background: var(--background-modifier-hover);
	}

	.multilang-cell {
		padding: 8px 10px;
		display: flex;
		align-items: center;
		border-right: 1px solid var(--background-modifier-border);
		min-height: 34px;
		box-sizing: border-box;
		overflow: hidden;
		min-width: 0;
	}

	.multilang-cell:last-child {
		border-right: none;
	}

	.content-path-cell {
		gap: 6px;
	}

	.multilang-cell .content-path {
		color: var(--text-normal);
		font-size: 12px;
		flex: 1;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		min-width: 0;
	}

	.default-badge {
		background: var(--interactive-accent);
		color: var(--text-on-accent);
		padding: 2px 5px;
		border-radius: 3px;
		font-size: 10px;
		font-weight: 500;
		white-space: nowrap;
	}

	.language-cell {
		display: flex;
		align-items: center;
		gap: 6px;
	}

	.language-select {
		flex: 1;
		max-width: 160px;
		padding: 4px 8px;
		border: 1px solid var(--background-modifier-border);
		border-radius: 3px;
		background: var(--background-primary);
		color: var(--text-normal);
		font-size: 12px;
		appearance: none;
		background-image: url("data:image/svg+xml;charset=UTF-8,%3csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3e%3cpolyline points='6,9 12,15 18,9'%3e%3c/polyline%3e%3c/svg%3e");
		background-repeat: no-repeat;
		background-position: right 5px center;
		background-size: 10px;
		padding-right: 20px;
		cursor: pointer;
	}

	.remove-btn {
		width: 18px;
		height: 18px;
		border: none;
		border-radius: 50%;
		background: transparent;
		color: var(--text-muted);
		font-size: 14px;
		cursor: pointer;
		display: flex;
		align-items: center;
		justify-content: center;
		transition: all 0.2s;
		opacity: 0;
		margin-left: 4px;
	}

	.multilang-row:hover .remove-btn {
		opacity: 1;
	}

	.remove-btn:hover {
		background: var(--background-modifier-error);
		color: var(--text-on-accent);
		transform: scale(1.1);
	}

	.remove-icon {
		line-height: 1;
		font-weight: bold;
	}

	.multilang-empty {
		padding: 16px;
		text-align: center;
		color: var(--text-muted);
		font-style: italic;
	}

	.empty-message {
		font-size: 12px;
	}

	/* Site Assets */
	.site-assets-container {
		border: 1px solid var(--background-modifier-border);
		border-radius: 4px;
		background: var(--background-primary);
	}

	.assets-display {
		padding: 8px 10px;
		display: flex;
		align-items: center;
		justify-content: space-between;
		min-height: 34px;
		box-sizing: border-box;
	}

	.assets-path {
		color: var(--text-normal);
		font-size: 12px;
		flex: 1;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		min-width: 0;
	}

	.assets-placeholder {
		color: var(--text-muted);
		font-size: 12px;
		font-style: italic;
		flex: 1;
	}

	.clear-assets-btn {
		padding: 3px 6px;
		border: 1px solid var(--interactive-accent);
		border-radius: 3px;
		background: transparent;
		color: var(--interactive-accent);
		font-size: 10px;
		cursor: pointer;
		transition: all 0.2s;
		white-space: nowrap;
		margin-left: 6px;
	}

	.clear-assets-btn:hover {
		background: var(--interactive-accent);
		color: var(--text-on-accent);
	}

	.assets-hint {
		padding: 6px 10px;
		background: var(--background-secondary);
		border-top: 1px solid var(--background-modifier-border);
		font-size: 11px;
		color: var(--text-muted);
		line-height: 1.4;
	}

	/* FTP Test Connection */
	.ftp-test-btn {
		width: 100%;
		padding: 8px 16px;
		border: 1px solid var(--interactive-accent);
		border-radius: 4px;
		background: transparent;
		color: var(--interactive-accent);
		font-size: 13px;
		font-weight: 500;
		cursor: pointer;
		transition: all 0.2s;
		min-height: 34px;
	}

	.ftp-test-btn:hover:not(:disabled) {
		background: var(--interactive-accent);
		color: var(--text-on-accent);
	}

	.ftp-test-btn:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.ftp-test-btn.ftp-test-success {
		background-color: var(--color-green) !important;
		color: white !important;
		border-color: var(--color-green) !important;
	}

	.ftp-test-btn.ftp-test-error {
		background-color: var(--color-red) !important;
		color: white !important;
		border-color: var(--color-red) !important;
	}

	.ftp-test-result {
		margin-top: 6px;
		padding: 6px 10px;
		border-radius: 3px;
		font-size: 11px;
		line-height: 1.4;
		display: block;
		width: 100%;
		box-sizing: border-box;
	}

	.ftp-test-result-success {
		background-color: rgba(var(--color-green-rgb), 0.1);
		color: var(--color-green);
		border: 1px solid rgba(var(--color-green-rgb), 0.3);
	}

	.ftp-test-result-error {
		background-color: rgba(var(--color-red-rgb), 0.1);
		color: var(--color-red);
		border: 1px solid rgba(var(--color-red-rgb), 0.3);
	}
</style> 
