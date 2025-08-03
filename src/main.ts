import {App, Plugin, PluginSettingTab, Setting, TFolder} from 'obsidian';
import ServerView, {FRIDAY_SERVER_VIEW_TYPE} from './server';
import {User} from "./user";
import './styles/theme-modal.css';
import {stopGlobalHttpServer} from './httpServer';
import {ThemeSelectionModal} from "./theme/modal";
import {Hugoverse} from "./hugoverse";

interface FridaySettings {
	username: string;
	password: string;
	userToken: string;
}

const DEFAULT_SETTINGS: FridaySettings = {
	username: '',
	password: '',
	userToken: '',
}

export const FRIDAY_ICON = 'dice-5';
export const API_URL_DEV = 'http://127.0.0.1:1314';
export const API_URL_PRO = 'https://mdfriday.sunwei.xyz';
export function GetBaseUrl(): string {
	return process.env.NODE_ENV === 'development' ? API_URL_DEV : API_URL_PRO;
}

export default class FridayPlugin extends Plugin {
	settings: FridaySettings;
	statusBar: HTMLElement

	pluginDir: string
	apiUrl: string
	user: User
	hugoverse: Hugoverse

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
									// Set selected folder and switch to site tab
									serverView.setSelectedFolder(file);
									await this.app.workspace.revealLeaf(leaves[0]);
								} else {
									// If no existing view, create a new one
									const leaf = this.app.workspace.getRightLeaf(false);
									if (leaf) {
										await leaf.setViewState({
											type: FRIDAY_SERVER_VIEW_TYPE,
											active: true,
										});
										const serverView = leaf.view as ServerView;
										serverView.setSelectedFolder(file);
									}
								}
							});
					});
				}
			})
		);
	}

	showThemeSelectionModal(selectedTheme: string, onSelect: (themeUrl: string, themeName?: string, themeId?: string) => void) {
		const modal = new ThemeSelectionModal(this.app, selectedTheme, onSelect);
		modal.open();
	}

	async initFriday(): Promise<void> {
		this.apiUrl = process.env.NODE_ENV === 'development' ? API_URL_DEV : API_URL_PRO;
		this.user = new User(this);
		this.hugoverse = new Hugoverse(this);
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
	}
}
