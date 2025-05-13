<script lang="ts">
	import { App } from "obsidian";
	import { onMount, afterUpdate } from "svelte";
	import { shortcodeService, shortcodeApiService, type ShortcodeItem, type ShortcodeSearchResult } from "../shortcode";
	import FridayPlugin from "../main";
	import { FileInfo } from "../fileinfo";

	// 接收 props
	export let fileInfo: FileInfo;
	export let app: App;
	export let plugin: FridayPlugin;

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

	// 响应式计算过滤后的快捷码
	$: filteredShortcodes = shortcodes;

	onMount(async () => {
		// 使用文件信息进行初始化
		console.log("Initializing Shortcodes with file:", fileInfo);
		
		// 使用插件实例记录日志
		plugin.status("Loading shortcodes...");
		
		// 加载标签
		await loadTags();
		// 加载初始快捷码
		await loadShortcodes();
		isInitialLoad = false;
		
		plugin.status("Shortcodes loaded");
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
			console.log('Loaded tags:', availableTags);
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
			console.log(`Loaded ${result.shortcodes.length} shortcodes, has more: ${result.hasMore}`);
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
			console.log(`Loaded more shortcodes (page ${currentPage}), total: ${shortcodes.length}, has more: ${result.hasMore}`);
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
	function insertShortcode(shortcode: ShortcodeItem) {
		// 获取当前编辑器
		const activeLeaf = app.workspace.activeLeaf;
		if (!activeLeaf) return;
		
		const activeView = activeLeaf.view;
		if (!activeView) return;
		
		// 使用 Obsidian API 插入文本
		// @ts-ignore - 编辑器在某些视图类型上可能不存在
		if (activeView.editor) {
			// @ts-ignore
			const cursor = activeView.editor.getCursor();
			// @ts-ignore
			activeView.editor.replaceRange(`{{${shortcode.title}}}`, cursor);
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
</script>

<div class="shortcodes-container" bind:this={containerRef}>
	<h2>Shortcodes</h2>
	
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
				<button 
					class="tag {selectedTags.includes(tag) ? 'selected' : ''}" 
					on:click={() => toggleTag(tag)}
					on:keydown={(e) => handleKeyDown(e, () => toggleTag(tag))}
					aria-pressed={selectedTags.includes(tag)}
				>
					{tag}
				</button>
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
		<div class="shortcodes-list" role="list" aria-label="Shortcodes list">
			{#each filteredShortcodes as shortcode}
				<div class="shortcode-item" role="listitem">
					<div class="shortcode-header">
						<h3>{shortcode.title}</h3>
						<button 
							on:click={() => insertShortcode(shortcode)} 
							class="insert-btn"
							aria-label="Insert {shortcode.title} shortcode"
						>
							Insert
						</button>
					</div>
					{#if shortcode.description}
						<div class="shortcode-description">{shortcode.description}</div>
					{/if}
					{#if shortcode.tags && shortcode.tags.length > 0}
						<div class="shortcode-tags" role="group" aria-label="Tags">
							{#each shortcode.tags as tag}
								<button 
									class="shortcode-tag {selectedTags.includes(tag) ? 'selected' : ''}" 
									on:click={() => toggleTag(tag)}
									on:keydown={(e) => handleKeyDown(e, () => toggleTag(tag))}
									aria-pressed={selectedTags.includes(tag)}
								>
									{tag}
								</button>
							{/each}
						</div>
					{/if}
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
	
	h2 {
		margin: 0;
		padding: 0;
	}
	
	.search-container {
		width: 100%;
		position: sticky;
		top: 0;
		z-index: 10;
		background-color: var(--background-primary);
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
		gap: 8px;
		position: sticky;
		top: 58px;
		z-index: 9;
		background-color: var(--background-primary);
		padding: 5px 0;
	}
	
	.tag {
		padding: 4px 8px;
		border-radius: 4px;
		background-color: var(--background-modifier-border);
		cursor: pointer;
		font-size: 12px;
		transition: all 0.2s ease;
		border: none;
	}
	
	.tag.selected {
		background-color: var(--interactive-accent);
		color: var(--text-on-accent);
	}
	
	.tag:focus {
		outline: 2px solid var(--interactive-accent);
		outline-offset: -2px;
	}
	
	.shortcodes-list {
		display: flex;
		flex-direction: column;
		gap: 15px;
		padding-bottom: 20px;
	}
	
	.shortcode-item {
		padding: 12px;
		border-radius: 4px;
		background-color: var(--background-secondary);
		border: 1px solid var(--background-modifier-border);
		transition: transform 0.2s ease, box-shadow 0.2s ease;
	}
	
	.shortcode-item:hover {
		transform: translateY(-2px);
		box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
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
	
	.shortcode-description {
		font-size: 14px;
		margin-bottom: 8px;
		color: var(--text-muted);
	}
	
	.shortcode-tags {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
	}
	
	.shortcode-tag {
		padding: 2px 6px;
		border-radius: 4px;
		background-color: var(--background-modifier-border);
		font-size: 11px;
		cursor: pointer;
		transition: all 0.2s ease;
		border: none;
	}
	
	.shortcode-tag.selected {
		background-color: var(--interactive-accent);
		color: var(--text-on-accent);
	}
	
	.shortcode-tag:focus {
		outline: 2px solid var(--interactive-accent);
		outline-offset: -2px;
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