<script lang="ts">
	import {App, requestUrl, RequestUrlResponse, Platform, Notice} from "obsidian";
	import ProgressBar from './ProgressBar.svelte';
	import {onMount} from 'svelte';
	import FridayPlugin from "../main";
	import {FileInfo} from "../fileinfo";
	import JSZip from "jszip";
	import * as path from "path";
	import {FM_PROJ} from "../frontmatter";

	// 接收 props
	export let fileInfo: FileInfo;
	export let app: App;
	export let plugin: FridayPlugin;

	let themeDownloadFilename: string
	let themeDownloadUrl: string
	let themePath: string
	let themeProjPath: string
	let themeContentPath: string

	let downloadProgress = 0;
	let isDownloading = false;
	let themeZipFileExists = false;

	onMount(async () => {
		if (Platform.isDesktop) {
			await refreshDownloadStatus()
		}
	});

	const refreshDownloadStatus = async () => {
		if (fileInfo.hasFridayPluginEnabled()) {
			if (!fileInfo.hasThemeConfigured()) {
				new Notice("Please configure your theme first.", 5000);
				return
			}
			themeDownloadFilename = fileInfo.getThemeDownloadFilename();
			themeDownloadUrl = plugin.hugoverse.generateDownloadUrl(themeDownloadFilename);

			themePath = `${plugin.manifest.dir}/${themeDownloadFilename}`;
			themeProjPath = plugin.hugoverse.projectDirPath(fileInfo.path)
			themeContentPath = `${themeProjPath}/${fileInfo.getThemeContentPath()}`;

			if (await app.vault.adapter.exists(themePath)) {
				themeZipFileExists = true;
			}

		}
	}

	const downloadFile = async () => {
		await refreshDownloadStatus()

		if (themeZipFileExists && await app.vault.adapter.exists(themeContentPath)){
			return
		}

		if (themeZipFileExists) {
			downloadProgress = 100;
			await extractFile(themePath, themeProjPath);
			await fileInfo.updateFrontMatter(FM_PROJ, themeContentPath);
			return
		}

		isDownloading = true;
		downloadProgress = 0;

		// 每个块的大小（以字节为单位）
		const chunkSize = 1024 * 1024; // 1MB
		let receivedLength = 0; // 已接收的字节数

		try {
			// 首先获取文件的总大小
			const headResponse: RequestUrlResponse = await requestUrl({
				url: themeDownloadUrl,
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
					url: themeDownloadUrl,
					headers: {
						'Range': `bytes=${start}-${end}`,
						'Cache-Control': 'no-cache',
						'Accept-Encoding': 'identity'
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
			}

			// 将文件写入到 Obsidian 插件目录中
			await this.app.vault.adapter.writeBinary(themePath, fileContent); // 写入完整文件

			isDownloading = false;

			await extractFile(themePath, themeProjPath);
			await fileInfo.updateFrontMatter(FM_PROJ, themeContentPath);
		} catch (error) {
			isDownloading = false;
		}
	};

	async function extractFile(sourceFilepath: string, outputDir: string): Promise<void> {
		try {
			// Read the ZIP file as binary
			const zipData = await app.vault.adapter.readBinary(sourceFilepath);
			const zip = await JSZip.loadAsync(zipData); // Load the ZIP file

			// Iterate through the files in the ZIP archive
			for (const fileName in zip.files) {
				const file = zip.files[fileName];

				if (!file.dir) { // Only extract files, not directories
					const content = await file.async("uint8array"); // Read file content as Uint8Array
					const outputFilePath = `${outputDir}/${fileName}`;

					const shouldFilter = outputFilePath.includes("__MACOSX") ||
						outputFilePath.split(path.sep).some(segment => segment.startsWith('.'));

					if (shouldFilter) {
						continue
					}

					await ensureDirectoriesExist(outputFilePath);

					// Write the extracted file to the specified output directory
					await app.vault.adapter.writeBinary(outputFilePath, content);
				}
			}
		} catch (error) {
			console.error("Error extracting ZIP file:", error);
		}
	}

	async function ensureDirectoriesExist(filePath: string): Promise<void> {
		const adapter = app.vault.adapter;
		const parts = filePath.split('/'); // 将路径拆分为各个部分

		// 通过切片去掉最后一个部分（文件名），只保留目录部分
		const directoryPath = parts.slice(0, parts.length - 1).join('/');

		// 检查并创建目录
		if (directoryPath) {
			let currentPath = '';

			// 遍历每个目录部分，逐层构建路径
			for (const part of directoryPath.split('/')) {
				if (part) { // 确保不处理空部分
					currentPath = path.posix.join(currentPath, part); // 构建当前路径

					if (!await adapter.stat(currentPath)) {
						// 如果目录不存在，则创建它
						await adapter.mkdir(currentPath);
					}
				}
			}
		}
	}


</script>

<div class="mt-20">
	{#if Platform.isDesktop}
		{#if themeDownloadFilename !== '' && fileInfo.hasFridayPluginEnabled()}
			<div class="card">
				<div class="version-info">Content structure example provided for theme: {fileInfo.getThemeName()}</div>

				<div class="spacer"></div>

				{#if isDownloading}
					<ProgressBar progress={downloadProgress}/>
				{:else}
					<button on:click={downloadFile}>Download Example</button>
				{/if}
			</div>
		{/if}
	{/if}
</div>

<style>
	.mt-20 {
		margin-top: 20px;
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
