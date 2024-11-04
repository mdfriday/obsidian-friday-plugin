<script lang="ts">
	import {App, Platform} from "obsidian";
	import Info from "./Info.svelte"
	import Service from "./Service.svelte"
	import BuildDeploy from "./BuildDeploy.svelte"
	import {FileInfo} from "../fileinfo";
	import {onMount} from "svelte";
	import {Notice} from "obsidian";
	import FridayPlugin from "../main";

	// 接收 props
	export let fileInfo: FileInfo;
	export let app: App;
	export let plugin: FridayPlugin;

	let isClientSupported = false;

	onMount(async () => {
		isClientSupported = Platform.isDesktop;

		if (!isClientSupported) {
			new Notice('Only desktop is supported at this time.', 5000);
			return;
		}
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
			<div>
				<Info/>
				<Service {fileInfo} {app} {plugin}/>
				<hr class="centered-line">
				{#if fileInfo.hasFridayPluginEnabled() && fileInfo.hasThemeConfigured()}
					<BuildDeploy {fileInfo} />
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

</style>
