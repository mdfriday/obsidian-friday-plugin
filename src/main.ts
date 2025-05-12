import {App, Notice, Plugin, PluginSettingTab, Setting, TFile, TFolder} from 'obsidian';
import {getDefaultFrontMatter} from './frontmatter';
import ServerView, {FRIDAY_SERVER_VIEW_TYPE} from './server';
import {User} from "./user";
import {Hugoverse} from "./hugoverse";
import {FileInfo} from "./fileinfo";
import {Store} from "./store";
import { registerShortcodeProcessor } from './shortcode';
import './shortcode/styles.css';

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
	scpPath: ''
}

export const FRIDAY_ICON = 'dice-5';
export const API_URL_DEV = 'http://127.0.0.1:1314';
export const API_URL_PRO = 'https://mdfriday.sunwei.xyz';

const FRIDAY_ROOT_FOLDER = 'MDFriday';

export default class FridayPlugin extends Plugin {
	settings: FridaySettings;
	statusBar: HTMLElement

	fileInfo: FileInfo;

	pluginDir: string
	apiUrl: string
	user: User
	hugoverse: Hugoverse

	store: Store

	async onload() {
		this.pluginDir = `${this.manifest.dir}`;
		await this.loadSettings();
		await this.initFriday()

		this.addRibbonIcon(FRIDAY_ICON, 'Create new Friday note', (evt: MouseEvent) => this.newNote());

		this.statusBar = this.addStatusBarItem();

		this.addSettingTab(new FridaySettingTab(this.app, this));

		this.registerView(FRIDAY_SERVER_VIEW_TYPE, leaf => new ServerView(leaf, this))
		this.app.workspace.onLayoutReady(() => this.initLeaf())
		
		// Register shortcode processor
		registerShortcodeProcessor(this);
	}

	async initFriday(): Promise<void> {
		this.fileInfo = new FileInfo()
		this.apiUrl = process.env.NODE_ENV === 'development' ? API_URL_DEV : API_URL_PRO;

		this.user = new User(this);
		this.store = new Store(this);
		this.hugoverse = new Hugoverse(this);
	}

	initLeaf(): void {
		if (this.app.workspace.getLeavesOfType(FRIDAY_SERVER_VIEW_TYPE).length) return

		this.app.workspace.getRightLeaf(false)?.setViewState({
			type: FRIDAY_SERVER_VIEW_TYPE,
			active: true,
		}).then(r => {})
	}

	onunload() {}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}

	async newNote(folder?: TFolder) {
		await this.ensureRootFolderExists();

		try {
			const fNote: TFile = await this.createUniqueMarkdownFile(FRIDAY_ROOT_FOLDER, 'Untitled Friday Site');

			await this.app.vault.modify(fNote, getDefaultFrontMatter());
			await this.app.workspace.getLeaf().openFile(fNote);
		} catch (e) {
			new Notice('Failed to create new Friday note');
			console.error('Error creating new Friday note :', e);
		}
	}

	async ensureRootFolderExists() {
		if (!(await this.app.vault.adapter.exists(FRIDAY_ROOT_FOLDER))) {
			await this.app.vault.createFolder(FRIDAY_ROOT_FOLDER);
		}
	}

	async createUniqueMarkdownFile(targetFolder: string, baseFileName: string): Promise<TFile> {
		let fileIndex = 0;
		let newFile: TFile | null = null;

		while (!newFile) {
			// 动态生成文件名：如 Untitled Friday Site, Untitled Friday Site 1, Untitled Friday Site 2
			const fileName = fileIndex === 0 ? `${baseFileName}.md` : `${baseFileName} ${fileIndex}.md`;
			const filePath = `${targetFolder}/${fileName}`;

			try {
				// 尝试创建文件
				newFile = await this.app.vault.create(filePath, ''); // 创建空文件
			} catch (error) {
				// 如果文件已存在，则递增 fileIndex 并重试
				if (error.message.includes("File already exists")) {
					fileIndex++;
				} else {
					throw error; // 其他错误直接抛出
				}
			}
		}

		return newFile;
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
