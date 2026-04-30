/**
 * Friday Chat View - 简化版本
 * 专为 Wiki Chat 设计，移除了 Claudian 的复杂依赖
 */

import type { WorkspaceLeaf } from 'obsidian';
import { ItemView, Notice } from 'obsidian';
import { FridayWikiRuntime } from './ChatRuntime';
import type FridayPlugin from '../main';
import { VIEW_TYPE_FRIDAY_CHAT } from '../main';

export { VIEW_TYPE_FRIDAY_CHAT };

export class ChatView extends ItemView {
	private plugin: FridayPlugin;
	private runtime: FridayWikiRuntime | null = null;
	private messagesEl: HTMLElement | null = null;
	private inputEl: HTMLTextAreaElement | null = null;
	private conversationHistory: Array<{ role: 'user' | 'assistant'; content: string }> = [];
	
	constructor(leaf: WorkspaceLeaf, plugin: FridayPlugin) {
		super(leaf);
		this.plugin = plugin;
	}
	
	getViewType(): string {
		return VIEW_TYPE_FRIDAY_CHAT;
	}
	
	getDisplayText(): string {
		return 'Friday Chat (Beta)';
	}
	
	getIcon(): string {
		return 'message-square';
	}
	
	async onOpen(): Promise<void> {
		const container = this.containerEl.children[1];
		container.empty();
		container.addClass('friday-chat-view');
		
		// 初始化 Runtime
		this.runtime = new FridayWikiRuntime(this.plugin);
		
		// 创建 Header
		const headerEl = container.createDiv({ cls: 'friday-chat-header' });
		
		// 标题
		headerEl.createDiv({ cls: 'friday-chat-title', text: '🤖 Friday Wiki Chat' });
		
		// 切换按钮
		const switchBtn = headerEl.createEl('button', {
			cls: 'friday-chat-switch-btn',
			text: '⚙️ Manual Mode'
		});
		switchBtn.addEventListener('click', () => {
			this.switchToManualMode();
		});
		
		// 消息区域
		this.messagesEl = container.createDiv({ cls: 'friday-chat-messages' });
		
		// 显示欢迎消息
		this.appendWelcomeMessage();
		
		// 输入区域
		const inputContainerEl = container.createDiv({ cls: 'friday-chat-input-container' });
		
		this.inputEl = inputContainerEl.createEl('textarea', {
			cls: 'friday-chat-input',
			attr: {
				placeholder: 'Type /wiki @folder to start, or ask a question...',
				rows: '3'
			}
		});
		
		const sendBtn = inputContainerEl.createEl('button', {
			cls: 'friday-chat-send-btn',
			text: 'Send'
		});
		
		// 事件处理
		sendBtn.addEventListener('click', () => this.handleSend());
		this.inputEl.addEventListener('keydown', (e) => {
			if (e.key === 'Enter' && !e.shiftKey) {
				e.preventDefault();
				this.handleSend();
			}
		});
	}
	
	async onClose(): Promise<void> {
		if (this.runtime) {
			this.runtime.cleanup();
		}
	}
	
	/**
	 * 显示欢迎消息
	 */
	private appendWelcomeMessage(): void {
		if (!this.messagesEl) return;
		
		const messageEl = this.messagesEl.createDiv({ cls: 'friday-chat-message assistant' });
		messageEl.createDiv({
			cls: 'friday-chat-message-content',
			text: `👋 Welcome to Friday Wiki Chat!

Get started:
• Type /wiki @your-folder to create a wiki
• Ask questions about your content
• Save conversations with /save [title]
• Publish with /publish

Type / to see all commands.`
		});
		
		this.scrollToBottom();
	}
	
	/**
	 * 处理发送消息
	 */
	private async handleSend(): Promise<void> {
		if (!this.inputEl || !this.runtime || !this.messagesEl) return;
		
		const text = this.inputEl.value.trim();
		if (!text) return;
		
		// 清空输入
		this.inputEl.value = '';
		
		// 显示用户消息
		this.appendUserMessage(text);
		
		// 添加到历史记录
		this.conversationHistory.push({
			role: 'user',
			content: text
		});
		
		// 准备助手消息容器
		const assistantMessageEl = this.messagesEl.createDiv({ cls: 'friday-chat-message assistant' });
		const contentEl = assistantMessageEl.createDiv({ cls: 'friday-chat-message-content' });
		
		try {
			// 准备 turn
			const turn = this.runtime.prepareTurn({ text });
			
			// 流式接收响应
			let assistantContent = '';
			
			for await (const chunk of this.runtime.query(turn, this.conversationHistory)) {
				if (chunk.type === 'text') {
					assistantContent += chunk.content;
					contentEl.setText(assistantContent);
					this.scrollToBottom();
				} else if (chunk.type === 'tool_call_start') {
					// 显示工具调用开始
					const toolEl = contentEl.createDiv({ cls: 'friday-chat-tool-call' });
					toolEl.createDiv({ cls: 'friday-chat-tool-name', text: `[${chunk.name}]` });
				} else if (chunk.type === 'tool_call_delta') {
					// 追加工具输出
					assistantContent += chunk.delta;
					contentEl.setText(assistantContent);
					this.scrollToBottom();
				} else if (chunk.type === 'tool_call_result') {
					// 显示工具结果
					assistantContent += chunk.result;
					contentEl.setText(assistantContent);
					this.scrollToBottom();
				}
			}
			
			// 添加到历史记录
			if (assistantContent) {
				this.conversationHistory.push({
					role: 'assistant',
					content: assistantContent
				});
			}
			
		} catch (error) {
			contentEl.setText(`❌ Error: ${error.message}`);
			console.error('[Friday Chat] Query error:', error);
		}
		
		this.scrollToBottom();
	}
	
	/**
	 * 显示用户消息
	 */
	private appendUserMessage(text: string): void {
		if (!this.messagesEl) return;
		
		const messageEl = this.messagesEl.createDiv({ cls: 'friday-chat-message user' });
		messageEl.createDiv({
			cls: 'friday-chat-message-content',
			text
		});
		
		this.scrollToBottom();
	}
	
	/**
	 * 滚动到底部
	 */
	private scrollToBottom(): void {
		if (this.messagesEl) {
			this.messagesEl.scrollTop = this.messagesEl.scrollHeight;
		}
	}
	
	/**
	 * 切换到手动模式（Site.svelte）
	 */
	private switchToManualMode(): void {
		// 激活 Site view
		this.plugin.activateView();
		new Notice('Switched to Manual Mode');
	}
}
