import type { LanguageCode, LanguageInfo } from './types';
import type { App } from 'obsidian';

/**
 * Available languages with display information
 */
export const AVAILABLE_LANGUAGES: LanguageInfo[] = [
	{
		code: 'en',
		name: 'English',
		nativeName: 'English',
	},
	{
		code: 'zh-cn',
		name: 'Chinese (Simplified)',
		nativeName: '简体中文',
	},
	{
		code: 'es',
		name: 'Spanish',
		nativeName: 'Español',
	},
	{
		code: 'fr',
		name: 'French',
		nativeName: 'Français',
	},
	{
		code: 'de',
		name: 'German',
		nativeName: 'Deutsch',
	},
	{
		code: 'ja',
		name: 'Japanese',
		nativeName: '日本語',
	},
	{
		code: 'ko',
		name: 'Korean',
		nativeName: '한국어',
	},
	{
		code: 'pt',
		name: 'Portuguese',
		nativeName: 'Português',
	},
];

/**
 * Default language
 */
export const DEFAULT_LANGUAGE: LanguageCode = 'en';

/**
 * Detect user's preferred language based on system sources
 * Priority: Obsidian setting > browser language > default
 */
export function detectLanguage(app: App): LanguageCode {
	// 1. Try to get Obsidian's language setting
	try {
		// @ts-ignore - Obsidian internal API
		let obsidianLang = app.vault?.config?.lang;
		
		// Try alternative paths if first method fails
		if (!obsidianLang) {
			// @ts-ignore - Obsidian internal API  
			obsidianLang = app.vault?.config?.language;
		}
		
		if (!obsidianLang && typeof window !== 'undefined' && (window as any).moment) {
			obsidianLang = (window as any).moment.locale();
		}
		
		if (!obsidianLang && document.documentElement.lang) {
			obsidianLang = document.documentElement.lang;
		}
		
		if (obsidianLang) {
			const normalized = normalizeLanguageCode(obsidianLang);
			if (normalized && isValidLanguageCode(normalized)) {
				return normalized as LanguageCode;
			}
		}
	} catch (error) {
		console.warn('Failed to get Obsidian language setting:', error);
	}

	// 2. Try browser language
	try {
		const browserLang = navigator.language || navigator.languages?.[0];
		if (browserLang) {
			const normalized = normalizeLanguageCode(browserLang);
			if (normalized && isValidLanguageCode(normalized)) {
				return normalized as LanguageCode;
			}
		}
	} catch (error) {
		console.warn('Failed to get browser language:', error);
	}

	// 3. Fallback to default
	return DEFAULT_LANGUAGE;
}

/**
 * Normalize language code to match our supported formats
 */
export function normalizeLanguageCode(langCode: string): string | null {
	if (!langCode) return null;

	const normalized = langCode.toLowerCase().replace(/[_]/g, '-');
	
	// Handle common variations
	const mappings: Record<string, string> = {
		// Chinese variants
		'zh': 'zh-cn',
		'zh-cn': 'zh-cn',
		'zh-hans': 'zh-cn',
		'zh-hans-cn': 'zh-cn',
		'zh-chs': 'zh-cn',
		'zh-simplified': 'zh-cn',
		'chinese': 'zh-cn',
		'chinese-simplified': 'zh-cn',
		
		// Traditional Chinese (future support)
		'zh-hant': 'zh-tw',
		'zh-tw': 'zh-tw',
		'zh-cht': 'zh-tw',
		'zh-traditional': 'zh-tw',
		'chinese-traditional': 'zh-tw',
		
		// English variants
		'en': 'en',
		'en-us': 'en',
		'en-gb': 'en',
		'en-au': 'en',
		'en-ca': 'en',
		'english': 'en',
		
		// Spanish variants
		'es': 'es',
		'es-es': 'es',
		'es-mx': 'es',
		'es-ar': 'es',
		'spanish': 'es',
		
		// French variants
		'fr': 'fr',
		'fr-fr': 'fr',
		'fr-ca': 'fr',
		'french': 'fr',
		
		// German variants
		'de': 'de',
		'de-de': 'de',
		'de-at': 'de',
		'de-ch': 'de',
		'german': 'de',
		
		// Japanese variants
		'ja': 'ja',
		'ja-jp': 'ja',
		'japanese': 'ja',
		
		// Korean variants
		'ko': 'ko',
		'ko-kr': 'ko',
		'korean': 'ko',
		
		// Portuguese variants
		'pt': 'pt',
		'pt-pt': 'pt',
		'pt-br': 'pt',
		'portuguese': 'pt',
	};

	// Check exact match first
	if (mappings[normalized]) {
		return mappings[normalized];
	}

	// Check prefix match (e.g., 'zh-hans-cn' -> 'zh-cn')
	for (const [key, value] of Object.entries(mappings)) {
		if (normalized.startsWith(key + '-') || normalized.startsWith(key + '_')) {
			return value;
		}
	}

	return null;
}

/**
 * Check if a language code is supported
 */
export function isValidLanguageCode(code: string): boolean {
	return AVAILABLE_LANGUAGES.some(lang => lang.code === code);
}

/**
 * Get language info by code
 */
export function getLanguageInfo(code: LanguageCode): LanguageInfo | undefined {
	return AVAILABLE_LANGUAGES.find(lang => lang.code === code);
}

/**
 * Simple template replacement for translations with parameters
 * Supports {{param}} syntax
 */
export function interpolateTemplate(template: string, params?: Record<string, any>): string {
	if (!params) return template;

	return template.replace(/\{\{(\w+)\}\}/g, (match, key) => {
		return params[key] !== undefined ? String(params[key]) : match;
	});
}

/**
 * Get nested translation value by dot-notation key
 */
export function getNestedValue(obj: any, path: string): any {
	return path.split('.').reduce((current, key) => {
		return current && current[key] !== undefined ? current[key] : undefined;
	}, obj);
}

/**
 * Format language display name for UI
 */
export function formatLanguageDisplayName(info: LanguageInfo): string {
	return info.nativeName === info.name ? info.name : `${info.name} (${info.nativeName})`;
}
