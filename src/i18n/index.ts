/**
 * I18n module entry point
 * Provides internationalization support for the Friday plugin
 */

// Export types
export type { 
	LanguageCode, 
	LanguageInfo, 
	TranslationNamespace, 
	TranslationFunction, 
	II18nService 
} from './types';

// Export service
export { I18nService } from './service';

// Export utilities
export { 
	AVAILABLE_LANGUAGES, 
	DEFAULT_LANGUAGE, 
	detectLanguage, 
	normalizeLanguageCode, 
	isValidLanguageCode, 
	getLanguageInfo, 
	formatLanguageDisplayName,
	interpolateTemplate,
	getNestedValue
} from './utils';

// Export translations
export { en } from './locales/en';
export { zhCn } from './locales/zh-cn';
