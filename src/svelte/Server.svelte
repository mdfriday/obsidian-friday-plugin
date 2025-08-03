<script lang="ts">
	import {App, Platform, TFolder, Notice} from "obsidian";
	import Info from "./Info.svelte"
	import Site from "./Site.svelte"
	import {onMount, onDestroy} from "svelte";
	import FridayPlugin from "../main";

	// 接收 props
	export let app: App;
	export let plugin: FridayPlugin;
	export let selectedFolder: TFolder | null = null; // 新增：选中的文件夹

	let isClientSupported = false;

	onMount(async () => {
		isClientSupported = Platform.isDesktop;

		if (!isClientSupported) {
			new Notice('Only desktop is supported at this time.', 5000);
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
				We're sorry, only desktop is supported at this time.
				<br/>
				Mobile and Tablet is coming soon.
				Thank you for your patience and understanding!
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
						<Site {app} {plugin} {selectedFolder} />
						
						<hr class="centered-line">
						<Info/>
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
