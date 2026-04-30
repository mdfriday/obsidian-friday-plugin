/**
 * Friday Chat View - 简化版本
 * 专为 Wiki Chat 设计，移除了 Claudian 的复杂依赖
 */

import type { WorkspaceLeaf, TFolder } from 'obsidian';
import { ItemView, Notice } from 'obsidian';
import { FridayWikiRuntime } from './ChatRuntime';
import type FridayPlugin from '../main';
import { VIEW_TYPE_FRIDAY_CHAT } from '../main';
import { CommandPicker } from './features/input/CommandPicker';
import { FolderPicker } from './features/input/FolderPicker';
import type { SlashCommand } from './ChatCommands';

export { VIEW_TYPE_FRIDAY_CHAT };

export class ChatView extends ItemView {
	private plugin: FridayPlugin;
	private runtime: FridayWikiRuntime | null = null;
	private messagesEl: HTMLElement | null = null;
	private inputEl: HTMLTextAreaElement | null = null;
	private inputContainerEl: HTMLElement | null = null;
	private conversationHistory: Array<{ role: 'user' | 'assistant'; content: string }> = [];
	
	// Pickers
	private commandPicker: CommandPicker | null = null;
	private folderPicker: FolderPicker | null = null;
	
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
		
		// Logo 和标题
		const titleContainer = headerEl.createDiv({ cls: 'friday-chat-title-container' });
		const logoImg = titleContainer.createEl('img', {
			cls: 'friday-chat-logo',
			attr: {
				src: 'https://gohugo.net/mdfriday.svg',
				alt: 'MDFriday',
				width: '24',
				height: '24'
			}
		});
		titleContainer.createSpan({ cls: 'friday-chat-title', text: 'Friday Wiki Chat' });
		
		// Action buttons container
		const actionsEl = headerEl.createDiv({ cls: 'friday-chat-actions' });
		
		// Manual mode button
		const switchBtn = actionsEl.createEl('button', {
			cls: 'friday-chat-icon-btn',
			attr: { 'aria-label': 'Switch to Manual Mode', title: 'Switch to Manual Mode' }
		});
		switchBtn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"></path><circle cx="12" cy="12" r="3"></circle></svg>';
		switchBtn.addEventListener('click', () => {
			this.switchToManualMode();
		});
		
		// 消息区域
		this.messagesEl = container.createDiv({ cls: 'friday-chat-messages' });
		
		// 显示欢迎消息
		this.appendWelcomeMessage();
		
		// 输入区域
		this.inputContainerEl = container.createDiv({ cls: 'friday-chat-input-container' });
		
		this.inputEl = this.inputContainerEl.createEl('textarea', {
			cls: 'friday-chat-input',
			attr: {
				placeholder: 'Type /wiki @folder to start, or ask a question...',
				rows: '3'
			}
		});
		
		const sendBtn = this.inputContainerEl.createEl('button', {
			cls: 'friday-chat-send-btn',
			text: 'Send'
		});
		
		// 事件处理
		sendBtn.addEventListener('click', () => this.handleSend());
		this.inputEl.addEventListener('keydown', (e) => {
			this.handleInputKeydown(e);
		});
		
