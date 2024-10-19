<script lang="ts">
	import {App, FileSystemAdapter, Plugin, requestUrl, RequestUrlResponse} from "obsidian";
	import { createEventDispatcher } from "svelte";
	import ProgressBar from './ProgressBar.svelte';
	import {onMount} from 'svelte';
	import {exec} from 'child_process'; // 用于在本地执行命令
	import { promisify } from 'util';
	import { extname, basename } from 'path';
	import * as os from 'os';

	const execAsync = promisify(exec);

	// 接收 props
	export let platform: string;
	export let app: App;
	export let plugin: Plugin;

	let absPluginDir: string;
	let currentVersion = '0.4.1'; // 版本号
	let latestVersion = "0.4.1";

	let binaryPath = '';
	let binaryName = "hugoverse"
	let downloadProgress = 0;
	let executableFilePath = '';

	let isExecutableFileExist = false;
	let isServiceAvailable = false; // 服务是否可用
	let isDownloading = false;
	let isRunning = false;

	const dispatch = createEventDispatcher();

	onMount(async () => {
		await getLatestVersion();

		const adapter = app.vault.adapter;
		let path: string
		if (adapter instanceof FileSystemAdapter) {
			path = adapter.getBasePath();
			absPluginDir = `${path}/${plugin.manifest.dir}`
		}

		switch (platform) {
			case 'MacOS':
				binaryName = "hugoverse"
				break
			default:
				binaryName = "hugoverse.exe";
				break;
		}

		binaryPath = `${plugin.manifest.dir}/${binaryName}`

		console.log("binaryPath:", binaryPath)
		await checkBinaryFile();
		if (isExecutableFileExist) {
			await checkServiceStatus();
			if (isRunning) {
				await getCurrentVersion();
			}
		}
	});

	const checkBinaryFile = async () => {
		if (await app.vault.adapter.exists(binaryPath)) {
			isExecutableFileExist = true;
		}
		console.log("not exist")
	};

	const checkServiceStatus = async () => {
		try {
			const response = await fetch('http://localhost:1314/api/health');
			isRunning = response.ok;
		} catch (error) {
			console.log("checkServiceStatus error:", error);
			isRunning = false;
		}
	};

	const getLatestVersion = async () => {
		try {
			const response = await fetch('https://mdfriday.com/api/version');
			const data = await response.json();
			latestVersion = data.vresion;
		} catch (error) {
			console.log("getLatestVersion error:", error);
		}
	}

	const getCurrentVersion = async () => {
		try {
			const response = await fetch('http://localhost:1314/api/version');
			const data = await response.json();
			currentVersion = data.vresion;
		} catch (error) {
			console.log("getCurrentVersion error:", error);
		}
	}

	const downloadFile = async () => {
		isDownloading = true;
		downloadProgress = 0;

		let arch = os.arch();
		if (arch === 'x64') {
			arch = "amd64";
		}
		const binaryPkg = `dp-v${latestVersion}-${os.platform()}-${arch}.tar.gz`;
		const downloadUrl = `https://github.com/dddplayer/dp/releases/download/v${latestVersion}/${binaryPkg}`;
		console.log("Downloading from:", downloadUrl);

		// 每个块的大小（以字节为单位）
		const chunkSize = 1024 * 1024; // 1MB
		let receivedLength = 0; // 已接收的字节数

		try {
			// 首先获取文件的总大小
			const headResponse: RequestUrlResponse = await requestUrl({
				url: downloadUrl,
				method: 'HEAD'
			});

			if (headResponse.status !== 200) {
				throw new Error(`Failed to get file info: ${headResponse.text}`);
			}

			const contentLength = parseInt(headResponse.headers['content-length'], 10) || 0;
			const fileContent = new Uint8Array(contentLength); // 创建一个用于存放完整文件的数组

			// 分块下载文件
			for (let start = 0; start < contentLength; start += chunkSize) {
				const end = Math.min(start + chunkSize - 1, contentLength - 1); // 计算每个块的结束字节

				// 发起分块请求
				const chunkResponse: RequestUrlResponse = await requestUrl({
					url: downloadUrl,
					headers: {
						'Range': `bytes=${start}-${end}`
					}
				});

				// 检查响应状态
				if (chunkResponse.status !== 206 && chunkResponse.status !== 200) {
					throw new Error(`Failed to download chunk: ${chunkResponse.text}`);
				}

				const chunkArray = new Uint8Array(chunkResponse.arrayBuffer); // 将 ArrayBuffer 转为 Uint8Array
				fileContent.set(chunkArray, start); // 将下载的块存放到 fileContent 中
				receivedLength += chunkArray.length; // 更新已接收字节数

				// 更新下载进度
				downloadProgress = Math.floor((receivedLength / contentLength) * 100);
				console.log(`Downloaded ${downloadProgress}%`);
			}

			// 将文件写入到 Obsidian 插件目录中
			const filePath = `${plugin.manifest.dir}/${binaryPkg}`;
			await this.app.vault.adapter.writeBinary(filePath, fileContent); // 写入完整文件

			console.log(`File downloaded to: ${filePath}`);
			isDownloading = false;

			await extractFile(`${absPluginDir}/${binaryPkg}`, `${absPluginDir}`);
		} catch (error) {
			console.error('Download error:', error);
			isDownloading = false;
		}
	};

	async function extractFile(filePath:string, outputDir:string) {
		const fullExtension = getFullExtension(filePath).toLowerCase();

		let command:string;

		switch (fullExtension) {
			case '.zip':
				command = `unzip "${filePath}" -d "${outputDir}"`;
				break;
			case '.tar':
				command = `tar -xf "${filePath}" -C "${outputDir}"`;
				break;
			case '.tar.gz':
			case '.tgz':
				command = `tar -xzf "${filePath}" -C "${outputDir}"`;
				break;
			case '.gz':
				command = `gunzip "${filePath}"`;
				break;
			case '.bz2':
				command = `bunzip2 "${filePath}"`;
				break;
			// 添加其他文件类型的处理方式
			default:
				throw new Error(`Unsupported file type: ${fullExtension}`);
		}

		try {
			console.log("Extracting file with command:", command);

			const { stdout, stderr } = await execAsync(command);
			console.log(`Extracted to: ${outputDir}`);
			if (stdout) {
				isExecutableFileExist = true;
				console.log(`stdout: ${stdout}`);
			}
			if (stderr) {
				console.log(`stderr: ${stderr}`);
			}
		} catch (error) {
			console.error('Error extracting file:', error.message);
		}
	}

	// Helper function to get the full extension
		function getFullExtension(filePath: string): string {
		const baseName = basename(filePath);
		const match = baseName.match(/\.[^.]+(\.[^.]+)?$/); // Matches `.tar.gz`, `.zip`, etc.
		return match ? match[0] : extname(filePath);
	}

	const startService = () => {
		isRunning = true;
		dispatch('serviceStatus', { isRunning }); // Emit the event

	};

	const stopService = () => {
		isRunning = false;
		dispatch('serviceStatus', { isRunning });
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

		<div class="version-info">version: {currentVersion}</div>

		<div class="spacer"></div>

		{#if isDownloading}
			<ProgressBar progress={downloadProgress}/>
		{:else}
			{#if !isExecutableFileExist}
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
