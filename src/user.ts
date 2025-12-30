import type FridayPlugin from "./main";
import {App, requestUrl, Notice } from "obsidian";
import type {RequestUrlResponse} from "obsidian";

export class User {
	name: string;
	password: string;
	token: string;

	apiUrl: string;

	app: App
	plugin: FridayPlugin

	constructor(plugin: FridayPlugin) {
		this.plugin = plugin;

		this.app = this.plugin.app;
		this.apiUrl = this.plugin.apiUrl;

		this.name = this.plugin.settings.username;
		this.password = this.plugin.settings.password;
		this.token = this.plugin.settings.userToken;
	}

	getName(): string {
		return this.name;
	}

	async getToken(): Promise<string> {
		return this.token;
	}

	async logout() {
		this.token = '';
		this.plugin.settings.userToken = '';
		await this.plugin.saveSettings();
	}

	async login() {
		this.name = this.plugin.settings.username
		this.password = this.plugin.settings.password

		if (!this.name || !this.password) {
			new Notice(this.plugin.i18n.t('messages.enter_email_password'), 5000);
			return;
		}

		try {
			// 构造URL和请求参数
			const loginUrl = `${this.apiUrl}/api/login`;
			const response: RequestUrlResponse = await requestUrl({
				url: loginUrl,
				method: "POST",
				headers: {
					"Content-Type": "application/x-www-form-urlencoded"
				},
				body: `email=${encodeURIComponent(this.name)}&password=${encodeURIComponent(this.password)}`
			});

			// 检查响应状态
			if (response.status !== 201) {
				throw new Error(`Login failed: ${response.text}`);
			}

			// 解析返回的JSON数据，提取token
			this.token = response.json.data[0]; // 假设`data`数组的第一个元素就是token

			this.plugin.settings.userToken = this.token;
			await this.plugin.saveSettings();
		} catch (error) {
			console.error("Failed to login:", error);
			new Notice(this.plugin.i18n.t('messages.login_failed'), 5000);
		}
	}

	/**
	 * Login with provided credentials (programmatic login)
	 * Used for license activation flow where credentials are derived from license key
	 * 
	 * @param email - User email
	 * @param password - User password
	 * @returns Token if successful, null otherwise
	 */
	async loginWithCredentials(email: string, password: string): Promise<string | null> {
		try {
			const loginUrl = `${this.apiUrl}/api/login`;
			const response: RequestUrlResponse = await requestUrl({
				url: loginUrl,
				method: "POST",
				headers: {
					"Content-Type": "application/x-www-form-urlencoded"
				},
				body: `email=${encodeURIComponent(email)}&password=${encodeURIComponent(password)}`
			});

			// Check response status
			if (response.status !== 201) {
				console.error(`Login failed with status ${response.status}: ${response.text}`);
				return null;
			}

			// Parse token from response
			const token = response.json.data[0];
			
			// Update plugin state
			this.name = email;
			this.password = password;
			this.token = token;
			
			// Save to settings
			this.plugin.settings.username = email;
			this.plugin.settings.password = password;
			this.plugin.settings.userToken = token;
			await this.plugin.saveSettings();

			return token;
		} catch (error) {
			console.error("Failed to login with credentials:", error);
			return null;
		}
	}

	async register() {
		this.name = this.plugin.settings.username
		this.password = this.plugin.settings.password

		if (!this.name || !this.password) {
			new Notice(this.plugin.i18n.t('messages.enter_email_password'), 5000);
			return;
		}

		// 验证邮箱格式
		const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
		if (!emailRegex.test(this.name)) {
			new Notice(this.plugin.i18n.t('messages.enter_valid_email'), 5000);
			return;
		}

		try {
			// 构造注册URL和请求参数
			const registerUrl = `${this.apiUrl}/api/user`;
			const response: RequestUrlResponse = await requestUrl({
				url: registerUrl,
				method: "POST",
				headers: {
					"Content-Type": "application/x-www-form-urlencoded"
				},
				body: `email=${encodeURIComponent(this.name)}&password=${encodeURIComponent(this.password)}`
			});

			// 检查响应状态
			if (response.status !== 201) {
				throw new Error(`Registration failed: ${response.text}`);
			}

			// 解析返回的JSON数据，提取token
			this.token = response.json.data[0]; // 假设`data`数组的第一个元素就是token

			this.plugin.settings.userToken = this.token;
			await this.plugin.saveSettings();
		} catch (error) {
			console.error("Failed to register user:", error);
			new Notice(this.plugin.i18n.t('messages.register_failed'), 5000);
		}
	}
}
