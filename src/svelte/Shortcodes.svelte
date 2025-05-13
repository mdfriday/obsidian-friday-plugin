<script lang="ts">
	import { App } from "obsidian";
	import { onMount } from "svelte";
	import { shortcodeService, shortcodeApiService, type ShortcodeItem } from "../shortcode";
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

	onMount(async () => {
		await loadShortcodes();
		await loadTags();
	});

	// 加载快捷码列表
	async function loadShortcodes() {
		isLoading = true;
		try {
			// 使用 shortcodeApiService 获取快捷码列表
			const result = await shortcodeApiService.fetchShortcodes();
			shortcodes = result.shortcodes || [];
		} catch (error) {
			console.error("Error loading shortcodes:", error);
		} finally {
			isLoading = false;
		}
	}

	// 加载标签列表
	async function loadTags() {
		try {
			availableTags = await shortcodeApiService.fetchAllTags();
		} catch (error) {
			console.error("Error loading tags:", error);
		}
	}

	// 根据搜索条件和标签过滤快捷码
	$: filteredShortcodes = shortcodes.filter(sc => {
		// 标题或描述包含搜索词
		const matchesSearch = searchQuery === "" || 
			(sc.title && sc.title.toLowerCase().includes(searchQuery.toLowerCase())) || 
			(sc.description && sc.description.toLowerCase().includes(searchQuery.toLowerCase()));
		
		// 如果没有选择标签，显示所有匹配搜索的快捷码
		if (selectedTags.length === 0) return matchesSearch;
		
		// 如果选择了标签，则只显示拥有所选标签的快捷码
		return matchesSearch && sc.tags && selectedTags.some(tag => sc.tags.includes(tag));
	});

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
	}
</script>

<div class="shortcodes-container">
	<h2>Shortcodes</h2>
	
	<div class="search-container">
		<input 
			type="text" 
			bind:value={searchQuery} 
			placeholder="Search shortcodes..." 
			class="search-input"
		/>
	</div>
	
	{#if availableTags.length > 0}
		<div class="tags-container">
			{#each availableTags as tag}
				<div 
					class="tag {selectedTags.includes(tag) ? 'selected' : ''}" 
					on:click={() => toggleTag(tag)}
				>
					{tag}
				</div>
			{/each}
		</div>
	{/if}
	
	{#if isLoading}
		<div class="loading">Loading shortcodes...</div>
	{:else if filteredShortcodes.length === 0}
		<div class="no-results">No shortcodes found</div>
	{:else}
		<div class="shortcodes-list">
			{#each filteredShortcodes as shortcode}
				<div class="shortcode-item">
					<div class="shortcode-header">
						<h3>{shortcode.title}</h3>
						<button on:click={() => insertShortcode(shortcode)} class="insert-btn">Insert</button>
					</div>
					{#if shortcode.description}
						<div class="shortcode-description">{shortcode.description}</div>
					{/if}
					{#if shortcode.tags && shortcode.tags.length > 0}
						<div class="shortcode-tags">
							{#each shortcode.tags as tag}
								<span class="shortcode-tag">{tag}</span>
							{/each}
						</div>
					{/if}
				</div>
			{/each}
		</div>
	{/if}
</div>

<style>
	.shortcodes-container {
		display: flex;
		flex-direction: column;
		padding: 10px;
		gap: 15px;
	}
	
	h2 {
		margin: 0;
		padding: 0;
	}
	
	.search-container {
		width: 100%;
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
	}
	
	.tag {
		padding: 4px 8px;
		border-radius: 4px;
		background-color: var(--background-modifier-border);
		cursor: pointer;
		font-size: 12px;
	}
	
	.tag.selected {
		background-color: var(--interactive-accent);
		color: var(--text-on-accent);
	}
	
	.shortcodes-list {
		display: flex;
		flex-direction: column;
		gap: 15px;
		overflow-y: auto;
	}
	
	.shortcode-item {
		padding: 12px;
		border-radius: 4px;
		background-color: var(--background-secondary);
		border: 1px solid var(--background-modifier-border);
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
	}
	
	.loading, .no-results {
		text-align: center;
		color: var(--text-muted);
		padding: 20px 0;
	}
</style> 