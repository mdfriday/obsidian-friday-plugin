<script lang="ts">
	import FridayPlugin from "../main";
	import ProgressBar from "./ProgressBar.svelte";
	import {Notice} from "obsidian";
	import type {FileInfo} from "../fileinfo";
	// 接收 props
	export let fileInfo: FileInfo;
	export let plugin: FridayPlugin;

	let isBuilding = false;
	let buildProgress = 0;
	let buildSuccess = false;
	let statusText = "";
	let previewLink = '';

	let isDeploying = false;
	let status = "";
	let deployedSizeText = '';
	let deploySuccess = false;
	let deployLink = '';
	let deployProgress = 0;
	let totalSizeText = '';
	let currentDeployType: 'netlify' | 'scp' = 'netlify';

	let previewFilename = '';
	let selectedDeploymentType: 'netlify' | 'scp' = 'netlify';

	interface PreviewCache {
		previewLink: string;
		buildSuccess: boolean;
		timestamp: number;
		deploymentType?: 'netlify' | 'scp';
	}

	// 初始化时从localStorage加载缓存
	const loadPreviewCache = () => {
		const cacheKey = `preview_${fileInfo.path}`;
		const cached = localStorage.getItem(cacheKey);
		if (cached) {
			const cache: PreviewCache = JSON.parse(cached);
			previewLink = cache.previewLink;
			buildSuccess = cache.buildSuccess;
			previewFilename = fileInfo.name;
			selectedDeploymentType = cache.deploymentType || plugin.settings.deploymentType;
		} else {
			selectedDeploymentType = plugin.settings.deploymentType;
		}
	};

	// 保存预览缓存
	const savePreviewCache = () => {
		const cacheKey = `preview_${fileInfo.path}`;
		const cache: PreviewCache = {
			previewLink,
			buildSuccess,
			timestamp: Date.now(),
			deploymentType: selectedDeploymentType
		};
		localStorage.setItem(cacheKey, JSON.stringify(cache));
	};

	// 在组件初始化时加载缓存
	loadPreviewCache();

	// 模拟构建过程
	const startPreview = async () => {
		previewFilename = fileInfo.name;
		buildProgress = 0;
		buildSuccess = false;

		isBuilding = true;
		statusText = "Building started...";

		const previewUrl = await plugin.hugoverse.preview((progress: number) => {
			if (progress === 0) {
				buildSuccess = false;
				buildProgress = 0;
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
		});
		
		if (previewUrl !== "") {
			previewLink = previewUrl;
			savePreviewCache(); // 保存成功的预览结果
		}
		isBuilding = false;
	};

	function formatBytes(bytes: number): string {
		if (bytes === 0) return '0 B';
		const k = 1024;
		const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
		const i = Math.floor(Math.log(bytes) / Math.log(k));
		return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
	}

	const startDeploy = async () => {
		deploySuccess = false;
		isDeploying = true;
		deployProgress = 0;
		totalSizeText = '';
		deployedSizeText = '';
		status = "Deploying...";
		currentDeployType = selectedDeploymentType;

		const deployUrl = await plugin.hugoverse.deploy(selectedDeploymentType);
		if (deployUrl !== "") {
			try {
				const deployData = JSON.parse(deployUrl);
				
				if (deployData.deployType === 'scp') {
					// 开始监控 SCP 进度
					totalSizeText = formatBytes(deployData.totalSize);
					status = "Starting SCP deployment...";
					const finalUrl = await plugin.hugoverse.monitorSCPProgress(
						deployData.sessionId,
						(progress, newStatus) => {
							deployProgress = (progress / deployData.totalSize) * 100;
							status = newStatus;
							deployedSizeText = formatBytes(progress);
						}
					);
					if (finalUrl) {
						deployLink = finalUrl;
					}
				} else {
					// 处理 Netlify 部署
					deployLink = deployUrl;
					status = "Deploying to Netlify...";
				}
				deploySuccess = true;
			} catch (error) {
				console.error("Deployment error:", error);
				new Notice(`Deployment failed: ${error.message}`, 5000);
				deploySuccess = false;
			}
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
				<span class="dynamic">{fileInfo.name}</span>
			</li>
			<li>
				<span class="label">Theme:</span>
				<span class="dynamic">{fileInfo.frontMatter?.theme}</span>
			</li>
		</ul>
	</div>
	{#if isBuilding}
		<ProgressBar progress={buildProgress}/>
	{:else}
		<button on:click={startPreview} disabled={buildProgress > 0 && buildProgress < 100}>
			{buildSuccess && previewFilename === fileInfo.name ? 'Rebuild Preview' : 'Preview'}
		</button>
	{/if}

</div>

{#if isBuilding}
	<div class="card is-selected">
		<p>{statusText}</p>
	</div>
{/if}

<!-- 在预览链接显示部分添加缓存提示 -->
{#if buildSuccess && previewFilename === fileInfo.name}
	<div class="card is-selected">
		<p>You can preview your site by clicking the link below:</p>
		<a href={previewLink} target="_blank">{previewLink}</a>
		<div class="dns-info">
			<p>Please note:</p>
			<ul>
				<li>The preview link will expire after 1 hour</li>
				<li>It may take a few minutes for the DNS to propagate and become active</li>
			</ul>
		</div>
	</div>
{/if}

<div class="build-container">
	{#if buildSuccess && previewFilename === fileInfo.name}
		<div class="card">
			<div class="deploy-section">
				<div class="deploy-type">
					<label for="deployType">Deployment Type:</label>
					<select 
						id="deployType"
						bind:value={selectedDeploymentType}
						class="deployment-select"
					>
						<option value="netlify">Netlify</option>
						<option value="scp">SCP (Private Server)</option>
					</select>
				</div>
				<button on:click={startDeploy} disabled={isDeploying}>Deploy</button>
			</div>
		</div>
		{#if isDeploying}
			<div class="card is-selected">
				<div class="deploy-status">
					<p>{status}</p>
					{#if currentDeployType === 'scp'}
						<p class="progress-text">{deployedSizeText} / {totalSizeText}</p>
					{/if}
				</div>
				{#if currentDeployType === 'scp'}
					<ProgressBar progress={deployProgress}/>
				{/if}
			</div>
		{/if}
	{/if}
</div>

<!-- 部署完成后显示链接 -->
{#if deploySuccess && previewFilename === fileInfo.name}
	<div class="card is-selected">
		<p>Congratulations! Your site has been deployed successfully.</p>
		{#if deployLink}
			<p>Click the link below to view it:</p>
			<a href={deployLink} target="_blank">{deployLink}</a>
			<p class="dns-info">Please note that it may take a few minutes for the DNS to propagate and become active.</p>
		{/if}
	</div>
{/if}

<style>
	.build-container {
		margin-top: 20px;
	}

	button:disabled {
		opacity: 0.5;
		cursor: not-allowed;
		background-color: var(--background-modifier-border);
		color: var(--text-muted);
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

	.deploy-section {
		display: flex;
		flex-direction: column;
		gap: 1rem;
	}

	.deploy-type {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: 0.5rem;
		width: 100%;
	}

	.deploy-type label {
		font-size: 0.9em;
		color: var(--text-muted);
	}

	.deployment-select {
		padding: 4px 8px;
		border-radius: 4px;
		border: 1px solid var(--background-modifier-border);
		background-color: var(--background-primary);
		color: var(--text-normal);
		width: 100%;
		appearance: none;
		-webkit-appearance: none;
		background-image: url("data:image/svg+xml;charset=US-ASCII,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%2214%22%20height%3D%2214%22%20viewBox%3D%220%200%2014%2014%22%3E%3Cpath%20fill%3D%22%23666%22%20d%3D%22M7%2010L3.5%206h7L7%2010z%22%2F%3E%3C%2Fsvg%3E");
		background-repeat: no-repeat;
		background-position: right 8px center;
		padding-right: 28px;
	}

	.deployment-select:focus {
		outline: none;
		border-color: var(--interactive-accent);
		background-image: url("data:image/svg+xml;charset=US-ASCII,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%2214%22%20height%3D%2214%22%20viewBox%3D%220%200%2014%2014%22%3E%3Cpath%20fill%3D%22%235c88ff%22%20d%3D%22M7%2010L3.5%206h7L7%2010z%22%2F%3E%3C%2Fsvg%3E");
	}

	.deployment-select:hover {
		border-color: var(--background-modifier-border-hover);
	}

	.deploy-status {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
	}

	.progress-text {
		font-size: 0.9em;
		color: var(--text-muted);
	}
</style>
