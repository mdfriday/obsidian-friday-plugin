<script lang="ts">
	import {App, Notice, TFolder, TFile, FileSystemAdapter, requestUrl} from "obsidian";
	import FridayPlugin from "../main";
	import ProgressBar from "./ProgressBar.svelte";
	import {onMount, onDestroy} from "svelte";
	import * as path from "path";
	import * as fs from "fs";
	import {startIncrementalBuild, IncrementalBuildConfig, IncrementalBuildCoordinator} from "@mdfriday/foundry";
	import JSZip from "jszip";
	import {GetBaseUrl} from "../main";
	import {createStyleRenderer, OBStyleRenderer} from "../markdown";
	import {themeApiService} from "../theme/themeApiService";

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
	let selectedPublishOption: 'netlify' | 'ftp' | 'mdf-preview' = plugin.settings.publishMethod || 'netlify';
	
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
	
	// Reactive publish options
	$: publishOptions = [
		{ value: 'netlify', label: t('ui.publish_option_netlify') },
		{ value: 'ftp', label: t('ui.publish_option_ftp') },
		...(sitePath.startsWith('/preview/') ? [{ value: 'mdf-preview', label: t('ui.publish_option_mdfriday') }] : []),
	];

	// Auto-switch to netlify if mdf-preview is not available when sitePath changes
	$: if (!sitePath.startsWith('/preview/') && selectedPublishOption === 'mdf-preview') {
		selectedPublishOption = plugin.settings.publishMethod || 'netlify';
	}

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
		
		// Register applyProjectConfiguration method so it can be called from main.ts
		plugin.applyProjectConfigurationToPanel = applyProjectConfiguration;
	});

	onDestroy(() => {
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


	// 多语言相关函数
	function updateLanguageCode(contentId: string, newLanguageCode: string) {
		site.updateLanguageCode(contentId, newLanguageCode);
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
			selectedPublishOption = plugin.settings.publishMethod || 'netlify';
			
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

	function openProjectsModal() {
		// Call plugin method to show project management modal
		plugin.showProjectManagementModal(applyProjectConfiguration, exportHistoryBuild, clearPreviewHistory);
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
				selectedPublishOption = plugin.settings.publishMethod || 'netlify';
				
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
			const themeInfo = await themeApiService.getThemeById(selectedThemeId, plugin);
			const obImagesDir = path.join(absPreviewDir, 'public', 'ob-images');
			
			// Check if theme has "Book" tag (case-insensitive)
			const hasOBTag = themeInfo?.tags?.some(tag =>
				tag.toLowerCase() === 'obsidian'
			) || false;
			
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

	async function createSitePathStructure(previewDir: string): Promise<string> {
		if (sitePath === '/') {
			// Default root path, return public directory directly
			return path.join(previewDir, 'public');
		}

		// Create directory structure for non-root site path
		// e.g., sitePath = "/path/sub" should create "path" dir and symlink "sub" to "public"
		const pathParts = sitePath.split('/').filter(part => part !== '');
		
		if (pathParts.length === 0) {
			// Fallback to root
			return path.join(previewDir, 'public');
		}

		// Start from preview directory as root
		let currentDir = previewDir;
		
		// Create all parent directories except the last one
		for (let i = 0; i < pathParts.length - 1; i++) {
			currentDir = path.join(currentDir, pathParts[i]);
			if (!await app.vault.adapter.exists(currentDir)) {
				await app.vault.adapter.mkdir(currentDir);
			}
		}

		// Create symlink or copy for the final directory
		const finalDirName = pathParts[pathParts.length - 1];
		const finalDirPath = path.join(currentDir, finalDirName);
		const publicDir = path.join(previewDir, 'public');

		// Remove existing symlink/directory if it exists
		if (await app.vault.adapter.exists(finalDirPath)) {
			await app.vault.adapter.rmdir(finalDirPath, true);
		}

		const adapter = app.vault.adapter;
		if (adapter instanceof FileSystemAdapter) {
			const absFinalDirPath = path.join(adapter.getBasePath(), finalDirPath);
			const absPublicDir = path.join(adapter.getBasePath(), publicDir);
			try {
				if (isWindows) {
					await fs.promises.symlink(absPublicDir, absFinalDirPath, 'junction');
				} else {
					await fs.promises.symlink(absPublicDir, absFinalDirPath, 'dir');
				}
			} catch (error) {
				console.error('Failed to create symlink for site path:', error);
				// Fallback: copy directory
				await fs.promises.cp(absPublicDir, absFinalDirPath, { recursive: true });
			}
		}

		// Return the preview directory as root for HTTP server
		return previewDir;
	}

	async function startPreview() {
		if (currentContents.length === 0) {
			new Notice(t('messages.no_folder_or_file_selected'), 3000);
			return;
		}

		isBuilding = true;
		buildProgress = 0;
		hasPreview = false;

		try {
			if (serverRunning) {
				await httpServer.stopWatching();
				serverRunning = false;
			}

			// Generate random preview ID
			previewId = generateRandomId();

			// Create preview directory
			const previewDir = path.join(plugin.pluginDir, 'preview', previewId);
			await createPreviewDirectory(previewDir);
			buildProgress = 5;

			// Create config file
			if (sitePath.startsWith("/preview")){
				sitePath = `/preview/${previewId}`;
			}
			await createConfigFile(previewDir);
			buildProgress = 10;

			// Create symbolic links for all language contents
			await linkMultiLanguageContents(previewDir);
			buildProgress = 15;

			// Copy site assets if configured
			if (currentAssets && currentAssets.folder) {
				await copySiteAssetsToPreview(previewDir);
				buildProgress = 18;
			}

			// Build site (reserved for future implementation)
			absPreviewDir = path.join(basePath, previewDir);
			const absThemesDir = path.join(basePath, themesDir)

			// Create site path structure and get server root directory
			const serverRootDir = await createSitePathStructure(previewDir);

			// Configure image output directory for app:// URLs
			const obImagesDir = path.join(absPreviewDir, 'public', 'ob-images');
			
			// Create renderer based on theme tags
			const styleRenderer = await createRendererBasedOnTheme();

			// Create httpClient instance for the build config
			const httpClient = {
				async download(url: string, targetPath: string, options?: {
					onProgress?: (progress: { percentage: number; loaded: number; total?: number }) => void;
					headers?: Record<string, string>;
					timeout?: number;
				}): Promise<void> {
					try {
						// Call progress callback at start
						if (options?.onProgress) {
							options.onProgress({ percentage: 0, loaded: 0 });
						}

						const response = await requestUrl({
							url: url,
							method: 'GET',
							headers: options?.headers
						});

						if (response.status !== 200) {
							throw new Error(`Download failed with status: ${response.status}`);
						}

						// Call progress callback at 50%
						if (options?.onProgress) {
							const arrayBuffer = response.arrayBuffer;
							const total = arrayBuffer.byteLength;
							options.onProgress({ percentage: 50, loaded: total / 2, total });
						}

						// Ensure target directory exists
						const targetDir = path.dirname(targetPath);
						if (!(await checkFolderExists(targetDir))) {
							if (path.isAbsolute(targetDir)) {
								await fs.promises.mkdir(targetDir, { recursive: true });
							} else {
								await app.vault.adapter.mkdir(targetDir);
							}
						}

						// Write file using appropriate method
						const fileContent = new Uint8Array(response.arrayBuffer);
						if (path.isAbsolute(targetPath)) {
							await fs.promises.writeFile(targetPath, fileContent);
						} else {
							await app.vault.adapter.writeBinary(targetPath, fileContent.buffer);
						}

						// Call progress callback at completion
						if (options?.onProgress) {
							const total = fileContent.length;
							options.onProgress({ percentage: 100, loaded: total, total });
						}

					} catch (error) {
						console.error('HTTP download failed:', error);
						throw error;
					}
				},

				async get(url: string, options?: {
					headers?: Record<string, string>;
					timeout?: number;
				}): Promise<{
					data: ArrayBuffer;
					headers: Record<string, string>;
					status: number;
				}> {
					try {
						const response = await requestUrl({
							url: url,
							method: 'GET',
							headers: options?.headers
						});

						return {
							data: response.arrayBuffer,
							headers: response.headers || {},
							status: response.status
						};

					} catch (error) {
						console.error('HTTP get failed:', error);
						throw error;
					}
				}
			};

			httpServer = await startIncrementalBuild({
				projDir: absPreviewDir,
				modulesDir: absThemesDir,
				contentDirs: absSelectedFolderPath,
				projContentDirs: absProjContentPath,
				publicDir: path.join(basePath, serverRootDir),
				enableWatching: true, // 启用完整的文件监控和增量构建
				batchDelay: 500,
				progressCallback: (progress) => {
					buildProgress = 15 + (progress.percentage / 100 * 85); // Start from 15%, up to 100%
				},
				markdown: styleRenderer,
				httpClient: httpClient,

				// Live Reload 配置
				liveReload: {
					enabled: true,
					port: serverPort,
					host: serverHost,
					livereloadPort: 35729
				}
			})

			serverRunning = true;
			buildProgress = 100;

			// Set preview URL
			if (sitePath === '/') {
				if (isForSingleFile) {
					previewUrl = `${httpServer.getServerUrl()}/`;
				} else {
					previewUrl = httpServer.getServerUrl();
				}
			} else {
				previewUrl = `${httpServer.getServerUrl()}${sitePath}/`;
			}
			hasPreview = true;

			// Open browser preview
			window.open(previewUrl, '_blank');

			new Notice(t('messages.preview_generated_successfully'), 3000);

			// Save project configuration and add build history
			await saveCurrentProjectConfiguration();
			if (currentContents.length > 0 && siteName) {
				const projectId = getProjectId();
				if (projectId) {
					await plugin.projectService.addBuildHistory({
						projectId: projectId,
						timestamp: Date.now(),
						success: true,
						type: 'preview',
						url: previewUrl,
						previewId: previewId // Save preview ID for export functionality
					});
				}
			}

			// Send counter for preview (don't wait for result)
			plugin.hugoverse.sendCounter('preview').catch(error => {
				console.warn('Counter request failed (non-critical):', error);
			});

		} catch (error) {
			console.error('Preview generation failed:', error);
			new Notice(t('messages.preview_failed', { error: error.message }), 5000);
		} finally {
			isBuilding = false;
		}
	}

	async function startPublish() {
		if (!hasPreview) {
			new Notice(t('messages.please_generate_preview_first'), 3000);
			return;
		}

		if (!previewId || !absPreviewDir) {
			new Notice(t('messages.preview_data_missing'), 3000);
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
			// Step 1: Create ZIP file from public directory (0-50%)
			publishProgress = 5;
			const publicDir = path.join(absPreviewDir, 'public');

			if (selectedPublishOption === 'netlify') {
				// Netlify deployment
				await publishToNetlify(publicDir);
			} else if (selectedPublishOption === 'ftp') {
				// FTP deployment
				await publishToFTP(publicDir);
			} else {
				// MDFriday Preview deployment
				const zipContent = await createZipFromDirectory(publicDir);
				publishProgress = 50;

				const previewApiId = await plugin.hugoverse.createMDFPreview(previewId, zipContent);
				if (!previewApiId) {
					throw new Error('Failed to create MDFriday preview');
				}
				publishProgress = 80;

				// Step 3: Deploy the preview (80-100%)
				const deployPath = await plugin.hugoverse.deployMDFridayPreview(previewApiId);
				if (!deployPath) {
					throw new Error('Failed to deploy MDFriday preview');
				}
				publishProgress = 100;

				// Step 4: Construct final publish URL
				const baseUrl = GetBaseUrl();
				publishUrl = `${baseUrl}${deployPath}`;
				publishSuccess = true;

				new Notice(t('messages.site_published_successfully'), 3000);

				// Save project configuration and add build history
				await saveCurrentProjectConfiguration();
				if (currentContents.length > 0 && siteName) {
					const projectId = getProjectId();
					if (projectId) {
						await plugin.projectService.addBuildHistory({
							projectId: projectId,
							timestamp: Date.now(),
							success: true,
							type: 'publish',
							publishMethod: 'mdf-preview',
							url: publishUrl
						});
					}
				}

				// Send counter for publish (don't wait for result)
				plugin.hugoverse.sendCounter('mdf-preview').catch(error => {
					console.warn('Counter request failed (non-critical):', error);
				});
			}

		} catch (error) {
			console.error('Publishing failed:', error);
			new Notice(t('messages.publishing_failed', { error: error.message }), 5000);
		} finally {
			isPublishing = false;
		}
	}

	async function publishToNetlify(publicDir: string) {
		try {
			// Temporarily override plugin settings with panel configuration
			const originalToken = plugin.settings.netlifyAccessToken;
			const originalProjectId = plugin.settings.netlifyProjectId;
			
			plugin.settings.netlifyAccessToken = netlifyAccessToken;
			plugin.settings.netlifyProjectId = netlifyProjectId;
			
			try {
				publishUrl = await plugin.netlify.deployToNetlify(publicDir, (progress) => {
					publishProgress = Math.round(progress);
				});
			} finally {
				// Restore original settings
				plugin.settings.netlifyAccessToken = originalToken;
				plugin.settings.netlifyProjectId = originalProjectId;
			}
			
			publishSuccess = true;
			new Notice(t('messages.netlify_deploy_success'), 3000);

			// Save project configuration and add build history
			await saveCurrentProjectConfiguration();
			if (currentContents.length > 0 && siteName) {
				const projectId = getProjectId();
				if (projectId) {
					await plugin.projectService.addBuildHistory({
						projectId: projectId,
						timestamp: Date.now(),
						success: true,
						type: 'publish',
						publishMethod: 'netlify',
						url: publishUrl
					});
				}
			}

			// Send counter for netlify publish (don't wait for result)
			plugin.hugoverse.sendCounter('netlify').catch(error => {
				console.warn('Counter request failed (non-critical):', error);
			});
		} catch (error) {
			console.error('Netlify deployment failed:', error);
			throw new Error(t('messages.netlify_deploy_failed', { error: error.message }));
		}
	}

	async function publishToFTP(publicDir: string) {
		try {
			// Temporarily override plugin settings with panel configuration
			const originalServer = plugin.settings.ftpServer;
			const originalUsername = plugin.settings.ftpUsername;
			const originalPassword = plugin.settings.ftpPassword;
			const originalRemoteDir = plugin.settings.ftpRemoteDir;
			const originalIgnoreCert = plugin.settings.ftpIgnoreCert;
			
			plugin.settings.ftpServer = ftpServer;
			plugin.settings.ftpUsername = ftpUsername;
			plugin.settings.ftpPassword = ftpPassword;
			plugin.settings.ftpRemoteDir = ftpRemoteDir;
			plugin.settings.ftpIgnoreCert = ftpIgnoreCert;
			
			// Reinitialize FTP uploader with panel settings and preferred connection type
			plugin.initializeFTP(ftpPreferredSecure);
			
			if (!plugin.ftp) {
				throw new Error('FTP uploader not initialized - please check FTP settings');
			}

			// Set up connection type callback to remember successful connection
			plugin.ftp.setConnectionTypeCallback((usedSecure: boolean) => {
				ftpPreferredSecure = usedSecure;
			});

			// Set up progress callback
			plugin.ftp.setProgressCallback((progress) => {
				publishProgress = Math.round(progress.percentage);
			});

			let result;
			try {
				// Get project ID for incremental upload
				const projectId = getProjectId();
				
				if (projectId) {
					// Load previous manifest
					const oldManifest = await plugin.projectService.loadManifest(projectId, 'ftp');
					
					// Use incremental upload
					const incrementalResult = await plugin.ftp.uploadDirectoryIncremental(
						publicDir,
						projectId,
						oldManifest
					);
					
					result = {
						success: incrementalResult.success,
						usedSecure: incrementalResult.usedSecure,
						error: incrementalResult.error
					};
					
					// Save new manifest if successful
					if (incrementalResult.success && incrementalResult.newManifest) {
						await plugin.projectService.saveManifest(incrementalResult.newManifest);
						
						// Show incremental upload stats
						if (incrementalResult.stats) {
							const { uploaded, deleted, unchanged } = incrementalResult.stats;
							const totalFiles = uploaded + unchanged;
							const savedTime = totalFiles > 0 ? Math.round((unchanged / totalFiles) * 100) : 0;
							new Notice(
								t('messages.incremental_upload_stats', {
									uploaded,
									deleted,
									unchanged,
									saved: savedTime
								}) || 
								`Incremental upload: ${uploaded} uploaded, ${deleted} deleted, ${unchanged} unchanged (${savedTime}% time saved)`,
								4000
							);
						}
					}
				} else {
					// Fallback to full upload if no project ID
					result = await plugin.ftp.uploadDirectory(publicDir);
				}
			} finally {
				// Restore original settings
				plugin.settings.ftpServer = originalServer;
				plugin.settings.ftpUsername = originalUsername;
				plugin.settings.ftpPassword = originalPassword;
				plugin.settings.ftpRemoteDir = originalRemoteDir;
				plugin.settings.ftpIgnoreCert = originalIgnoreCert;
				// Reinitialize FTP with original settings
				plugin.initializeFTP();
			}

			if (result.success) {
				publishSuccess = true;
				publishUrl = ''; // FTP doesn't return a URL
				
				// Show appropriate success message
				if (!result.usedSecure) {
					new Notice(t('messages.ftp_fallback_to_plain'), 4000);
				}
				new Notice(t('messages.ftp_upload_success'), 3000);

				// Save project configuration and add build history
				await saveCurrentProjectConfiguration();
				if (currentContents.length > 0 && siteName) {
					const projectId = getProjectId();
					if (projectId) {
						await plugin.projectService.addBuildHistory({
							projectId: projectId,
							timestamp: Date.now(),
							success: true,
							type: 'publish',
							publishMethod: 'ftp'
						});
					}
				}

				// Send counter for ftp publish (don't wait for result)
				plugin.hugoverse.sendCounter('ftp').catch(error => {
					console.warn('Counter request failed (non-critical):', error);
				});
			} else {
				throw new Error(result.error || 'Unknown FTP error');
			}

		} catch (error) {
			console.error('FTP upload failed:', error);
			throw new Error(t('messages.ftp_upload_failed', { error: error.message }));
		}
	}

	// Reactive: Check if FTP is configured
	$: isFTPConfigured = !!(ftpServer.trim() && ftpUsername.trim() && ftpPassword.trim());

	// Test FTP connection
	async function testFTPConnection() {
		ftpTestState = 'testing';
		ftpTestMessage = '';
		
		try {
			// Temporarily override plugin settings with panel configuration
			const originalServer = plugin.settings.ftpServer;
			const originalUsername = plugin.settings.ftpUsername;
			const originalPassword = plugin.settings.ftpPassword;
			const originalRemoteDir = plugin.settings.ftpRemoteDir;
			const originalIgnoreCert = plugin.settings.ftpIgnoreCert;
			
			plugin.settings.ftpServer = ftpServer;
			plugin.settings.ftpUsername = ftpUsername;
			plugin.settings.ftpPassword = ftpPassword;
			plugin.settings.ftpRemoteDir = ftpRemoteDir;
			plugin.settings.ftpIgnoreCert = ftpIgnoreCert;
			
			// Reinitialize FTP uploader with panel settings and preferred connection type
			plugin.initializeFTP(ftpPreferredSecure);
			
			if (plugin.ftp) {
				// Set up connection type callback to remember successful connection
				plugin.ftp.setConnectionTypeCallback((usedSecure: boolean) => {
					ftpPreferredSecure = usedSecure;
				});
			}
			
			let result;
			try {
				result = await plugin.testFTPConnection();
			} finally {
				// Restore original settings
				plugin.settings.ftpServer = originalServer;
				plugin.settings.ftpUsername = originalUsername;
				plugin.settings.ftpPassword = originalPassword;
				plugin.settings.ftpRemoteDir = originalRemoteDir;
				plugin.settings.ftpIgnoreCert = originalIgnoreCert;
				// Reinitialize FTP with original settings
				plugin.initializeFTP();
			}
			
			if (result.success) {
				ftpTestState = 'success';
				ftpTestMessage = result.message || t('settings.ftp_test_connection_success');
			} else {
				ftpTestState = 'error';
				ftpTestMessage = result.message || t('settings.ftp_test_connection_failed');
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

	function generateRandomId(): string {
		return Math.random().toString(36).substring(2, 8);
	}

	async function createPreviewDirectory(previewDir: string) {
		// Create preview root directory
		const previewRoot = path.join(plugin.pluginDir, 'preview');
		if (!await app.vault.adapter.exists(previewRoot)) {
			await app.vault.adapter.mkdir(previewRoot);
		}

		// Create specific preview directory
		if (!await app.vault.adapter.exists(previewDir)) {
			await app.vault.adapter.mkdir(previewDir);
		}

		// Create content subdirectory
		const contentDir = path.join(previewDir, 'content');
		if (!await app.vault.adapter.exists(contentDir)) {
			await app.vault.adapter.mkdir(contentDir);
		}

		const publicDir = path.join(previewDir, 'public');
		if (!await app.vault.adapter.exists(publicDir)) {
			await app.vault.adapter.mkdir(publicDir);
		}

		// Create ob-images subdirectory for Obsidian app:// images
		const obImagesDir = path.join(publicDir, 'ob-images');
		if (!await app.vault.adapter.exists(obImagesDir)) {
			await app.vault.adapter.mkdir(obImagesDir);
		}

		// Create static subdirectory if site assets are configured
		if (currentAssets && currentAssets.folder) {
			const staticDir = path.join(previewDir, 'static');
			if (!await app.vault.adapter.exists(staticDir)) {
				await app.vault.adapter.mkdir(staticDir);
			}
		}
	}

	async function createThemesDirectory() {
		if (!await app.vault.adapter.exists(themesDir)) {
			await app.vault.adapter.mkdir(themesDir);
		}
	}

	async function createConfigFile(previewDir: string) {
		const config: any = {
			baseURL: sitePath, // Use site path as base URL
			title: siteName,
			contentDir: "content",
			publishDir: "public",
			defaultContentLanguage: defaultContentLanguage,
			taxonomies: {
				tag: "tags",
				category: "categories"
			},
			module: {
				imports: [
					{
						path: selectedThemeDownloadUrl,
					}
				]
			},
			params: {
				branding: true,
				...(sitePassword && sitePassword.trim() ? { password: sitePassword.trim() } : {})
			}
		};

		// Add services configuration if any values are provided
		const services: any = {};
		
		if (googleAnalyticsId && googleAnalyticsId.trim()) {
			services.googleAnalytics = {
				id: googleAnalyticsId.trim()
			};
		}
		
		if (disqusShortname && disqusShortname.trim()) {
			services.disqus = {
				shortname: disqusShortname.trim()
			};
		}
		
		// Only add services to config if there are any services configured
		if (Object.keys(services).length > 0) {
			config.services = services;
		}

		// Add languages configuration if multiple languages are configured
		if (currentContents.length > 0) {
			const languages: any = {};
			
			currentContents.forEach((content, index) => {
				const contentDir = index === 0 ? "content" : `content.${content.languageCode}`;
				languages[content.languageCode] = {
					contentDir: contentDir,
					weight: content.weight
				};
			});
			
			config.languages = languages;
		}

		const configPath = path.join(previewDir, 'config.json');
		await app.vault.adapter.write(configPath, JSON.stringify(config, null, 2));
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

	async function linkMultiLanguageContents(previewDir: string) {
		// Link all language contents
		for (let i = 0; i < currentContents.length; i++) {
			const content = currentContents[i];
			const contentDir = i === 0 ? "content" : `content.${content.languageCode}`;
			const targetPath = path.join(previewDir, contentDir);
			
			if (content.folder) {
				await linkFolderContents(content.folder, targetPath);
			} else if (content.file) {
				await linkSingleFileContent(content.file, targetPath);
			}
		}
	}

	async function linkFolderContents(folder: TFolder, targetPath: string) {
		// Get absolute path of source folder
		const adapter = app.vault.adapter;
		let sourcePath: string;
		let absTargetPath: string;

		if (adapter instanceof FileSystemAdapter) {
			sourcePath = path.join(adapter.getBasePath(), folder.path);
			absTargetPath = path.join(adapter.getBasePath(), targetPath);

			absSelectedFolderPath.push(sourcePath);
			absProjContentPath.push(absTargetPath);
		} else {
			// If not FileSystemAdapter, fall back to copying files
			console.warn('Not using FileSystemAdapter, falling back to copying files');
			await copyFolderContents(folder, targetPath);
			return;
		}

		try {
			if (await app.vault.adapter.exists(targetPath)) {
				await app.vault.adapter.rmdir(targetPath, true);
			}

			if (isWindows) {
				await fs.promises.symlink(sourcePath, absTargetPath, 'junction');
				return;
			}

			await fs.promises.symlink(sourcePath, absTargetPath, 'dir');
		} catch (error) {
			console.error('Failed to create symbolic link, falling back to copying:', error);
			// If symbolic link fails, fall back to copying files
			await copyFolderContents(folder, targetPath);
		}
	}

	async function copyFolderContents(folder: TFolder, targetPath: string) {
		// Recursively copy folder contents (kept as backup solution)
		const copyRecursive = async (sourceFolder: TFolder, destPath: string) => {
			for (const child of sourceFolder.children) {
				if (child instanceof TFolder) {
					const childDestPath = path.join(destPath, child.name);
					if (!await app.vault.adapter.exists(childDestPath)) {
						await app.vault.adapter.mkdir(childDestPath);
					}
					await copyRecursive(child, childDestPath);
				} else if (child instanceof TFile) {
					const childDestPath = path.join(destPath, child.name);
					try {
						const content = await app.vault.read(child);
						await app.vault.adapter.write(childDestPath, content);
					} catch (error) {
						console.warn(`Failed to copy file ${child.path}:`, error);
					}
				}
			}
		};

		await copyRecursive(folder, targetPath);
	}

	async function linkSingleFileContent(file: TFile, targetPath: string) {
		// Get absolute path of source file
		const adapter = app.vault.adapter;
		let sourcePath: string;
		let absTargetPath: string;
		let absContentDir: string;

		if (adapter instanceof FileSystemAdapter) {
			sourcePath = path.join(adapter.getBasePath(), file.path);
			absContentDir = path.join(adapter.getBasePath(), targetPath);
			absTargetPath = path.join(absContentDir, 'index.md');

			absSelectedFolderPath.push(path.dirname(sourcePath));
			absProjContentPath.push(absContentDir);
		} else {
			// If not FileSystemAdapter, fall back to copying file
			console.warn('Not using FileSystemAdapter, falling back to copying file');
			await copySingleFileContent(file, targetPath);
			return;
		}

		try {
			// Create content directory if it doesn't exist
			if (!await app.vault.adapter.exists(targetPath)) {
				await app.vault.adapter.mkdir(targetPath);
			}

			// Remove existing index.md if it exists
			if (await app.vault.adapter.exists(path.join(targetPath, 'index.md'))) {
				await app.vault.adapter.remove(path.join(targetPath, 'index.md'));
			}

			// Create symbolic link to the file as index.md
			if (isWindows) {
				await fs.promises.symlink(sourcePath, absTargetPath, 'file');
			} else {
				await fs.promises.symlink(sourcePath, absTargetPath);
			}
		} catch (error) {
			console.error('Failed to create symbolic link for file, falling back to copying:', error);
			// If symbolic link fails, fall back to copying file
			await copySingleFileContent(file, targetPath);
		}
	}

	async function copySingleFileContent(file: TFile, targetPath: string) {
		// Create content directory if it doesn't exist
		if (!await app.vault.adapter.exists(targetPath)) {
			await app.vault.adapter.mkdir(targetPath);
		}

		// Copy the file as index.md
		const indexPath = path.join(targetPath, 'index.md');
		try {
			const fileContent = await app.vault.read(file);
			await app.vault.adapter.write(indexPath, fileContent);
		} catch (error) {
			console.error('Failed to copy file content:', error);
			throw error;
		}
	}

	async function copySiteAssetsToPreview(previewDir: string) {
		if (!currentAssets || !currentAssets.folder) {
			return;
		}

		const assetsSourceFolder = currentAssets.folder;
		const staticTargetDir = path.join(previewDir, 'static');

		try {
			// Get absolute paths
			const adapter = app.vault.adapter;
			if (adapter instanceof FileSystemAdapter) {
				const absSourcePath = path.join(adapter.getBasePath(), assetsSourceFolder.path);
				const absTargetPath = path.join(adapter.getBasePath(), staticTargetDir);

				// Use Node.js fs to copy the directory recursively
				await fs.promises.cp(absSourcePath, absTargetPath, { 
					recursive: true,
					force: true // Overwrite existing files
				});

			} else {
				// Fallback: use Obsidian's API to copy files
				await copyAssetsUsingObsidianAPI(assetsSourceFolder, staticTargetDir);
			}
		} catch (error) {
			console.error('Failed to copy site assets:', error);
			// Don't throw error, just log it - assets are optional
		}
	}

	async function copyAssetsUsingObsidianAPI(sourceFolder: TFolder, targetDir: string) {
		// Recursively copy folder contents using Obsidian's API
		const copyRecursive = async (sourceFolder: TFolder, destPath: string) => {
			for (const child of sourceFolder.children) {
				if (child instanceof TFolder) {
					const childDestPath = path.join(destPath, child.name);
					if (!await app.vault.adapter.exists(childDestPath)) {
						await app.vault.adapter.mkdir(childDestPath);
					}
					await copyRecursive(child, childDestPath);
				} else if (child instanceof TFile) {
					const childDestPath = path.join(destPath, child.name);
					try {
						const content = await app.vault.readBinary(child);
						await app.vault.adapter.writeBinary(childDestPath, content);
					} catch (error) {
						console.warn(`Failed to copy asset file ${child.path}:`, error);
					}
				}
			}
		};

		await copyRecursive(sourceFolder, targetDir);
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
	<!-- Projects Management Button -->
	<div class="section advanced-settings">
		<button 
			class="advanced-toggle" 
			on:click={openProjectsModal}
			aria-label={t('projects.manage_projects')}
		>
			{t('projects.manage_projects')}
		</button>
	</div>

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
				<select id="publish-method" class="form-select" bind:value={selectedPublishOption}>
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
							placeholder={t('settings.ftp_server_placeholder')}
						/>
					</div>
					<div class="config-field">
						<label class="section-label" for="ftp-username">{t('settings.ftp_username')}</label>
						<input
							type="text"
							class="form-input"
							bind:value={ftpUsername}
							placeholder={t('settings.ftp_username_placeholder')}
						/>
					</div>
					<div class="config-field">
						<label class="section-label" for="ftp-password">{t('settings.ftp_password')}</label>
						<input
							type="password"
							class="form-input"
							bind:value={ftpPassword}
							placeholder={t('settings.ftp_password_placeholder')}
						/>
					</div>
					<div class="config-field">
						<label class="section-label" for="ftp-remote-dir">{t('settings.ftp_remote_dir')}</label>
						<input
							type="text"
							class="form-input"
							bind:value={ftpRemoteDir}
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

			<!-- MDFriday Preview Info -->
			{#if selectedPublishOption === 'mdf-preview'}
				<div class="publish-config">
					<div class="field-hint">
						{t('ui.mdfriday_preview_hint')}
					</div>
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
						disabled={!hasPreview}
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
