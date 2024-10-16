import {ItemView, WorkspaceLeaf} from 'obsidian'
import FridayPlugin, {FRIDAY_ICON} from "./main";
import Server from './svelte/Server.svelte'

export const FRIDAY_SERVER_VIEW_TYPE = 'Friday'

export default class ServerView extends ItemView {
	private _app: Server

	plugin: FridayPlugin;

	getDisplayText(): string {
		return "Friday Server";
	}

	getViewType(): string {
		return FRIDAY_SERVER_VIEW_TYPE;
	}

	getIcon(): string {
		return FRIDAY_ICON
	}

	constructor(leaf: WorkspaceLeaf, plugin: FridayPlugin,) {
		super(leaf)
		this.plugin = plugin
	}

	async onClose() {
		this._app.$destroy()
	}

	async onOpen(): Promise<void> {
		this._app = new Server({
			target: (this as any).contentEl,
		})
	}

}
