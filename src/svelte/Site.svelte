<script lang="ts">
	import {App, Notice, TFolder, TFile, FileSystemAdapter, requestUrl} from "obsidian";
	import FridayPlugin from "../main";
	import ProgressBar from "./ProgressBar.svelte";
	import {onMount, onDestroy, tick} from "svelte";
	import type { ValidPublishMethod } from "../types/publish";
	import { normalizePublishMethod, VALID_PUBLISH_METHODS, DEFAULT_PUBLISH_METHOD } from "../types/publish";
	import { generateRandomId } from "../utils/common";
	import * as path from "path";
	import * as fs from "fs";
	import {startIncrementalBuild, IncrementalBuildConfig, IncrementalBuildCoordinator} from "@mdfriday/foundry";
	import JSZip from "jszip";
	import {GetBaseUrl} from "../main";
	import {createStyleRenderer, OBStyleRenderer} from "../markdown";
	import {themeApiService} from "../theme/themeApiService";
	import type { ProjectState, ProgressUpdate } from "../types/events";

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
		// Update publish options - always show all 6 options
		publishOptions = [
			{ value: 'netlify', label: t('ui.publish_option_netlify') },
			{ value: 'ftp', label: t('ui.publish_option_ftp') },
			{ value: 'mdf-share', label: t('ui.publish_option_mdfriday_share') },
			{ value: 'mdf-app', label: t('ui.publish_option_mdfriday_app') },
			{ value: 'mdf-custom', label: t('ui.publish_option_mdfriday_custom') },
			{ value: 'mdf-enterprise', label: t('ui.publish_option_mdfriday_enterprise') },
		];
	}

	// Helper function to check if current publish option has required permission
	function hasCurrentPublishPermission(): boolean {
		const licenseState = plugin.licenseState;
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
			case 'netlify':
			case 'ftp':
				return true; // No license required for Netlify and FTP
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
			} else {
				// Fallback to old method if event system not available
				await plugin.saveFoundryProjectConfig(plugin.currentProjectName, actualKey, actualValue);
			}
			
			console.log(`[Site] Saved config: ${key} = ${value}`);
		} catch (error) {
			console.error('[Site] Error saving config:', error);
		}
	}

	// ==================== End Foundry Integration Functions ====================

	// ==================== Public Interface Methods (called by Main.ts) ====================

	/**
	 * Initialize component with project state
	 * Called by Main.ts after project creation or when loading existing project
	 */
	export async function initialize(state: ProjectState) {
		console.log('[Site] Initializing with project state:', state.name);

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
							selectedThemeId = 17;
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
		console.log('[Site] Preview started:', result.url);
	}

	/**
	 * Preview error callback
	 */
	export function onPreviewError(error: string) {
		serverRunning = false;
		hasPreview = false;
		buildProgress = 0;
		isBuilding = false;
		console.error('[Site] Preview error:', error);
	}

	/**
	 * Preview stopped callback
	 */
	export function onPreviewStopped() {
		serverRunning = false;
		hasPreview = false;
		console.log('[Site] Preview stopped');
	}

	/**
	 * Publish complete callback
	 */
	export function onPublishComplete(result: any) {
		publishProgress = 100;
		isPublishing = false;
		publishSuccess = true;
		
		// Set publish URL if available
		if (result.url) {
			publishUrl = result.url;
			console.log('[Site] Publish completed:', result.url);
		} else {
			publishUrl = '';
			console.log('[Site] Publish completed (no URL returned)');
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
	let httpServer: IncrementalBuildCoordinator;
	let serverRunning = false;
	let serverHost = 'localhost';
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
		
		// ==================== OLD ARCHITECTURE: Register callbacks (for Project Management Modal only) ====================
		// TODO: These will be removed when Project Management feature is refactored
		plugin.applyProjectConfigurationToPanel = applyProjectConfiguration;
		plugin.exportHistoryBuild = exportHistoryBuild;
		plugin.clearPreviewHistory = clearPreviewHistory;
		
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
			httpServer.stopWatching();
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
			
			// Load default publish config from settings if project doesn't have one
			loadDefaultPublishConfigIfNeeded();
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
	
	function getLanguageName(code: string): string {
		const lang = SUPPORTED_LANGUAGES.find(l => l.code === code);
		return lang ? lang.name : code;
	}

	function showAddLanguageDialog() {
		// Show a simple notice asking user to right-click a folder/file
		new Notice(t('messages.add_language_instruction'), 5000);
	}

	/**
	 * Load publish config when content is added
	 * - If project exists with config: apply project config
	 * - If project doesn't have config: apply settings defaults
	 */
	function loadDefaultPublishConfigIfNeeded() {
		// Get project ID to check if it exists
		const projectId = getProjectId();
		if (!projectId) {
			return;
		}

		// Check if project already exists
		const existingProject = plugin.projectService.getProject(projectId);
		
		if (existingProject && existingProject.publishConfig) {
			selectedPublishOption = existingProject.publishConfig.method || 'netlify';
			
			// Apply Netlify config
			netlifyAccessToken = existingProject.publishConfig.netlify?.accessToken || '';
			netlifyProjectId = existingProject.publishConfig.netlify?.projectId || '';
			
			// Apply FTP config
			ftpServer = existingProject.publishConfig.ftp?.server || '';
			ftpUsername = existingProject.publishConfig.ftp?.username || '';
			ftpPassword = existingProject.publishConfig.ftp?.password || '';
			ftpRemoteDir = existingProject.publishConfig.ftp?.remoteDir || '';
			ftpIgnoreCert = existingProject.publishConfig.ftp?.ignoreCert !== undefined 
				? existingProject.publishConfig.ftp.ignoreCert 
				: true;
			ftpPreferredSecure = existingProject.publishConfig.ftp?.preferredSecure;
		} else {
			// Map 'mdfriday' from settings to 'netlify' as default
			const settingsMethod = plugin.settings.publishMethod;
			selectedPublishOption = (settingsMethod === 'mdfriday' ? 'netlify' : settingsMethod) || 'netlify';
			
			// Load Netlify defaults
			netlifyAccessToken = plugin.settings.netlifyAccessToken || '';
			netlifyProjectId = plugin.settings.netlifyProjectId || '';
			
			// Load FTP defaults
			ftpServer = plugin.settings.ftpServer || '';
			ftpUsername = plugin.settings.ftpUsername || '';
			ftpPassword = plugin.settings.ftpPassword || '';
			ftpRemoteDir = plugin.settings.ftpRemoteDir || '';
			ftpIgnoreCert = plugin.settings.ftpIgnoreCert !== undefined 
				? plugin.settings.ftpIgnoreCert 
				: true;
			ftpPreferredSecure = undefined; // Default to plain FTP
		}
		
		// Reset FTP test state
		ftpTestState = 'idle';
		ftpTestMessage = '';
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

	async function exportHistoryBuild(previewId: string) {
		try {
			// Construct path to the preview directory
			const previewDir = path.join(plugin.pluginDir, 'preview', previewId);
			const publicDir = path.join(previewDir, 'public');
			
			// Check if the directory exists
			const adapter = app.vault.adapter;
			if (!(await adapter.exists(publicDir))) {
				new Notice(t('projects.preview_not_found'), 5000);
				return;
			}
			
			// Get absolute path
			const absPublicDir = path.join(basePath, publicDir);
			
			// Create ZIP from public directory
			const zipContent = await createZipFromDirectory(absPublicDir);

			// Use Electron's dialog API to show save dialog
			const { dialog } = require('@electron/remote') || require('electron').remote;
			const { canceled, filePath } = await dialog.showSaveDialog({
				title: t('ui.export_site_dialog_title'),
				defaultPath: `mdfriday-site-${previewId}.zip`,
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
			console.error('Export history build failed:', error);
			new Notice(t('messages.export_failed', { error: error.message }), 5000);
		}
	}

	async function clearPreviewHistory(projectId: string) {
		try {
			// Show confirmation dialog
			const confirmed = confirm(t('projects.confirm_clear_history'));
			if (!confirmed) {
				return;
			}

			// Get all build history for this project
			const buildHistory = plugin.projectService.getBuildHistory(projectId, 1000);
			
			// Extract all previewIds
			const previewIds = buildHistory
				.filter(h => h.previewId)
				.map(h => h.previewId!);
			
			if (previewIds.length === 0) {
				new Notice(t('projects.no_preview_files'), 3000);
				return;
			}

			// Get preview root directory
			const previewRoot = path.join(plugin.pluginDir, 'preview');
			const adapter = app.vault.adapter;
			
			// Check if preview directory exists
			if (!(await adapter.exists(previewRoot))) {
				new Notice(t('projects.no_preview_files'), 3000);
				return;
			}

			// Get absolute path for file system operations
			const absPreviewRoot = path.join(basePath, previewRoot);
			let deletedCount = 0;

			// Delete only the preview directories belonging to this project
			for (const previewId of previewIds) {
				const previewDirPath = path.join(absPreviewRoot, previewId);
				try {
					// Check if directory exists before deleting
					if (await fs.promises.access(previewDirPath).then(() => true).catch(() => false)) {
						await fs.promises.rm(previewDirPath, { recursive: true, force: true });
						deletedCount++;
					}
				} catch (error) {
					console.warn(`Failed to delete preview directory ${previewId}:`, error);
				}
			}

			// Clear build history for this project
			await plugin.projectService.clearProjectBuildHistory(projectId);

			if (deletedCount > 0) {
				new Notice(t('projects.preview_history_cleared', { count: deletedCount }), 3000);
			} else {
				new Notice(t('projects.no_preview_files'), 3000);
			}
		} catch (error) {
			console.error('Clear preview history failed:', error);
			new Notice(t('messages.export_failed', { error: error.message }), 5000);
		}
	}

	async function applyProjectConfiguration(project: any) {
		try {
			// Clear existing content first
			site.clearAllContent();
			
			// Apply site name
			siteName = project.name;
			
			// Apply theme
			selectedThemeDownloadUrl = project.themeUrl;
			selectedThemeName = project.themeName;
			selectedThemeId = project.themeId;
			userHasSelectedTheme = true;
			
			// Apply site path
			sitePath = project.sitePath;
			
			// Apply advanced settings
			googleAnalyticsId = project.googleAnalyticsId || '';
			disqusShortname = project.disqusShortname || '';
			sitePassword = project.sitePassword || '';
			
			// Apply publish settings
			if (project.publishConfig) {
				// Project has config, use it
				selectedPublishOption = project.publishConfig.method || 'netlify';
				
				// Apply Netlify config
				netlifyAccessToken = project.publishConfig.netlify?.accessToken || '';
				netlifyProjectId = project.publishConfig.netlify?.projectId || '';
				
				// Apply FTP config
				ftpServer = project.publishConfig.ftp?.server || '';
				ftpUsername = project.publishConfig.ftp?.username || '';
				ftpPassword = project.publishConfig.ftp?.password || '';
				ftpRemoteDir = project.publishConfig.ftp?.remoteDir || '';
				ftpIgnoreCert = project.publishConfig.ftp?.ignoreCert !== undefined ? project.publishConfig.ftp.ignoreCert : true;
				ftpPreferredSecure = project.publishConfig.ftp?.preferredSecure;
			} else {
				// Project doesn't have config, load defaults from settings
				// Map 'mdfriday' from settings to 'netlify' as default
				const settingsMethod = plugin.settings.publishMethod;
				selectedPublishOption = (settingsMethod === 'mdfriday' ? 'netlify' : settingsMethod) || 'netlify';
				
				// Load Netlify defaults
				netlifyAccessToken = plugin.settings.netlifyAccessToken || '';
				netlifyProjectId = plugin.settings.netlifyProjectId || '';
				
				// Load FTP defaults
				ftpServer = plugin.settings.ftpServer || '';
				ftpUsername = plugin.settings.ftpUsername || '';
				ftpPassword = plugin.settings.ftpPassword || '';
				ftpRemoteDir = plugin.settings.ftpRemoteDir || '';
				ftpIgnoreCert = plugin.settings.ftpIgnoreCert !== undefined ? plugin.settings.ftpIgnoreCert : true;
				ftpPreferredSecure = undefined; // Default to plain FTP for new projects
			}
			
			// Reset FTP test state
			ftpTestState = 'idle';
			ftpTestMessage = '';
			
			// Try to reload content paths
			let contentLoadedCount = 0;
			if (project.contents && project.contents.length > 0) {
				for (let i = 0; i < project.contents.length; i++) {
					const contentConfig = project.contents[i];
					const abstractFile = app.vault.getAbstractFileByPath(contentConfig.contentPath);
					
					if (abstractFile) {
						if (abstractFile instanceof TFolder) {
							if (i === 0) {
								site.initializeContentWithLanguage(abstractFile, null, contentConfig.languageCode);
							} else {
								site.addLanguageContentWithCode(abstractFile, null, contentConfig.languageCode);
							}
							contentLoadedCount++;
						} else if (abstractFile instanceof TFile && abstractFile.extension === 'md') {
							if (i === 0) {
								site.initializeContentWithLanguage(null, abstractFile, contentConfig.languageCode);
							} else {
								site.addLanguageContentWithCode(null, abstractFile, contentConfig.languageCode);
							}
							contentLoadedCount++;
						}
					} else {
						console.warn(`Content path not found: ${contentConfig.contentPath}`);
					}
				}
			}
			
			// Try to reload site assets
			if (project.assetsPath) {
				const assetsFile = app.vault.getAbstractFileByPath(project.assetsPath);
				if (assetsFile instanceof TFolder) {
					site.setSiteAssets(assetsFile);
				} else {
					console.warn(`Assets path not found: ${project.assetsPath}`);
				}
			}
			
			// Show appropriate message
			if (contentLoadedCount > 0) {
				const contentText = contentLoadedCount === 1 ? 'content' : 'contents';
				new Notice(t('projects.project_applied') + `\n✅ ${contentLoadedCount} ${contentText} loaded`, 3000);
			} else {
				new Notice(t('projects.project_applied_no_content'), 5000);
			}
		} catch (error) {
			console.error('Failed to apply project configuration:', error);
			new Notice(t('messages.export_failed', { error: error.message }), 5000);
		}
	}

	/**
	 * Get project ID from current content
	 * If content is in a content subfolder, returns parent folder path
	 * Otherwise returns content path
	 */
	function getProjectId(): string {
		if (currentContents.length === 0) {
			return '';
		}

		const firstContent = currentContents[0];
		let projectId = firstContent.folder?.path || firstContent.file?.path || '';
		
		// Try to get parent folder for better project identification
		const contentFolder = firstContent.folder || (firstContent.file ? firstContent.file.parent : null);
		if (contentFolder && contentFolder.parent) {
			// Check if this looks like a content subfolder (content, content.en, etc.)
			const folderName = contentFolder.name.toLowerCase();
			if (folderName === 'content' || folderName.startsWith('content.')) {
				// Use parent folder path as project ID
				projectId = contentFolder.parent.path;
			}
		}
		
		return projectId;
	}

	async function saveCurrentProjectConfiguration() {
		if (currentContents.length === 0 || !siteName) {
			// No content to save
			return;
		}

		try {
			// Get project ID using helper function
			const projectId = getProjectId();
			
			if (!projectId) {
				return;
			}
			
			// Always use user's input site name
			const projectName = siteName;

			// Check if project already exists to preserve createdAt
			const existingProject = plugin.projectService.getProject(projectId);
			const now = Date.now();

			// Build publish config (only if there's actual configuration)
			const hasNetlifyConfig = !!(netlifyAccessToken || netlifyProjectId);
			const hasFtpConfig = !!(ftpServer || ftpUsername || ftpPassword || ftpRemoteDir);
			const hasPublishConfig = hasNetlifyConfig || hasFtpConfig;
			
			// Build project config
			const projectConfig = {
				id: projectId,
				name: projectName,
				contents: currentContents.map(content => ({
					languageCode: content.languageCode,
					contentPath: content.folder?.path || content.file?.path || '',
					weight: content.weight
				})),
				defaultContentLanguage: defaultContentLanguage,
				assetsPath: currentAssets?.folder?.path || undefined,
				sitePath: sitePath,
				themeUrl: selectedThemeDownloadUrl,
				themeName: selectedThemeName,
				themeId: selectedThemeId,
				googleAnalyticsId: googleAnalyticsId || undefined,
				disqusShortname: disqusShortname || undefined,
				sitePassword: sitePassword || undefined,
				publishConfig: hasPublishConfig ? {
					method: selectedPublishOption,
					netlify: hasNetlifyConfig ? {
						accessToken: netlifyAccessToken || undefined,
						projectId: netlifyProjectId || undefined
					} : undefined,
					ftp: hasFtpConfig ? {
						server: ftpServer || undefined,
						username: ftpUsername || undefined,
						password: ftpPassword || undefined,
						remoteDir: ftpRemoteDir || undefined,
						ignoreCert: ftpIgnoreCert,
						preferredSecure: ftpPreferredSecure
					} : undefined
				} : undefined,
				createdAt: existingProject?.createdAt || now,
				updatedAt: now
			};

			// Save to project service
			await plugin.projectService.saveProject(projectConfig);
		} catch (error) {
			console.error('Failed to save project configuration:', error);
		}
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
			} else {
				// Fallback to old method if event system not available
				await plugin.saveFoundryProjectConfig(
					plugin.currentProjectName,
					'publish',
					publishConfig
				);
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
				// Note: State will be updated by onPreviewStopped() callback
			} else {
				// Fallback to direct method
				await plugin.stopFoundryPreviewServer();
				// Manually update state for fallback path
				hasPreview = false;
				previewUrl = '';
				serverRunning = false;
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
		} else if (selectedPublishOption === 'mdf-share') {
			publishConfig = {
				type: 'mdfriday',
				deploymentType: 'share',
				enabled: true,
				accessToken: plugin.licenseState?.getAccessToken() || '',
				licenseKey: plugin.licenseState?.getLicenseKey() || '',
				apiUrl: plugin.licenseState?.getApiUrl() || GetBaseUrl(plugin.settings)
			};
		} else if (selectedPublishOption === 'mdf-app') {
			publishConfig = {
				type: 'mdfriday',
				deploymentType: 'sub',
				enabled: true,
				accessToken: plugin.licenseState?.getAccessToken() || '',
				licenseKey: plugin.licenseState?.getLicenseKey() || '',
				apiUrl: plugin.licenseState?.getApiUrl() || GetBaseUrl(plugin.settings)
			};
		} else if (selectedPublishOption === 'mdf-custom') {
			publishConfig = {
				type: 'mdfriday',
				deploymentType: 'custom',
				enabled: true,
				accessToken: plugin.licenseState?.getAccessToken() || '',
				licenseKey: plugin.licenseState?.getLicenseKey() || '',
				apiUrl: plugin.licenseState?.getApiUrl() || GetBaseUrl(plugin.settings)
			};
		} else if (selectedPublishOption === 'mdf-enterprise') {
			publishConfig = {
				type: 'mdfriday',
				deploymentType: 'enterprise',
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
		// Check if Foundry Publish Service is available
		if (!plugin.foundryPublishService) {
			ftpTestState = 'error';
			ftpTestMessage = 'Publish service not initialized';
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
			// Save configuration before testing (ensures config is available for test)
			await savePublishConfig();
			
			// Prepare FTP configuration
			const ftpConfig = {
				type: 'ftp',
				host: ftpServer,
				username: ftpUsername,
				password: ftpPassword,
				remotePath: ftpRemoteDir || '/',
				secure: ftpPreferredSecure !== undefined ? ftpPreferredSecure : true, // Default to secure
			};
			
			// Use Foundry Publish Service to test connection
			const result = await plugin.foundryPublishService.testConnection(
				plugin.absWorkspacePath,
				plugin.currentProjectName,
				ftpConfig
			);
			
			if (result.success) {
				ftpTestState = 'success';
				ftpTestMessage = result.message || t('settings.ftp_test_connection_success');
				
				// If the result includes connection type info, remember it
				if (result.data?.usedSecure !== undefined) {
					ftpPreferredSecure = result.data.usedSecure;
					console.log('[FTP Test] Connection type:', ftpPreferredSecure ? 'FTPS' : 'FTP');
				}
			} else {
				ftpTestState = 'error';
				ftpTestMessage = result.error || t('settings.ftp_test_connection_failed');
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

	// Note: generateRandomId is now imported from utils/common.ts

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
					zipFolder.file(item.name, fileContent);
				}
			}
		};

		await addDirectoryToZip(sourceDir, zip);
		
		// Generate ZIP file
		return await zip.generateAsync({ type: 'uint8array' });
	}
</script>

<div class="site-builder">
	<!-- Multi-language Content Section -->
	<div class="section">
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
	<div class="section">
		<label class="section-label" for="site-name">{t('ui.site_name')}</label>
		<input
			type="text"
			class="form-input"
		bind:value={siteName}
		on:blur={() => saveFoundryConfig('title', siteName)}
		placeholder={t('ui.site_name_placeholder')}
		/>
	</div>

	<!-- Site Assets -->
	<div class="section">
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

	<!-- Advanced Settings -->
	<div class="section">
		<div class="advanced-settings">
			<button 
				class="advanced-toggle" 
				on:click={toggleAdvancedSettings}
				aria-expanded={showAdvancedSettings}
			>
				<span class="toggle-icon" class:expanded={showAdvancedSettings}>▶</span>
{t('ui.advanced_settings')}
			</button>
			
			{#if showAdvancedSettings}
				<div class="advanced-content">
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

	<!-- Theme Selection -->
	<div class="section">
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
	<div class="section">
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

	<!-- Publish Section -->
	<div class="section">
		<h3 class="section-title">{t('ui.publish')}</h3>
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

			<!-- Publish Button -->
			<div class="publish-actions">
				{#if isPublishing}
					<div class="progress-container">
						<p>{t('ui.publish_building')}</p>
						<ProgressBar progress={publishProgress} />
					</div>
				{:else}
					<button
						class="action-button publish-button"
						on:click={startPublish}
						disabled={!hasPreview || isPublishDisabled}
					>
						{t('ui.publish')}
					</button>
				{/if}
			</div>

			{#if publishSuccess}
				<div class="publish-success">
					<p class="success-message">{t('ui.published_successfully')}</p>
					{#if publishUrl}
						<a href={publishUrl} target="_blank" class="publish-url">{publishUrl}</a>
					{:else if selectedPublishOption === 'ftp'}
						<p class="ftp-success-info">{t('messages.ftp_upload_success')}</p>
					{/if}
				</div>
			{/if}
		</div>
	</div>
</div>

<style>
	.site-builder {
		padding: 20px;
		max-width: 100%;
	}

	.section {
		margin-bottom: 20px;
	}

	.section-label {
		display: block;
		margin-bottom: 8px;
		font-weight: 500;
		color: var(--text-normal);
		font-size: 14px;
	}

	.form-input {
		width: 100%;
		padding: 10px 12px;
		border: 1px solid var(--background-modifier-border);
		border-radius: 4px;
		background: var(--background-primary);
		color: var(--text-normal);
		font-size: 14px;
		line-height: 1.4;
		box-sizing: border-box;
		min-height: 38px;
	}

	.form-select {
		width: 100%;
		border: 1px solid var(--background-modifier-border);
		border-radius: 4px;
		background: var(--background-primary);
		color: var(--text-normal);
		font-size: 14px;
		line-height: 1.4;
		box-sizing: border-box;
		min-height: 38px;
		appearance: none;
		background-image: url("data:image/svg+xml;charset=UTF-8,%3csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3e%3cpolyline points='6,9 12,15 18,9'%3e%3c/polyline%3e%3c/svg%3e");
		background-repeat: no-repeat;
		background-position: right 12px center;
		background-size: 16px;
		padding-right: 40px;
	}

	.theme-selector {
		width: 100%;
	}

	.current-theme {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 10px 12px;
		border: 1px solid var(--background-modifier-border);
		border-radius: 4px;
		background: var(--background-primary);
		min-height: 38px;
		box-sizing: border-box;
	}

	.theme-name {
		color: var(--text-normal);
		font-size: 14px;
		flex: 1;
	}

	.theme-actions {
		display: flex;
		align-items: center;
		gap: 8px;
	}

	.change-theme-btn {
		padding: 6px 12px;
		border: 1px solid var(--interactive-accent);
		border-radius: 3px;
		background: transparent;
		color: var(--interactive-accent);
		font-size: 12px;
		cursor: pointer;
		transition: all 0.2s;
		white-space: nowrap;
	}

	.change-theme-btn:hover {
		background: var(--interactive-accent);
		color: var(--text-on-accent);
	}

	.download-sample-btn {
		padding: 6px 12px;
		border: 1px solid var(--text-accent);
		border-radius: 3px;
		background: transparent;
		color: var(--text-accent);
		font-size: 12px;
		cursor: pointer;
		transition: all 0.2s;
		white-space: nowrap;
	}

	.download-sample-btn:hover {
		background: var(--text-accent);
		color: var(--text-on-accent);
	}

	.sample-download-progress {
		display: flex;
		flex-direction: column;
		gap: 4px;
		min-width: 120px;
	}

	.progress-text {
		font-size: 11px;
		color: var(--text-muted);
		text-align: center;
	}

	.section-title {
		margin: 0 0 10px 0;
		font-size: 16px;
		font-weight: 600;
		color: var(--text-normal);
	}

	.preview-section, .publish-section {
		padding: 15px;
		border: 1px solid var(--background-modifier-border);
		border-radius: 6px;
		background: var(--background-secondary);
	}

	.action-button {
		padding: 10px 20px;
		border: none;
		border-radius: 4px;
		background: var(--interactive-accent);
		color: var(--text-on-accent);
		font-size: 14px;
		font-weight: 500;
		cursor: pointer;
		transition: background-color 0.2s;
		min-height: 38px;
	}

	.action-button:hover:not(:disabled) {
		background: var(--interactive-accent-hover);
	}

	.action-button:disabled {
		background: var(--background-modifier-border);
		color: var(--text-muted);
		cursor: not-allowed;
	}

	.preview-button {
		margin-bottom: 10px;
	}

	.publish-button {
		margin-left: 10px;
	}

	.preview-link, .publish-success {
		margin-top: 15px;
		padding: 10px;
		background: var(--background-primary);
		border-radius: 4px;
		border: 1px solid var(--background-modifier-border);
	}

	.preview-url, .publish-url {
		display: block;
		color: var(--interactive-accent);
		text-decoration: none;
		word-break: break-all;
		margin-top: 5px;
	}

	.preview-url:hover, .publish-url:hover {
		text-decoration: underline;
	}

	.progress-container {
		margin: 10px 0;
	}

	.progress-container p {
		margin: 0 0 10px 0;
		color: var(--text-muted);
		font-size: 14px;
	}

	.publish-select-wrapper {
		margin-bottom: 16px;
	}

	.publish-config {
		background: var(--background-secondary);
		border: 1px solid var(--background-modifier-border);
		border-radius: 4px;
		padding: 16px;
		margin-bottom: 16px;
	}

	.config-field {
		margin-bottom: 16px;
	}

	.config-field:last-child {
		margin-bottom: 0;
	}

	.checkbox-label {
		display: flex;
		align-items: center;
		gap: 8px;
		cursor: pointer;
		font-size: 14px;
		color: var(--text-normal);
	}

	.checkbox-label input[type="checkbox"] {
		width: 16px;
		height: 16px;
		cursor: pointer;
	}

	.publish-actions {
		margin-top: 16px;
	}

	.success-message {
		margin: 0 0 5px 0;
		color: var(--text-success);
		font-weight: 500;
	}

	.ftp-success-info {
		margin: 5px 0 0 0;
		color: var(--text-muted);
		font-size: 14px;
	}

	.preview-actions {
		margin-top: 10px;
		display: flex;
		gap: 10px;
	}

	.export-button {
		background: var(--interactive-normal);
		color: var(--text-normal);
		border: 1px solid var(--background-modifier-border);
	}

	.export-button:hover:not(:disabled) {
		background: var(--interactive-hover);
	}

	.export-button:disabled {
		opacity: 0.6;
	}

	.advanced-settings {
		border: 1px solid var(--background-modifier-border);
		border-radius: 4px;
		overflow: hidden;
	}

	.advanced-toggle {
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
		box-shadow: none;
	}

	.advanced-toggle:hover {
		background: var(--background-modifier-hover);
	}

	.toggle-icon {
		transition: transform 0.2s;
		font-size: 12px;
		color: var(--text-muted);
	}

	.toggle-icon.expanded {
		transform: rotate(90deg);
	}

	.advanced-content {
		background: var(--background-secondary);
		padding: 16px;
		border-top: 1px solid var(--background-modifier-border);
	}

	.advanced-field {
		margin-bottom: 16px;
	}

	.advanced-field:last-child {
		margin-bottom: 0;
	}

	.field-hint {
		font-size: 12px;
		color: var(--text-muted);
		margin-top: 4px;
		line-height: 1.4;
	}

	.license-warning {
		font-size: 12px;
		color: var(--text-accent);
		background: var(--background-secondary);
		border: 1px solid var(--background-modifier-border);
		padding: 8px 12px;
		border-radius: 4px;
		margin-top: 8px;
		line-height: 1.4;
	}

	/* Multi-language table styles */
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
		padding: 10px 12px;
		font-weight: 500;
		font-size: 14px;
		color: var(--text-normal);
		border-right: 1px solid var(--background-modifier-border);
		display: flex;
		align-items: center;
		justify-content: space-between;
		overflow: hidden;
		min-width: 0;
	}

	.add-language-btn {
		padding: 4px 8px;
		border: 1px solid var(--interactive-accent);
		border-radius: 3px;
		background: transparent;
		color: var(--interactive-accent);
		font-size: 11px;
		cursor: pointer;
		transition: all 0.2s;
		white-space: nowrap;
		margin-left: 8px;
	}

	.add-language-btn:hover {
		background: var(--interactive-accent);
		color: var(--text-on-accent);
	}

	.multilang-header-cell:last-child {
		border-right: none;
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
		padding: 10px 12px;
		display: flex;
		align-items: center;
		border-right: 1px solid var(--background-modifier-border);
		min-height: 38px;
		box-sizing: border-box;
		overflow: hidden;
		min-width: 0;
	}

	.multilang-cell:last-child {
		border-right: none;
	}

	.content-path-cell {
		gap: 8px;
	}

	.content-path {
		color: var(--text-normal);
		font-size: 14px;
		flex: 1;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		min-width: 0;
	}

	.default-badge {
		background: var(--interactive-accent);
		color: var(--text-on-accent);
		padding: 2px 6px;
		border-radius: 3px;
		font-size: 11px;
		font-weight: 500;
		white-space: nowrap;
	}

	.language-cell {
		display: flex;
		align-items: center;
		gap: 8px;
	}

	.language-select {
		flex: 1;
		max-width: 180px;
		padding: 4px 8px;
		border: 1px solid var(--background-modifier-border);
		border-radius: 3px;
		background: var(--background-primary);
		color: var(--text-normal);
		font-size: 13px;
		appearance: none;
		background-image: url("data:image/svg+xml;charset=UTF-8,%3csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3e%3cpolyline points='6,9 12,15 18,9'%3e%3c/polyline%3e%3c/svg%3e");
		background-repeat: no-repeat;
		background-position: right 6px center;
		background-size: 12px;
		padding-right: 24px;
	}

	.remove-btn {
		width: 20px;
		height: 20px;
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
		padding: 20px;
		text-align: center;
		color: var(--text-muted);
		font-style: italic;
	}

	.empty-message {
		font-size: 14px;
	}

	/* Site Assets styles */
	.site-assets-container {
		border: 1px solid var(--background-modifier-border);
		border-radius: 4px;
		background: var(--background-primary);
	}

	.assets-display {
		padding: 10px 12px;
		display: flex;
		align-items: center;
		justify-content: space-between;
		min-height: 38px;
		box-sizing: border-box;
	}

	.assets-path {
		color: var(--text-normal);
		font-size: 14px;
		flex: 1;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		min-width: 0;
	}

	.assets-placeholder {
		color: var(--text-muted);
		font-size: 14px;
		font-style: italic;
		flex: 1;
	}

	.clear-assets-btn {
		padding: 4px 8px;
		border: 1px solid var(--interactive-accent);
		border-radius: 3px;
		background: transparent;
		color: var(--interactive-accent);
		font-size: 11px;
		cursor: pointer;
		transition: all 0.2s;
		white-space: nowrap;
		margin-left: 8px;
	}

	.clear-assets-btn:hover {
		background: var(--interactive-accent);
		color: var(--text-on-accent);
	}

	.assets-hint {
		padding: 8px 12px;
		background: var(--background-secondary);
		border-top: 1px solid var(--background-modifier-border);
		font-size: 12px;
		color: var(--text-muted);
		line-height: 1.4;
	}

	/* FTP Test Connection Styles */
	.ftp-test-btn {
		padding: 10px 20px;
		border: 1px solid var(--interactive-accent);
		border-radius: 4px;
		background: transparent;
		color: var(--interactive-accent);
		font-size: 14px;
		font-weight: 500;
		cursor: pointer;
		transition: all 0.2s;
		min-height: 38px;
	}

	.ftp-test-btn:hover:not(:disabled) {
		background: var(--interactive-accent);
		color: var(--text-on-accent);
	}

	.ftp-test-btn:disabled {
		opacity: 0.6;
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
		margin-top: 8px;
		padding: 8px 12px;
		border-radius: 4px;
		font-size: 13px;
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
