import {App, FileSystemAdapter, Notice, requestUrl, RequestUrlResponse, TFile, TFolder, Vault} from "obsidian";
import type {User} from "./user";
import type FridayPlugin from "./main";
import {WebPreviewModal} from "./preview";
import * as path from "path";
import {FM_SITE_ID} from "./frontmatter";

interface ManifestConfig {
	validation: { rules: { field: string; required: boolean; message: string }[] };
}

const supportedImageExtensions = ["png", "jpg", "jpeg", "gif", "svg", "bmp", "webp", "ico", "tif", "tiff"];
const supportedCompressionExtensions = ["zip"];
const NEW_ID = "-1"

export class Hugoverse {
	basePath: string;
	apiUrl: string;
	user: User

	app: App
	plugin: FridayPlugin

	manifestConfig: ManifestConfig | null = null;

	constructor(plugin: FridayPlugin) {
		this.plugin = plugin;

		this.app = this.plugin.app;
		this.apiUrl = this.plugin.apiUrl;
		this.user = this.plugin.user;

		const adapter = this.app.vault.adapter;
		if (adapter instanceof FileSystemAdapter) {
			this.basePath = adapter.getBasePath();
		}
	}

	generateDownloadUrl(filename: string): string {
		return `${this.apiUrl}/api/uploads/themes/${filename}`;
	}

	projectDirPath(filepath: string): string {
		return path.dirname(filepath)
	}

	async loadManifestConfig() {
		try {
			const manifestPath = `${this.projectDirPath(this.plugin.fileInfo.path)}/${this.plugin.fileInfo.getThemeBaseName()}/manifest.json`;
			if (await this.plugin.app.vault.adapter.exists(manifestPath)) {
				const data = await this.app.vault.adapter.read(manifestPath);
				this.manifestConfig = JSON.parse(data);
			}
		} catch (error) {
			console.error('Failed to load manifest.json', error);
		}
	}

	async validateActiveFileFrontmatter() {
		await this.loadManifestConfig();

		if (!this.manifestConfig) {
			new Notice('Manifest configuration not loaded.');
			return "";
		}

		const frontmatter = this.plugin.fileInfo.frontMatter;
		if (!frontmatter) {
			new Notice('No frontmatter found in the active file.', 5000);
			return "No frontmatter found in the active file.";
		}

		const errors: string[] = [];
		for (const rule of this.manifestConfig.validation.rules) {
			if (rule.required && !frontmatter[rule.field]) {
				errors.push(rule.message);
			}
		}

		// Show all validation errors at once
		if (errors.length > 0) {
			new Notice(`Frontmatter validation failed:\n${errors.join('\n')}`, 8000);
			return errors.join('\n');
		} else {
			return "";
		}
	}

	async deploy(): Promise<string> {
		const errors = await this.validateActiveFileFrontmatter();
		if (errors) {
			return errors;
		}

		const siteId = this.plugin.fileInfo.getSiteId();

		return await this.deploySite(siteId)
	}

