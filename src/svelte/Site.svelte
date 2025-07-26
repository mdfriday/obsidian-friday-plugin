<script lang="ts">
	import {App, Notice, TFolder, TFile} from "obsidian";
	import FridayPlugin from "../main";
	import ProgressBar from "./ProgressBar.svelte";
	import {onMount, onDestroy} from "svelte";
	import {getGlobalHttpServer, LocalHttpServer} from "../httpServer";
	import {FileWatcher} from "../fileWatcher";
	import * as path from "path";
	import {processSSG} from "@mdfriday/foundry"

	// 接收 props
	export let app: App;
	export let plugin: FridayPlugin;
	export let selectedFolder: TFolder | null = null;

	// 状态变量
	let contentPath = '';
	let siteName = '';
	let selectedTheme = 'theme-book';
	let availableThemes: string[] = ['theme-book', 'theme-hero', 'theme-academic'];
	
	// 预览相关状态
	let isBuilding = false;
	let buildProgress = 0;
	let previewUrl = '';
	let previewId = '';
	let hasPreview = false;
	
	// 发布相关状态
	let isPublishing = false;
	let publishProgress = 0;
	let publishSuccess = false;
	let publishUrl = '';
	let selectedPublishOption = 'netlify';
	let publishOptions = [
		{ value: 'netlify', label: 'Netlify' },
		{ value: 'scp', label: 'SCP (Private Server)' }
	];

	// HTTP服务器相关
	let httpServer: LocalHttpServer;
	let serverRunning = false;
	let serverPort = 1314;

	// 文件监控相关
	let fileWatcher: FileWatcher;
	let isWatchingFiles = false;

	onMount(() => {
		if (selectedFolder) {
			contentPath = selectedFolder.name;
			siteName = selectedFolder.name;
		}
		// 从插件设置中获取可用主题
		loadAvailableThemes();
		
		// 初始化HTTP服务器
		const previewBaseDir = path.join(plugin.pluginDir, 'preview');
		httpServer = getGlobalHttpServer(app, previewBaseDir);
		checkServerStatus();

		// 初始化文件监控器
		fileWatcher = new FileWatcher(app);
	});

	onDestroy(() => {
		// 清理文件监控器
		if (fileWatcher && isWatchingFiles) {
			fileWatcher.stopWatching();
		}
	});

	// 响应式更新：当selectedFolder改变时更新相关状态
	$: if (selectedFolder) {
		// 只在文件夹真正改变时才重置状态
		const newContentPath = selectedFolder.name;
		const newSiteName = selectedFolder.name;
		
		if (contentPath !== newContentPath) {
			contentPath = newContentPath;
			siteName = newSiteName;
			// 重置预览状态
			hasPreview = false;
			previewUrl = '';
			previewId = '';
			// 停止之前的文件监控（只在文件夹真正改变时）
			if (fileWatcher && isWatchingFiles) {
				console.log('Stopping file watcher due to folder change');
				fileWatcher.stopWatching();
				isWatchingFiles = false;
			}
		}
	}

	function loadAvailableThemes() {
		// 从plugin.settings中获取主题列表
		if (plugin.settings.availableThemes && plugin.settings.availableThemes.length > 0) {
			availableThemes = plugin.settings.availableThemes;
		} else {
			// 如果设置中没有主题，使用默认主题列表
			availableThemes = ['theme-book', 'theme-hero', 'theme-academic'];
		}
	}

	async function checkServerStatus() {
		if (httpServer) {
			serverRunning = await httpServer.checkHealth();
			serverPort = httpServer.getPort();
		}
	}

	async function startPreview() {
		if (!selectedFolder) {
			new Notice('No folder selected', 3000);
			return;
		}

		isBuilding = true;
		buildProgress = 0;
		hasPreview = false;

		try {
			// 生成随机预览ID
			previewId = generateRandomId();
			
			// 创建预览目录
			const previewDir = path.join(plugin.pluginDir, 'preview', previewId);
			await createPreviewDirectory(previewDir);
			const themesDir = path.join(plugin.pluginDir, 'themes')
			await createThemesDirectory()
			buildProgress = 20;
			
			// 创建配置文件
			await createConfigFile(previewDir);
			buildProgress = 40;
			
			// 复制内容文件
			await copyFolderContents(selectedFolder, path.join(previewDir, 'content'));
			buildProgress = 70;
			
			// 启动HTTP服务器（如果未运行）
			if (!serverRunning) {
				const started = await httpServer.start();
				if (started) {
					serverRunning = true;
					new Notice(`HTTP server started on port ${serverPort}`, 3000);
				} else {
					throw new Error('Failed to start HTTP server');
				}
			}
			buildProgress = 90;
			
			// 启动文件监控
			if (fileWatcher) {
				console.log(`Starting file watcher for folder: ${selectedFolder.path}`);
				fileWatcher.startWatching(selectedFolder, previewDir);
				isWatchingFiles = true;
				console.log('File watcher started successfully');
				new Notice('File watching enabled for hot reload', 2000);
			} else {
				console.warn('FileWatcher not initialized');
			}
			
			// 构建站点（预留给后续实现）
			const rootDir = "/Users/weisun/github/sunwei/obsidian-vault/.obsidian/plugins/mdfriday"
			const absPreviewDir = path.join(rootDir, 'preview', previewId);
			const absThemesDir = path.join(rootDir, 'themes')
			await processSSG(absPreviewDir, absThemesDir)

			buildProgress = 100;
			
			// 设置预览URL
			previewUrl = httpServer.getPreviewUrl(previewId);
			hasPreview = true;
			
			// 打开浏览器预览
			window.open(previewUrl + 'public/', '_blank');
			
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

		isPublishing = true;
		publishProgress = 0;
		publishSuccess = false;

		try {
			// 这里应该调用实际的发布逻辑
			// 暂时模拟发布过程
			for (let i = 0; i <= 100; i += 10) {
				publishProgress = i;
				await new Promise(resolve => setTimeout(resolve, 200));
			}

			publishSuccess = true;
			publishUrl = `https://example.com/${previewId}`;
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
		// 创建预览根目录
		const previewRoot = path.join(plugin.pluginDir, 'preview');
		if (!await app.vault.adapter.exists(previewRoot)) {
			await app.vault.adapter.mkdir(previewRoot);
		}
		
		// 创建具体的预览目录
		if (!await app.vault.adapter.exists(previewDir)) {
			await app.vault.adapter.mkdir(previewDir);
		}
		
		// 创建content子目录
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
		const themesRoot = path.join(plugin.pluginDir, 'themes');
		if (!await app.vault.adapter.exists(themesRoot)) {
			await app.vault.adapter.mkdir(themesRoot);
		}
	}

	async function createConfigFile(previewDir: string) {
		const config = {
			baseURL: `/${previewId}/public/`,
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
						path: "http://localhost:8090/long-teng.zip"
					}
				]
			},
			params: {
				environment: "development"
			}
		};

		const configPath = path.join(previewDir, 'config.json');
		await app.vault.adapter.write(configPath, JSON.stringify(config, null, 2));

		// 同时生成预览HTML页面
		await createPreviewHtml(previewDir);
	}

	async function createPreviewHtml(previewDir: string) {
		// 生成HTML模板内容
		const contentList = await generateContentList();
		
		// 使用字符串拼接构建HTML，避免Svelte解析器问题
		let htmlTemplate = '';
		
		// HTML头部
		htmlTemplate += '<!DOCTYPE html>\n';
		htmlTemplate += '<html lang="en">\n';
		htmlTemplate += '<head>\n';
		htmlTemplate += '    <meta charset="UTF-8">\n';
		htmlTemplate += '    <meta name="viewport" content="width=device-width, initial-scale=1.0">\n';
		htmlTemplate += `    <title>${siteName} - MDFriday Preview</title>\n`;
		htmlTemplate += '    <style>\n';
		htmlTemplate += '        body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; line-height: 1.6; max-width: 800px; margin: 0 auto; padding: 20px; background-color: #f5f5f5; }\n';
		htmlTemplate += '        .container { background: white; padding: 30px; border-radius: 8px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }\n';
		htmlTemplate += '        h1 { color: #333; border-bottom: 2px solid #007acc; padding-bottom: 10px; }\n';
		htmlTemplate += '        .preview-info { background: #e3f2fd; padding: 15px; border-radius: 4px; margin-bottom: 20px; border-left: 4px solid #2196f3; }\n';
		htmlTemplate += '        .theme-info { margin-top: 20px; padding: 15px; background: #fff3e0; border-radius: 4px; border-left: 4px solid #ff9800; }\n';
		htmlTemplate += '        .content-preview { margin-top: 20px; padding: 15px; background: #f8f9fa; border-radius: 4px; border-left: 4px solid #28a745; }\n';
		htmlTemplate += '        .file-item { padding: 8px 0; border-bottom: 1px solid #eee; }\n';
		htmlTemplate += '        .hot-reload-status { position: fixed; top: 20px; right: 20px; background: #4caf50; color: white; padding: 10px 15px; border-radius: 4px; font-size: 12px; opacity: 0.9; }\n';
		htmlTemplate += '    </style>\n';
		htmlTemplate += '</head>\n';
		
		// HTML主体开始
		const bodyOpenTag = '<body>';
		htmlTemplate += bodyOpenTag + '\n';
		htmlTemplate += '    <div class="hot-reload-status">🔥 Hot Reload Active</div>\n';
		htmlTemplate += '    <div class="container">\n';
		htmlTemplate += `        <h1>${siteName}</h1>\n`;
		
		// 预览信息
		htmlTemplate += '        <div class="preview-info">\n';
		htmlTemplate += '            <strong>📁 Preview Information</strong><br>\n';
		htmlTemplate += `            <strong>Content Path:</strong> ${contentPath}<br>\n`;
		htmlTemplate += `            <strong>Theme:</strong> ${selectedTheme}<br>\n`;
		htmlTemplate += `            <strong>Base URL:</strong> /${previewId}/<br>\n`;
		htmlTemplate += `            <strong>Generated:</strong> ${new Date().toLocaleString()}\n`;
		htmlTemplate += '        </div>\n';
		
		// 主题信息
		htmlTemplate += '        <div class="theme-info">\n';
		htmlTemplate += `            <strong>🎨 Theme: ${selectedTheme}</strong><br>\n`;
		htmlTemplate += '            This is a preview of your site using the selected theme.\n';
		htmlTemplate += '        </div>\n';
		
		// 内容预览
		htmlTemplate += '        <div class="content-preview">\n';
		htmlTemplate += '            <h3>📄 Content Preview</h3>\n';
		htmlTemplate += '            <p>Your markdown files will be processed and displayed here.</p>\n';
		htmlTemplate += '            <div id="content-list">\n';
		htmlTemplate += contentList;
		htmlTemplate += '            </div>\n';
		htmlTemplate += '        </div>\n';
		
		// 页脚
		htmlTemplate += '        <div style="margin-top: 30px; text-align: center; color: #666; font-size: 14px;">\n';
		htmlTemplate += '            <p>This is a development preview generated by MDFriday Obsidian Plugin</p>\n';
		htmlTemplate += '            <p>Changes to your files will be automatically reflected here</p>\n';
		htmlTemplate += '        </div>\n';
		htmlTemplate += '    </div>\n';
		
		// HTML结束标签
		const bodyCloseTag = '</body>';
		const htmlCloseTag = '</html>';
		htmlTemplate += bodyCloseTag + '\n';
		htmlTemplate += htmlCloseTag;

		const htmlPath = path.join(previewDir, 'index.html');
		await app.vault.adapter.write(htmlPath, htmlTemplate);
	}

	async function generateContentList(): Promise<string> {
		if (!selectedFolder) {
			return '<p>No content folder selected</p>';
		}

		let contentHtml = '';
		
		const processFolder = (folder: TFolder, level: number = 0): string => {
			let html = '';
			const indent = '  '.repeat(level);
			
			for (const child of folder.children) {
				if (child instanceof TFile && child.extension === 'md') {
					html += `${indent}<div class="file-item">📄 ${child.name}</div>\n`;
				} else if (child instanceof TFolder) {
					html += `${indent}<div class="file-item">📁 ${child.name}/</div>\n`;
					html += processFolder(child, level + 1);
				}
			}
			return html;
		};

		contentHtml = processFolder(selectedFolder);
		
		return contentHtml || '<p>No markdown files found in the selected folder</p>';
	}

	async function copyFolderContents(folder: TFolder, targetPath: string) {
		// 递归复制文件夹内容
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

</script>

<div class="site-builder">
	<div class="section">
		<label class="section-label" for="content-path">内容路径</label>
		<input 
			type="text" 
			class="form-input readonly" 
			value={contentPath} 
			readonly 
		/>
	</div>

	<!-- 站点名称 -->
	<div class="section">
		<label class="section-label" for="site-name">站点名称</label>
		<input 
			type="text" 
			class="form-input" 
			bind:value={siteName} 
			placeholder="输入站点名称"
		/>
	</div>

	<!-- 使用主题 -->
	<div class="section">
		<label class="section-label" for="themes">使用主题</label>
		<select class="form-select" bind:value={selectedTheme}>
			{#each availableThemes as theme}
				<option value={theme}>{theme}</option>
			{/each}
		</select>
	</div>

	<!-- 预览章节 -->
	<div class="section">
		<h3 class="section-title">预览章节</h3>
		<div class="preview-section">
			{#if isBuilding}
				<div class="progress-container">
					<p>正在生成预览...</p>
					<ProgressBar progress={buildProgress} />
				</div>
			{:else}
				<button 
					class="action-button preview-button" 
					on:click={startPreview}
					disabled={!selectedFolder}
				>
					{hasPreview ? '重新预览' : '生成预览'}
				</button>
			{/if}
			
			{#if hasPreview && previewUrl}
				<div class="preview-link">
					<p>预览链接:</p>
					<a href={previewUrl} target="_blank" class="preview-url">{previewUrl}</a>
					{#if isWatchingFiles}
						<p class="hot-reload-info">🔥 热重载已启用 - 文件更改将自动同步</p>
					{/if}
				</div>
			{/if}
		</div>
	</div>

	<!-- 发布章节 -->
	<div class="section">
		<h3 class="section-title">发布章节</h3>
		<div class="publish-section">
			<div class="publish-options">
				<select class="form-select" bind:value={selectedPublishOption}>
					{#each publishOptions as option}
						<option value={option.value}>{option.label}</option>
					{/each}
				</select>
				
				{#if isPublishing}
					<div class="progress-container">
						<p>正在发布...</p>
						<ProgressBar progress={publishProgress} />
					</div>
				{:else}
					<button 
						class="action-button publish-button" 
						on:click={startPublish}
						disabled={!hasPreview}
					>
						发布站点
					</button>
				{/if}
			</div>
			
			{#if publishSuccess && publishUrl}
				<div class="publish-success">
					<p class="success-message">✅ 发布成功!</p>
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
		margin-bottom: 5px;
		font-weight: 500;
		color: var(--text-normal);
	}

	.form-input {
		width: 100%;
		padding: 8px 12px;
		border: 1px solid var(--background-modifier-border);
		border-radius: 4px;
		background: var(--background-primary);
		color: var(--text-normal);
		font-size: 14px;
	}

	.form-input.readonly {
		background: var(--background-secondary);
		color: var(--text-muted);
		cursor: not-allowed;
	}

	.form-select {
		width: 100%;
		padding: 8px 12px;
		border: 1px solid var(--background-modifier-border);
		border-radius: 4px;
		background: var(--background-primary);
		color: var(--text-normal);
		font-size: 14px;
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

	.hot-reload-info {
		margin: 10px 0 0 0;
		font-size: 12px;
		color: var(--text-muted);
		font-style: italic;
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
		align-items: center;
		gap: 10px;
		flex-wrap: wrap;
	}

	.publish-options .form-select {
		flex: 1;
		min-width: 150px;
	}

	.success-message {
		margin: 0 0 5px 0;
		color: var(--text-success);
		font-weight: 500;
	}
</style> 
