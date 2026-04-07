/**
 * 主题相关的类型和常量
 */

/**
 * 默认主题配置
 */
export const DEFAULT_THEMES = {
	NOTE: {
		id: 2,
		name: 'Note',
		downloadUrl: 'https://gohugo.net/note.zip?version=1.2',
		tags: ['obsidian']
	},
	QUARTZ: {
		id: 17,
		name: 'Quartz',
		downloadUrl: 'https://gohugo.net/quartz-theme.zip?version=1.2',
		tags: []
	}
} as const;

/**
 * 检查主题是否支持 Obsidian 内部渲染器
 * 通过检查主题的 tags 是否包含 'obsidian'
 * 
 * @param themeTags - 主题的标签数组
 * @returns 是否使用内部渲染器
 */
export function shouldUseInternalRenderer(themeTags: string[] = []): boolean {
	return !themeTags.includes('obsidian');
}

/**
 * 根据项目类型获取默认主题
 * 
 * @param isFolder - 是否为文件夹项目
 * @returns 默认主题配置
 */
export function getDefaultTheme(isFolder: boolean) {
	return isFolder ? DEFAULT_THEMES.QUARTZ : DEFAULT_THEMES.NOTE;
}
