/**
 * Friday Wiki Runtime - 核心适配器
 * 实现 ChatRuntime 接口，连接 Chat UI 和 Wiki Service
 */

import type { ChatRuntime, StreamChunk, PreparedChatTurn, ChatTurnRequest } from './core/runtime/ChatRuntime';
import type { ChatMessage } from './core/types/chat';
import type { RuntimeCapabilities } from './core/runtime/types';
import { WikiService } from '../services/wiki';
import { parseFolderPath } from './ChatCommands';
import type FridayPlugin from '../main';
import { VIEW_TYPE_FRIDAY_CHAT } from '../main';
import * as path from 'path';

export { VIEW_TYPE_FRIDAY_CHAT };

export class FridayWikiRuntime implements ChatRuntime {
	readonly providerId = 'friday-wiki';
	
	private wikiService: WikiService;
	private currentFolderPath: string | null = null;
	
	constructor(private plugin: FridayPlugin) {
		this.wikiService = new WikiService(plugin);
	}
	
	private t(key: string, params?: Record<string, any>): string {
		return this.plugin.i18n.t(`chat.${key}`, params);
	}

	/**
	 * 核心：流式查询方法
	 */
	async *query(
		turn: PreparedChatTurn,
		conversationHistory: ChatMessage[] = []
	): AsyncGenerator<StreamChunk> {
		const text = turn.request.text.trim();
		
		try {
			// 命令路由
			if (text.startsWith('/wiki ')) {
				yield* this.handleWikiIngest(text.slice(6));
			} else if (text.startsWith('/publish')) {
				yield* this.handlePublish();
			} else if (text.startsWith('/save')) {
				const title = text.slice(5).trim();
				yield* this.handleSaveConversation(title, conversationHistory);
			} else if (text.startsWith('/ask ')) {
				yield* this.handleWikiQuery(text.slice(5), conversationHistory);
			} else if (text.startsWith('/')) {
				yield {
					type: 'text',
					content: this.t('unknown_cmd', { cmd: text.split(' ')[0] }),
				};
			} else {
				yield* this.handleWikiQuery(text, conversationHistory);
			}
		} catch (error) {
			yield {
				type: 'text',
				content: `\n\n❌ **Error**: ${error.message}`,
			};
		}
	}
	
	/**
	 * /wiki @folder - Ingest
	 */
	private async *handleWikiIngest(args: string): AsyncGenerator<StreamChunk> {
		const folderPath = parseFolderPath(args);
		
		if (!folderPath) {
			yield { type: 'text', content: this.t('ingest_no_folder') };
			return;
		}
		
		this.currentFolderPath = folderPath;
		
		yield { type: 'text', content: this.t('ingest_starting', { folder: folderPath }) };
		
		const toolId = `ingest-${Date.now()}`;
		yield { type: 'tool_call_start', id: toolId, name: 'wiki_ingest', input: { folderPath } };
		
		try {
			yield { type: 'tool_call_delta', id: toolId, delta: this.t('ingest_init_workspace') };
			await this.ensureWorkspaceInitialized();
			
			yield { type: 'tool_call_delta', id: toolId, delta: this.t('ingest_configure_llm', { provider: this.plugin.settings.aiProviderType || '?' }) };
			await this.configureLLM();
			
			yield { type: 'tool_call_delta', id: toolId, delta: this.t('ingest_get_project') };
			const projectName = await this.plugin.getOrCreateProjectForFolder(folderPath);
			yield { type: 'tool_call_delta', id: toolId, delta: `Project: ${projectName}` };
			
			yield { type: 'tool_call_delta', id: toolId, delta: this.t('ingest_processing') };
			
			const keyProgress: string[] = [];
			const result = await this.wikiService.ingest(projectName, (event) => {
				if (event.type === 'ingest:file:complete') {
					const progressText = event.progress
						? ` [${event.progress.current}/${event.progress.total}]`
						: '';
					keyProgress.push(`✓ File processed${progressText}`);
				} else if (event.type === 'ingest:pages:complete') {
					keyProgress.push(`✓ Generated ${event.metadata?.pageCount || 0} wiki pages`);
				}
				const progressText = event.progress
					? ` [${event.progress.current}/${event.progress.total}] (${event.progress.percentage}%)`
					: '';
				console.log(`[${event.type}] ${event.message}${progressText}`);
			});
			
			for (const line of keyProgress) {
				yield { type: 'tool_call_delta', id: toolId, delta: line };
			}
			
			const resultLines = [
				`Entities: ${result.extractedEntities}`,
				`Concepts: ${result.extractedConcepts}`,
				`Connections: ${result.extractedConnections}`,
				result.pagesGenerated ? `Pages generated: ${result.pagesGenerated}` : '',
				`Total knowledge items: ${result.extractedEntities + result.extractedConcepts}`,
			].filter(Boolean);
			
			yield { type: 'tool_call_result', id: toolId, result: resultLines.join('\n') };
			yield { type: 'text', content: this.t('ingest_ready') };
			
		} catch (error) {
			yield {
				type: 'tool_call_result',
				id: toolId,
				result: `Error: ${(error as Error).message}`,
				isError: true,
			};
		}
	}
	
