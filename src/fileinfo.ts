import {App, Notice, TFolder} from "obsidian";
import {
	FM_CONTENT,
	FM_CONTENT_EMPTY,
	FM_DEFAULT_LANGUAGE,
	FM_FRIDAY_PLUGIN, FM_GA,
	FM_MENU, FM_PROJ,
	FM_SITE_ID, FM_SITE_TITLE,
	FM_THEME
} from "./frontmatter";
import * as path from "path";
import * as yaml from "js-yaml";
import {IsLanguageSupported, IsRtlLanguage} from "./language";

export class FileInfo {
	name: string;
	path: string;
	frontMatter: Record<string, any> | null;
	content: string;
	languages: string[] = [];
	menus: string[] = [];

	isContentFolderExists: boolean;
	isReadyForBuild: boolean

	app: App

	constructor() {
		this.name = '';
		this.path = '';
		this.frontMatter = null;
		this.content = '';
		this.isReadyForBuild = false;
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

			this.isContentFolderExists = await app.vault.adapter.exists(this.getContentFolder());
			this.isReadyForBuild = this.hasFridayPluginEnabled() && this.hasThemeConfigured() && this.hasContentConfigured()

			// 获取文件内容
			const fileContent = await app.vault.read(activeFile); // 读取文件内容
			this.content = this.extractContentWithoutFrontmatter(fileContent, this.frontMatter); // 存储去掉 frontmatter 的内容

			this.languages = this.detectLanguageFolders();
			this.menus = this.getMenus();

			callback(this); // 通知外部异步操作已完成
		} else {
			callback(this); // 没有文件的情况，直接回调
		}
	}

	isMultiLang(): boolean {
		return this.languages.length > 1
	}

	detectLanguageFolders(): string[] {
		const folder = this.app.vault.getAbstractFileByPath(this.getContentFolder());

		const detectedLanguages: string[] = [];
		if (folder instanceof TFolder) {
			folder.children.forEach((child) => {
				if (child instanceof TFolder && IsLanguageSupported(child.name)) {
					if (!IsRtlLanguage(child.name)) {
						detectedLanguages.push(child.name);
					}
				}
			});
		}
		return detectedLanguages;
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

		await this.app.fileManager.processFrontMatter(file, (frontmatter) => {
			frontmatter[key] = value;
		});

		await new Promise(resolve => setTimeout(resolve, 100));
	}

	hasFridayPluginEnabled(): boolean {
		return this.frontMatter?.[FM_FRIDAY_PLUGIN] === 'enabled';
	}

	hasThemeConfigured(): boolean {
		return this.frontMatter?.[FM_THEME] !== undefined;
	}

	hasContentConfigured(): boolean {
		const contentPath = this.getContentFolder();
		return contentPath !== FM_CONTENT_EMPTY && contentPath !== null && this.isContentFolderExists;
	}

	getContentFolder(): string {
		return path.posix.join(this.getProjFolder(), FM_CONTENT)
	}

	getProjFolder(): string {
		return this.frontMatter?.[FM_PROJ] ?? ''
	}

	getMenus(): string[] {
		return this.frontMatter?.[FM_MENU] ?? []
	}

	getSiteId(): string {
		return this.frontMatter?.[FM_SITE_ID] ?? '0';
	}

	getSiteTitle(): string {
		return this.frontMatter?.[FM_SITE_TITLE] ?? this.getBaseName();
	}

	getThemeName(): string {
		return this.frontMatter?.[FM_THEME] ?? ''
	}

	getThemeBaseName(): string {
		return path.basename(this.getThemeName())
	}

	getDefaultLanguage(): string {
		return this.frontMatter?.[FM_DEFAULT_LANGUAGE] ?? ''
	}

	getGA(): string {
		return this.frontMatter?.[FM_GA] ?? ''
	}

	getParams(): string {
		const excludeKeys = [
			FM_FRIDAY_PLUGIN, FM_SITE_ID, FM_SITE_TITLE, FM_PROJ, FM_THEME,
			FM_MENU, FM_DEFAULT_LANGUAGE, FM_GA];

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
			return path.basename(theme)
		}

		return ''
	}

	getThemeDownloadFilename(): string {
		return `${this.getThemeBaseName()}.zip`;
	}

	getBaseName(): string {
		return this.name.split(".")[0];
	}

	getDescription(): string {
		return this.content.replace(/[\r\n]+/g, ' ');
	}
}
