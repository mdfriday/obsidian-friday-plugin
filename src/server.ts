import {ItemView, WorkspaceLeaf, TFile, TFolder} from 'obsidian';
import FridayPlugin, {FRIDAY_ICON} from "./main";
import Server from './svelte/Server.svelte';
import {FileInfo} from "./fileinfo";

export const FRIDAY_SERVER_VIEW_TYPE = 'Friday_Service';
export type TabName = 'site' | 'shortcodes'; // 定义标签页类型

export default class ServerView extends ItemView {
	plugin: FridayPlugin;
	private _app: Server | null = null;
	private activeTab: TabName = 'site'; // 默认选中 site 标签页
	private selectedFolder: TFolder | null = null; // 新增：存储选中的文件夹

	constructor(leaf: WorkspaceLeaf, plugin: FridayPlugin) {
		super(leaf);
		this.plugin = plugin;
	}

	// 设置选中的文件夹
	setSelectedFolder(folder: TFolder) {
		this.selectedFolder = folder;
		if (this._app) {
			this._app.$set({ selectedFolder: folder });
		}
	}

	// 切换标签页
	setActiveTab(tabName: TabName) {
		this.activeTab = tabName;
		if (this._app) {
			this._app.$set({ activeTab: tabName });
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
				activeTab: this.activeTab, // 传入当前激活的标签页
				selectedFolder: this.selectedFolder, // 传入选中的文件夹
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