	/**
	 * 直接输入 - Query
	 */
	private async *handleWikiQuery(
		question: string,
		history: ChatMessage[]
	): AsyncGenerator<StreamChunk> {
		if (!this.currentFolderPath) {
			yield { type: 'text', content: this.t('query_no_wiki') };
			return;
		}
		
		const toolId = `query-${Date.now()}`;
		yield { type: 'tool_call_start', id: toolId, name: 'wiki_query', input: { question } };
		yield { type: 'tool_call_delta', id: toolId, delta: this.t('query_searching') };
		
		try {
			const projectName = await this.plugin.getOrCreateProjectForFolder(this.currentFolderPath);

			yield { type: 'tool_call_delta', id: toolId, delta: this.t('query_querying') };

			// Stream LLM answer as `text` chunks so the View renders them as Markdown.
			// We do NOT close the tool block yet — the spinner keeps running.
			for await (const chunk of this.wikiService.queryStream(projectName, question, (event) => {
				console.log(`[${event.type}] ${event.message}`);
			})) {
				yield { type: 'text', content: chunk };
			}

			// Only now close the tool block with ✓ — after all text has streamed
			yield { type: 'tool_call_result', id: toolId, result: 'Done' };

		} catch (error) {
			yield {
				type: 'tool_call_result',
				id: toolId,
				result: `Query error: ${(error as Error).message}`,
				isError: true,
			};
		}
	}
	
	/**
	 * /save - 保存对话
	 */
	private async *handleSaveConversation(
		title: string,
		history: ChatMessage[]
	): AsyncGenerator<StreamChunk> {
		if (!this.currentFolderPath) {
			yield { type: 'text', content: this.t('save_no_wiki') };
			return;
		}
		
		const conversationTitle = title || 'Untitled Conversation';
		yield { type: 'text', content: this.t('save_saving', { title: conversationTitle }) };
		
		try {
			const projectName = await this.plugin.getOrCreateProjectForFolder(this.currentFolderPath);
			const conversationHistory = this.convertToWikiFormat(history);
			
			const result = await this.wikiService.saveConversation(
				projectName,
				conversationTitle,
				conversationHistory
			);
			
			yield {
				type: 'text',
				content: this.t('save_complete', { file: path.basename(result.savedPath) }),
			};
			
		} catch (error) {
			yield {
				type: 'text',
				content: `❌ **Save error**: ${error.message}`,
			};
		}
	}
	
	/**
	 * /publish - 发布（复用现有逻辑）
	 */
	private async *handlePublish(): AsyncGenerator<StreamChunk> {
		if (!this.currentFolderPath) {
			yield { type: 'text', content: this.t('publish_no_wiki') };
			return;
		}
		
		yield { type: 'text', content: this.t('publish_starting') };
		
		const toolId = `publish-${Date.now()}`;
		yield { type: 'tool_call_start', id: toolId, name: 'wiki_publish', input: { folderPath: this.currentFolderPath } };
		
		try {
			const result = await this.plugin.publishFolder(this.currentFolderPath, {
				onProgress: (_progress) => {},
			});
			
			if (result.success) {
				yield {
					type: 'tool_call_result',
					id: toolId,
					result: `✅ **Published successfully!**\n\n🔗 ${result.url}`,
				};
				yield { type: 'text', content: this.t('publish_live') };
			}
			
		} catch (error) {
			yield {
				type: 'tool_call_result',
				id: toolId,
				result: `❌ **Publish error**: ${error.message}`,
			};
		}
	}
	
	/**
	 * 辅助方法：确保工作空间已初始化
	 */
	private async ensureWorkspaceInitialized(): Promise<void> {
		// 直接使用 plugin 的 workspaceService
		if (!this.plugin.workspaceService) {
			throw new Error('Workspace service not initialized');
		}
		
		const existsResult = await this.plugin.workspaceService.workspaceExists(this.plugin.absWorkspacePath);
		
		if (existsResult.success && !existsResult.data) {
			// Workspace doesn't exist, initialize it
			const initResult = await this.plugin.workspaceService.initWorkspace(this.plugin.absWorkspacePath);
			
			if (!initResult.success) {
				throw new Error(`Failed to initialize workspace: ${initResult.error}`);
			}
		} else if (!existsResult.success) {
			throw new Error(`Failed to check workspace existence: ${existsResult.error}`);
		}
	}
	
