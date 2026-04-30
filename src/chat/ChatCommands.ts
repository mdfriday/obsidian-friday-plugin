/**
 * Friday Chat Slash Commands
 */

export interface SlashCommand {
	id: string;
	name: string;
	description: string;
	syntax: string;
	example: string;
}

export const FRIDAY_CHAT_COMMANDS: SlashCommand[] = [
	{
		id: 'friday:wiki-ingest',
		name: '/wiki',
		description: '📚 Ingest folder into wiki',
		syntax: '/wiki @folder-name',
		example: '/wiki @MyNotes',
	},
	{
		id: 'friday:wiki-query',
		name: '/ask',
		description: '🔍 Query wiki (optional, direct input works too)',
		syntax: '/ask [question]',
		example: '/ask What is Domain-Driven Design?',
	},
	{
		id: 'friday:save-conversation',
		name: '/save',
		description: '💾 Save conversation',
		syntax: '/save [title]',
		example: '/save DDD Introduction',
	},
	{
		id: 'friday:publish-wiki',
		name: '/publish',
		description: '📤 Publish wiki to MDFriday',
		syntax: '/publish',
		example: '/publish',
	},
];

/**
 * Get command by name
 */
export function getCommandByName(name: string): SlashCommand | undefined {
	return FRIDAY_CHAT_COMMANDS.find(cmd => cmd.name === name);
}

/**
 * Parse folder path from @mention
 */
export function parseFolderPath(text: string): string | null {
	const match = text.match(/@([^\s]+)/);
	return match ? match[1] : null;
}
