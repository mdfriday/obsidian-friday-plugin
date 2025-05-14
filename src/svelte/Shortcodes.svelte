<script lang="ts">
	import {App, MarkdownView, Notice} from "obsidian";
	import { onMount, afterUpdate } from "svelte";
	import { shortcodeService, shortcodeApiService, type ShortcodeItem, type ShortcodeSearchResult } from "../shortcode";
	import FridayPlugin from "../main";
	import { FileInfo } from "../fileinfo";

	// 接收 props
	export let plugin: FridayPlugin;
	export let activeMarkdownView: MarkdownView | null = null; // 新增：从外部传入当前活动的 MarkdownView

	let shortcodes: ShortcodeItem[] = [];
	let searchQuery: string = "";
	let isLoading: boolean = false;
	let selectedTags: string[] = [];
	let availableTags: string[] = [];
	let currentPage: number = 1;
	let hasMoreShortcodes: boolean = true;
	let loadingMore: boolean = false;
	let containerRef: HTMLElement;
	let searchTimeout: NodeJS.Timeout;
	let isInitialLoad: boolean = true;
	let loadedImages: Record<string, boolean> = {}; // Track loaded state of images
	let insertingShortcodes: Record<string, boolean> = {}; // Track which shortcodes are being inserted

	// 响应式计算过滤后的快捷码
	$: filteredShortcodes = shortcodes;

	onMount(async () => {
		// 加载标签
		await loadTags();
		// 加载初始快捷码
		await loadShortcodes();
		isInitialLoad = false;
	});

	afterUpdate(() => {
		// 设置滚动监听，仅在组件更新后添加一次
		if (!isInitialLoad && containerRef) {
			setupScrollListener();
		}
	});

	// 设置滚动监听
	function setupScrollListener() {
		if (!containerRef) return;

		// 使用 IntersectionObserver 监听滚动到底部
		const observer = new IntersectionObserver((entries) => {
			const [entry] = entries;
			if (entry.isIntersecting && hasMoreShortcodes && !loadingMore) {
				loadMoreShortcodes();
			}
		}, {
			root: containerRef.parentElement,
			threshold: 0.1
		});

		// 添加一个触发加载更多的元素
		const loaderElement = document.getElementById('shortcode-loader');
		if (loaderElement) {
			observer.observe(loaderElement);
		}

		return () => {
			observer.disconnect();
		};
	}

	// 加载标签列表
	async function loadTags() {
		try {
			availableTags = await shortcodeApiService.fetchAllTags();
		} catch (error) {
			console.error("Error loading tags:", error);
		}
	}

	// 加载快捷码列表
	async function loadShortcodes(resetList: boolean = true) {
		isLoading = true;
		
		if (resetList) {
			shortcodes = [];
			currentPage = 1;
			loadedImages = {}; // Reset loaded images state
		}
		
		try {
			// 使用 shortcodeApiService 获取快捷码列表
			const result = await shortcodeApiService.searchShortcodes(
				currentPage,
				20, // 每页20条
				searchQuery,
				selectedTags
			);
			
			if (resetList) {
				shortcodes = result.shortcodes;
			} else {
				// 合并新加载的快捷码，避免重复
				const newShortcodes = result.shortcodes.filter(
					newCode => !shortcodes.some(existingCode => existingCode.id === newCode.id)
				);
				shortcodes = [...shortcodes, ...newShortcodes];
			}
			
			hasMoreShortcodes = result.hasMore;
		} catch (error) {
			console.error("Error loading shortcodes:", error);
		} finally {
			isLoading = false;
		}
	}

	// 加载更多快捷码
	async function loadMoreShortcodes() {
		if (!hasMoreShortcodes || loadingMore) return;
		
		loadingMore = true;
		currentPage++;
		
		try {
			// 加载下一页快捷码
			const result = await shortcodeApiService.searchShortcodes(
				currentPage,
				20, // 每页20条
				searchQuery,
				selectedTags
			);
			
			// 合并新加载的快捷码，避免重复
			const newShortcodes = result.shortcodes.filter(
				newCode => !shortcodes.some(existingCode => existingCode.id === newCode.id)
			);
			shortcodes = [...shortcodes, ...newShortcodes];
			
			hasMoreShortcodes = result.hasMore;
		} catch (error) {
			console.error("Error loading more shortcodes:", error);
		} finally {
			loadingMore = false;
		}
	}

	// 处理搜索输入
	function handleSearchInput() {
		// 防抖处理，避免频繁请求
		if (searchTimeout) {
			clearTimeout(searchTimeout);
		}
		
		searchTimeout = setTimeout(() => {
			loadShortcodes();
		}, 300);
	}

	// 插入快捷码到当前文档
	async function insertShortcode(shortcode: ShortcodeItem) {
		try {
			// 设置加载状态
			insertingShortcodes[shortcode.id] = true;
			insertingShortcodes = {...insertingShortcodes}; // 触发响应式更新

			// 首先注册 shortcode
			shortcodeService.registerShortcode(shortcode);

			// 解码 example 内容
			let exampleContent = shortcodeService.decodeExample(shortcode) || `{{${shortcode.title}}}`;
			
			// 确保所有嵌套的 shortcodes 都已注册
			await shortcodeService.ensureShortcodesRegistered(exampleContent);

			// 检查是否有有效的 activeMarkdownView 并且它是处于编辑模式
			if (!activeMarkdownView || !activeMarkdownView.editor || activeMarkdownView.getMode() === 'preview') {
				// 显示错误信息
				const isPreviewMode = activeMarkdownView && activeMarkdownView.getMode() === 'preview';
				
				if (isPreviewMode) {
					await plugin.status('Cannot insert shortcode: Current view is in preview mode');
					new Notice("Please switch to edit mode to insert shortcodes.", 6000);
				} else {
					await plugin.status('Cannot insert shortcode: No active editor');
					new Notice("Please open a note in edit mode first.", 6000);
				}
				return;
			}

			// 获取编辑器实例
			const editor = activeMarkdownView.editor;
			
			// 获取光标位置
			const cursor = editor.getCursor();

			// 创建带有格式的内容，用 shortcode 代码块包裹
			const formattedContent = `\`\`\`shortcode\n\n${exampleContent}\n\n\`\`\``;
			
			// 插入内容到光标位置
			editor.replaceRange(formattedContent, cursor);

			// 通知用户
			let filename = "";
			if (activeMarkdownView && activeMarkdownView.file) {
				filename = ` in "${activeMarkdownView.file.name}"`;
			}
			await plugin.status(`Inserted ${shortcode.title} shortcode${filename}`);
		} catch (error) {
			console.error('Error inserting shortcode:', error);
			
			// 提供更具体的错误消息
			let errorMessage = 'Failed to insert shortcode';
			
			// @ts-ignore
			if (error && error.message) {
				// @ts-ignore
				errorMessage += `: ${error.message}`;
			}
			
			await plugin.status(errorMessage);
		} finally {
			// 重置加载状态
			insertingShortcodes[shortcode.id] = false;
			insertingShortcodes = {...insertingShortcodes}; // 触发响应式更新
		}
	}

	// 切换标签选择
	function toggleTag(tag: string) {
		if (selectedTags.includes(tag)) {
			selectedTags = selectedTags.filter(t => t !== tag);
		} else {
			selectedTags = [...selectedTags, tag];
		}
		
		// 重新加载快捷码
		loadShortcodes();
	}
	
	// 处理键盘事件
	function handleKeyDown(event: KeyboardEvent, action: () => void) {
		// 当用户按下 Enter 或空格键时触发动作
		if (event.key === 'Enter' || event.key === ' ') {
			event.preventDefault();
			action();
		}
	}

	// 处理图片加载完成
	function handleImageLoad(shortcodeId: string) {
		loadedImages[shortcodeId] = true;
		loadedImages = loadedImages; // 触发响应式更新
	}
