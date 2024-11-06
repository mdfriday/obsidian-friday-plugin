import {App, Notice} from "obsidian";
import {FM_CONTENT, FM_CONTENT_EMPTY, FM_FRIDAY_PLUGIN, FM_SITE_ID, FM_THEME} from "./frontmatter";
import * as path from "path";
import * as yaml from "js-yaml";

export class FileInfo {
	name: string;
	path: string;
	frontMatter: Record<string, any> | null;
	content: string;

	app: App

	constructor() {
		this.name = '';
		this.path = '';
		this.frontMatter = null;
		this.content = '';
	}

	async updateFileInfo(app: App, callback: (fileInfo: FileInfo) => void) {
		const activeFile = app.workspace.getActiveFile();
		if (activeFile) {
			this.app = app;
			this.name = activeFile.name;
			this.path = activeFile.path;

			// 获取 frontmatter 信息
			const metadata = app.metadataCache.getFileCache(activeFile);
			this.frontMatter = metadata?.frontmatter ?? null;

			// 获取文件内容
			const fileContent = await app.vault.read(activeFile); // 读取文件内容
			this.content = this.extractContentWithoutFrontmatter(fileContent, this.frontMatter); // 存储去掉 frontmatter 的内容

			callback(this); // 通知外部异步操作已完成
		} else {
			callback(this); // 没有文件的情况，直接回调
		}
	}

	extractContentWithoutFrontmatter(content, frontMatter) {
		if (!frontMatter) return content; // 如果没有 frontmatter，则返回原内容

		// 查找 frontmatter 的结束位置
		const frontmatterEndIndex = content.indexOf('---', content.indexOf('---') + 3); // 找到第二个 '---'
		return frontmatterEndIndex !== -1 ? content.substring(frontmatterEndIndex + 3).trim() : content; // 返回去掉 frontmatter 后的内容
	}

	async updateFrontMatter(key: string, value: string) {
		const file = this.app.workspace.getActiveFile();
		if (!file) {
			new Notice("No active file.");
			return;
		}
		// 从缓存中获取文件的 frontmatter
		const metadata = this.app.metadataCache.getFileCache(file);
		const frontmatter = metadata?.frontmatter;

		if (!frontmatter) {
			new Notice("No frontmatter found.");
			return;
		}

		// 更新 frontmatter 中的指定键值
		frontmatter[key] = value; // 修改目标 key 的值

		// 读取文件内容
		const content = await this.app.vault.read(file);

		// 使用正则表达式提取并替换原始 frontmatter
		const frontmatterRegex = /^---\n([\s\S]*?)\n---\n/;
		const updatedFrontmatter = yaml.dump(frontmatter);
		const newContent = content.replace(frontmatterRegex, `---\n${updatedFrontmatter}---\n`);

		// 将修改后的内容写回文件
		await this.app.vault.modify(file, newContent);
	}

	hasFridayPluginEnabled(): boolean {
		return this.frontMatter?.[FM_FRIDAY_PLUGIN] === 'enabled';
	}

	hasThemeConfigured(): boolean {
		return this.frontMatter?.[FM_THEME] !== undefined;
	}

	hasContentConfigured(): boolean {
		return this.frontMatter?.[FM_CONTENT] !== FM_CONTENT_EMPTY;
	}

	getContentFolder(): string {
		return this.frontMatter?.[FM_CONTENT] ?? ''
	}

	getSiteId(): string {
		return this.frontMatter?.[FM_SITE_ID] ?? '0';
	}

	getThemeName(): string {
		return this.frontMatter?.[FM_THEME] ?? ''
	}

	getParams(): string {
		const excludeKeys = [FM_FRIDAY_PLUGIN, FM_SITE_ID, FM_CONTENT, FM_THEME];

		const paramsArray = [];
		for (const key in this.frontMatter) {
			if (this.frontMatter.hasOwnProperty(key) && !excludeKeys.includes(key)) {
				const value = this.frontMatter[key];
				paramsArray.push(`${key} = '${value}'`);
			}
		}

		return `\n${paramsArray.join("\n")}\n`;
	}

	getThemeContentPath(): string {
		if (this.hasThemeConfigured()) {
			const theme = this.getThemeName();
			const base = path.basename(theme)
			return path.join(base, 'content')
		}

		return ''
	}

	// TODO: showing warning message for not supported themes
	getThemeDownloadFilename(): string {
		const theme = this.frontMatter?.[FM_THEME];
		switch (theme) {
			case 'github.com/mdfriday/theme-manual-of-me':
				return 'theme-manual-of-me.zip';
			default:
				return '';
		}
	}

	getBaseName(): string {
		return this.name.split(".")[0];
	}

	getDescription(): string {
		return this.content;
	}
}
