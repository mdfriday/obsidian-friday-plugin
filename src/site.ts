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

/**
 * Site 类 - 管理多语言内容选择
 */
export class Site {
	app: App;
	plugin: FridayPlugin;

	// Svelte store for reactive data
	public languageContents: Writable<LanguageContent[]>;

	constructor(plugin: FridayPlugin) {
		this.plugin = plugin;
		this.app = this.plugin.app;

		// 初始化多语言内容数组
		this.languageContents = writable([]);
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
		this.languageContents.update(contents => {
			// 如果已经有内容，不重复初始化
			if (contents.length > 0) {
				return contents;
			}

			const initialContent: LanguageContent = {
				id: this.generateRandomId(),
				folder,
				file,
				languageCode: 'en', // 默认英语
				weight: 1
			};

			return [initialContent];
		});
	}

	/**
	 * 添加多语言内容
	 */
	addLanguageContent(folder: TFolder | null, file: TFile | null): boolean {
		let canAdd = false;
		let currentContents: LanguageContent[] = [];

		// 获取当前内容
		this.languageContents.subscribe(contents => {
			currentContents = contents;
		})();

		// 检查是否有现有内容
		if (currentContents.length === 0) {
			new Notice(this.plugin.i18n.t('messages.please_use_publish_first'), 5000);
			return false;
		}

		// 检查类型一致性
		const firstContent = currentContents[0];
		const isFirstFolder = !!firstContent.folder;
		const isNewFolder = !!folder;

		if (isFirstFolder !== isNewFolder) {
			const errorMessage = isFirstFolder 
				? this.plugin.i18n.t('messages.must_select_folder_type')
				: this.plugin.i18n.t('messages.must_select_file_type');
			new Notice(errorMessage, 5000);
			return false;
		}

		this.languageContents.update(contents => {
			const newContent: LanguageContent = {
				id: this.generateRandomId(),
				folder,
				file,
				languageCode: 'en', // 默认英语，用户可以后续修改
				weight: contents.length + 1
			};

			canAdd = true;
			return [...contents, newContent];
		});

		if (canAdd) {
			new Notice(this.plugin.i18n.t('messages.language_added_successfully'), 3000);
		}

		return canAdd;
	}

	/**
	 * 更新语言代码
	 */
	updateLanguageCode(contentId: string, newLanguageCode: string) {
		this.languageContents.update(contents => {
			return contents.map(content =>
				content.id === contentId 
					? { ...content, languageCode: newLanguageCode }
					: content
			);
		});
	}

	/**
	 * 移除语言内容
	 */
	removeLanguageContent(contentId: string) {
		this.languageContents.update(contents => {
			const filteredContents = contents.filter(content => content.id !== contentId);
			
			// 重新分配权重
			return filteredContents.map((content, index) => ({
				...content,
				weight: index + 1
			}));
		});
	}

	/**
	 * 清空所有内容
	 */
	clearAllContent() {
		this.languageContents.set([]);
		new Notice(this.plugin.i18n.t('messages.all_content_cleared'), 3000);
	}

	/**
	 * 检查是否有内容
	 */
	hasContent(): boolean {
		let hasContent = false;
		this.languageContents.subscribe(contents => {
			hasContent = contents.length > 0;
		})();
		return hasContent;
	}

	/**
	 * 获取当前内容（同步方式）
	 */
	getCurrentContents(): LanguageContent[] {
		let currentContents: LanguageContent[] = [];
		this.languageContents.subscribe(contents => {
			currentContents = contents;
		})();
		return currentContents;
	}

	/**
	 * 获取默认内容语言
	 */
	getDefaultContentLanguage(): string {
		const contents = this.getCurrentContents();
		return contents.length > 0 ? contents[0].languageCode : 'en';
	}

	/**
	 * 检查是否为单文件模式
	 */
	isForSingleFile(): boolean {
		const contents = this.getCurrentContents();
		return contents.length > 0 && !!contents[0].file;
	}
}