</script>

<div class="shortcodes-container" bind:this={containerRef}>
	<!-- 搜索输入框 -->
	<div class="search-container">
		<input 
			type="text" 
			bind:value={searchQuery} 
			on:input={handleSearchInput}
			placeholder="Search shortcodes..." 
			class="search-input"
			aria-label="Search shortcodes"
		/>
	</div>
	
	<!-- 标签区域 -->
	{#if availableTags.length > 0}
		<div class="tags-container" role="group" aria-label="Filter by tags">
			{#each availableTags as tag}
				<span 
					class="tag-pill {selectedTags.includes(tag) ? 'selected' : ''}" 
					on:click={() => toggleTag(tag)}
					on:keydown={(e) => handleKeyDown(e, () => toggleTag(tag))}
					tabindex="0"
					role="button"
					aria-pressed={selectedTags.includes(tag)}
				>
					{tag}
				</span>
			{/each}
		</div>
	{/if}
	
	<!-- 加载状态 -->
	{#if isLoading && shortcodes.length === 0}
		<div class="loading" aria-live="polite">Loading shortcodes...</div>
	{:else if filteredShortcodes.length === 0}
		<div class="no-results" aria-live="polite">No shortcodes found</div>
	{:else}
		<!-- 快捷码列表 -->
		<div class="shortcodes-grid" role="list" aria-label="Shortcodes list">
			{#each filteredShortcodes as shortcode}
				<div class="shortcode-item" role="listitem">
					<!-- 缩略图区域 -->
					<div class="shortcode-thumbnail-container">
						{#if shortcode.thumbnail}
							<div class="thumbnail-wrapper">
								<div class={`thumbnail-placeholder ${loadedImages[shortcode.id] ? 'hidden' : ''}`}></div>
								<img 
									src={shortcode.thumbnail} 
									alt={shortcode.title}
									class="shortcode-thumbnail {loadedImages[shortcode.id] ? 'loaded' : ''}"
									on:load={() => handleImageLoad(shortcode.id)}
									loading="lazy"
								/>
							</div>
						{:else}
							<div class="thumbnail-placeholder no-image">
								<span>No preview</span>
							</div>
						{/if}
					</div>
					
					<div class="shortcode-content">
						<div class="shortcode-header">
							<h3>{shortcode.title}</h3>
							<button 
								on:click={() => insertShortcode(shortcode)} 
								class="insert-btn {insertingShortcodes[shortcode.id] ? 'loading' : ''}"
								aria-label="Insert {shortcode.title} shortcode"
								disabled={insertingShortcodes[shortcode.id]}
							>
								{insertingShortcodes[shortcode.id] ? 'Inserting...' : 'Insert'}
							</button>
						</div>
						{#if shortcode.description}
							<div class="shortcode-description">{shortcode.description}</div>
						{/if}
						{#if shortcode.tags && shortcode.tags.length > 0}
							<div class="shortcode-tags" role="group" aria-label="Tags">
								{#each shortcode.tags as tag}
									<span 
										class="tag-pill {selectedTags.includes(tag) ? 'selected' : ''}" 
										on:click={() => toggleTag(tag)}
										on:keydown={(e) => handleKeyDown(e, () => toggleTag(tag))}
										tabindex="0"
										role="button"
										aria-pressed={selectedTags.includes(tag)}
									>
										{tag}
									</span>
								{/each}
							</div>
						{/if}
					</div>
				</div>
			{/each}
			
			<!-- 加载更多触发元素 -->
			<div id="shortcode-loader" class="shortcode-loader" aria-live="polite">
				{#if loadingMore}
					<div class="loading-more">Loading more shortcodes...</div>
				{:else if hasMoreShortcodes}
					<div class="loader-placeholder"></div>
				{:else}
					<div class="no-more">No more shortcodes</div>
				{/if}
			</div>
		</div>
	{/if}
</div>

<style>
	.shortcodes-container {
		display: flex;
		flex-direction: column;
		padding: 10px;
		gap: 15px;
		height: 100%;
		overflow-y: auto;
	}
	
	.search-container {
		width: 100%;
		position: sticky;
		top: 0;
		z-index: 10;
		background-color: transparent;
		padding: 10px 0;
	}
	
	.search-input {
		width: 100%;
		padding: 8px;
		border-radius: 4px;
		border: 1px solid var(--background-modifier-border);
	}
	
	.tags-container {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
		position: sticky;
		top: 58px;
		z-index: 9;
		background-color: transparent;
		padding: 5px 0;
	}
	
	.tag-pill {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		padding: 0.25rem 0.75rem;
		border-radius: 9999px; /* Full rounded for pill effect */
		font-size: 0.75rem;
		font-weight: 500;
		background-color: var(--background-primary-alt);
		color: var(--text-muted);
		cursor: pointer;
		transition: all 0.15s ease;
		user-select: none;
		line-height: 1.5;
		box-shadow: 0 1px 2px rgba(0, 0, 0, 0.05);
		border: 1px solid var(--background-modifier-border);
		min-width: 1.5rem;
		height: 1.5rem;
	}
	
	.tag-pill:hover {
		background-color: var(--background-primary);
		color: var(--text-normal);
		transform: translateY(-1px);
		box-shadow: 0 2px 3px rgba(0, 0, 0, 0.1);
	}
	
	.tag-pill.selected {
		background-color: var(--interactive-accent);
		color: var(--text-on-accent);
		border-color: var(--interactive-accent);
		transform: translateY(-1px);
		box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
		font-weight: 600;
	}
	
	.tag-pill:focus {
		outline: none;
		box-shadow: 0 0 0 2px var(--background-modifier-border-hover), 0 0 0 4px var(--interactive-accent-hover);
	}
	
	.tag-pill:active {
		transform: translateY(0);
	}
	
	/* Hide but don't remove entirely for backward compatibility */
	.tag {
		display: none !important;
	}
	
	.shortcode-tag {
		display: none !important;
	}
	
	/* 改为网格布局，更好地显示缩略图卡片 */
	.shortcodes-grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(250px, 1fr));
		gap: 15px;
		padding-bottom: 20px;
	}
	
	.shortcode-item {
		display: flex;
		flex-direction: column;
		border-radius: 8px;
		background-color: var(--background-secondary);
		border: 1px solid var(--background-modifier-border);
		transition: transform 0.2s ease, box-shadow 0.2s ease;
		overflow: hidden;
	}
	
	.shortcode-item:hover {
		transform: translateY(-2px);
		box-shadow: 0 4px 8px rgba(0, 0, 0, 0.15);
	}
	
	/* 缩略图相关样式 */
	.shortcode-thumbnail-container {
		width: 100%;
		position: relative;
		overflow: hidden;
		background-color: var(--background-modifier-border);
		aspect-ratio: 16/9;
	}
	
	.thumbnail-wrapper {
		width: 100%;
		height: 100%;
		position: relative;
	}
	
	.thumbnail-placeholder {
		position: absolute;
		top: 0;
		left: 0;
		width: 100%;
		height: 100%;
		background-color: var(--background-secondary-alt);
		display: flex;
		justify-content: center;
		align-items: center;
		transition: opacity 0.3s ease;
	}
	
	.thumbnail-placeholder.hidden {
		opacity: 0;
	}
	
	.thumbnail-placeholder.no-image {
		position: relative;
		color: var(--text-muted);
		font-size: 14px;
	}
	
	.shortcode-thumbnail {
		width: 100%;
		height: 100%;
		object-fit: contain;
		opacity: 0;
		transition: opacity 0.3s ease;
	}
	
	.shortcode-thumbnail.loaded {
		opacity: 1;
	}
	
	.shortcode-content {
		padding: 12px;
		display: flex;
		flex-direction: column;
		flex: 1;
	}
	
	.shortcode-header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		margin-bottom: 8px;
	}
	
	.shortcode-header h3 {
		margin: 0;
		font-size: 16px;
	}
	
	.insert-btn {
		padding: 4px 8px;
		border-radius: 4px;
		background-color: var(--interactive-accent);
		color: var(--text-on-accent);
		cursor: pointer;
		border: none;
		transition: background-color 0.2s ease;
	}
	
	.insert-btn:hover {
		background-color: var(--interactive-accent-hover);
	}
	
	.insert-btn:focus {
		outline: 2px solid var(--interactive-accent);
		outline-offset: -2px;
	}
	
	.insert-btn.loading {
		background-color: var(--background-modifier-border);
		color: var(--text-muted);
		cursor: not-allowed;
		position: relative;
		overflow: hidden;
	}
	
	.insert-btn.loading::after {
		content: "";
		position: absolute;
		left: -100%;
		top: 0;
		width: 100%;
		height: 100%;
		background: linear-gradient(
			to right,
			transparent 0%,
			rgba(255, 255, 255, 0.2) 50%,
			transparent 100%
		);
		animation: loading-animation 1.5s infinite;
	}
	
	@keyframes loading-animation {
		0% {
			left: -100%;
		}
		100% {
			left: 100%;
		}
	}
	
	.shortcode-description {
		font-size: 14px;
		margin-bottom: 8px;
		color: var(--text-muted);
		/* 添加文本截断，防止过长描述 */
		overflow: hidden;
		text-overflow: ellipsis;
		display: -webkit-box;
		-webkit-line-clamp: 2;
		-webkit-box-orient: vertical;
	}
	
	.shortcode-tags {
		display: flex;
		flex-wrap: wrap;
		gap: 0.4rem;
		margin-top: auto;
		padding-top: 8px;
	}
	
	.shortcode-tags .tag-pill {
		padding: 0.15rem 0.6rem;
		font-size: 0.7rem;
		height: 1.3rem;
		min-width: 1.3rem;
	}
	
	.loading, .no-results {
		text-align: center;
		color: var(--text-muted);
		padding: 20px 0;
	}
	
	.shortcode-loader {
		text-align: center;
		padding: 15px 0;
		margin-top: 10px;
		grid-column: 1 / -1; /* 让加载器占据整行 */
	}
	
	.loading-more {
		color: var(--text-muted);
		font-size: 14px;
	}
	
	.loader-placeholder {
		height: 30px;
	}
	
	.no-more {
		color: var(--text-muted);
		font-size: 14px;
		opacity: 0.7;
	}
</style> 
