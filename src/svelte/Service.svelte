<script lang="ts">
	import ProgressBar from './ProgressBar.svelte';
	import { onMount } from 'svelte';
	import { exec } from 'child_process'; // 用于在本地执行命令
	import { platform } from 'os'; // 用于获取操作系统信息

	let platformType = ""; // 操作系统
	const version = '0.1.0'; // 版本号
	let downloadUrl = '';
	let downloadProgress = 0;
	let executableFileName = ""
	let executableFilePath = '';

	let isExecutableFileExist = false;
	let isServiceAvailable = false; // 服务是否可用
	let isDownloading = false;
	let isRunning = false;

	onMount(async () => {
		// 获取平台类型
		platformType = platform();

		// 初始化下载URL和文件名
		if (platformType.includes('win')) {
			downloadUrl = `https://example.com/hugoverse-windows-${version}.exe`;
			executableFileName = `hugoverse-${version}.exe`;
		} else if (platformType.includes('mac')) {
			downloadUrl = `https://example.com/hugoverse-macos-${version}.zip`;
			executableFileName = "hugoverse";
			executableFilePath = "~/.local/share/hugoverse";
		} else if (platformType.includes('linux')) {
			downloadUrl = `https://example.com/hugoverse-linux-${version}.tar.gz`;
			executableFileName = "hugoverse";
			executableFilePath = "~/.local/share/hugoverse";
		}

		// 检查服务是否已启动
		await checkServiceStatus();

		// 如果服务没有启动，检查二进制文件是否存在
		if (!isRunning) {
			await checkBinaryFile();
		}
	});

	const checkServiceStatus = async () => {
		try {
			const response = await fetch('http://localhost:1314/api/health');
			if (response.ok) {
				isRunning = true;
				isServiceAvailable = true;
			} else {
				isRunning = false;
			}
		} catch (error) {
			isRunning = false;
			// 如果服务没有运行，检查二进制文件是否存在
			await checkBinaryFile();
		}
	};

	const checkBinaryFile = async () => {
		try {
			if (platformType.includes('win')) {
				// Windows上的逻辑
				isExecutableFileExist = await checkIfBinaryExists();
			} else if (platformType.includes('mac') || platformType.includes('linux')) {
				// macOS和Linux上的逻辑
				const dirExist = await checkDirectoryExists(executableFilePath);
				if (!dirExist) {
					await createDirectory(executableFilePath);
				}
				isExecutableFileExist = await checkIfBinaryExists();
			}
			if (isExecutableFileExist) {
				isServiceAvailable = true;
			}
		} catch (error) {
			console.error('检查二进制文件出错:', error);
		}
	};

	const checkDirectoryExists = async (path: string): Promise<boolean> => {
		// 执行命令检查目录是否存在
		return new Promise((resolve) => {
			exec(`[ -d "${path}" ] && echo "exists"`, (error, stdout, stderr) => {
				if (stdout.includes("exists")) {
					resolve(true);
				} else {
					resolve(false);
				}
			});
		});
	};

	const createDirectory = async (path: string) => {
		// 执行命令创建目录
		return new Promise((resolve, reject) => {
			exec(`mkdir -p "${path}"`, (error, stdout, stderr) => {
				if (error) {
					reject(error);
				} else {
					resolve(true);
				}
			});
		});
	};

	const checkIfBinaryExists = async (): Promise<boolean> => {
		// 检查二进制文件是否存在
		return new Promise((resolve) => {
			exec(`[ -f "${executableFilePath}/${executableFileName}" ] && echo "exists"`, (error, stdout, stderr) => {
				if (stdout.includes("exists")) {
					resolve(true);
				} else {
					resolve(false);
				}
			});
		});
	};

	const downloadFile = async () => {
		isDownloading = true;
		downloadProgress = 0;

		console.log("downloading...", downloadUrl);

		// 模拟下载过程
		const interval = setInterval(() => {
			if (downloadProgress < 100) {
				downloadProgress += 20;
			} else {
				clearInterval(interval);
				isDownloading = false;
				isServiceAvailable = true;
			}
		}, 500);
	};

	const startService = () => {
		isRunning = true;
	};

	const stopService = () => {
		isRunning = false;
	};

</script>

<div class="friday-plugin-service mt-20">
	<div class="card">
		<div class="flex">
			<p class="service-title">Service</p>
			<div class="status-container">
				{#if isServiceAvailable}
					{#if isRunning}
						<div id="status-running" class="status">
							<span class="dot running"></span>
							<p>running</p>
						</div>
					{:else}
						<div id="status-stopped" class="status">
							<span class="dot stopped"></span>
							<p>stopped</p>
						</div>
					{/if}
				{:else}
					<!-- 如果没有找到二进制文件则不显示状态 -->
				{/if}
			</div>
		</div>

		<div class="version-info">version: {version}</div>

		<div class="spacer"></div>

		{#if isDownloading}
			<ProgressBar progress={downloadProgress} />
		{:else}
			{#if !isServiceAvailable}
				<button on:click={downloadFile}>Download</button>
			{:else if isRunning}
				<button on:click={stopService}>Stop</button>
			{:else}
				<button on:click={startService}>Start</button>
			{/if}
		{/if}
	</div>
</div>

<style>
	.friday-plugin-service {
	}

	.mt-20 {
		margin-top: 20px;
	}

	.flex {
		display: flex;
		justify-content: space-between;
		align-items: center;
	}

	.service-title {
		font-weight: bold;
	}

	.status-container {
		display: flex;
		gap: 10px;
	}

	.status {
		display: flex;
		align-items: center;
		gap: 5px; /* 点和文字之间的间距 */
	}

	.dot {
		height: 10px;
		width: 10px;
		border-radius: 50%; /* 圆形 */
		display: inline-block;
	}

	/* 定义不同状态的点的颜色 */
	.running {
		background-color: rgb(124, 58, 237);
	}

	.stopped {
		background-color: rgb(64, 64, 64);
	}

	p {
		margin: 0; /* 移除默认的段落边距 */
	}

	.version-info {
		font-size: 12px; /* 设置较小的字体 */
		color: gray; /* 设置字体颜色为灰色 */
		margin-top: 5px; /* 添加上边距以保持间距 */
	}

	.spacer {
		height: 20px; /* 可以根据需要调整这个高度 */
	}
</style>
