<script lang="ts">
	import {App, Notice, TFolder, TFile, FileSystemAdapter} from "obsidian";
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
	export let selectedFolder: TFolder | null = null;
	export let selectedFile: TFile | null = null;
	
	// Reactive translation function
	$: t = plugin.i18n?.t || ((key: string) => key);

	const BOOK_THEME_URL = "https://gohugo.net/book-ob.zip?version=1.0"
	const BOOK_THEME_ID = "3"
	const BOOK_THEME_NAME = "Obsidian Book"
	const NOTE_THEME_URL = "https://gohugo.net/note.zip?version=1.0"
	const NOTE_THEME_ID = "2"
	const NOTE_THEME_NAME = "Note";

	const isWindows = process.platform === 'win32';

	// State variables
	let basePath = plugin.pluginDir;
	let absSelectedFolderPath = '';
	let absProjContentPath = '';
	let contentPath = '';
	let siteName = '';
	let sitePath = '/';
	let selectedThemeDownloadUrl = BOOK_THEME_URL;
	let selectedThemeName = BOOK_THEME_NAME;
	let selectedThemeId = BOOK_THEME_ID; // Add theme ID tracking for Book theme
	let isForSingleFile = false; // Track if we're working with a single file

	// Advanced settings state
	let showAdvancedSettings = false;
	let googleAnalyticsId = '';
	let disqusShortname = '';

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

	// Export related state
	let isExporting = false;
	
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
		if (selectedFolder) {
			contentPath = selectedFolder.name;
			siteName = selectedFolder.name;
			isForSingleFile = false;
			// Set default theme for folder (Book)
			selectedThemeDownloadUrl = BOOK_THEME_URL;
			selectedThemeName = BOOK_THEME_NAME;
			selectedThemeId = BOOK_THEME_ID;
		} else if (selectedFile) {
			contentPath = selectedFile.name;
			siteName = selectedFile.basename; // Remove .md extension
			isForSingleFile = true;
			// Set default theme for single file (Note)
			selectedThemeDownloadUrl = NOTE_THEME_URL;
			selectedThemeName = NOTE_THEME_NAME;
			// Find the actual Note theme ID by searching themes
			selectedThemeId = NOTE_THEME_ID; // Default to Note theme ID
		}

		themesDir = path.join(plugin.pluginDir, 'themes')
		await createThemesDirectory()

		const adapter = app.vault.adapter;
		if (adapter instanceof FileSystemAdapter) {
			basePath = adapter.getBasePath()
		}
	});

	onDestroy(() => {
		if (serverRunning) {
			httpServer.stopWatching();
			serverRunning = false;
		}
	});

	// Reactive update: update related state when selectedFolder or selectedFile changes
	$: if (selectedFolder) {
		// Only reset state when folder actually changes
		const newContentPath = selectedFolder.name;
		const newSiteName = selectedFolder.name;

		if (contentPath !== newContentPath) {
			contentPath = newContentPath;
			siteName = newSiteName;
			isForSingleFile = false;
			// Set default theme for folder
			selectedThemeDownloadUrl = BOOK_THEME_URL;
			selectedThemeName = BOOK_THEME_NAME;
			selectedThemeId = BOOK_THEME_ID;
			// Reset preview state
			hasPreview = false;
			previewUrl = '';
			previewId = '';
		}
	} else if (selectedFile) {
		// Only reset state when file actually changes
		const newContentPath = selectedFile.name;
		const newSiteName = selectedFile.basename;

		if (contentPath !== newContentPath) {
			contentPath = newContentPath;
			siteName = newSiteName;
			isForSingleFile = true;
			// Set default theme for single file
			selectedThemeDownloadUrl = NOTE_THEME_URL;
			selectedThemeName = NOTE_THEME_NAME;
			// Find the actual Note theme ID
			selectedThemeId = NOTE_THEME_ID;
			// Reset preview state
			hasPreview = false;
			previewUrl = '';
			previewId = '';
		}
	}

	function openThemeModal() {
		// Call plugin method to show theme selection modal
		plugin.showThemeSelectionModal(selectedThemeId, (themeUrl: string, themeName?: string, themeId?: string) => {
			// Force reactive updates by reassigning all variables
			selectedThemeDownloadUrl = themeUrl;
			selectedThemeName = themeName || (isForSingleFile ? "Note" : "Book");
			selectedThemeId = themeId || selectedThemeId;
		}, isForSingleFile);
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
			const themeInfo = await themeApiService.getThemeById(selectedThemeId);
			const obImagesDir = path.join(absPreviewDir, 'public', 'ob-images');
			
			// Check if theme has "Book" tag (case-insensitive)
			const hasOBTag = themeInfo?.tags?.some(tag =>
				tag.toLowerCase() === 'obsidian'
			) || false;
			
			if (hasOBTag) {
				// Use OBStyleRenderer for themes with "Book" tag
				// This includes full CSS collection, plugin rendering, and theme styles
				console.log(`Theme "${selectedThemeName}" has Book tag, using OBStyleRenderer with plugin rendering`);
				const renderer = new OBStyleRenderer(plugin, {
					includeCSS: true, // Include CSS in HTML for complete styling
					waitForPlugins: true, // Wait for plugin rendering callbacks
					timeout: 200, // Shorter timeout with smart detection
					containerWidth: "1000px",
					includeTheme: true // Include theme styles
				});
				
				// Configure resource processor for app:// URLs
				renderer.getResourceProcessor().configureImageOutput(obImagesDir, sitePath, selectedFolder?.name);
				return renderer;
			} else {
				// Use lightweight StyleRenderer for other themes
				console.log(`Theme "${selectedThemeName}" doesn't have Book tag, using lightweight StyleRenderer`);
				const renderer = createStyleRenderer(plugin, {
					autoHeadingID: true,
					waitForStable: false, // Don't wait for DOM stable for better performance
				});
				
				// Configure resource processor for internal links
				if (renderer.getResourceProcessor) {
					renderer.getResourceProcessor().configureImageOutput(obImagesDir, sitePath, selectedFolder?.name);
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
				renderer.getResourceProcessor().configureImageOutput(obImagesDir, sitePath, selectedFolder?.name);
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
		if (!selectedFolder && !selectedFile) {
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

			// Create symbolic link to content files or copy single file
			if (selectedFolder) {
				await linkFolderContents(selectedFolder, path.join(previewDir, 'content'));
			} else if (selectedFile) {
				await linkSingleFileContent(selectedFile, path.join(previewDir, 'content'));
			}
			buildProgress = 15;

			// Build site (reserved for future implementation)
			absPreviewDir = path.join(basePath, previewDir);
			const absThemesDir = path.join(basePath, themesDir)

			// Create site path structure and get server root directory
			const serverRootDir = await createSitePathStructure(previewDir);

			// Configure image output directory for app:// URLs
			const obImagesDir = path.join(absPreviewDir, 'public', 'ob-images');
			
			// Create renderer based on theme tags
			const styleRenderer = await createRendererBasedOnTheme();

			httpServer = await startIncrementalBuild({
				projDir: absPreviewDir,
				modulesDir: absThemesDir,
				contentDir: absSelectedFolderPath,
				projContentDir: absProjContentPath,
				publicDir: path.join(basePath, serverRootDir),
				enableWatching: true, // 启用完整的文件监控和增量构建
				batchDelay: 500,
				progressCallback: (progress) => {
					buildProgress = 15 + (progress.percentage / 100 * 85); // Start from 15%, up to 100%
				},
				markdown: styleRenderer,

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
			if (!plugin.settings.netlifyAccessToken || !plugin.settings.netlifyProjectId) {
				new Notice(t('messages.netlify_settings_missing'), 5000);
				return;
			}
		} else if (selectedPublishOption === 'ftp') {
			if (!plugin.settings.ftpServer || !plugin.settings.ftpUsername || !plugin.settings.ftpPassword) {
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
			publishUrl = await plugin.netlify.deployToNetlify(publicDir, (progress) => {
				publishProgress = Math.round(progress);
			});
			publishSuccess = true;
			new Notice(t('messages.netlify_deploy_success'), 3000);
		} catch (error) {
			console.error('Netlify deployment failed:', error);
			throw new Error(t('messages.netlify_deploy_failed', { error: error.message }));
		}
	}

	async function publishToFTP(publicDir: string) {
		try {
			// Reinitialize FTP uploader to ensure latest settings
			plugin.initializeFTP();
			
			if (!plugin.ftp) {
				throw new Error('FTP uploader not initialized - please check FTP settings');
			}

			console.log('Starting FTP upload from:', publicDir);

			// Set up progress callback
			plugin.ftp.setProgressCallback((progress) => {
				publishProgress = Math.round(progress.percentage);
			});

			// Upload directory
			const result = await plugin.ftp.uploadDirectory(publicDir);

			if (result.success) {
				publishSuccess = true;
				publishUrl = ''; // FTP doesn't return a URL
				
				// Show appropriate success message
				if (!result.usedSecure) {
					new Notice(t('messages.ftp_fallback_to_plain'), 4000);
				}
				new Notice(t('messages.ftp_upload_success'), 3000);
			} else {
				throw new Error(result.error || 'Unknown FTP error');
			}

		} catch (error) {
			console.error('FTP upload failed:', error);
			throw new Error(t('messages.ftp_upload_failed', { error: error.message }));
		}
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
			defaultContentLanguage: "en",
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
				branding: false
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

		const configPath = path.join(previewDir, 'config.json');
		await app.vault.adapter.write(configPath, JSON.stringify(config, null, 2));
	}

	async function linkFolderContents(folder: TFolder, targetPath: string) {
		// Get absolute path of source folder
		const adapter = app.vault.adapter;
		let sourcePath: string;
		let absTargetPath: string;

		if (adapter instanceof FileSystemAdapter) {
			sourcePath = path.join(adapter.getBasePath(), folder.path);
			absTargetPath = path.join(adapter.getBasePath(), targetPath);

			absSelectedFolderPath = sourcePath;
			absProjContentPath = absTargetPath;
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

			absSelectedFolderPath = path.dirname(sourcePath);
			absProjContentPath = absContentDir;
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
	<div class="section">
		<label class="section-label" for="content-path">{t('ui.content_path')}</label>
		<input
			type="text"
			class="form-input readonly"
			value={contentPath}
			readonly
		/>
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
				<button class="change-theme-btn" on:click={openThemeModal}>
					{t('ui.change_theme')}
				</button>
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
					disabled={!selectedFolder && !selectedFile}
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
			<div class="publish-options">
				<div class="publish-select-wrapper">
					<select class="form-select" bind:value={selectedPublishOption}>
						{#each publishOptions as option}
							<option value={option.value}>{option.label}</option>
						{/each}
					</select>
				</div>

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

	.form-input.readonly {
		background: var(--background-secondary);
		color: var(--text-muted);
		cursor: not-allowed;
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

	.publish-options {
		display: flex;
		align-items: flex-start;
		gap: 10px;
		flex-wrap: wrap;
	}

	.publish-select-wrapper {
		flex: 1;
		min-width: 150px;
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
</style> 
