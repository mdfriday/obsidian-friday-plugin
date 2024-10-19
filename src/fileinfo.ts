import type {App} from "obsidian";

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
}
