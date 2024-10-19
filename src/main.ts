import { App, Notice, Plugin, TFile, TFolder, PluginSettingTab, Setting } from 'obsidian';
import { getDefaultFrontMatter } from './frontmatter';
import ServerView, { FRIDAY_SERVER_VIEW_TYPE } from './server';

interface MyPluginSettings {
	mySetting: string;
}

const DEFAULT_SETTINGS: MyPluginSettings = {
	mySetting: 'default'
}

export const FRIDAY_ICON = 'dice-5';

export default class FridayPlugin extends Plugin {
	settings: MyPluginSettings;
	statusBar: HTMLElement

	async onload() {
		await this.loadSettings();

		this.addRibbonIcon(FRIDAY_ICON, 'Create new Friday note', (evt: MouseEvent) => this.newNote());

		this.statusBar = this.addStatusBarItem();

		this.addSettingTab(new SampleSettingTab(this.app, this));

		this.registerView(FRIDAY_SERVER_VIEW_TYPE, leaf => new ServerView(leaf, this))
		if (this.app.workspace.layoutReady) this.initLeaf()
		else this.app.workspace.onLayoutReady(() => this.initLeaf())
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
			const fNote: TFile = await (this.app.fileManager as any).createNewMarkdownFile(
				targetFolder,
				'Untitled Friday Note'
			);

			await this.app.vault.modify(fNote, getDefaultFrontMatter());
			await this.app.workspace.getLeaf().openFile(fNote);
		} catch (e) {
			new Notice('Failed to create new Friday note');
			console.error('Error creating new Friday note :', e);
		}
	}

	async status(text: string) {
		this.statusBar.setText(text)
	}
}

class SampleSettingTab extends PluginSettingTab {
	plugin: FridayPlugin;

	constructor(app: App, plugin: FridayPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const {containerEl} = this;

		containerEl.empty();

		new Setting(containerEl)
			.setName('Setting #1')
			.setDesc('It\'s a secret')
			.addText(text => text
				.setPlaceholder('Enter your secret')
				.setValue(this.plugin.settings.mySetting)
				.onChange(async (value) => {
					this.plugin.settings.mySetting = value;
					await this.plugin.saveSettings();
				}));
	}
}