	async preview(callback: (progress: number) => void): Promise<string> {
		const errors = await this.validateActiveFileFrontmatter();
		if (errors) {
			callback(0);
			return errors;
		}

		const activeFiles: string[] = []

		try {
			callback(1); // 初始进度设置为 1%

			await this.handleSite()
			callback(15); // 更新 Front Matter 后，进度为15%

			// 获取内容文件夹
			const folder = this.plugin.app.vault.getAbstractFileByPath(this.plugin.fileInfo.getProjFolder());
			if (folder instanceof TFolder) {
				let totalFiles = 0;
				let processedFiles = 0;

				// 先获取文件夹下的所有 Markdown 文件
				await new Promise<void>((resolve) => {
					Vault.recurseChildren(folder, (file) => {
						if (file instanceof TFile &&
							(file.extension === "md"
								|| supportedImageExtensions.includes(file.extension)
								|| supportedCompressionExtensions.includes(file.extension))) {
							totalFiles++;
						}
					});
					resolve();
				});

				if (totalFiles === 0) {
					callback(100); // 如果没有 Markdown 文件，直接完成
					return "";
				}

				// 遍历文件夹中的所有 Markdown 文件并处理
				const filePromises = [];
				Vault.recurseChildren(folder, (file) => {
					(async (currentFile) => {
						if (currentFile instanceof TFile) {
							if (currentFile.extension === "md") {
								const fileProcessing = (async () => {
									await this.handlePost(currentFile);
									activeFiles.push(currentFile.path);

									// 处理完每个文件后，更新进度
									processedFiles++;
									const progress = 45 + 50 * (processedFiles / totalFiles); // 根据文件数量调整进度
									callback(progress);
								})();
								filePromises.push(fileProcessing);
							} else if (supportedImageExtensions.includes(currentFile.extension)
								|| supportedCompressionExtensions.includes(currentFile.extension)) {
								const imageProcessing = (async () => {
									await this.handleResource(currentFile);
									activeFiles.push(currentFile.path);

									processedFiles++;
									const progress = 45 + 50 * (processedFiles / totalFiles); // 根据文件数量调整进度
									callback(progress);
								})();
								filePromises.push(imageProcessing);
							}
						}
					})(file);
				});

				// 等待所有文件的处理完成
				await Promise.all(filePromises);
			} else {
				console.warn(`Path "${this.plugin.fileInfo.getContentFolder()}" is not a folder.`);
				new Notice(`Path "${this.plugin.fileInfo.getContentFolder()}" is not a folder.`, 5000);
				return "";
			}

			await this.removeDisappearedFiles(activeFiles)

			// 生成站点预览
			const preUrl = await this.previewSite(this.plugin.fileInfo.getSiteId());
			if (preUrl == "") {
				throw new Error("Failed to generate preview.");
			}
			callback(100); // 预览完成，进度达到100%

			const newUrl = preUrl.replace("app.mdfriday.com", "netlify.app");
			const modal = new WebPreviewModal(this.app, newUrl); // 创建一个 WebPreviewModal 实例
			modal.open();

			return preUrl;
		} catch (error) {
			console.error("Error during preview:", error);
			new Notice("Failed to generate preview.", 5000);
			callback(0); // 如果出错，回调设置为0%
			return "";
		}
	}

	async removeDisappearedFiles(activeFiles: string[]) {
		const removedPaths = this.plugin.store.getRemovedPaths(activeFiles)
		const siteId = this.plugin.fileInfo.getSiteId();
		try {
			for (const path of removedPaths) {
				const fileId = this.plugin.store.getAssociatedId(siteId, path)
				const fileType = this.plugin.store.getAssociatedType(siteId, path)

				const res = await this.deleteEntity(fileType, fileId)
				if (res) {
					this.plugin.store.removeFileFromProject(siteId, path)
				}
			}
		} catch (error) {
			console.error(error.toString())
		}
	}

	async handleSite() {
		let siteId = this.plugin.fileInfo.getSiteId();
		if (Number(siteId) <= 0) {
			siteId = await this.createSite(NEW_ID);
			if (siteId === "" || siteId === undefined) {
				throw new Error("Failed to create site.");
			}
			this.plugin.store.createProject(siteId, this.plugin.app.workspace.getActiveFile())
			await this.plugin.fileInfo.updateFrontMatter(FM_SITE_ID, siteId);
		} else {
			this.plugin.store.loadProject(siteId);
			const siteUpdated = await this.plugin.store.updateProject(siteId, this.plugin.app.workspace.getActiveFile())
			if (siteUpdated) {
				const uid = await this.createSite(siteId);
				if (uid === "" || uid === undefined || uid !== siteId) {
					throw new Error("Failed to update site.");
				}
			}
		}
		return
	}

	async handlePost(file: TFile) {
		const siteId = this.plugin.fileInfo.getSiteId();
		const found = this.plugin.store.isFileInProject(siteId, file.path)
		if (!found) {
			const postId = await this.createPost(NEW_ID, file);
			if (postId === "") {
				throw new Error("Failed to create post in site: " + siteId);
			}

			const sitePostId = await this.createSitePost(siteId, postId, file);
			if (sitePostId === "") {
				throw new Error("Failed to create site post for site: " + siteId + ", post: " + postId);
			}

			this.plugin.store.addFileToProject(siteId, postId, sitePostId, "SitePost", file)
		} else {
			const postId = this.plugin.store.getFileId(siteId, file.path)
			const updated = await this.plugin.store.updateFileInProject(siteId, postId, file)
			if (updated) {
				const uid = await this.createPost(postId, file);
				if (uid === "" || uid != postId) {
					throw new Error("Failed to update post: " + postId);
				}
			}
		}

		return
	}

