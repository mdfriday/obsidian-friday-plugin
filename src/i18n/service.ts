import type { App } from 'obsidian';
import type { LanguageCode, LanguageInfo, TranslationNamespace, TranslationFunction, II18nService } from './types';
import { 
	detectLanguage, 
	AVAILABLE_LANGUAGES, 
	DEFAULT_LANGUAGE, 
	interpolateTemplate, 
	getNestedValue 
} from './utils';
import { en } from './locales/en';
import { zhCn } from './locales/zh-cn';
import type FridayPlugin from '../main';
import { setLang as setSyncLang, type I18N_LANGS } from '../sync/core/common/i18n';

/**
 * Map main i18n language codes to sync module language codes
 * Main i18n uses: 'en', 'zh-cn', 'es', 'fr', 'de', 'ja', 'ko', 'pt'
 * Sync module uses: 'def', 'zh', 'es', 'de', 'ja', 'ko', 'ru', 'zh-tw'
 */
function mapToSyncLang(lang: LanguageCode): I18N_LANGS {
	const mapping: Record<string, I18N_LANGS> = {
		'en': 'def',
		'zh-cn': 'zh',
		'es': 'es',
		'de': 'de',
		'ja': 'ja',
		'ko': 'ko',
		'fr': 'def', // No French in sync module, fallback to default
		'pt': 'def', // No Portuguese in sync module, fallback to default
	};
	return mapping[lang] || 'def';
}

/**
 * I18n Service - Handles internationalization for the Friday plugin
 */
export class I18nService implements II18nService {
	private app: App;
	private plugin: FridayPlugin;
	private currentLanguage: LanguageCode = DEFAULT_LANGUAGE;
	private translations: Record<LanguageCode, TranslationNamespace> = {
		'en': en,
		'zh-cn': zhCn,
		// For languages without translations, fallback to English
		'es': en,
		'fr': en,
		'de': en,
		'ja': en,
		'ko': en,
		'pt': en,
	};
	private ready: boolean = false;

	constructor(plugin: FridayPlugin) {
		this.plugin = plugin;
		this.app = plugin.app;
	}

	/**
	 * Initialize the i18n service
	 */
	async init(): Promise<void> {
		try {
			// Detect and set initial language based on system settings only
			const detectedLanguage = detectLanguage(this.app);
			this.setLanguageInternal(detectedLanguage);
			this.ready = true;
		} catch (error) {
			console.error('Failed to initialize i18n service:', error);
			// Fallback to default language
			this.currentLanguage = DEFAULT_LANGUAGE;
			this.ready = true;
		}
	}

	/**
	 * Get current language
	 */
	getCurrentLanguage(): LanguageCode {
		return this.currentLanguage;
	}

	/**
	 * Set current language (internal method)
	 */
	private setLanguageInternal(language: LanguageCode): void {
		if (!this.translations[language]) {
			console.warn(`Language '${language}' not supported, falling back to '${DEFAULT_LANGUAGE}'`);
			language = DEFAULT_LANGUAGE;
		}

		this.currentLanguage = language;

		// Also set language for sync module's i18n
		const syncLang = mapToSyncLang(language);
		setSyncLang(syncLang);

		// Emit language change event for reactive components
		this.plugin.app.workspace.trigger('friday:language-changed', language);
	}

	/**
	 * Set current language (for manual language switching, if needed in future)
	 */
	async setLanguage(language: LanguageCode): Promise<void> {
		this.setLanguageInternal(language);
	}

	/**
	 * Get available languages
	 */
	getAvailableLanguages(): LanguageInfo[] {
		return [...AVAILABLE_LANGUAGES];
	}

	/**
	 * Translation function with parameter interpolation support
	 */
	t: TranslationFunction = (key: string, params?: Record<string, any>): string => {
		if (!this.ready) {
			console.warn('I18n service not ready, returning key:', key);
			return key;
		}

		const currentTranslations = this.translations[this.currentLanguage];
		if (!currentTranslations) {
			console.warn(`No translations found for language '${this.currentLanguage}'`);
			return key;
		}

		// Get nested translation value
		const translation = getNestedValue(currentTranslations, key);
		
		if (translation === undefined) {
			// Try fallback to English if current language is not English
			if (this.currentLanguage !== 'en') {
				const fallbackTranslation = getNestedValue(this.translations['en'], key);
				if (fallbackTranslation !== undefined) {
					console.warn(`Missing translation for key '${key}' in '${this.currentLanguage}', using English fallback`);
					return interpolateTemplate(fallbackTranslation, params);
				}
			}
			
			console.warn(`Missing translation for key '${key}' in '${this.currentLanguage}'`);
			return key; // Return key as fallback
		}

		if (typeof translation !== 'string') {
			console.warn(`Translation for key '${key}' is not a string:`, translation);
			return key;
		}

		return interpolateTemplate(translation, params);
	};

	/**
	 * Check if service is ready
	 */
	isReady(): boolean {
		return this.ready;
	}

	/**
	 * Get translation for a specific language (useful for language switching preview)
	 */
	getTranslationForLanguage(key: string, language: LanguageCode, params?: Record<string, any>): string {
		const translations = this.translations[language];
		if (!translations) {
			return key;
		}

		const translation = getNestedValue(translations, key);
		if (translation === undefined || typeof translation !== 'string') {
			return key;
		}

		return interpolateTemplate(translation, params);
	}



	/**
	 * Reload translations (useful for development)
	 */
	async reload(): Promise<void> {
		this.ready = false;
		await this.init();
	}

	/**
	 * Get formatted language name for display
	 */
	getLanguageDisplayName(code?: LanguageCode): string {
		const targetCode = code || this.currentLanguage;
		const info = AVAILABLE_LANGUAGES.find(lang => lang.code === targetCode);
		return info ? (info.nativeName === info.name ? info.name : `${info.name} (${info.nativeName})`) : targetCode;
	}

	/**
	 * Check if a translation key exists
	 */
	hasTranslation(key: string, language?: LanguageCode): boolean {
		const targetLanguage = language || this.currentLanguage;
		const translations = this.translations[targetLanguage];
		if (!translations) return false;

		const translation = getNestedValue(translations, key);
		return translation !== undefined && typeof translation === 'string';
	}
}
