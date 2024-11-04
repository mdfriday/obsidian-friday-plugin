import type {App} from "obsidian";
import {FM_DEFAULT_THEME, FM_FRIDAY_PLUGIN, FM_THEME} from "./frontmatter";

export class FileInfo {
	name: string;
	path: string;
	frontMatter: Record<string, any> | null;

	constructor() {
		this.name = '';
		this.path = '';
		this.frontMatter = null;
	}

	// 只更新 path 和 frontmatter
	updateFileInfo(app: App, callback: (fileInfo: FileInfo) => void) {
		const activeFile = app.workspace.getActiveFile();
		if (activeFile) {
			this.name = activeFile.name;
			this.path = activeFile.path;

			// 获取 frontmatter 信息
			const metadata = app.metadataCache.getFileCache(activeFile);
			this.frontMatter = metadata?.frontmatter ?? null;

			callback(this); // 通知外部异步操作已完成
		} else {
			callback(this); // 没有文件的情况，直接回调
		}
	}

	hasFridayPluginEnabled(): boolean {
		return this.frontMatter?.[FM_FRIDAY_PLUGIN] === 'enabled';
	}

	hasThemeConfigured(): boolean {
		return this.frontMatter?.[FM_THEME] !== undefined;
	}

	getThemeName(): string {
		return this.frontMatter?.[FM_THEME] ?? ''
	}

	getThemeDownloadFilename(): string {
		const theme = this.frontMatter?.[FM_THEME] ?? FM_DEFAULT_THEME;
		switch (theme) {
			case 'github.com/mdfriday/theme-manual-of-me':
				return 'theme-manual-of-me.zip';
			default:
				return '';
		}
	}
}
