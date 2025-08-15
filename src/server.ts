import {ItemView, WorkspaceLeaf, TFile, TFolder} from 'obsidian';
import FridayPlugin, {FRIDAY_ICON} from "./main";
import Server from './svelte/Server.svelte';

export const FRIDAY_SERVER_VIEW_TYPE = 'Friday_Service';

export default class ServerView extends ItemView {
	plugin: FridayPlugin;
	private _app: Server | null = null;
	private selectedFolder: TFolder | null = null; // 存储选中的文件夹
	private selectedFile: TFile | null = null; // 存储选中的文件

	constructor(leaf: WorkspaceLeaf, plugin: FridayPlugin) {
		super(leaf);
		this.plugin = plugin;
	}

	// 设置选中的文件夹
	setSelectedFolder(folder: TFolder) {
		this.selectedFolder = folder;
		this.selectedFile = null; // 清除文件选择
		if (this._app) {
			this._app.$set({ selectedFolder: folder, selectedFile: null });
		}
	}

	// 设置选中的文件
	setSelectedFile(file: TFile) {
		this.selectedFile = file;
		this.selectedFolder = null; // 清除文件夹选择
		if (this._app) {
			this._app.$set({ selectedFile: file, selectedFolder: null });
		}
	}

	// 关闭时销毁 Svelte 实例
	async onClose() {
		if (this._app) {
			this._app.$destroy();
			this._app = null;
		}
	}

	// 打开时初始化 Svelte 实例并传入 props
	async onOpen(): Promise<void> {
		this._app = new Server({
			target: this.contentEl,
			props: {
				app: this.app,
				plugin: this.plugin,
				selectedFolder: this.selectedFolder, // 传入选中的文件夹
				selectedFile: this.selectedFile, // 传入选中的文件
			},
		});
	}

	getDisplayText(): string {
		return "Friday Service";
	}

	getViewType(): string {
		return FRIDAY_SERVER_VIEW_TYPE;
	}

	getIcon(): string {
		return FRIDAY_ICON
	}
}
