import {App, Notice, Plugin, PluginSettingTab, Setting, TFile, TFolder} from 'obsidian';
import ServerView, {FRIDAY_SERVER_VIEW_TYPE} from './server';
import {User} from "./user";
import './styles/site-preview.css';
import './styles/export-image.css';
import './obsidian';
import {stopGlobalHttpServer} from './httpServer';

interface FridaySettings {
	username: string;
	password: string;
	userToken: string;

	rootDomain: string
	netlifyToken: string
	deploymentType: 'netlify' | 'scp'
	scpUsername: string
	scpPassword: string
	scpHost: string
	scpPort: string
	scpPath: string
	
	// 新增主题配置
	availableThemes: string[]
}

const DEFAULT_SETTINGS: FridaySettings = {
	username: '',
	password: '',
	userToken: '',
	rootDomain: '',
	netlifyToken: '',
	deploymentType: 'netlify',
	scpUsername: '',
	scpPassword: '',
	scpHost: '',
	scpPort: '22',
	scpPath: '',
	
	// 默认主题列表
	availableThemes: ['theme-book', 'theme-hero', 'theme-academic']
}

export const FRIDAY_ICON = 'dice-5';
export const API_URL_DEV = 'http://127.0.0.1:1314';
export const API_URL_PRO = 'https://mdfriday.sunwei.xyz';
export function GetBaseUrl(): string {
	return process.env.NODE_ENV === 'development' ? API_URL_DEV : API_URL_PRO;
}

const FRIDAY_ROOT_FOLDER = 'MDFriday';

export default class FridayPlugin extends Plugin {
	settings: FridaySettings;
	statusBar: HTMLElement

	pluginDir: string
	apiUrl: string
	user: User

	async onload() {
		this.pluginDir = `${this.manifest.dir}`;
		await this.loadSettings();
		await this.initFriday()

		this.statusBar = this.addStatusBarItem();

		this.addSettingTab(new FridaySettingTab(this.app, this));

		this.registerView(FRIDAY_SERVER_VIEW_TYPE, leaf => new ServerView(leaf, this))
		this.app.workspace.onLayoutReady(() => this.initLeaf())

		// Register context menu for files
		this.registerEvent(
			this.app.workspace.on('file-menu', (menu, file) => {
				if (file instanceof TFolder) {
					menu.addItem(item => {
						item
							.setTitle('Build as site')
							.setIcon(FRIDAY_ICON)
							.onClick(async () => {
								const rightSplit = this.app.workspace.rightSplit;
								if (!rightSplit) {
									return;
								}
								if (rightSplit.collapsed) {
									rightSplit.expand();
								}
								const leaves = this.app.workspace.getLeavesOfType(FRIDAY_SERVER_VIEW_TYPE);
								if (leaves.length > 0 ) {
									const serverView = leaves[0].view as ServerView;
									// 设置选中的文件夹并切换到site标签页
									serverView.setSelectedFolder(file);
									serverView.setActiveTab('site');
									await this.app.workspace.revealLeaf(leaves[0]);
								} else {
									// 如果没有现有的view，创建一个新的
									const leaf = this.app.workspace.getRightLeaf(false);
									if (leaf) {
										await leaf.setViewState({
											type: FRIDAY_SERVER_VIEW_TYPE,
											active: true,
										});
										const serverView = leaf.view as ServerView;
										serverView.setSelectedFolder(file);
										serverView.setActiveTab('site');
									}
								}
							});
					});
				}
			})
		);
	}

	async initFriday(): Promise<void> {
		this.apiUrl = process.env.NODE_ENV === 'development' ? API_URL_DEV : API_URL_PRO;
		this.user = new User(this);
	}

	initLeaf(): void {
		if (this.app.workspace.getLeavesOfType(FRIDAY_SERVER_VIEW_TYPE).length > 0) return

		this.app.workspace.getRightLeaf(false)?.setViewState({
			type: FRIDAY_SERVER_VIEW_TYPE,
			active: true,
		}).then(r => {})
	}

	async onunload() {
		await stopGlobalHttpServer();
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}

	async status(text: string) {
		this.statusBar.setText(text)
	}
}

class FridaySettingTab extends PluginSettingTab {
	plugin: FridayPlugin;

