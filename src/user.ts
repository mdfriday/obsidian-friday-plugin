import type FridayPlugin from "./main";
import {App, requestUrl, RequestUrlResponse, Notice } from "obsidian";

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
			new Notice("Please enter your username and password", 5000);
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
			new Notice("Failed to login", 5000);
		}
	}

	async register() {
		this.name = this.plugin.settings.username
		this.password = this.plugin.settings.password

		if (!this.name || !this.password) {
			new Notice("Please enter your username and password", 5000);
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
			new Notice("Failed to register user", 5000);
		}
	}
}
