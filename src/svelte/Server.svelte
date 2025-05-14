<script lang="ts">
	import {App, MarkdownView, Platform} from "obsidian";
	import Info from "./Info.svelte"
	import Service from "./Service.svelte"
	import BuildDeploy from "./BuildDeploy.svelte"
	import Shortcodes from "./Shortcodes.svelte"
	import {FileInfo} from "../fileinfo";
	import {onMount, onDestroy} from "svelte";
	import {Notice} from "obsidian";
	import FridayPlugin from "../main";
	import type { TabName } from "../server";

	// 接收 props
	export let fileInfo: FileInfo;
	export let app: App;
	export let plugin: FridayPlugin;
	export let activeTab: TabName = 'shortcodes'; // 接收外部传入的标签页，默认为 shortcodes

	let isClientSupported = false;
	let activeMarkdownView: MarkdownView | null = null;
	let cleanupActiveViewListener: (() => void) | null = null;

	onMount(async () => {
		isClientSupported = Platform.isDesktop;

		if (!isClientSupported) {
			new Notice('Only desktop is supported at this time.', 5000);
			return;
		}

		// 设置初始活动视图
		updateActiveMarkdownView();

		// 1. 监听活动叶子变化，以便追踪最新的活动 MarkdownView
		const onActiveLeafChange = () => {
			updateActiveMarkdownView();
		};

		// 2. 监听文件打开事件，确保在用户打开新文件时更新
		const onFileOpen = () => {
			updateActiveMarkdownView();
		};

		// 3. 监听布局变化，以应对拆分视图和标签页变化
		const onLayoutChange = () => {
			updateActiveMarkdownView();
		};

		// 4. 尝试监听视图模式变化 (在某些 Obsidian API版本中可能无效)
		const onViewModeChange = () => {
			// 延迟一下，确保模式切换已完成
			setTimeout(updateActiveMarkdownView, 50);
		};

		// 添加所有监听器
		app.workspace.on('active-leaf-change', onActiveLeafChange);
		app.workspace.on('file-open', onFileOpen);
		app.workspace.on('layout-change', onLayoutChange);
		app.workspace.on('editor-change', onViewModeChange);

		// 设置清理函数
		cleanupActiveViewListener = () => {
			app.workspace.off('active-leaf-change', onActiveLeafChange);
			app.workspace.off('file-open', onFileOpen);
			app.workspace.off('layout-change', onLayoutChange);
			app.workspace.off('editor-change', onViewModeChange);
		};
	});

	onDestroy(() => {
		// 清理监听器
		if (cleanupActiveViewListener) {
			cleanupActiveViewListener();
		}
	});

	// 更新当前活动的 MarkdownView
	function updateActiveMarkdownView() {
		// 获取当前活动的视图
		const currentView = app.workspace.getActiveViewOfType(MarkdownView);
		
		// 如果当前视图是可编辑的 markdown 视图，直接使用它
		if (currentView && currentView.editor && currentView.getMode() !== 'preview') {
			activeMarkdownView = currentView;
			return;
		}
		
		// 如果当前视图不可用，尝试从所有打开的视图中找到一个可编辑的视图
		const leaves = app.workspace.getLeavesOfType('markdown');
		const editableLeaves = leaves.filter(leaf => {
			const view = leaf.view as MarkdownView;
			return view && view.editor && view.getMode() !== 'preview';
		});
		
		// 如果找到了可编辑的视图，使用第一个
		if (editableLeaves.length > 0) {
			activeMarkdownView = editableLeaves[0].view as MarkdownView;
		} else if (currentView) {
			// 如果没有可编辑的视图但有当前视图（预览模式），仍然记录它以便显示错误信息
			activeMarkdownView = currentView;
		} else {
			// 没有找到任何 markdown 视图
			activeMarkdownView = null;
		}
	}

	// 切换标签页函数
	function setActiveTab(tab: TabName) {
		activeTab = tab;
	}

	// 处理键盘事件
	function handleKeyDown(event: KeyboardEvent, tab: TabName) {
		// 当用户按下 Enter 或空格键时触发点击
		if (event.key === 'Enter' || event.key === ' ') {
			event.preventDefault();
			setActiveTab(tab);
		}
	}
