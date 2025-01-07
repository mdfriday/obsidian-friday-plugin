export const FM_FRIDAY_PLUGIN = 'friday-plugin';
export const FM_SITE_ID = 'site';
export const FM_CONTENT = 'content';
export const FM_CONTENT_EMPTY = 'empty';
export const FM_THEME = 'theme';
export const FM_DEFAULT_THEME = 'github.com/mdfriday/theme-long-teng';
export const FM_MENU = 'menu';
export const FM_DEFAULT_LANGUAGE = 'defaultLanguage';
export const FM_GA = 'ga';
export const FM_EMPTY_GA = 'GT-XXXXXXXXX';

const basicFrontMatter = [
	'---',
	'', `${FM_FRIDAY_PLUGIN}: enabled`, '',
	'', `${FM_SITE_ID}: '0'`, '',
	'', `${FM_THEME}: ${FM_DEFAULT_THEME}`, '',
	'', `${FM_CONTENT}: ${FM_CONTENT_EMPTY}`, '',
	'', `${FM_DEFAULT_LANGUAGE}: en`, '',
	'', `${FM_GA}: ${FM_EMPTY_GA}`, '',
	'---',
	'', ''].join(
	'\n'
);

export function getDefaultFrontMatter(): string {
	return basicFrontMatter
}