	/**
	 * 辅助方法：配置 LLM
	 * 
	 * 从 plugin.settings 读取用户配置的 AI Provider，写入 foundry global config。
	 * 如果用户尚未配置，则抛出错误提示用户先完成配置。
	 */
	private async configureLLM(): Promise<void> {
		if (!this.plugin.foundryGlobalConfigService) {
			throw new Error('Global config service not initialized');
		}

		const { aiProviderType, aiProviderBaseUrl, aiProviderApiKey, aiProviderModel } = this.plugin.settings;

		if (!aiProviderType) {
			throw new Error('AI provider not configured. Please open Settings → AI Provider Settings to configure an AI model.');
		}

		// Cloud providers require an API key
		const cloudProviders = ['openai', 'glm', 'deepseek', 'moonshot'];
		if (cloudProviders.includes(aiProviderType) && !aiProviderApiKey) {
			throw new Error(`${aiProviderType} requires an API key. Please configure it in Settings → AI Provider Settings.`);
		}

		// Build the LLM config (compatible with LLMServiceConfig + wiki adapter field names)
		const llmConfig: Record<string, any> = {
			type: aiProviderType,
			baseURL: aiProviderBaseUrl,
			model: aiProviderModel,
			defaultModel: aiProviderModel,
			maxTokens: 32768,
		};
		if (aiProviderApiKey) {
			llmConfig.apiKey = aiProviderApiKey;
		}

		await this.plugin.foundryGlobalConfigService.set(this.plugin.absWorkspacePath, 'llm', llmConfig);

		// Configure embedding — activated when a provider type is selected
		const { aiEmbeddingType, aiEmbeddingBaseUrl, aiEmbeddingApiKey, aiEmbeddingModel } = this.plugin.settings;
		if (aiEmbeddingType && aiEmbeddingType !== 'none') {
			const embeddingConfig: Record<string, any> = {
				type: aiEmbeddingType,
				baseURL: aiEmbeddingBaseUrl,
				model: aiEmbeddingModel,
			};
			if (aiEmbeddingApiKey) {
				embeddingConfig.apiKey = aiEmbeddingApiKey;
			}
			await this.plugin.foundryGlobalConfigService.set(this.plugin.absWorkspacePath, 'llm.embedding', embeddingConfig);
		}

		// Output language — use user setting, auto-detect from Obsidian language if not set
		await this.plugin.foundryGlobalConfigService.set(
			this.plugin.absWorkspacePath,
			'wiki.outputLanguage',
			this.plugin.resolveOutputLanguage()
		);
	}
	
	/**
	 * 辅助方法：转换对话格式
	 * ✅ 过滤掉命令消息（/wiki, /publish, /save 等）
	 */
	private convertToWikiFormat(history: ChatMessage[]): Array<{ question: string; answer: string }> {
		const result: Array<{ question: string; answer: string }> = [];
		
		for (let i = 0; i < history.length; i += 2) {
			const user = history[i];
			const assistant = history[i + 1];
			
			if (user?.role === 'user' && assistant?.role === 'assistant') {
				// ✅ 过滤掉命令消息
				const userText = user.content.trim();
				if (userText.startsWith('/wiki') || 
				    userText.startsWith('/publish') || 
				    userText.startsWith('/save')) {
					continue; // 跳过命令消息
				}
				
				result.push({
					question: user.content,
					answer: assistant.content,
				});
			}
		}
		
		return result;
	}
	
	// ========== ChatRuntime 接口必需方法 ==========
	
	getCapabilities(): RuntimeCapabilities {
		return {
			providerId: 'friday-wiki',
			supportsPersistentRuntime: true,
			supportsNativeHistory: true,
			supportsPlanMode: false,
			supportsRewind: false,
			supportsFork: false,
			supportsProviderCommands: false,
			supportsImageAttachments: false,
			supportsInstructionMode: false,
			supportsMcpTools: false,
			reasoningControl: 'none' as const,
		};
	}
	
	prepareTurn(request: ChatTurnRequest): PreparedChatTurn {
		return {
			persistedContent: request.text,
			request,
			isCompact: false,
		};
	}
	
	cancel(): void {
		// 可以添加取消逻辑
	}
	
	resetSession(): void {
		this.currentFolderPath = null;
	}
	
	getSessionId(): string | null {
		return this.currentFolderPath;
	}
	
	isReady(): boolean {
		return true;
	}
	
	cleanup(): void {}
	
	consumeSessionInvalidation(): boolean {
		return false;
	}
	
	onReadyStateChange() {
		return () => {};
	}
	
	setResumeCheckpoint() {}
	syncConversationState() {}
	reloadMcpServers() { return Promise.resolve(); }
	ensureReady() { return Promise.resolve(true); }
	consumeTurnMetadata() {
		return {
			userMessageId: undefined,
			assistantMessageId: undefined,
			wasSent: false,
			planCompleted: false,
		};
	}
	
	setApprovalCallback() {}
	setApprovalDismisser() {}
	setAskUserQuestionCallback() {}
	setExitPlanModeCallback() {}
	setPermissionModeSyncCallback() {}
	setSubagentHookProvider() {}
	setAutoTurnCallback() {}
	
	buildSessionUpdates() {
		return {
			created: [],
			resumed: [],
			invalidated: [],
		};
	}
	
	resolveSessionIdForFork() {
		return null;
	}
	
	async rewind() {
		throw new Error('Rewind not supported');
	}
}