</script>


<div class="friday-plugin-main">
	{#if !isClientSupported}
		<div>
			<p>
				We're sorry, only desktop is supported at this time.
				<br/>
				Mobile and Tablet is coming soon.
				Thank you for your patience and understanding!
			</p>
		</div>
	{:else}
		<section id="friday-plugin-main">
			<!-- 标签页切换栏 -->
			<div class="friday-tabs" role="tablist" aria-label="Friday tabs">
				<div
					class="friday-tab {activeTab === 'shortcodes' ? 'active' : ''}" 
					on:click={() => setActiveTab('shortcodes')}
					on:keydown={(e) => handleKeyDown(e, 'shortcodes')}
					role="tab"
					tabindex={activeTab === 'shortcodes' ? 0 : -1}
					aria-selected={activeTab === 'shortcodes'}
					id="tab-shortcodes"
					aria-controls="panel-shortcodes"
				>
					Shortcodes
				</div>
				<div 
					class="friday-tab {activeTab === 'site' ? 'active' : ''}" 
					on:click={() => setActiveTab('site')}
					on:keydown={(e) => handleKeyDown(e, 'site')}
					role="tab"
					tabindex={activeTab === 'site' ? 0 : -1}
					aria-selected={activeTab === 'site'}
					id="tab-site"
					aria-controls="panel-site"
				>
					Site
				</div>
			</div>

			<!-- 标签页内容 -->
			<div class="friday-tab-content">
				{#if activeTab === 'site'}
					<div 
						role="tabpanel" 
						id="panel-site" 
						aria-labelledby="tab-site" 
						tabindex="0"
					>
						<Info/>
						<Service {fileInfo} {app} {plugin}/>
						<hr class="centered-line">
						{#if fileInfo.isReadyForBuild}
							<BuildDeploy {fileInfo} {plugin} />
						{/if}
					</div>
				{:else if activeTab === 'shortcodes'}
					<div 
						role="tabpanel" 
						id="panel-shortcodes" 
						aria-labelledby="tab-shortcodes" 
						tabindex="0"
					>
						<Shortcodes {plugin} {activeMarkdownView} />
					</div>
				{/if}
			</div>
		</section>
	{/if}
</div>

<style>
	.friday-plugin-main {
		padding: initial;
		width: initial;
		height: initial;
		position: initial;
		overflow-y: initial;
		overflow-wrap: initial;
	}

	.centered-line {
		width: 80%; /* 分隔线宽度占父容器的 80% */
		margin: 20px auto; /* 水平居中对齐 */
		border: none; /* 去掉默认的边框样式 */
		border-top: 1px solid rgb(64 64 64); /* 顶部边框作为分隔线 */
		height: 1px; /* 分隔线高度 */
		background-color: transparent; /* 确保背景透明 */
	}

	.friday-tabs {
		display: flex;
		border-bottom: 1px solid var(--background-modifier-border);
		margin-bottom: 15px;
	}

	.friday-tab {
		padding: 8px 16px;
		cursor: pointer;
		font-weight: 500;
		border-bottom: 2px solid transparent;
		transition: all 0.2s ease;
		background: none;
		border: none;
		text-align: center;
	}

	.friday-tab.active {
		border-bottom: 2px solid var(--interactive-accent);
		color: var(--interactive-accent);
	}

	.friday-tab:hover:not(.active) {
		background-color: var(--background-modifier-hover);
	}

	.friday-tab:focus {
		outline: 2px solid var(--interactive-accent);
		outline-offset: -2px;
	}

	.friday-tab-content {
		padding: 10px 0;
	}
</style>
