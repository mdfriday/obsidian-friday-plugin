<script lang="ts">
	import {App, Platform} from "obsidian";
	import Info from "./Info.svelte"
	import Service from "./Service.svelte"
	import BuildDeploy from "./BuildDeploy.svelte"
	import Shortcodes from "./Shortcodes.svelte"
	import {FileInfo} from "../fileinfo";
	import {onMount} from "svelte";
	import {Notice} from "obsidian";
	import FridayPlugin from "../main";
	import type { TabName } from "../server";

	// 接收 props
	export let fileInfo: FileInfo;
	export let app: App;
	export let plugin: FridayPlugin;
	export let activeTab: TabName = 'shortcodes'; // 接收外部传入的标签页，默认为 shortcodes

	let isClientSupported = false;

	onMount(async () => {
		isClientSupported = Platform.isDesktop;

		if (!isClientSupported) {
			new Notice('Only desktop is supported at this time.', 5000);
			return;
		}
	});

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
						<Shortcodes {fileInfo} {app} {plugin} />
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
