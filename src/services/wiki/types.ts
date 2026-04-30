/**
 * Wiki Service Types
 */

export interface IngestResult {
	success: boolean;
	extractedEntities: number;
	extractedConcepts: number;
	extractedConnections: number;
	pagesGenerated?: number; // Foundry 自动生成的页面数量
}

export interface SaveResult {
	savedPath: string;
}

export interface ConversationTurn {
	question: string;
	answer: string;
}

export type ConversationHistory = ConversationTurn[];

export interface WikiServiceConfig {
	workspacePath: string;
	temperature?: number;
}
