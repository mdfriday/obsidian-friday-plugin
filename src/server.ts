import {ItemView, WorkspaceLeaf, TFile} from 'obsidian';
import FridayPlugin, {FRIDAY_ICON} from "./main";
import Server from './svelte/Server.svelte';
import {FileInfo} from "./fileinfo";

export const FRIDAY_SERVER_VIEW_TYPE = 'Friday';

export default class ServerView extends ItemView {
	plugin: FridayPlugin;
	private _app: Server | null = null;

	constructor(leaf: WorkspaceLeaf, plugin: FridayPlugin) {
		super(leaf);
		this.plugin = plugin;

		// 监听用户选择文件的变化
		this.registerEvent(
			this.app.workspace.on('active-leaf-change', async () => {
				await this.updateFileInfo();
			})
		);

		// 监听 frontmatter 的变化
		this.registerEvent(
			this.app.metadataCache.on('changed', async (file) => {
				if (file === this.app.workspace.getActiveFile()) {
					await this.updateFileInfo();
				}
			})
		);

		// 监听文件名变化（可以通过 resolved 事件监听文件的重命名）
		this.registerEvent(
			this.app.metadataCache.on('resolved', async () => {
				await this.updateFileInfo();
			})
		);
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
		await this.updateFileInfo(); // 初始化时获取 fileInfo
		this._app = new Server({
			target: this.contentEl,
			props: {
				fileInfo: this.plugin.fileInfo,
				app: this.app,
				plugin: this.plugin,
			},
		});
	}

	// 更新 fileInfo 并通知 Svelte 组件
	private async updateFileInfo() {
		const fileInfo = new FileInfo();
		await fileInfo.updateFileInfo(this.app, (updatedFileInfo) => {
			this.plugin.fileInfo = updatedFileInfo; // 更新 fileInfo
			if (this._app) {
				this._app.$set({ fileInfo: this.plugin.fileInfo });
			}
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
