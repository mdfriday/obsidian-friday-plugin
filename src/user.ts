import type FridayPlugin from "./main";
import {App, requestUrl, RequestUrlResponse, Notice } from "obsidian";

const USER_FILE = 'friday-user.json';

export class User {
	name: string;
	password: string;
	token: string;

	apiUrl: string;
	pluginDir: string

	app: App
	plugin: FridayPlugin

	constructor(plugin: FridayPlugin) {
		this.plugin = plugin;

		this.app = this.plugin.app;
		this.pluginDir = this.plugin.pluginDir;
		this.apiUrl = this.plugin.apiUrl;

		this.name = '';
		this.password = '';
		this.token = '';


	}

	// 初始化用户信息
	async initializeUser() {
		// 检查配置文件是否存在
		const userConfigPath = this.configFile();
		const fileExists = await this.fileExists(userConfigPath);

		if (fileExists) {
			// 如果文件存在，加载用户信息
			await this.loadUser();
		} else {
			// 如果文件不存在，生成新用户并注册
			await this.registerUser();
		}
	}

	// 检查文件是否存在
	async fileExists(path: string): Promise<boolean> {
		try {
			const statResult = await this.app.vault.adapter.stat(path); // 尝试获取文件状态

			// 检查 statResult 的类型，确保是文件或文件夹
			// 这里可以根据实际需要进一步检查
			return statResult.type === 'file';

			 // 如果是其他类型，则认为文件不存在
		} catch (error) {
			console.error(`File does not exist at path: ${path}`, error.message);
			return false; // 文件不存在
		}
	}


	configFile() :string {
		return `${this.pluginDir}/${USER_FILE}`
	}

	getName(): string {
		return this.name;
	}

	async loadUser() {
		const userFilePath = this.configFile();
		try {
			const fileContent = await this.app.vault.adapter.read(userFilePath); // 从硬盘读取文件内容
			const data = JSON.parse(fileContent); // 解析 JSON 数据

			this.name = data.name;
			this.password = data.password;
			this.token = data.token;
		} catch (error) {
			console.error("Failed to load user data:", error);
		}
	}

	async getToken(): Promise<string> {
		// 如果已有token则直接返回
		if (this.token) {
			return this.token;
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
			if (response.status !== 200) {
				throw new Error(`Login failed: ${response.text}`);
			}

			// 解析返回的JSON数据，提取token
			const responseData = JSON.parse(response.text);
			this.token = responseData.data[0]; // 假设`data`数组的第一个元素就是token

			return this.token;

		} catch (error) {
			console.error("Failed to get token:", error);
			return '';
		}
	}

	async registerUser() {
		// 动态生成用户名和密码
		this.name = `user_${Math.floor(Math.random() * 1000000)}@mdfriday.com`;
		this.password = Math.random().toString(36).substring(2, 10);

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
			const responseData = JSON.parse(response.text);
			this.token = responseData.data[0]; // 假设`data`数组的第一个元素就是token

			// 保存用户信息到文件
			await this.saveUser();
		} catch (error) {
			console.error("Failed to register user:", error);
		}
	}

	async saveUser() {
		const userData = {
			name: this.name,
			password: this.password,
			token: this.token
		};

		// 写入到文件
		await this.app.vault.adapter.write(this.configFile(), JSON.stringify(userData));
		new Notice("User registered and saved successfully.");
	}

}