	async handleResource(file: TFile) {
		const siteId = this.plugin.fileInfo.getSiteId();
		const found = this.plugin.store.isFileInProject(siteId, file.path)
		if (!found) {
			const resourceId = await this.createResource(NEW_ID, file);
			if (resourceId === "") {
				throw new Error("Failed to create resource in site: " + siteId);
			}

			const siteResourceId = await this.createSiteResource(siteId, resourceId, file);
			if (siteResourceId === "") {
				throw new Error("Failed to create site resource for site: " + siteId + ", resource: " + resourceId);
			}

			this.plugin.store.addFileToProject(siteId, resourceId, siteResourceId, "SiteResource", file)
		} else {
			const resourceId = this.plugin.store.getFileId(siteId, file.path)
			const updated = await this.plugin.store.updateFileInProject(siteId, resourceId, file)
			if (updated) {
				const uid = await this.createResource(resourceId, file);
				if (uid === "" || uid != resourceId) {
					throw new Error("Failed to update post: " + resourceId);
				}
			}
		}

		return
	}

	async sendSiteRequest(action: string, siteId: string): Promise<string> {
		// 定义请求的URL
		const url = `${this.apiUrl}/api/${action}?type=Site&id=${siteId}`;

		// 创建 FormData 实例并添加 siteId 字段
		let body = new FormData();
		body.append("site", `${siteId}`);
		body.append("domain", this.plugin.settings.rootDomain);
		body.append("host_name", "Netlify");
		body.append("host_token", this.plugin.settings.netlifyToken);

		// 将 FormData 转换为 ArrayBuffer
		const boundary = "----WebKitFormBoundary" + Math.random().toString(36).substring(2, 9);
		const arrayBufferBody = await this.formDataToArrayBuffer(body, boundary);

		// 发送请求
		const response: RequestUrlResponse = await requestUrl({
			url: url,
			method: "POST",
			headers: {
				"Authorization": `Bearer ${await this.user.getToken()}`,
				"Content-Type": `multipart/form-data; boundary=${boundary}`,
			},
			body: arrayBufferBody,
		});

		// 检查响应状态
		if (response.status !== 200) {
			let errMsg = `Failed to ${action} site.`;
			if (response.status === 409) {
				errMsg = "Domain is already taken. Please choose a different one by changing the note name.";
			} else if (response.status === 400) {
				errMsg = response.json.data[0];
			}
			console.error(`Error generating site ${action}:`, response.text);
			new Notice(errMsg, 8000);

			return "";
		}

		// 解析返回的 JSON 数据，提取 ID
		return response.json.data[0];
	}

	async previewSite(siteId: string): Promise<string> {
		return this.sendSiteRequest("preview", siteId);
	}

	async deploySite(siteId: string): Promise<string> {
		return this.sendSiteRequest("deploy", siteId);
	}

	async deleteEntity(entityType: string, id: string): Promise<boolean> {
		const deleteUrl = `${this.apiUrl}/api/content/delete`;

		let body: FormData = new FormData();
		body.append("id", id);
		body.append("type", entityType);
		body.append("status", "");

		// 将 FormData 转换为 ArrayBuffer
		const boundary = "----WebKitFormBoundary" + Math.random().toString(36).substring(2, 9);
		const arrayBufferBody = await this.formDataToArrayBuffer(body, boundary);

		const response: RequestUrlResponse = await requestUrl({
			url: deleteUrl,
			method: "POST",
			headers: {
				"Authorization": `Bearer ${await this.user.getToken()}`,
				"Content-Type": `multipart/form-data; boundary=${boundary}`,
			},
			body: arrayBufferBody,
		});

		// 检查响应状态
		if (response.status !== 200) {
			throw new Error(`Entity ${entityType}, id: ${id} deletion failed: ${response.text}`);
		}

		return true
	}

	async createSite(id: string): Promise<string> {
		const createSiteUrl = `${this.apiUrl}/api/content?type=Site`;

		let body: FormData = new FormData();
		body.append("id", id);
		body.append("title", this.plugin.fileInfo.getBaseName());
		body.append("description", this.plugin.fileInfo.getDescription());
		body.append("base_url", "/");
		body.append("theme", this.plugin.fileInfo.getThemeName());
		body.append("owner", this.plugin.user.getName());
		body.append("Params", this.plugin.fileInfo.getParams());
		body.append("default_content_language", this.plugin.fileInfo.getDefaultLanguage());
		body.append("google_analytics", this.plugin.fileInfo.getGA());

		this.plugin.fileInfo.languages.forEach((lang, index) => {
			body.append(`languages.${index}`, lang);
		});
		this.plugin.fileInfo.menus.forEach((menu, index) => {
			body.append(`menus.${index}`, menu);
		})

		// 将 FormData 转换为 ArrayBuffer
		const boundary = "----WebKitFormBoundary" + Math.random().toString(36).substring(2, 9);
		const arrayBufferBody = await this.formDataToArrayBuffer(body, boundary);

		const response: RequestUrlResponse = await requestUrl({
			url: createSiteUrl,
			method: "POST",
			headers: {
				"Authorization": `Bearer ${await this.user.getToken()}`,
				"Content-Type": `multipart/form-data; boundary=${boundary}`,
			},
			body: arrayBufferBody,
		});

		// 检查响应状态
		if (response.status !== 200) {
			const err = new Error(`Site creation failed: ${response.text}`);
			console.error("Failed to create site:", err.toString());
			new Notice(err.toString(), 5000);
			return "";
		}

		// 解析返回的 JSON 数据，提取 ID
		// 假设`data`数组的第一个元素包含所需的`id`
		return response.json.data[0].id;
	}

