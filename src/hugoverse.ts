import {App, FileSystemAdapter, Notice, requestUrl, RequestUrlResponse, TFile, TFolder, Vault} from "obsidian";
import type {User} from "./user";
import type FridayPlugin from "./main";
import * as path from "path";

const NEW_ID = "-1"
const COUNTER_REQUEST_ID_KEY = "friday_counter_request_id"

export class Hugoverse {
	basePath: string;
	apiUrl: string;
	user: User

	app: App
	plugin: FridayPlugin

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

	/**
	 * 生成简单的 UUID（不使用第三方库）
	 */
	private generateUUID(): string {
		return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
			const r = Math.random() * 16 | 0;
			const v = c == 'x' ? r : (r & 0x3 | 0x8);
			return v.toString(16);
		});
	}

	/**
	 * 从浏览器缓存获取或生成 request_id
	 */
	private getOrCreateRequestId(): string {
		let requestId = localStorage.getItem(COUNTER_REQUEST_ID_KEY);
		if (!requestId) {
			requestId = this.generateUUID();
			localStorage.setItem(COUNTER_REQUEST_ID_KEY, requestId);
		}
		return requestId;
	}

	projectDirPath(filepath: string): string {
		return path.dirname(filepath)
	}

	/*
	* curl -X POST "http://127.0.0.1:1314/api/mdf/preview/deploy?type=MDFPreview&id=1" \
	* -F "type=MDFPreview" \
	* -F "host_name=MDFriday Preview"
	*/
	async deployMDFridayPreview(id: string): Promise<string> {
		try {
			const createPostUrl = `${this.apiUrl}/api/mdf/preview/deploy?type=MDFPreview&id=${id}`;

			// 创建 FormData 并添加基本字段
			let body: FormData = new FormData();
			body.append("type", "MDFPreview");
			body.append("id", id);
			body.append("host_name", "MDFriday Preview");

			// 将 FormData 转换为 ArrayBuffer
			const boundary = "----WebKitFormBoundary" + Math.random().toString(36).substring(2, 9);
			const arrayBufferBody = await this.formDataToArrayBuffer(body, boundary);

			const response: RequestUrlResponse = await requestUrl({
				url: createPostUrl,
				method: "POST",
				headers: {
					"Content-Type": `multipart/form-data; boundary=${boundary}`,
				},
				body: arrayBufferBody,
			});

			// 检查响应状态
			if (response.status !== 200) {
				throw new Error(`Post creation failed: ${response.text}`);
			}

			return response.json.data[0];
		} catch (error) {
			console.error("Failed to create post:", error.toString());
			new Notice(this.plugin.i18n.t('messages.failed_to_create_post'), 5000);
		}
	}

	/*
	* curl -X POST "http://127.0.0.1:1314/api/mdf/preview?type=MDFPreview" \
	* -F "type=MDFPreview" \
	* -F "id=-1" \
	* -F "name=abc" \
	* -F "size=12345" \
	* -F "asset=@/Users/weisun/Downloads/site.zip"
	*/
	async createMDFPreview(name:string, content:Uint8Array): Promise<string> {
		try {
			const createResourceUrl = `${this.apiUrl}/api/mdf/preview?type=MDFPreview`;

			// 创建 FormData 并添加基本字段
			let body: FormData = new FormData();
			body.append("type", "MDFPreview");
			body.append("id", NEW_ID);
			body.append("name", name);
			body.append("size", content.byteLength.toString());

			const mimeType = "application/zip"; // 默认 MIME 类型

			const blob = new Blob([content], {type: mimeType});
			body.append(`asset`, blob, `${name}.zip`);

			// 将 FormData 转换为 ArrayBuffer
			const boundary = "----WebKitFormBoundary" + Math.random().toString(36).substring(2, 9);
			const arrayBufferBody = await this.formDataToArrayBuffer(body, boundary);

			const response: RequestUrlResponse = await requestUrl({
				url: createResourceUrl,
				method: "POST",
				headers: {
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
			new Notice(this.plugin.i18n.t('messages.failed_to_create_resource'), 5000);
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

	async sendCounter(kind: string = "preview"): Promise<boolean> {
		try {
			const requestId = this.getOrCreateRequestId();
			const counterUrl = `${this.apiUrl}/api/counter?type=Counter`;

			// 创建 FormData 并添加字段
			let body: FormData = new FormData();
			body.append("id", NEW_ID);
			body.append("kind", kind);
			body.append("request_id", requestId);

			// 将 FormData 转换为 ArrayBuffer
			const boundary = "----WebKitFormBoundary" + Math.random().toString(36).substring(2, 9);
			const arrayBufferBody = await this.formDataToArrayBuffer(body, boundary);

			const response: RequestUrlResponse = await requestUrl({
				url: counterUrl,
				method: "POST",
				headers: {
					"Content-Type": `multipart/form-data; boundary=${boundary}`,
				},
				body: arrayBufferBody,
			});

			// 检查响应状态
			if (response.status !== 200) {
				console.warn(`Counter request failed: ${response.text}`);
				return false;
			}

			return true;
		} catch (error) {
			console.warn("Failed to send counter:", error.toString());
			return false;
		}
	}

}
