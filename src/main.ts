import {App, Notice, Plugin, PluginSettingTab, Setting, TFile, TFolder} from 'obsidian';
import {getDefaultFrontMatter} from './frontmatter';
import ServerView, {FRIDAY_SERVER_VIEW_TYPE} from './server';
import {User} from "./user";
import {Hugoverse} from "./hugoverse";
import {FileInfo} from "./fileinfo";

interface FridaySettings {
	netlifyToken: string;
}

const DEFAULT_SETTINGS: FridaySettings = {
	netlifyToken: ''
}

export const FRIDAY_ICON = 'dice-5';
export const API_URL_DEV = 'http://127.0.0.1:1314';
export const API_URL_PRO = 'https://mdfriday.sunwei.xyz';

export default class FridayPlugin extends Plugin {
	settings: FridaySettings;
	statusBar: HTMLElement

	fileInfo: FileInfo;

	pluginDir: string
	apiUrl: string
	user: User
	hugoverse: Hugoverse

	async onload() {
		this.pluginDir = `${this.manifest.dir}`;
		await this.initFriday()
		await this.loadSettings();

		this.addRibbonIcon(FRIDAY_ICON, 'Create new Friday note', (evt: MouseEvent) => this.newNote());

		this.statusBar = this.addStatusBarItem();

		this.addSettingTab(new FridaySettingTab(this.app, this));

		this.registerView(FRIDAY_SERVER_VIEW_TYPE, leaf => new ServerView(leaf, this))
		if (this.app.workspace.layoutReady) this.initLeaf()
		else this.app.workspace.onLayoutReady(() => this.initLeaf())
	}

	async initFriday(): Promise<void> {
		this.fileInfo = new FileInfo()
		this.apiUrl = process.env.NODE_ENV === 'development' ? API_URL_DEV : API_URL_PRO;

		this.user = new User(this);
		await this.user.initializeUser()

		this.hugoverse = new Hugoverse(this);
	}

	initLeaf(): void {
		if (this.app.workspace.getLeavesOfType(FRIDAY_SERVER_VIEW_TYPE).length) return

		this.app.workspace.getRightLeaf(false)?.setViewState({
			type: FRIDAY_SERVER_VIEW_TYPE,
			active: true,
		}).then(r => {})
	}

	onunload() {
		this.app.workspace.getLeavesOfType(FRIDAY_SERVER_VIEW_TYPE)[0]?.detach()
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}

	async newNote(folder?: TFolder) {
		const targetFolder = folder
			? folder
			: this.app.fileManager.getNewFileParent(this.app.workspace.getActiveFile()?.path || '');

		try {
			const fNote: TFile = await this.createUniqueMarkdownFile(targetFolder.path, 'Untitled Friday Site');

			await this.app.vault.modify(fNote, getDefaultFrontMatter());
			await this.app.workspace.getLeaf().openFile(fNote);
		} catch (e) {
			new Notice('Failed to create new Friday note');
			console.error('Error creating new Friday note :', e);
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

		new Setting(containerEl)
			.setName('Netlify Token')
			.setDesc('Deploy to your own account')
			.addText(text => text
				.setPlaceholder('Enter your netlify token')
				.setValue(this.plugin.settings.netlifyToken)
				.onChange(async (value) => {
					this.plugin.settings.netlifyToken = value;
					await this.plugin.saveSettings();
				}));
	}
}
