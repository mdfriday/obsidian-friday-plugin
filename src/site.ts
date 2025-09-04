import type FridayPlugin from "./main";
import { App, TFolder, TFile, Notice } from "obsidian";
import { writable, type Writable } from 'svelte/store';

// 语言内容接口
export interface LanguageContent {
	id: string;
	folder: TFolder | null;
	file: TFile | null;
	languageCode: string;
	weight: number;
}

// 站点配置接口
export interface SiteConfig {
	siteName: string;
	sitePath: string;
	languageContents: LanguageContent[];
	defaultContentLanguage: string;
	googleAnalyticsId: string;
	disqusShortname: string;
	selectedThemeDownloadUrl: string;
	selectedThemeName: string;
	selectedThemeId: string;
	isForSingleFile: boolean;
}

/**
 * Site 类 - 管理站点配置和多语言内容
 */
export class Site {
	app: App;
	plugin: FridayPlugin;

	// Svelte stores for reactive data
	public config: Writable<SiteConfig>;

	constructor(plugin: FridayPlugin) {
		this.plugin = plugin;
		this.app = this.plugin.app;

		// 初始化配置
		const initialConfig: SiteConfig = {
			siteName: '',
			sitePath: '/',
			languageContents: [],
			defaultContentLanguage: 'en',
			googleAnalyticsId: '',
			disqusShortname: '',
			selectedThemeDownloadUrl: 'https://gohugo.net/book.zip?version=1.0',
			selectedThemeName: 'Obsidian Book',
			selectedThemeId: '1',
			isForSingleFile: false,
		};

		this.config = writable(initialConfig);
	}

	/**
	 * 生成随机ID
	 */
	private generateRandomId(): string {
		return Math.random().toString(36).substr(2, 9);
	}

	/**
	 * 初始化内容 - 当用户首次选择文件夹或文件时调用
	 */
	initializeContent(folder: TFolder | null, file: TFile | null) {
		this.config.update(config => {
			// 如果已经有内容，不重复初始化
			if (config.languageContents.length > 0) {
				return config;
			}

			const initialContent: LanguageContent = {
				id: this.generateRandomId(),
				folder,
				file,
				languageCode: 'en', // 默认英语
				weight: 1
			};

			const contentName = folder ? folder.name : file ? file.basename : '';
			const isForSingleFile = !!file;

			return {
				...config,
				languageContents: [initialContent],
				siteName: contentName,
				isForSingleFile,
				// 根据内容类型设置默认主题
				selectedThemeDownloadUrl: isForSingleFile 
					? 'https://gohugo.net/note.zip?version=1.0'
					: 'https://gohugo.net/book.zip?version=1.0',
				selectedThemeName: isForSingleFile ? 'Note' : 'Obsidian Book',
				selectedThemeId: isForSingleFile ? '2' : '1',
			};
		});
	}

	/**
	 * 添加多语言内容
	 */
	addLanguageContent(folder: TFolder | null, file: TFile | null) {
		this.config.update(config => {
			// 检查是否有现有内容
			if (config.languageContents.length === 0) {
				new Notice(this.plugin.i18n.t('messages.please_use_publish_first'), 5000);
				return config;
			}

			const newContent: LanguageContent = {
				id: this.generateRandomId(),
				folder,
				file,
				languageCode: 'en', // 默认英语，用户可以后续修改
				weight: config.languageContents.length + 1
			};

			return {
				...config,
				languageContents: [...config.languageContents, newContent]
			};
		});

		new Notice(this.plugin.i18n.t('messages.language_added_successfully'), 3000);
	}

	/**
	 * 更新语言代码
	 */
	updateLanguageCode(contentId: string, newLanguageCode: string) {
		this.config.update(config => {
			const updatedContents = config.languageContents.map(content =>
				content.id === contentId 
					? { ...content, languageCode: newLanguageCode }
					: content
			);

			return {
				...config,
				languageContents: updatedContents,
				// 如果更新的是第一个内容，更新默认语言
				defaultContentLanguage: updatedContents.length > 0 
					? updatedContents[0].languageCode 
					: 'en'
			};
		});
	}

	/**
	 * 移除语言内容
	 */
	removeLanguageContent(contentId: string) {
		this.config.update(config => {
			const filteredContents = config.languageContents.filter(content => content.id !== contentId);
			
			// 重新分配权重
			const reweightedContents = filteredContents.map((content, index) => ({
				...content,
				weight: index + 1
			}));

			return {
				...config,
				languageContents: reweightedContents,
				// 更新默认语言
				defaultContentLanguage: reweightedContents.length > 0 
					? reweightedContents[0].languageCode 
					: 'en'
			};
		});
	}

	/**
	 * 更新站点名称
	 */
	updateSiteName(siteName: string) {
		this.config.update(config => ({
			...config,
			siteName
		}));
	}

	/**
	 * 更新站点路径
	 */
	updateSitePath(sitePath: string) {
		// 规范化路径
		let normalizedPath = sitePath;
		if (!normalizedPath.startsWith('/')) {
			normalizedPath = '/' + normalizedPath;
		}
		if (normalizedPath.length > 1 && normalizedPath.endsWith('/')) {
			normalizedPath = normalizedPath.slice(0, -1);
		}

		this.config.update(config => ({
			...config,
			sitePath: normalizedPath
		}));
	}

	/**
	 * 更新主题
	 */
	updateTheme(themeUrl: string, themeName?: string, themeId?: string) {
		this.config.update(config => ({
			...config,
			selectedThemeDownloadUrl: themeUrl,
			selectedThemeName: themeName || config.selectedThemeName,
			selectedThemeId: themeId || config.selectedThemeId
		}));
	}

	/**
	 * 更新高级设置
	 */
	updateAdvancedSettings(settings: {
		googleAnalyticsId?: string;
		disqusShortname?: string;
	}) {
		this.config.update(config => ({
			...config,
			...settings
		}));
	}

	/**
	 * 检查是否有内容
	 */
	hasContent(): boolean {
		let hasContent = false;
		this.config.subscribe(config => {
			hasContent = config.languageContents.length > 0;
		})();
		return hasContent;
	}

	/**
	 * 获取当前配置（同步方式）
	 */
	getCurrentConfig(): SiteConfig {
		let currentConfig: SiteConfig;
		this.config.subscribe(config => {
			currentConfig = config;
		})();
		return currentConfig!;
	}

	/**
	 * 重置配置
	 */
	reset() {
		this.config.update(config => ({
			...config,
			siteName: '',
			languageContents: [],
			defaultContentLanguage: 'en',
			googleAnalyticsId: '',
			disqusShortname: '',
			isForSingleFile: false
		}));
	}
}
