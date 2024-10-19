import {ItemView, WorkspaceLeaf, Platform} from 'obsidian';
import FridayPlugin, {FRIDAY_ICON} from "./main";
import Server from './svelte/Server.svelte';
import {FileInfo} from "./fileinfo";

export const FRIDAY_SERVER_VIEW_TYPE = 'Friday';

export default class ServerView extends ItemView {
	plugin: FridayPlugin;
	private _app: Server;
	private fileInfo: FileInfo;

	constructor(leaf: WorkspaceLeaf, plugin: FridayPlugin) {
		super(leaf);
		this.plugin = plugin;
		this.fileInfo = new FileInfo(); // 初始化 fileInfo

		// 监听用户选择文件的变化
		this.registerEvent(
			this.app.workspace.on('active-leaf-change', () => {
				this.updateFileInfo();
			})
		);

		// 监听 frontmatter 的变化
		this.registerEvent(
			this.app.metadataCache.on('changed', (file) => {
				if (file === this.app.workspace.getActiveFile()) {
					this.updateFileInfo();
				}
			})
		);

		// 监听文件名变化（可以通过 resolved 事件监听文件的重命名）
		this.registerEvent(
			this.app.metadataCache.on('resolved', () => {
				this.updateFileInfo();
			})
		);
	}

	// 关闭时销毁 Svelte 实例
	async onClose() {
		this._app.$destroy();
	}

	// 打开时初始化 Svelte 实例并传入 props
	async onOpen(): Promise<void> {
		this.updateFileInfo(); // 初始化时获取 fileInfo
		this._app = new Server({
			target: (this as any).contentEl,
			props: {
				fileInfo: this.fileInfo,
				platform: this.getOSInfo(),
				app: this.app,
				plugin: this.plugin,
			},
		});
	}

	// 更新 fileInfo 并通知 Svelte 组件
	private updateFileInfo() {
		const fileInfo = new FileInfo();
		fileInfo.updateFileInfo(this.app, (updatedFileInfo) => {
			this.fileInfo = updatedFileInfo; // 更新 fileInfo
			if (this._app) {
				// 重新设置 Svelte 组件的 props
				this._app.$set({ fileInfo: this.fileInfo });
			}
		});
	}

	// 获取客户端操作系统信息
	private getOSInfo(): string {
		if (Platform.isMacOS) return "MacOS";
		if (Platform.isWin) return "Windows";
		if (Platform.isLinux) return "Linux";
		if (Platform.isMobile) return "Mobile";
		return "Unknown";
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
