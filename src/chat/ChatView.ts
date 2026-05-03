/**
 * Friday Chat View
 * UI aligned with Claudian: wrapper input, markdown rendering,
 * welcome screen, copy buttons, collapsible tool calls, scroll-to-bottom.
 */

import type { WorkspaceLeaf, TFolder } from 'obsidian';
import { ItemView, MarkdownRenderer, Notice, setIcon } from 'obsidian';
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

	// DOM refs
	private messagesEl: HTMLElement | null = null;
	private messagesWrapperEl: HTMLElement | null = null;
	private inputEl: HTMLTextAreaElement | null = null;
	private inputWrapperEl: HTMLElement | null = null;
	private sendBtn: HTMLButtonElement | null = null;
	private scrollBtn: HTMLElement | null = null;

	// State
	private conversationHistory: Array<{ role: 'user' | 'assistant'; content: string }> = [];
	private isStreaming = false;

	// Pickers
	private commandPicker: CommandPicker | null = null;
	private folderPicker: FolderPicker | null = null;

	constructor(leaf: WorkspaceLeaf, plugin: FridayPlugin) {
		super(leaf);
		this.plugin = plugin;
	}

	getViewType(): string { return VIEW_TYPE_FRIDAY_CHAT; }
	getDisplayText(): string { return 'Friday Chat'; }
	getIcon(): string { return 'message-square'; }

	async onOpen(): Promise<void> {
		const container = this.containerEl.children[1] as HTMLElement;
		container.empty();
		container.addClass('friday-chat-view');

		this.runtime = new FridayWikiRuntime(this.plugin);

		this.buildHeader(container);
		this.buildMessagesArea(container);
		this.buildInputArea(container);
	}

	async onClose(): Promise<void> {
		this.runtime?.cleanup();
		this.destroyPickers();
	}

	// ─────────────────────────────────────────
	// Build: Header
	// ─────────────────────────────────────────

	private buildHeader(container: HTMLElement): void {
		const headerEl = container.createDiv({ cls: 'friday-chat-header' });

		const titleContainer = headerEl.createDiv({ cls: 'friday-chat-title-container' });
		titleContainer.createEl('img', {
			cls: 'friday-chat-logo',
			attr: { src: 'https://gohugo.net/mdfriday.svg', alt: 'MDFriday', width: '20', height: '20' },
		});
		titleContainer.createSpan({ cls: 'friday-chat-title', text: 'Friday Chat' });

		const actionsEl = headerEl.createDiv({ cls: 'friday-chat-actions' });

		// New conversation button
		const newBtn = actionsEl.createDiv({ cls: 'friday-chat-icon-btn', attr: { title: 'New conversation', 'aria-label': 'New conversation' } });
		setIcon(newBtn, 'square-pen');
		newBtn.addEventListener('click', () => this.startNewConversation());

		// Switch to Manual Mode button
		const switchBtn = actionsEl.createDiv({ cls: 'friday-chat-icon-btn', attr: { title: 'Switch to Manual Mode', 'aria-label': 'Switch to Manual Mode' } });
		setIcon(switchBtn, 'settings-2');
		switchBtn.addEventListener('click', () => this.switchToManualMode());
	}

	// ─────────────────────────────────────────
	// Build: Messages area
	// ─────────────────────────────────────────

	private buildMessagesArea(container: HTMLElement): void {
		this.messagesWrapperEl = container.createDiv({ cls: 'friday-chat-messages-wrapper' });
		this.messagesEl = this.messagesWrapperEl.createDiv({ cls: 'friday-chat-messages' });

		// Scroll-to-bottom button (inside wrapper for absolute positioning)
		this.scrollBtn = this.messagesWrapperEl.createDiv({ cls: 'friday-scroll-btn' });
		setIcon(this.scrollBtn, 'chevron-down');
		this.scrollBtn.addEventListener('click', () => this.scrollToBottom());

		this.messagesEl.addEventListener('scroll', () => this.updateScrollBtn());

		this.appendWelcomeMessage();
	}

	// ─────────────────────────────────────────
	// Build: Input area
	// ─────────────────────────────────────────

	private buildInputArea(container: HTMLElement): void {
		const inputContainerEl = container.createDiv({ cls: 'friday-chat-input-container' });

		this.inputWrapperEl = inputContainerEl.createDiv({ cls: 'friday-chat-input-wrapper' });

		this.inputEl = this.inputWrapperEl.createEl('textarea', {
			cls: 'friday-chat-input',
			attr: { placeholder: 'Message Friday... (/ for commands, @ for folders)', rows: '3' },
		});

		const toolbar = this.inputWrapperEl.createDiv({ cls: 'friday-chat-input-toolbar' });
		toolbar.createSpan({ cls: 'friday-chat-input-hint', text: '↵ send · ⇧↵ newline' });

		this.sendBtn = toolbar.createEl('button', { cls: 'friday-chat-send-btn', text: 'Send' });

		this.sendBtn.addEventListener('click', () => this.handleSend());
		this.inputEl.addEventListener('keydown', (e) => this.handleInputKeydown(e));
		this.inputEl.addEventListener('input', () => this.handleInputChange());

		// Auto-resize textarea
		this.inputEl.addEventListener('input', () => this.resizeInput());
	}

	// ─────────────────────────────────────────
	// Welcome screen
	// ─────────────────────────────────────────

	private appendWelcomeMessage(): void {
		if (!this.messagesEl) return;
		const el = this.messagesEl.createDiv({ cls: 'friday-chat-welcome' });
		el.createDiv({ cls: 'friday-chat-welcome-greeting', text: 'Hello, how can I help?' });
		el.createDiv({ cls: 'friday-chat-welcome-hint', text: 'Your AI assistant for Obsidian notes.' });
		const cmds = el.createDiv({ cls: 'friday-chat-welcome-commands' });
		const items: [string, string][] = [
			['/wiki @folder', 'build a knowledge base from a folder'],
			['/ask question', 'ask a question across your notes'],
			['/save [title]', 'save this conversation'],
			['/publish', 'publish your site'],
		];
		for (const [cmd, desc] of items) {
			const row = cmds.createDiv({ cls: 'friday-chat-welcome-cmd' });
			row.createEl('strong', { text: cmd });
			row.appendText(` — ${desc}`);
		}
	}

	// ─────────────────────────────────────────
	// Input: keydown / change
	// ─────────────────────────────────────────

	private handleInputKeydown(e: KeyboardEvent): void {
		if (this.commandPicker || this.folderPicker) {
			const picker = this.commandPicker ?? this.folderPicker!;
			if (e.key === 'ArrowUp')   { e.preventDefault(); picker.selectPrevious(); return; }
			if (e.key === 'ArrowDown') { e.preventDefault(); picker.selectNext(); return; }
			if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); picker.confirm(); return; }
			if (e.key === 'Escape') { e.preventDefault(); this.destroyPickers(); return; }
			if (e.key === 'Tab')   { e.preventDefault(); picker.confirm(); return; }
		}

		if (e.key === 'Enter' && !e.shiftKey) {
			e.preventDefault();
			this.handleSend();
		}
	}

	private handleInputChange(): void {
		if (!this.inputEl || !this.inputWrapperEl) return;
		const text = this.inputEl.value;
		const cursorPos = this.inputEl.selectionStart ?? 0;
		const beforeCursor = text.substring(0, cursorPos);

		const slashMatch = beforeCursor.match(/\/(\w*)$/);
		if (slashMatch) { this.showCommandPicker(slashMatch[1]); return; }

		const atMatch = beforeCursor.match(/@([\w/-]*)$/);
		if (atMatch) { this.showFolderPicker(atMatch[1]); return; }

		this.destroyPickers();
	}

	private resizeInput(): void {
		if (!this.inputEl) return;
		this.inputEl.style.height = 'auto';
		const maxH = Math.max(150, window.innerHeight * 0.45);
		this.inputEl.style.height = Math.min(this.inputEl.scrollHeight, maxH) + 'px';
	}

	// ─────────────────────────────────────────
	// Pickers
	// ─────────────────────────────────────────

	private showCommandPicker(query: string): void {
		if (!this.inputWrapperEl) return;
		this.destroyPickers();
		this.commandPicker = new CommandPicker(this.inputWrapperEl, {
			onSelect: (command: SlashCommand) => { this.insertCommand(command); this.destroyPickers(); },
			onCancel: () => this.destroyPickers(),
		});
		this.commandPicker.filter(query);
	}

	private showFolderPicker(query: string): void {
		if (!this.inputWrapperEl) return;
		this.destroyPickers();
		this.folderPicker = new FolderPicker(this.inputWrapperEl, {
			vault: this.plugin.app.vault,
			onSelect: (folder: TFolder) => { this.insertFolder(folder); this.destroyPickers(); },
			onCancel: () => this.destroyPickers(),
		});
		this.folderPicker.filter(query);
	}

	private insertCommand(command: SlashCommand): void {
		if (!this.inputEl) return;
		const text = this.inputEl.value;
		const pos = this.inputEl.selectionStart ?? 0;
		const newBefore = text.substring(0, pos).replace(/\/\w*$/, `${command.name} `);
		this.inputEl.value = newBefore + text.substring(pos);
		this.inputEl.selectionStart = this.inputEl.selectionEnd = newBefore.length;
		this.inputEl.focus();
		this.resizeInput();
	}

	private insertFolder(folder: TFolder): void {
		if (!this.inputEl) return;
		const text = this.inputEl.value;
		const pos = this.inputEl.selectionStart ?? 0;
		const newBefore = text.substring(0, pos).replace(/@[\w/-]*$/, `@${folder.name} `);
		this.inputEl.value = newBefore + text.substring(pos);
		this.inputEl.selectionStart = this.inputEl.selectionEnd = newBefore.length;
		this.inputEl.focus();
		this.resizeInput();
	}

	private destroyPickers(): void {
		this.commandPicker?.destroy(); this.commandPicker = null;
		this.folderPicker?.destroy();  this.folderPicker = null;
	}

	// ─────────────────────────────────────────
	// Send & streaming
	// ─────────────────────────────────────────

	private async handleSend(): Promise<void> {
		if (!this.inputEl || !this.runtime || !this.messagesEl || this.isStreaming) return;
		const text = this.inputEl.value.trim();
		if (!text) return;

		this.destroyPickers();
		this.inputEl.value = '';
		this.resizeInput();
		this.setStreaming(true);

		this.appendUserMessage(text);
		this.conversationHistory.push({ role: 'user', content: text });

		const assistantEl = this.messagesEl.createDiv({ cls: 'friday-chat-message assistant' });
		const contentEl = assistantEl.createDiv({ cls: 'friday-chat-message-content' });

		// Thinking indicator
		const thinkingEl = contentEl.createDiv({ cls: 'friday-thinking' });
		thinkingEl.createDiv({ cls: 'friday-spinner' });
		thinkingEl.appendText('Thinking…');

		try {
			const turn = this.runtime.prepareTurn({ text });
			let assistantContent = '';

			for await (const chunk of this.runtime.query(turn, this.conversationHistory)) {
				// Remove thinking indicator on first chunk
				thinkingEl.remove();

				if (chunk.type === 'text') {
					assistantContent += chunk.content;
					this.renderStreamingText(contentEl, assistantContent);
					this.scrollToBottom();
				} else if (chunk.type === 'tool_call_start') {
					assistantContent += '\n';
					this.appendToolCall(contentEl, chunk.name ?? 'tool', '');
					this.scrollToBottom();
				} else if (chunk.type === 'tool_call_delta') {
					// Update last tool call summary
					this.updateLastToolSummary(contentEl, chunk.delta ?? '');
					this.scrollToBottom();
				} else if (chunk.type === 'tool_call_result') {
					const result = chunk.result ?? '';
					assistantContent += result;
					this.finalizeLastToolCall(contentEl, result);
					this.scrollToBottom();
				}
			}

			// Final render with Markdown
			thinkingEl.remove();
			if (assistantContent) {
				const cleanContent = this.stripProgressHtml(assistantContent);
				await this.renderMarkdown(contentEl, cleanContent);
				this.conversationHistory.push({ role: 'assistant', content: cleanContent });
			}
		} catch (error) {
			thinkingEl.remove();
			contentEl.empty();
			contentEl.createDiv({ cls: 'friday-chat-error', text: `Error: ${(error as Error).message}` });
			console.error('[Friday Chat] Query error:', error);
		}

		this.setStreaming(false);
		this.scrollToBottom();
	}

	// ─────────────────────────────────────────
	// Message rendering helpers
	// ─────────────────────────────────────────

	private appendUserMessage(text: string): void {
		if (!this.messagesEl) return;
		const messageEl = this.messagesEl.createDiv({ cls: 'friday-chat-message user' });
		messageEl.createDiv({ cls: 'friday-chat-message-content', text });

		// Hover actions
		const actions = messageEl.createDiv({ cls: 'friday-chat-user-actions' });
		const copyBtn = actions.createSpan({ attr: { title: 'Copy' } });
		setIcon(copyBtn, 'copy');
		copyBtn.addEventListener('click', () => {
			navigator.clipboard.writeText(text).catch(() => {});
			copyBtn.empty();
			copyBtn.setText('copied');
			copyBtn.addClass('copied');
			setTimeout(() => {
				copyBtn.removeClass('copied');
				copyBtn.empty();
				setIcon(copyBtn, 'copy');
			}, 1500);
		});

		this.scrollToBottom();
	}

	/** Live streaming text (plain, avoids re-parsing MD on every chunk) */
	private renderStreamingText(el: HTMLElement, content: string): void {
		// Keep any tool-call blocks and only re-render the text portion
		const toolCalls = Array.from(el.querySelectorAll('.friday-tool-call'));
		el.empty();
		for (const tc of toolCalls) el.appendChild(tc);

		const lines = content.split('\n');
		lines.forEach((line, i) => {
			if (i > 0) el.createEl('br');
			if (line) el.appendText(line);
		});
	}

	/** Proper Markdown rendering (called after stream completes) */
	private async renderMarkdown(el: HTMLElement, content: string): Promise<void> {
		el.empty();
		await MarkdownRenderer.render(
			this.plugin.app,
			content,
			el,
			'',
			this,
		);
	}

	// ─────────────────────────────────────────
	// Tool call rendering
	// ─────────────────────────────────────────

	private appendToolCall(containerEl: HTMLElement, name: string, summary: string): void {
		const toolEl = containerEl.createDiv({ cls: 'friday-tool-call' });

		const header = toolEl.createDiv({ cls: 'friday-tool-header' });

		const iconEl = header.createDiv({ cls: 'friday-tool-icon' });
		setIcon(iconEl, 'wrench');

		header.createSpan({ cls: 'friday-tool-name', text: name });
		header.createSpan({ cls: 'friday-tool-summary', text: summary });

		const statusEl = header.createDiv({ cls: 'friday-tool-status running' });
		setIcon(statusEl, 'loader-2');

		const contentEl = toolEl.createDiv({ cls: 'friday-tool-content' });

		// Toggle expand/collapse on header click
		header.addEventListener('click', () => {
			toolEl.toggleClass('expanded', !toolEl.hasClass('expanded'));
		});

		// Animate spinner
		const spinnerInterval = setInterval(() => {
			if (!document.contains(statusEl)) { clearInterval(spinnerInterval); return; }
			statusEl.empty();
			setIcon(statusEl, statusEl.hasClass('running') ? 'loader-2' : 'check');
		}, 300);
		(toolEl as any)._spinnerInterval = spinnerInterval;
		(toolEl as any)._contentEl = contentEl;
		(toolEl as any)._statusEl = statusEl;
		(toolEl as any)._spinnerIntervalId = spinnerInterval;
	}

	private updateLastToolSummary(containerEl: HTMLElement, delta: string): void {
		const toolCalls = containerEl.querySelectorAll('.friday-tool-call');
		const last = toolCalls[toolCalls.length - 1] as HTMLElement | undefined;
		if (!last) return;
		const summaryEl = last.querySelector('.friday-tool-summary') as HTMLElement | null;
		if (summaryEl) summaryEl.textContent = (summaryEl.textContent ?? '') + delta;
		const contentEl = (last as any)._contentEl as HTMLElement | undefined;
		if (contentEl) {
			const lines = contentEl.querySelector('.friday-tool-lines') ?? contentEl.createDiv({ cls: 'friday-tool-lines' });
			lines.textContent = (lines.textContent ?? '') + delta;
		}
	}

	private finalizeLastToolCall(containerEl: HTMLElement, result: string): void {
		const toolCalls = containerEl.querySelectorAll('.friday-tool-call');
		const last = toolCalls[toolCalls.length - 1] as HTMLElement | undefined;
		if (!last) return;

		clearInterval((last as any)._spinnerIntervalId);
		const statusEl = (last as any)._statusEl as HTMLElement | undefined;
		if (statusEl) {
			statusEl.removeClass('running');
			statusEl.addClass('done');
			statusEl.empty();
			setIcon(statusEl, 'check');
		}
		const contentEl = (last as any)._contentEl as HTMLElement | undefined;
		if (contentEl && result) {
			const lines = contentEl.querySelector('.friday-tool-lines') as HTMLElement | null;
			if (lines) {
				lines.textContent = result;
			} else {
				contentEl.createDiv({ cls: 'friday-tool-lines', text: result });
			}
		}
	}

	// ─────────────────────────────────────────
	// Scroll
	// ─────────────────────────────────────────

	private scrollToBottom(): void {
		if (this.messagesEl) {
			this.messagesEl.scrollTop = this.messagesEl.scrollHeight;
		}
		this.updateScrollBtn();
	}

	private updateScrollBtn(): void {
		if (!this.messagesEl || !this.scrollBtn) return;
		const { scrollTop, scrollHeight, clientHeight } = this.messagesEl;
		const atBottom = scrollHeight - scrollTop - clientHeight < 60;
		this.scrollBtn.toggleClass('visible', !atBottom);
	}

	// ─────────────────────────────────────────
	// Misc helpers
	// ─────────────────────────────────────────

	private setStreaming(active: boolean): void {
		this.isStreaming = active;
		if (this.sendBtn) {
			this.sendBtn.disabled = active;
			this.sendBtn.textContent = active ? 'Sending…' : 'Send';
		}
		if (this.inputEl) this.inputEl.disabled = active;
	}

	private startNewConversation(): void {
		if (this.isStreaming) return;
		this.conversationHistory = [];
		if (this.messagesEl) {
			this.messagesEl.empty();
			this.appendWelcomeMessage();
		}
		this.inputEl?.focus();
	}

	private stripProgressHtml(content: string): string {
		return content
			.replace(/<div class="friday-wiki-progress">[\s\S]*?<\/div>/g, '')
			.replace(/<div class="friday-progress-hint">[\s\S]*?<\/div>/g, '')
			.replace(/<[^>]+>/g, '')
			.replace(/\n{3,}/g, '\n\n')
			.trim();
	}

	private switchToManualMode(): void {
		this.plugin.activateView();
		new Notice('Switched to Manual Mode');
	}
}
