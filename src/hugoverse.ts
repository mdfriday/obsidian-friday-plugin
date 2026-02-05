import {App, FileSystemAdapter, Notice, Platform, requestUrl, TFile, TFolder, Vault} from "obsidian";
import type {RequestUrlResponse} from "obsidian";
import type {User} from "./user";
import type FridayPlugin from "./main";
import type { LicenseActivationResponse, LicenseUsageResponse, DomainInfo, SubdomainCheckResponse, SubdomainUpdateResponse } from "./license";

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

		// basePath is only available on desktop (FileSystemAdapter)
		// On mobile, we don't need it for license-related operations
		const adapter = this.app.vault.adapter;
		if (Platform.isDesktop && adapter instanceof FileSystemAdapter) {
			this.basePath = adapter.getBasePath();
		} else {
			this.basePath = '';
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
		// Use simple string manipulation instead of Node.js path module
		// This works on both desktop and mobile
		const lastSlash = filepath.lastIndexOf('/');
		if (lastSlash === -1) {
			const lastBackslash = filepath.lastIndexOf('\\');
			if (lastBackslash === -1) return '.';
			return filepath.substring(0, lastBackslash);
		}
		return filepath.substring(0, lastSlash);
	}

	/*
	* curl -X POST "http://127.0.0.1:1314/api/mdf/preview/deploy?type=MDFPreview&id=1" \
	* -H "Authorization: Bearer <token>" \
	* -F "type=MDFPreview" \
	* -F "host_name=MDFriday Share"
	*/
	async deployMDFridayPreview(id: string, licenseKey: string = ''): Promise<string> {
		try {
			const createPostUrl = `${this.apiUrl}/api/mdf/preview/deploy?type=MDFPreview&id=${id}`;

			// 创建 FormData 并添加基本字段
			let body: FormData = new FormData();
			body.append("type", "MDFPreview");
			body.append("id", id);
			body.append("host_name", "MDFriday Preview");
			body.append("license_key", licenseKey);

			// 将 FormData 转换为 ArrayBuffer
			const boundary = "----WebKitFormBoundary" + Math.random().toString(36).substring(2, 9);
			const arrayBufferBody = await this.formDataToArrayBuffer(body, boundary);

			const response: RequestUrlResponse = await requestUrl({
				url: createPostUrl,
				method: "POST",
				headers: {
					"Content-Type": `multipart/form-data; boundary=${boundary}`,
					"Authorization": `Bearer ${this.user.token}`,
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
	async createMDFPreview(name:string, content:Uint8Array, type: 'share' | 'sub' | 'custom' | 'enterprise' = 'share', path:string = ''): Promise<string> {
		try {
			const createResourceUrl = `${this.apiUrl}/api/mdf/preview?type=MDFPreview`;

			// 创建 FormData 并添加基本字段
			let body: FormData = new FormData();
			body.append("type", type);
			body.append("path", path);
			body.append("id", NEW_ID);
			body.append("name", name);
			body.append("size", content.byteLength.toString());

			const mimeType = "application/zip"; // 默认 MIME 类型

			const blob = new Blob([new Uint8Array(content)], {type: mimeType});
			body.append(`asset`, blob, `${name}.zip`);

			// 将 FormData 转换为 ArrayBuffer
			const boundary = "----WebKitFormBoundary" + Math.random().toString(36).substring(2, 9);
			const arrayBufferBody = await this.formDataToArrayBuffer(body, boundary);

			const response: RequestUrlResponse = await requestUrl({
				url: createResourceUrl,
				method: "POST",
				headers: {
					"Content-Type": `multipart/form-data; boundary=${boundary}`,
					"Authorization": `Bearer ${this.user.token}`,
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

	/**
	 * Activate a license key
	 * 
	 * POST /api/license/activate
	 * Authorization: Bearer <token>
	 * 
	 * FormData:
	 * - license_key
	 * - device_id
	 * - device_name
	 * - device_type
	 */
	async activateLicense(
		token: string,
		licenseKey: string,
		deviceId: string,
		deviceName: string,
		deviceType: string
	): Promise<LicenseActivationResponse | null> {
		try {
			const activateUrl = `${this.apiUrl}/api/license/activate`;

			// Create FormData
			const body: FormData = new FormData();
			body.append("license_key", licenseKey);
			body.append("device_id", deviceId);
			body.append("device_name", deviceName);
			body.append("device_type", deviceType);

			// Convert FormData to ArrayBuffer
			const boundary = "----WebKitFormBoundary" + Math.random().toString(36).substring(2, 9);
			const arrayBufferBody = await this.formDataToArrayBuffer(body, boundary);

			const response: RequestUrlResponse = await requestUrl({
				url: activateUrl,
				method: "POST",
				headers: {
					"Content-Type": `multipart/form-data; boundary=${boundary}`,
					"Authorization": `Bearer ${token}`,
				},
				body: arrayBufferBody,
			});

			// Check response status
			if (response.status !== 200 && response.status !== 201) {
				console.error(`License activation failed: ${response.text}`);
				throw new Error(`License activation failed: ${response.status}`);
			}

			// Parse response
			const data = response.json;
			if (data && data.data && data.data.length > 0) {
				return data.data[0] as LicenseActivationResponse;
			}

			throw new Error("Invalid activation response format");
		} catch (error) {
			console.error("Failed to activate license:", error);
			throw error;
		}
	}

	/**
	 * Get license usage information
	 * 
	 * GET /api/license/usage?key=<license_key>&_t=<timestamp>
	 * Authorization: Bearer <token>
	 * 
	 * Note: Adds timestamp parameter to prevent HTTP caching
	 */
	async getLicenseUsage(
		token: string,
		licenseKey: string
	): Promise<LicenseUsageResponse | null> {
		try {
			// Add timestamp to prevent caching
			const timestamp = Date.now();
			const usageUrl = `${this.apiUrl}/api/license/usage?key=${licenseKey}&_t=${timestamp}`;

			const response: RequestUrlResponse = await requestUrl({
				url: usageUrl,
				method: "GET",
				headers: {
					"Authorization": `Bearer ${token}`,
					"Cache-Control": "no-cache",
					"Pragma": "no-cache"
				},
			});

			// Check response status
			if (response.status !== 200) {
				console.error(`License usage fetch failed: ${response.text}`);
				throw new Error(`License usage fetch failed: ${response.status}`);
			}

			// Parse response
			const data = response.json;
			if (data && data.data && data.data.length > 0) {
				return data.data[0] as LicenseUsageResponse;
			}

			throw new Error("Invalid usage response format");
		} catch (error) {
			console.error("Failed to get license usage:", error);
			throw error;
		}
	}

	/**
	 * Get license information (plan, expiration, features)
	 * 
	 * GET /api/license/info?key=<license_key>&_t=<timestamp>
	 * Authorization: Bearer <token>
	 * 
	 * Returns up-to-date license information including:
	 * - expires_at: expiration timestamp
	 * - plan: license plan type
	 * - features.max_storage: maximum storage quota
	 */
	async getLicenseInfo(
		token: string,
		licenseKey: string
	): Promise<any | null> {
		try {
			// Add timestamp to prevent caching
			const timestamp = Date.now();
			const infoUrl = `${this.apiUrl}/api/license/info?key=${licenseKey}&_t=${timestamp}`;

			const response: RequestUrlResponse = await requestUrl({
				url: infoUrl,
				method: "GET",
				headers: {
					"Authorization": `Bearer ${token}`,
					"Cache-Control": "no-cache",
					"Pragma": "no-cache"
				},
			});

			// Check response status
			if (response.status !== 200) {
				console.error(`License info fetch failed: ${response.text}`);
				throw new Error(`License info fetch failed: ${response.status}`);
			}

			// Parse response
			const data = response.json;
			if (data && data.data && data.data.length > 0) {
				return data.data[0];
			}

			throw new Error("Invalid license info response format");
		} catch (error) {
			console.error("Failed to get license info:", error);
			throw error;
		}
	}

	/**
	 * Reset license usage (clear sync database and publish data)
	 * 
	 * POST /api/license/usage/reset?key=<license_key>
	 * Authorization: Bearer <token>
	 * 
	 * This will:
	 * 1. Delete and recreate the CouchDB database (clear sync data)
	 * 2. Delete the publish directory (clear publish data)
	 */
	async resetUsage(
		token: string,
		licenseKey: string
	): Promise<{ success: boolean; message?: string }> {
		try {
			const resetUrl = `${this.apiUrl}/api/license/usage/reset?key=${licenseKey}`;

			const response: RequestUrlResponse = await requestUrl({
				url: resetUrl,
				method: "POST",
				headers: {
					"Authorization": `Bearer ${token}`,
				},
			});

			// Check response status
			if (response.status !== 200 && response.status !== 201) {
				console.error(`License usage reset failed: ${response.text}`);
				throw new Error(`Reset failed: ${response.status}`);
			}

			return { success: true };
		} catch (error) {
			console.error("Failed to reset license usage:", error);
			throw error;
		}
	}

	/**
	 * Get current subdomain for license
	 * 
	 * GET /api/license/subdomain?key={license_key}
	 * Authorization: Bearer <token>
	 */
	async getDomains(
		token: string,
		licenseKey: string
	): Promise<DomainInfo | null> {
		try {
			const url = `${this.apiUrl}/api/license/domains?key=${licenseKey}`;
			
			const response: RequestUrlResponse = await requestUrl({
				url,
				method: "GET",
				headers: {
					"Authorization": `Bearer ${token}`,
				},
			});
			
			if (response.status !== 200) {
				console.error(`Get subdomain failed: ${response.text}`);
				return null;
			}
			
			const data = response.json;
			if (data && data.data && data.data.length > 0) {
				return data.data[0] as DomainInfo;
			}
			
			return null;
		} catch (error) {
			console.error("Failed to get subdomain:", error);
			return null;
		}
	}

	/**
	 * Check if subdomain is available
	 * 
	 * POST /api/license/subdomain/check
	 * Authorization: Bearer <token>
	 * FormData: license_key, subdomain
	 */
	async checkSubdomainAvailability(
		token: string,
		licenseKey: string,
		subdomain: string
	): Promise<SubdomainCheckResponse | null> {
		try {
			const url = `${this.apiUrl}/api/license/subdomain/check`;
			
			const body = new FormData();
			body.append("license_key", licenseKey);
			body.append("subdomain", subdomain);
			
			const boundary = "----WebKitFormBoundary" + Math.random().toString(36).substring(2, 9);
			const arrayBufferBody = await this.formDataToArrayBuffer(body, boundary);
			
			const response: RequestUrlResponse = await requestUrl({
				url,
				method: "POST",
				headers: {
					"Content-Type": `multipart/form-data; boundary=${boundary}`,
					"Authorization": `Bearer ${token}`,
				},
				body: arrayBufferBody,
			});
			
			if (response.status !== 200) {
				console.error(`Check subdomain failed: ${response.text}`);
				return null;
			}
			
			const data = response.json;
			if (data && data.data && data.data.length > 0) {
				return data.data[0] as SubdomainCheckResponse;
			}
			
			return null;
		} catch (error) {
			console.error("Failed to check subdomain:", error);
			return null;
		}
	}

	/**
	 * Update subdomain
	 * 
	 * POST /api/license/subdomain/update
	 * Authorization: Bearer <token>
	 * FormData: license_key, new_subdomain
	 */
	async updateSubdomain(
		token: string,
		licenseKey: string,
		newSubdomain: string
	): Promise<SubdomainUpdateResponse | null> {
		try {
			const url = `${this.apiUrl}/api/license/subdomain/update`;
			
			const body = new FormData();
			body.append("license_key", licenseKey);
			body.append("new_subdomain", newSubdomain);
			
			const boundary = "----WebKitFormBoundary" + Math.random().toString(36).substring(2, 9);
			const arrayBufferBody = await this.formDataToArrayBuffer(body, boundary);
			
			const response: RequestUrlResponse = await requestUrl({
				url,
				method: "POST",
				headers: {
					"Content-Type": `multipart/form-data; boundary=${boundary}`,
					"Authorization": `Bearer ${token}`,
				},
				body: arrayBufferBody,
			});
			if (response.status !== 200) {
				console.error(`Update subdomain failed: ${response.text}`);
				return null;
			}
			
			const data = response.json;
			console.log("Update subdomain response data:", data);
			if (data && data.data && data.data.length > 0) {
				return data.data[0] as SubdomainUpdateResponse;
			}
			
			return null;
		} catch (error) {
			console.error("Failed to update subdomain:", error);
			return null;
		}
	}
	
	/**
	 * Check custom domain DNS configuration
	 * 
	 * POST /api/license/domain/check
	 * Authorization: Bearer <token>
	 * FormData: license_key, domain
	 */
	async checkCustomDomain(
		token: string,
		licenseKey: string,
		domain: string
	): Promise<{ dns_valid: boolean; ready: boolean; message: string; resolved_ips?: string[] } | null> {
		try {
			const url = `${this.apiUrl}/api/license/domain/check`;
			
			const body = new FormData();
			body.append("license_key", licenseKey);
			body.append("domain", domain);
			
			const boundary = "----WebKitFormBoundary" + Math.random().toString(36).substring(2, 9);
			const arrayBufferBody = await this.formDataToArrayBuffer(body, boundary);
			
			const response: RequestUrlResponse = await requestUrl({
				url,
				method: "POST",
				headers: {
					"Authorization": `Bearer ${token}`,
					"Content-Type": `multipart/form-data; boundary=${boundary}`
				},
				body: arrayBufferBody,
			});
			
			if (response.status !== 200) {
				console.error(`Check custom domain failed: ${response.text}`);
				return null;
			}
			
			const data = response.json;
			if (data && data.data && data.data.length > 0) {
				return data.data[0];
			}
			
			return null;
		} catch (error) {
			console.error("Failed to check custom domain:", error);
			throw error;
		}
	}
	
	/**
	 * Add custom domain to license
	 * 
	 * POST /api/license/domain/add
	 * Authorization: Bearer <token>
	 * FormData: license_key, domain
	 */
	async addCustomDomain(
		token: string,
		licenseKey: string,
		domain: string
	): Promise<{ domain: string; status: string; message: string } | null> {
		try {
			const url = `${this.apiUrl}/api/license/domain/add`;
			
			const body = new FormData();
			body.append("license_key", licenseKey);
			body.append("domain", domain);
			
			const boundary = "----WebKitFormBoundary" + Math.random().toString(36).substring(2, 9);
			const arrayBufferBody = await this.formDataToArrayBuffer(body, boundary);
			
			const response: RequestUrlResponse = await requestUrl({
				url,
				method: "POST",
				headers: {
					"Authorization": `Bearer ${token}`,
					"Content-Type": `multipart/form-data; boundary=${boundary}`
				},
				body: arrayBufferBody,
			});
			
			if (response.status !== 200 && response.status !== 201) {
				console.error(`Add custom domain failed: ${response.text}`);
				return null;
			}
			
			const data = response.json;
			if (data && data.data && data.data.length > 0) {
				return data.data[0];
			}
			
			return null;
		} catch (error) {
			console.error("Failed to add custom domain:", error);
			throw error;
		}
	}
	
	/**
	 * Check HTTPS certificate status for custom domain
	 * 
	 * POST /api/license/domain/https-status
	 * Authorization: Bearer <token>
	 * FormData: license_key, domain
	 */
	async checkCustomDomainHttpsStatus(
		token: string,
		licenseKey: string,
		domain: string
	): Promise<{ 
		status: string; 
		tls_ready: boolean; 
		dns_valid: boolean;
		message: string;
		certificate?: any;
	} | null> {
		try {
			const url = `${this.apiUrl}/api/license/domain/https-status`;
			
			const body = new FormData();
			body.append("license_key", licenseKey);
			body.append("domain", domain);
			
			const boundary = "----WebKitFormBoundary" + Math.random().toString(36).substring(2, 9);
			const arrayBufferBody = await this.formDataToArrayBuffer(body, boundary);
			
			const response: RequestUrlResponse = await requestUrl({
				url,
				method: "POST",
				headers: {
					"Authorization": `Bearer ${token}`,
					"Content-Type": `multipart/form-data; boundary=${boundary}`
				},
				body: arrayBufferBody,
			});
			
			if (response.status !== 200) {
				console.error(`Check HTTPS status failed: ${response.text}`);
				return null;
			}
			
			const data = response.json;
			if (data && data.data && data.data.length > 0) {
				return data.data[0];
			}
			
			return null;
		} catch (error) {
			console.error("Failed to check HTTPS status:", error);
			throw error;
		}
	}

}
