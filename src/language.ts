const ltrLanguages = [
	// LTR 语言
	"zh", "en", "ja", "ko", "fr", "de", "es", "ru", "pt", "it", "nl", "hi", "th", "vi", "uk",
	"sv", "da", "fi", "no", "pl", "el", "cs", "tr", "id", "ms",
	"zh-CN", "zh-TW", "zh-HK",
	"en-US", "en-GB", "en-AU",
	"ja-JP", "ko-KR", "fr-FR", "fr-CA",
	"de-DE", "de-AT", "es-ES", "es-MX",
	"ru-RU", "pt-PT", "pt-BR", "it-IT", "nl-NL", "nl-BE",
	"hi-IN", "th-TH", "vi-VN", "uk-UA", "sv-SE", "da-DK", "fi-FI",
	"no-NO", "pl-PL", "el-GR", "cs-CZ", "tr-TR", "id-ID", "ms-MY",
];
const rtlLanguages = [
	// RTL 语言
	"ar", "ar-SA", "ar-AE", "ar-EG",
	"he", "he-IL",
	"fa", "fa-IR",
	"ur", "ur-PK", "ur-IN",
];

export const SUPPORTED_LANGUAGES = ltrLanguages.concat(rtlLanguages);

export function IsRtlLanguage(language: string): boolean {
	return rtlLanguages.includes(language);
}

export function IsLanguageSupported(language: string): boolean {
	return SUPPORTED_LANGUAGES.includes(language);
}