		// Input change handler for autocomplete
		this.inputEl.addEventListener('input', () => {
			this.handleInputChange();
		});
	}
	
	async onClose(): Promise<void> {
		if (this.runtime) {
			this.runtime.cleanup();
		}
		this.destroyPickers();
	}
	
	/**
	 * Handle input keydown events
	 */
	private handleInputKeydown(e: KeyboardEvent): void {
		// Handle picker navigation
		if (this.commandPicker || this.folderPicker) {
			const picker = this.commandPicker || this.folderPicker;
			
			if (e.key === 'ArrowUp') {
				e.preventDefault();
				picker.selectPrevious();
				return;
			}
			
			if (e.key === 'ArrowDown') {
				e.preventDefault();
				picker.selectNext();
				return;
			}
			
			if (e.key === 'Enter' && !e.shiftKey) {
				e.preventDefault();
				picker.confirm();
				return;
			}
			
			if (e.key === 'Escape') {
				e.preventDefault();
				this.destroyPickers();
				return;
			}
			
			// Tab also confirms selection
			if (e.key === 'Tab') {
				e.preventDefault();
				picker.confirm();
				return;
			}
		}
		
		// Normal send with Enter (no picker active)
		if (e.key === 'Enter' && !e.shiftKey && !this.commandPicker && !this.folderPicker) {
			e.preventDefault();
			this.handleSend();
		}
	}
	
	/**
	 * Handle input changes for autocomplete
	 */
	private handleInputChange(): void {
		if (!this.inputEl || !this.inputContainerEl) return;
		
		const text = this.inputEl.value;
		const cursorPos = this.inputEl.selectionStart;
		
		// Check for slash command trigger
		const beforeCursor = text.substring(0, cursorPos);
		const slashMatch = beforeCursor.match(/\/(\w*)$/);
		
		if (slashMatch) {
			const query = slashMatch[1];
			this.showCommandPicker(query);
			return;
		}
		
		// Check for folder mention trigger
		const atMatch = beforeCursor.match(/@([\w-]*)$/);
		
		if (atMatch) {
			const query = atMatch[1];
			this.showFolderPicker(query);
			return;
		}
		
		// No trigger found, close pickers
		this.destroyPickers();
	}
	
	/**
	 * Show command picker
	 */
	private showCommandPicker(query: string): void {
		if (!this.inputContainerEl) return;
		
		// Destroy existing pickers
		this.destroyPickers();
		
		// Create command picker
		this.commandPicker = new CommandPicker(this.inputContainerEl, {
			onSelect: (command: SlashCommand) => {
				this.insertCommand(command);
				this.destroyPickers();
			},
			onCancel: () => {
				this.destroyPickers();
			}
		});
		
		this.commandPicker.filter(query);
	}
	
	/**
	 * Show folder picker
	 */
	private showFolderPicker(query: string): void {
		if (!this.inputContainerEl) return;
		
		// Destroy existing pickers
		this.destroyPickers();
		
		// Create folder picker
		this.folderPicker = new FolderPicker(this.inputContainerEl, {
			vault: this.plugin.app.vault,
			onSelect: (folder: TFolder) => {
				this.insertFolder(folder);
				this.destroyPickers();
			},
			onCancel: () => {
				this.destroyPickers();
			}
		});
		
		this.folderPicker.filter(query);
	}
	
	/**
	 * Insert command into input
	 */
	private insertCommand(command: SlashCommand): void {
		if (!this.inputEl) return;
		
		const text = this.inputEl.value;
		const cursorPos = this.inputEl.selectionStart;
		const beforeCursor = text.substring(0, cursorPos);
		const afterCursor = text.substring(cursorPos);
		
		// Replace /query with command name (e.g., /wiki)
		const newBefore = beforeCursor.replace(/\/\w*$/, `${command.name} `);
		this.inputEl.value = newBefore + afterCursor;
		this.inputEl.selectionStart = this.inputEl.selectionEnd = newBefore.length;
		this.inputEl.focus();
	}
	
	/**
	 * Insert folder mention into input
	 */
	private insertFolder(folder: TFolder): void {
		if (!this.inputEl) return;
		
		const text = this.inputEl.value;
		const cursorPos = this.inputEl.selectionStart;
		const beforeCursor = text.substring(0, cursorPos);
		const afterCursor = text.substring(cursorPos);
		
		// Replace @query with @folder-name
		const newBefore = beforeCursor.replace(/@[\w-]*$/, `@${folder.name} `);
		this.inputEl.value = newBefore + afterCursor;
		this.inputEl.selectionStart = this.inputEl.selectionEnd = newBefore.length;
		this.inputEl.focus();
	}
	
	/**
	 * Destroy active pickers
	 */
	private destroyPickers(): void {
		if (this.commandPicker) {
			this.commandPicker.destroy();
			this.commandPicker = null;
		}
		if (this.folderPicker) {
			this.folderPicker.destroy();
			this.folderPicker = null;
		}
	}
	
	/**
	 * 显示欢迎消息
	 */
	private appendWelcomeMessage(): void {
		if (!this.messagesEl) return;
		
		const messageEl = this.messagesEl.createDiv({ cls: 'friday-chat-message assistant' });
		const contentEl = messageEl.createDiv({ cls: 'friday-chat-message-content' });
		
		contentEl.createEl('div', {
			cls: 'friday-welcome-title',
			text: '👋 Welcome to Friday Wiki Chat!'
		});
		
		const instructionsEl = contentEl.createDiv({ cls: 'friday-welcome-instructions' });
		instructionsEl.createEl('p', { text: 'Get started:' });
		
		const list = instructionsEl.createEl('ul');
		list.createEl('li', { text: 'Type /wiki @your-folder to create a wiki' });
		list.createEl('li', { text: 'Ask questions about your content' });
		list.createEl('li', { text: 'Save conversations with /save [title]' });
		list.createEl('li', { text: 'Publish with /publish' });
		
		contentEl.createEl('p', {
			cls: 'friday-welcome-hint',
			text: 'Type / to see all commands.'
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
		
		// Close any open pickers
		this.destroyPickers();
		
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
			let hasHtmlContent = false; // Track if content has HTML
			
			for await (const chunk of this.runtime.query(turn, this.conversationHistory)) {
				if (chunk.type === 'text') {
					assistantContent += chunk.content;
					this.renderContent(contentEl, assistantContent);
					this.scrollToBottom();
				} else if (chunk.type === 'tool_call_start') {
					// 显示工具调用开始
					const toolEl = contentEl.createDiv({ cls: 'friday-chat-tool-call' });
					toolEl.createDiv({ cls: 'friday-chat-tool-name', text: `[${chunk.name}]` });
				} else if (chunk.type === 'tool_call_delta') {
					// 追加工具输出
					assistantContent += chunk.delta;
					// Track if HTML is present
					if (chunk.delta.includes('<div') || chunk.delta.includes('<span')) {
						hasHtmlContent = true;
					}
					this.renderContent(contentEl, assistantContent);
					this.scrollToBottom();
				} else if (chunk.type === 'tool_call_result') {
					// 显示工具结果 - 如果之前有HTML，先清除再显示纯文本结果
					if (hasHtmlContent) {
						// Remove HTML tags from accumulated content for final result
						const cleanContent = this.stripProgressHtml(assistantContent);
						assistantContent = cleanContent + '\n\n' + chunk.result;
					} else {
						assistantContent += chunk.result;
					}
					this.renderContent(contentEl, assistantContent);
					this.scrollToBottom();
				}
			}
			
			// 添加到历史记录 (strip HTML for clean history)
			if (assistantContent) {
				const cleanContent = this.stripProgressHtml(assistantContent);
				this.conversationHistory.push({
					role: 'assistant',
					content: cleanContent
				});
			}
			
		} catch (error) {
			contentEl.setText(`❌ Error: ${error.message}`);
			console.error('[Friday Chat] Query error:', error);
		}
		
		this.scrollToBottom();
	}
	
	/**
	 * Render content (supports HTML and preserves line breaks)
	 */
	private renderContent(el: HTMLElement, content: string): void {
		el.empty();
		
		// Check if content contains HTML
		if (content.includes('<div') || content.includes('<span')) {
			// Set innerHTML for HTML content
			el.innerHTML = content;
		} else {
			// For plain text, convert \n to <br> for reliable display
			const lines = content.split('\n');
			lines.forEach((line, index) => {
				if (index > 0) {
					el.createEl('br');
				}
				if (line) {
					el.appendText(line);
				}
			});
		}
	}
	
	/**
	 * Strip progress HTML tags and keep only text content
	 */
	private stripProgressHtml(content: string): string {
		// Remove friday-wiki-progress div (spinner animation)
		let cleaned = content.replace(/<div class="friday-wiki-progress">[\s\S]*?<\/div>/g, '');
		
		// Remove friday-progress-hint div
		cleaned = cleaned.replace(/<div class="friday-progress-hint">[\s\S]*?<\/div>/g, '');
		
		// Remove any remaining HTML tags
		cleaned = cleaned.replace(/<[^>]+>/g, '');
		
		// Clean up extra whitespace
		cleaned = cleaned.replace(/\n{3,}/g, '\n\n').trim();
		
		return cleaned;
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
