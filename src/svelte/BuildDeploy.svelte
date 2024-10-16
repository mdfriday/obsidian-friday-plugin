<script>
	let buildProgress = 0;
	let buildSuccess = false;
	let deploySuccess = false;
	let statusText = "Idle";
	let deployLink = '';

	// 模拟构建过程
	const startBuild = () => {
		buildProgress = 0;
		buildSuccess = false;
		deploySuccess = false;
		statusText = "Building...";

		const buildInterval = setInterval(() => {
			if (buildProgress < 100) {
				buildProgress += 20;
			} else {
				clearInterval(buildInterval);
				buildSuccess = true;
				statusText = "Build successful!";
			}
		}, 500); // 每0.5秒更新一次
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
			<li>Note: note name</li>
			<li>Theme: default</li>
		</ul>
	</div>

	<button on:click={startBuild} disabled={buildProgress > 0 && buildProgress < 100}>
		Preview
	</button>
</div>

<div class="card is-selected">
	<p>{statusText}</p>
</div>

<div class="build-container">
	{#if buildSuccess}
		<div class="card">
			<div>We will build your site based on the following information.</div>
			<div>
				<ul>
					<li>Note: note name</li>
					<li>Theme: default</li>
				</ul>
			</div>

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
	}

	a:hover {
		text-decoration: underline;
	}
</style>
