<script lang="ts">
	import FridayPlugin from "../main";
	import ProgressBar from "./ProgressBar.svelte";
	import {Notice} from "obsidian";
	// 接收 props
	export let plugin: FridayPlugin;

	let isBuilding = false;
	let buildProgress = 0;
	let buildSuccess = false;
	let statusText = "";
	let previewLink = '';

	let isDeploying = false;
	let deployStatusText = "";
	let deploySuccess = false;
	let deployLink = '';

	// 模拟构建过程
	const startPreview = async () => {
		buildProgress = 0;
		buildSuccess = false;

		isBuilding = true;
		statusText = "Building started...";

		const previewUrl = await plugin.hugoverse.preview((progress: number) => {
			if (progress === 0) {
				buildSuccess = false;
				statusText = "Building for preview failed...";
				isBuilding = false;
				new Notice("Building for preview failed!", 5000);

			} else if (progress < 100) {
				buildProgress = progress;
				statusText = "Building for preview...";
			} else {
				buildProgress = progress;
				buildSuccess = true;
				statusText = "Build successful!";
			}
		})
		if (previewUrl !== "") {
			previewLink = previewUrl;
		}
		isBuilding = false;
	};

	const startDeploy = async () => {
		deploySuccess = false;

		isDeploying = true;
		deployStatusText = "Deploying...";

		const deployUrl = await plugin.hugoverse.deploy()
		if (deployUrl !== "") {
			deployLink = deployUrl;
			deploySuccess = true;
		}
		isDeploying = false;
	};
</script>

<!-- 构建部分 -->

<div class="card">
	<div>We will build your site based on the following information.</div>
	<div>
		<ul>
			<li>
				<span class="label">Note:</span>
				<span class="dynamic">{plugin.fileInfo.name}</span>
			</li>
			<li>
				<span class="label">Theme:</span>
				<span class="dynamic">{plugin.fileInfo.frontMatter?.theme}</span>
			</li>
		</ul>
	</div>
	{#if isBuilding}
		<ProgressBar progress={buildProgress}/>
	{:else}
		<button on:click={startPreview} disabled={buildProgress > 0 && buildProgress < 100}>
			Preview
		</button>
	{/if}

</div>

{#if isBuilding}
	<div class="card is-selected">
		<p>{statusText}</p>
	</div>
{/if}

<!-- 部署完成后显示链接 -->
{#if buildSuccess}
	<div class="card is-selected">
		<p>You can preview your site by clicking the link below:</p>
		<a href={previewLink} target="_blank">{previewLink}</a>
	</div>
{/if}

<div class="build-container">
	{#if buildSuccess}
		<div class="card">
			<button on:click={startDeploy}>Deploy</button>
		</div>
		{#if isDeploying}
			<div class="card is-selected">
				<p>{deployStatusText}</p>
			</div>
		{/if}

	{/if}
</div>

<!-- 部署完成后显示链接 -->
{#if deploySuccess}
	<div class="card is-selected">
		<p>Congratulations! Your site has been deployed. Click the link below to view it:</p>
		<a href={deployLink} target="_blank">{deployLink}</a>
	</div>
{/if}

<style>
	.build-container {
		margin-top: 20px;
	}

	button:disabled {
		background-color: #aaa;
		cursor: not-allowed;
	}

	a {
		color: #007bff;
		text-decoration: none;
		word-wrap: break-word; /* 允许单词换行 */
		overflow-wrap: break-word; /* 确保长单词在行内换行 */
		word-break: break-all; /* 打破长单词在链接的地方换行 */
	}

	a:hover {
		text-decoration: underline;
	}

	/* 为动态部分添加样式 */
	.dynamic {
		font-style: italic;
		margin-left: 10px; /* 可选: 添加一些间距 */
	}
</style>
