<script lang="ts">
	import {App, Platform, TFolder, TFile, Notice} from "obsidian";
	import Info from "./Info.svelte"
	import Site from "./Site.svelte"
	import {onMount, onDestroy} from "svelte";
	import FridayPlugin from "../main";

	// 接收 props
	export let app: App;
	export let plugin: FridayPlugin;

	let isClientSupported = false;
	
	// Reactive translation function
	$: t = plugin.i18n?.t || ((key: string) => key);

	onMount(async () => {
		isClientSupported = Platform.isDesktop;

		if (!isClientSupported) {
			new Notice(t('messages.desktop_only_notice'), 5000);
			return;
		}
	});

	onDestroy(() => {
	});

</script>


<div class="friday-plugin-main">
	{#if !isClientSupported}
		<div>
			<p>
				{t('ui.desktop_only_message')}
				<br/>
				{t('ui.mobile_coming_soon')}
			</p>
		</div>
	{:else}
		<section id="friday-plugin-main">
			<!-- 标签页内容 -->
			<div class="friday-tab-content">
					<div
						role="tabpanel" 
						id="panel-site" 
						aria-labelledby="tab-site" 
						tabindex="0"
					>
						<Site {app} {plugin} />
						
						<hr class="centered-line">
						<Info {plugin}/>
					</div>
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

	.friday-tab-content {
		padding: 10px 0;
	}
</style>