	async createSitePost(siteId: string, postId: string, file: TFile): Promise<string> {
		return this.createSiteEntity("SitePost", siteId, postId, file);
	}

	async createSiteResource(siteId: string, resourceId: string, file: TFile): Promise<string> {
		return this.createSiteEntity("SiteResource", siteId, resourceId, file);
	}

	async createSiteEntity(entityType: string, siteId: string, entityId: string, file: TFile): Promise<string> {
		try {
			const url = `${this.apiUrl}/api/content?type=${entityType}`;

			// 获取并处理文件路径
			const projFolder = this.plugin.fileInfo.getProjFolder();
			const filePath = file.path;

			let relativePath = filePath.startsWith(projFolder) ? filePath.slice(projFolder.length) : filePath;
			let path = relativePath;

			if (this.plugin.fileInfo.isMultiLang()) {
				const contentFolder = this.plugin.fileInfo.getContentFolder();
				if (filePath.startsWith(contentFolder)) {
					relativePath = filePath.startsWith(contentFolder) ? filePath.slice(contentFolder.length) : filePath;

					const cleanPath = relativePath.startsWith("/") ? relativePath.slice(1) : relativePath;
					if (this.plugin.fileInfo.languages.some(lang => cleanPath.startsWith(`${lang}/`))) {
						path = `/content.${cleanPath}`
					}
				}
			}

			let body = new FormData();
			body.append("id", NEW_ID);
			body.append("site", `/api/content?type=Site&id=${siteId}`);
			body.append(`${entityType === "SitePost" ? "post" : "resource"}`, `/api/content?type=${entityType === "SitePost" ? "Post" : "Resource"}&id=${entityId}`);
			body.append("path", path);

			// 将 FormData 转换为 ArrayBuffer
			const boundary = "----WebKitFormBoundary" + Math.random().toString(36).substring(2, 9);
			const arrayBufferBody = await this.formDataToArrayBuffer(body, boundary);

			const response: RequestUrlResponse = await requestUrl({
				url: url,
				method: "POST",
				headers: {
					"Authorization": `Bearer ${await this.user.getToken()}`,
					"Content-Type": `multipart/form-data; boundary=${boundary}`,
				},
				body: arrayBufferBody,
			});

			if (response.status !== 200) {
				throw new Error(`Failed to create ${entityType}: ${response.text}`);
			}

			return response.json.data[0].id;
		} catch (error) {
			console.error(`Error creating ${entityType}:`, error);
			new Notice(`Failed to create ${entityType}.`, 5000);
			return "";
		}
	}

	async createPost(id: string, file: TFile): Promise<string> {
		try {
			const createPostUrl = `${this.apiUrl}/api/content?type=Post`;

			// 读取 Markdown 文件内容
			const fileContent = await this.app.vault.read(file);

			// 创建 FormData 并添加基本字段
			let body: FormData = new FormData();
			body.append("type", "Post");
			body.append("id", id);
			body.append("title", file.name);
			body.append("author", this.plugin.user.getName());
			body.append("params", "key: value");
			body.append("content", fileContent);

			// 将 FormData 转换为 ArrayBuffer
			const boundary = "----WebKitFormBoundary" + Math.random().toString(36).substring(2, 9);
			const arrayBufferBody = await this.formDataToArrayBuffer(body, boundary);

			const response: RequestUrlResponse = await requestUrl({
				url: createPostUrl,
				method: "POST",
				headers: {
					"Authorization": `Bearer ${await this.user.getToken()}`,
					"Content-Type": `multipart/form-data; boundary=${boundary}`,
				},
				body: arrayBufferBody,
			});

			// 检查响应状态
			if (response.status !== 200) {
				throw new Error(`Post creation failed: ${response.text}`);
			}

			// 解析返回的 JSON 数据，提取 ID
			// 假设`data`数组的第一个元素包含所需的`id`
			return response.json.data[0].id;
		} catch (error) {
			console.error("Failed to create post:", error.toString());
			new Notice("Failed to create post.", 5000);
		}
	}

