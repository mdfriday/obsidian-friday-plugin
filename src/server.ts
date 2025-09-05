import {ItemView, WorkspaceLeaf, TFile, TFolder} from 'obsidian';
import FridayPlugin, {FRIDAY_ICON} from "./main";
import Server from './svelte/Server.svelte';

export const FRIDAY_SERVER_VIEW_TYPE = 'Friday_Service';

export default class ServerView extends ItemView {
	plugin: FridayPlugin;
	private _app: Server | null = null;

	constructor(leaf: WorkspaceLeaf, plugin: FridayPlugin) {
		super(leaf);
		this.plugin = plugin;
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
