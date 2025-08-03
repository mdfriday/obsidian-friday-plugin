<script lang="ts">
	import {App, Notice, TFolder, TFile, FileSystemAdapter} from "obsidian";
	import FridayPlugin from "../main";
	import ProgressBar from "./ProgressBar.svelte";
	import {onMount, onDestroy} from "svelte";
	import {getGlobalHttpServer, LocalHttpServer, stopGlobalHttpServer, resetGlobalHttpServer} from "../httpServer";
	import * as path from "path";
	import * as fs from "fs";
	import {processSSGWithProgress} from "@mdfriday/foundry";
	import JSZip from "jszip";
	import {GetBaseUrl} from "../main";

	// Receive props
	export let app: App;
	export let plugin: FridayPlugin;
	export let selectedFolder: TFolder | null = null;

	const DEV_BOOK_THEME_URL = "http://localhost:1314/api/uploads/themes/book.zip"
	const PROD_BOOK_THEME_URL = "https://mdfriday.sunwei.xyz/api/uploads/themes/book.zip";

	// State variables
	let contentPath = '';
	let siteName = '';
	let sitePath = '/preview/';
	let selectedThemeDownloadUrl =  process.env.NODE_ENV === 'development' ? DEV_BOOK_THEME_URL : PROD_BOOK_THEME_URL;
	let selectedThemeName = 'Book';
	let selectedThemeId = '1'; // Add theme ID tracking for Book theme

	// Advanced settings state
	let showAdvancedSettings = false;

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
	let selectedPublishOption = 'mdf-preview';
	let publishOptions = [
		{ value: 'mdf-preview', label: 'MDFriday Preview' },
	];

	// HTTP server related
	let httpServer: LocalHttpServer;
	let serverRunning = false;
	let serverPort = 8090;

	onMount(async () => {
		if (selectedFolder) {
			contentPath = selectedFolder.name;
			siteName = selectedFolder.name;
		}

		themesDir = path.join(plugin.pluginDir, 'themes')
		await createThemesDirectory()

		// Initialize and start HTTP server
		const previewBaseDir = path.join(plugin.pluginDir, 'preview');
		httpServer = getGlobalHttpServer(app, previewBaseDir);

		// Start HTTP server
		const started = await httpServer.start();
		if (started) {
			serverRunning = true;
			serverPort = httpServer.getPort();
		} else {
			new Notice('Failed to start HTTP server', 3000);
		}
	});

	onDestroy(() => {
		// No need to stop HTTP server when component is destroyed as it's global
	});

	// Reactive update: update related state when selectedFolder changes
	$: if (selectedFolder) {
		// Only reset state when folder actually changes
		const newContentPath = selectedFolder.name;
		const newSiteName = selectedFolder.name;

		if (contentPath !== newContentPath) {
			contentPath = newContentPath;
			siteName = newSiteName;
			// Reset preview state
			hasPreview = false;
			previewUrl = '';
			previewId = '';
		}
	}

	function openThemeModal() {
		// Call plugin method to show theme selection modal
		plugin.showThemeSelectionModal(selectedThemeId, (themeUrl: string, themeName?: string, themeId?: string) => {
			selectedThemeDownloadUrl = themeUrl;
			selectedThemeName = themeName || "Book";
			selectedThemeId = themeId || selectedThemeId; // Update theme ID when theme changes
		});
	}

	function getSelectedThemeName() {
		// Return the cached theme name or fallback to ID
		return selectedThemeName || selectedThemeDownloadUrl;
	}

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

		// Create symlink for the final directory to point to public
		const finalDirName = pathParts[pathParts.length - 1];
		const finalDirPath = path.join(currentDir, finalDirName);
		const publicDir = path.join(previewDir, 'public');

		// Remove existing symlink/directory if it exists
		if (await app.vault.adapter.exists(finalDirPath)) {
			await app.vault.adapter.rmdir(finalDirPath, true);
		}

		// Create symlink
		const adapter = app.vault.adapter;
		if (adapter instanceof FileSystemAdapter) {
			const absFinalDirPath = path.join(adapter.getBasePath(), finalDirPath);
			const absPublicDir = path.join(adapter.getBasePath(), publicDir);
			try {
				await fs.promises.symlink(absPublicDir, absFinalDirPath, 'dir');
			} catch (error) {
				console.error('Failed to create symlink for site path:', error);
				// Fallback: just return public directory
				return path.join(previewDir, 'public');
			}
		}

		// Return the preview directory as root for HTTP server
		return previewDir;
	}

	async function startPreview() {
		if (!selectedFolder) {
			new Notice('No folder selected', 3000);
			return;
		}

		if (!serverRunning) {
			new Notice('HTTP server is not running', 3000);
			return;
		}

		isBuilding = true;
		buildProgress = 0;
		hasPreview = false;

		try {
			// Stop and reset HTTP server for new directory structure
			await stopGlobalHttpServer();
			resetGlobalHttpServer();

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

			// Create symbolic link to content files
			await linkFolderContents(selectedFolder, path.join(previewDir, 'content'));
			buildProgress = 15;

			// Build site (reserved for future implementation)
			const adapter = app.vault.adapter;
			let absThemesDir: string;

			if (adapter instanceof FileSystemAdapter) {
				absPreviewDir = path.join(adapter.getBasePath(), previewDir);
				absThemesDir = path.join(adapter.getBasePath(), themesDir)
			}

			await processSSGWithProgress(absPreviewDir, absThemesDir, (progress) => {
				buildProgress = 15 + (progress.percentage / 100 * 85); // Start from 15%, up to 100%
			});

			buildProgress = 100;

			// Create site path structure and get server root directory
			const serverRootDir = await createSitePathStructure(previewDir);

			// Initialize and start new HTTP server with correct directory
			httpServer = getGlobalHttpServer(app, serverRootDir);
			const started = await httpServer.start();
			if (started) {
				serverRunning = true;
				serverPort = httpServer.getPort();
			} else {
				new Notice('Failed to restart HTTP server', 3000);
				return;
			}

			// Set preview URL
			if (sitePath === '/') {
				previewUrl = `http://localhost:${serverPort}/`;
			} else {
				previewUrl = `http://localhost:${serverPort}${sitePath}/`;
			}
			hasPreview = true;

			// Open browser preview
			window.open(previewUrl, '_blank');

			new Notice('Preview generated successfully!', 3000);

		} catch (error) {
			console.error('Preview generation failed:', error);
			new Notice(`Preview failed: ${error.message}`, 5000);
		} finally {
			isBuilding = false;
		}
	}

	async function startPublish() {
		if (!hasPreview) {
			new Notice('Please generate preview first', 3000);
			return;
		}

		if (!previewId || !absPreviewDir) {
			new Notice('Preview data is missing', 3000);
			return;
		}

		isPublishing = true;
		publishProgress = 0;
		publishSuccess = false;

		try {
			// Step 1: Create ZIP file from public directory (0-50%)
			publishProgress = 5;
			const publicDir = path.join(absPreviewDir, 'public');

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

			new Notice('Site published successfully!', 3000);

		} catch (error) {
			console.error('Publishing failed:', error);
			new Notice(`Publishing failed: ${error.message}`, 5000);
		} finally {
			isPublishing = false;
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
	}

	async function createThemesDirectory() {
		if (!await app.vault.adapter.exists(themesDir)) {
			await app.vault.adapter.mkdir(themesDir);
		}
	}

	async function createConfigFile(previewDir: string) {
		const config = {
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
				environment: "development"
			}
		};

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
		<label class="section-label" for="content-path">Content Path</label>
		<input
			type="text"
			class="form-input readonly"
			value={contentPath}
			readonly
		/>
	</div>

	<!-- Site Name -->
	<div class="section">
		<label class="section-label" for="site-name">Site Name</label>
		<input
			type="text"
			class="form-input"
			bind:value={siteName}
			placeholder="Enter site name"
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
				Advanced Settings
			</button>
			
			{#if showAdvancedSettings}
				<div class="advanced-content">
					<div class="advanced-field">
						<label class="section-label" for="site-path">Site Path</label>
						<input
							type="text"
							class="form-input"
							bind:value={sitePath}
							on:blur={handleSitePathChange}
							placeholder="/"
							title="The base path where your site will be deployed (e.g., /docs, /blog)"
						/>
						<div class="field-hint">
							Specify the base path for your site. Use "/" for root deployment.
						</div>
					</div>
				</div>
			{/if}
		</div>
	</div>

	<!-- Theme Selection -->
	<div class="section">
		<label class="section-label" for="themes">Theme</label>
		<div class="theme-selector">
			<div class="current-theme">
				<span class="theme-name">{getSelectedThemeName()}</span>
				<button class="change-theme-btn" on:click={openThemeModal}>
					Change Theme
				</button>
			</div>
		</div>
	</div>

	<!-- Preview Section -->
	<div class="section">
		<h3 class="section-title">Preview</h3>
		<div class="preview-section">
			{#if isBuilding}
				<div class="progress-container">
					<p>Generating preview...</p>
					<ProgressBar progress={buildProgress} />
				</div>
			{:else}
				<button
					class="action-button preview-button"
					on:click={startPreview}
					disabled={!selectedFolder}
				>
					{hasPreview ? 'Regenerate Preview' : 'Generate Preview'}
				</button>
			{/if}

			{#if hasPreview && previewUrl}
				<div class="preview-link">
					<p>Preview link:</p>
					<a href={previewUrl} target="_blank" class="preview-url">{previewUrl}</a>
				</div>
			{/if}
		</div>
	</div>

	<!-- Publish Section -->
	<div class="section">
		<h3 class="section-title">Publish</h3>
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
						<p>Publishing...</p>
						<ProgressBar progress={publishProgress} />
					</div>
				{:else}
					<button
						class="action-button publish-button"
						on:click={startPublish}
						disabled={!hasPreview}
					>
						Publish Site
					</button>
				{/if}
			</div>

			{#if publishSuccess && publishUrl}
				<div class="publish-success">
					<p class="success-message">✅ Published successfully!</p>
					<a href={publishUrl} target="_blank" class="publish-url">{publishUrl}</a>
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
		margin-bottom: 0;
	}

	.field-hint {
		font-size: 12px;
		color: var(--text-muted);
		margin-top: 4px;
		line-height: 1.4;
	}
</style> 
