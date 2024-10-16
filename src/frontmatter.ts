export const FM_FRIDAY_PLUGIN = 'friday-plugin';
export const FM_THEME = 'theme';
export const FM_DEFAULT_THEME = 'manual-of-me';

const basicFrontMatter = [
	'---',
	'', `${FM_FRIDAY_PLUGIN}: single`, '',
	'', `${FM_THEME}: ${FM_DEFAULT_THEME}`, '',
	'---',
	'', ''].join(
	'\n'
);

export function getDefaultFrontMatter(): string {
	return basicFrontMatter
}