	constructor(app: App, plugin: FridayPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const {containerEl} = this;

		containerEl.empty();

		const {username, password, userToken} = this.plugin.settings;

		if (userToken) {
			// 用户已登录的界面
			containerEl.createEl("h2", {text: "Welcome Back!"});
			containerEl.createEl("p", {text: `Logged in as: ${username}`});

			new Setting(containerEl)
				.addButton((button) =>
					button
						.setButtonText("Logout")
						.setCta()
						.onClick(async () => {
							await this.plugin.user.logout(); // 处理登出逻辑
							this.display(); // 刷新界面
						})
				);
		} else {
			// 用户未登录的界面
			containerEl.createEl("h2", {text: "Welcome!"});
			containerEl.createEl("p", {text: "Please enter your credentials."});

			// Email 输入框
			new Setting(containerEl)
				.setName("Email")
				.setDesc("Enter your email address")
				.addText((text) =>
					text
						.setPlaceholder("your@email.com")
						.setValue(username || "") // 填充现有用户名
						.onChange(async (value) => {
							this.plugin.settings.username = value;
							await this.plugin.saveSettings();
						})
				);

			// Password 输入框
			new Setting(containerEl)
				.setName("Password")
				.setDesc("Enter your password")
				.addText((text) => {
					text
						.setPlaceholder("password")
						.setValue(password || "") // 填充现有密码
						.onChange(async (value) => {
							this.plugin.settings.password = value;
							await this.plugin.saveSettings();
						})
					text.inputEl.type = "password";
				});

			// Register 按钮
			new Setting(containerEl)
				.addButton((button) =>
					button
						.setButtonText("Register")
						.setCta()
						.onClick(async () => {
							await this.plugin.user.register(); // 处理注册逻辑
							this.display(); // 刷新界面
						})
				).addButton((button) =>
				button
					.setButtonText("Login")
					.setCta()
					.onClick(async () => {
						await this.plugin.user.login(); // 处理登录逻辑
						this.display(); // 刷新界面
					})
			);
		}

		containerEl.createEl("h2", {text: "Deployment"});
		
		// Add deployment type selector
		new Setting(containerEl)
			.setName("Deployment Type")
			.setDesc("Choose your deployment method")
			.addDropdown(dropdown => 
				dropdown
					.addOption('netlify', 'Netlify')
					.addOption('scp', 'SCP (Private Server)')
					.setValue(this.plugin.settings.deploymentType)
					.onChange(async (value) => {
						this.plugin.settings.deploymentType = value as 'netlify' | 'scp';
						await this.plugin.saveSettings();
						this.display(); // Refresh to show/hide relevant settings
					})
			);

		// Show different settings based on deployment type
		if (this.plugin.settings.deploymentType === 'netlify') {
			new Setting(containerEl)
				.setName("Root Domain")
				.setDesc("Set your custom root domain (e.g., mdfriday.com). This will be used for generated links.")
				.addText(text =>
					text
						.setPlaceholder("Enter your root domain")
						.setValue(this.plugin.settings.rootDomain || "")
						.onChange(async (value) => {
							this.plugin.settings.rootDomain = value;
							await this.plugin.saveSettings();
						})
				);

			new Setting(containerEl)
				.setName("Netlify Token")
				.setDesc("Set your Netlify personal access token here.")
				.addText(text =>
					text
						.setPlaceholder("Enter your Netlify Token")
						.setValue(this.plugin.settings.netlifyToken || "")
						.onChange(async (value) => {
							this.plugin.settings.netlifyToken = value;
							await this.plugin.saveSettings();
						})
				);
		} else {
			// SCP Settings
			new Setting(containerEl)
				.setName("SCP Username")
				.setDesc("Username for SCP connection")
				.addText(text =>
					text
						.setPlaceholder("Enter SCP username")
						.setValue(this.plugin.settings.scpUsername || "")
						.onChange(async (value) => {
							this.plugin.settings.scpUsername = value;
							await this.plugin.saveSettings();
						})
				);

			new Setting(containerEl)
				.setName("SCP Password")
				.setDesc("Password for SCP connection")
				.addText(text => {
					text
						.setPlaceholder("Enter SCP password")
						.setValue(this.plugin.settings.scpPassword || "")
						.onChange(async (value) => {
							this.plugin.settings.scpPassword = value;
							await this.plugin.saveSettings();
						});
					text.inputEl.type = "password";
				});

			new Setting(containerEl)
				.setName("SCP Host")
				.setDesc("Host address for SCP connection")
				.addText(text =>
					text
						.setPlaceholder("Enter host address")
						.setValue(this.plugin.settings.scpHost || "")
						.onChange(async (value) => {
							this.plugin.settings.scpHost = value;
							await this.plugin.saveSettings();
						})
				);

			new Setting(containerEl)
				.setName("SCP Port")
				.setDesc("Port for SCP connection (default: 22)")
				.addText(text =>
					text
						.setPlaceholder("22")
						.setValue(this.plugin.settings.scpPort || "22")
						.onChange(async (value) => {
							this.plugin.settings.scpPort = value;
							await this.plugin.saveSettings();
						})
				);

			new Setting(containerEl)
				.setName("Remote Path")
				.setDesc("Remote server path for deployment")
				.addText(text =>
					text
						.setPlaceholder("/var/www/html")
						.setValue(this.plugin.settings.scpPath || "")
						.onChange(async (value) => {
							this.plugin.settings.scpPath = value;
							await this.plugin.saveSettings();
						})
				);
		}
	}
}
