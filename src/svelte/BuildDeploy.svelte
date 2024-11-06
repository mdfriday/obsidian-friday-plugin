<script lang="ts">
	import FridayPlugin from "../main";
	// 接收 props
	export let plugin: FridayPlugin;

	let isBuilding = false;
	let buildProgress = 0;
	let buildSuccess = false;
	let deploySuccess = false;
	let statusText = "";
	let deployLink = '';
	let previewLink = '';

	// 模拟构建过程
	const startPreview = async () => {
		buildProgress = 0;
		buildSuccess = false;
		deploySuccess = false;

		isBuilding = true;
		statusText = "Building started...";

		const previewUrl = await plugin.hugoverse.preview((progress: number) => {
			if (progress === 0) {
				buildSuccess = false;
				statusText = "Building for preview failed...";

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
	};

	// 模拟部署过程
	const startDeploy = () => {
		statusText = "Deploying...";
		const deployInterval = setInterval(() => {
			if (buildProgress < 100) {
				buildProgress += 25;
			} else {
				clearInterval(deployInterval);
				deploySuccess = true;
				statusText = "Deploy successful!";
				deployLink = 'https://example.com'; // 模拟部署后的链接
			}
		}, 500); // 每0.5秒更新一次
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

	<button on:click={startPreview} disabled={buildProgress > 0 && buildProgress < 100}>
		Preview
	</button>
</div>

{#if isBuilding}
	<div class="card is-selected">
		<p>{statusText}</p>
	</div>
{/if}

<!-- 部署完成后显示链接 -->
{#if buildSuccess}
	<div class="card is-selected">
		<p>You can visit your preview site here:</p>
		<a href={previewLink} target="_blank">{previewLink}</a>
	</div>
{/if}

<div class="build-container">
	{#if buildSuccess}
		<div class="card">
			<div>Now you can deploy your site.</div>

			<button on:click={startDeploy}>Deploy</button>
		</div>

	{/if}
</div>

<!-- 部署完成后显示链接 -->
{#if deploySuccess}
	<div class="card is-selected">
		<p>Deploy successful! You can visit your site here:</p>
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
