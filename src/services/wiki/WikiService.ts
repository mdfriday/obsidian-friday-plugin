/**
 * Wiki Service - Foundry Wiki Service 封装
 * 只封装 Wiki 特有的 3 个方法
 */

import { createObsidianWikiService } from '@mdfriday/foundry';
import { createObsidianLLMHttpClient } from '../../http';
import type FridayPlugin from '../../main';
import type { IngestResult, SaveResult, ConversationHistory } from './types';

export class WikiService {
	private wikiService;
	private workspacePath: string;
	
	constructor(private plugin: FridayPlugin) {
		// 使用 plugin 的 absWorkspacePath，而不是 vault 根目录
		this.workspacePath = plugin.absWorkspacePath;
		
		// ✅ 创建 Obsidian-safe LLM HttpClient 并传入
		// 使用 Node.js http/https 模块绕过 CORS 限制
		const llmHttpClient = createObsidianLLMHttpClient();
		this.wikiService = createObsidianWikiService(llmHttpClient);
	}
	
	/**
	 * Ingest 文件夹到 Wiki
	 * 
	 * 注意：Foundry ingest 方法会自动生成 Wiki 页面，无需手动调用 generatePages
	 */
	async ingest(
		projectName: string,
		onProgress?: (event: any) => void
	): Promise<IngestResult> {
		const result = await this.wikiService.ingest({
			workspacePath: this.workspacePath,
			projectName,
			temperature: 0.3,
			onProgress, // ✅ 传递 progress callback
		});
		
		if (!result.success || !result.data) {
			throw new Error(`Ingest failed: ${result.error}`);
		}
		
		return {
			success: true,
			extractedEntities: result.data.extractedEntities || 0,
			extractedConcepts: result.data.extractedConcepts || 0,
			extractedConnections: result.data.extractedConnections || 0,
			pagesGenerated: result.data.pagesGenerated || 0,
		};
	}
	
	/**
	 * 查询 Wiki（流式）
	 */
	async *queryStream(
		projectName: string,
		question: string,
		onProgress?: (event: any) => void
	): AsyncGenerator<string> {
		for await (const chunk of this.wikiService.queryStream({
			workspacePath: this.workspacePath,
			projectName,
			question,
			onProgress, // ✅ 传递 progress callback
		})) {
			yield chunk;
		}
	}
	
	/**
	 * 保存对话历史
	 */
	async saveConversation(
		projectName: string,
		title: string,
		conversationHistory: ConversationHistory
	): Promise<SaveResult> {
		const result = await this.wikiService.saveConversation({
			workspacePath: this.workspacePath,
			projectName,
			title,
			topic: 'General',
			conversationHistory,
			filename: this.generateFilename(title),
		});
		
		if (!result.success || !result.data) {
			throw new Error(`Save conversation failed: ${result.error}`);
		}
		
		return {
			savedPath: result.data.savedPath || '',
		};
	}
	
	/**
	 * 生成文件名
	 */
	private generateFilename(title: string): string {
		const date = new Date().toISOString().split('T')[0];
		const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-');
		return `${date}-${slug}.md`;
	}
}