	async createResource(id: string, file: TFile): Promise<string> {
		try {
			const createResourceUrl = `${this.apiUrl}/api/content?type=Resource`;

			// 读取 Resource 文件内容
			const fileContent = await this.app.vault.readBinary(file);

			// 创建 FormData 并添加基本字段
			let body: FormData = new FormData();
			body.append("type", "Resource");
			body.append("id", id);
			body.append("name", file.name);
			body.append("size", fileContent.byteLength.toString());

			const fileExtension = file.extension;
			let mimeType = "application/octet-stream"; // 默认 MIME 类型
			if (fileExtension) {
				switch (fileExtension) {
					case "jpg":
					case "jpeg":
						mimeType = "image/jpeg";
						break;
					case "png":
						mimeType = "image/png";
						break;
					case "bmp":
						mimeType = "image/bmp";
						break;
					case "gif":
						mimeType = "image/gif";
						break;
					case "svg":
						mimeType = "image/svg+xml";
						break;
					case "webp":
						mimeType = "image/webp";
						break;
					case "ico":
						mimeType = "image/vnd.microsoft.icon";
						break;
					case "tif":
					case "tiff":
						mimeType = "image/tiff";
						break;
					case "zip":
						mimeType = "application/zip";
						break;
				}
			}

			const blob = new Blob([fileContent], {type: mimeType});
			body.append(`asset`, blob, file.name);

			// 将 FormData 转换为 ArrayBuffer
			const boundary = "----WebKitFormBoundary" + Math.random().toString(36).substring(2, 9);
			const arrayBufferBody = await this.formDataToArrayBuffer(body, boundary);

			const response: RequestUrlResponse = await requestUrl({
				url: createResourceUrl,
				method: "POST",
				headers: {
					"Authorization": `Bearer ${await this.user.getToken()}`,
					"Content-Type": `multipart/form-data; boundary=${boundary}`,
				},
				body: arrayBufferBody,
			});

			// 检查响应状态
			if (response.status !== 200) {
				throw new Error(`Resource creation failed: ${response.text}`);
			}

			return response.json.data[0].id;
		} catch (error) {
			console.error("Failed to create resource:", error.toString());
			new Notice("Failed to create resource.", 5000);
		}
	}

	async formDataToArrayBuffer(formData: FormData, boundary: string): Promise<ArrayBuffer> {
		let bodyParts: (string | Uint8Array)[] = []; // 用于存储字符串和二进制部分

		// 用来存储所有的字段数据，先同步收集信息
		const formDataEntries: { value: FormDataEntryValue; key: string }[] = [];

		formData.forEach((value, key) => {
			formDataEntries.push({value, key}); // 同步收集 formData 数据
		});

		// 处理收集的数据，使用 for...of 遍历并进行异步操作
		for (const {value, key} of formDataEntries) {
			bodyParts.push(`--${boundary}\r\n`);

			if (typeof value === "string") {
				// 处理字符串值
				bodyParts.push(`Content-Disposition: form-data; name="${key}"\r\n\r\n${value}\r\n`);
			} else if (value instanceof Blob) {
				// 处理 Blob 值
				bodyParts.push(
					`Content-Disposition: form-data; name="${key}"; filename="${value.name}"\r\n`
				);
				bodyParts.push(`Content-Type: ${value.type || "application/octet-stream"}\r\n\r\n`);

				// 使用 await 等待 Blob 转换为 ArrayBuffer
				const arrayBuffer = await value.arrayBuffer();
				bodyParts.push(new Uint8Array(arrayBuffer)); // 将 Blob 内容以 Uint8Array 添加
				bodyParts.push(`\r\n`); // 在二进制内容后添加换行
			}
		}

		// 添加结束边界
		bodyParts.push(`--${boundary}--\r\n`);

		// 将所有部分合并为一个 ArrayBuffer
		const encoder = new TextEncoder();
		const encodedParts = bodyParts.map(part => (typeof part === "string" ? encoder.encode(part) : part));

		// 计算总长度并创建最终的 ArrayBuffer
		const totalLength = encodedParts.reduce((acc, curr) => acc + curr.length, 0);
		const combinedArray = new Uint8Array(totalLength);
		let offset = 0;

		for (const part of encodedParts) {
			combinedArray.set(part, offset);
			offset += part.length;
		}

		return combinedArray.buffer;
	}

}
