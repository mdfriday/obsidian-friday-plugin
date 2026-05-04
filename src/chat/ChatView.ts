/**
 * Friday Chat View
 * UI aligned with Claudian: wrapper input, per-tool-id live progress,
 * markdown rendering, welcome screen, copy buttons, scroll-to-bottom.
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

// ─── Tool icons by name ───────────────────────────────────────────────────────
const TOOL_ICONS: Record<string, string> = {
	wiki_ingest:  'database',
	wiki_query:   'search',
	wiki_publish: 'upload',
	wiki_save:    'save',
};
function getToolIcon(name: string): string {
	return TOOL_ICONS[name] ?? 'wrench';
}

// ─── Tool call DOM refs ───────────────────────────────────────────────────────
interface ToolBlock {
	toolEl:    HTMLElement;
	summaryEl: HTMLElement;
	statusEl:  HTMLElement;
	linesEl:   HTMLElement;
	/** Accumulated text for the current streaming chunk (may be partial line) */
	buffer:    string;
	/** Whether the content section has been auto-expanded */
	expanded:  boolean;
}

export class ChatView extends ItemView {
	private plugin: FridayPlugin;
	private runtime: FridayWikiRuntime | null = null;

	// DOM refs
	private messagesEl:      HTMLElement | null = null;
	private messagesWrapperEl: HTMLElement | null = null;
	private inputEl:         HTMLTextAreaElement | null = null;
	private inputWrapperEl:  HTMLElement | null = null;
	private sendBtn:         HTMLButtonElement | null = null;
	private scrollBtn:       HTMLElement | null = null;

	// State
	private conversationHistory: Array<{ role: 'user' | 'assistant'; content: string }> = [];
	private isStreaming = false;
	/** Tool blocks keyed by tool-call id */
	private toolBlocks = new Map<string, ToolBlock>();

	// Pickers
	private commandPicker: CommandPicker | null = null;
	private folderPicker:  FolderPicker | null = null;

	constructor(leaf: WorkspaceLeaf, plugin: FridayPlugin) {
		super(leaf);
		this.plugin = plugin;
	}

	getViewType():   string { return VIEW_TYPE_FRIDAY_CHAT; }
	getDisplayText(): string { return 'Friday Chat'; }
	getIcon():       string { return 'message-square'; }

	async onOpen(): Promise<void> {
		const container = this.containerEl.children[1] as HTMLElement;
		container.empty();
		container.addClass('friday-chat-view');
		this.runtime = new FridayWikiRuntime(this.plugin);
		this.buildHeader(container);

		if (!this.plugin.settings.aiProviderType) {
			this.buildAIProviderNotConfiguredBanner(container);
		}

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

		const newBtn = actionsEl.createDiv({
			cls: 'friday-chat-icon-btn',
			attr: { title: 'New conversation', 'aria-label': 'New conversation' },
		});
		setIcon(newBtn, 'square-pen');
		newBtn.addEventListener('click', () => this.startNewConversation());

		const switchBtn = actionsEl.createDiv({
			cls: 'friday-chat-icon-btn',
			attr: { title: 'Switch to Manual Mode', 'aria-label': 'Switch to Manual Mode' },
		});
		setIcon(switchBtn, 'settings-2');
		switchBtn.addEventListener('click', () => this.switchToManualMode());
	}

	// ─────────────────────────────────────────
	// Build: AI provider not configured banner
	// ─────────────────────────────────────────

	private buildAIProviderNotConfiguredBanner(container: HTMLElement): void {
		const t = (key: string) => this.plugin.i18n.t(`settings.${key}`);
		const banner = container.createDiv({ cls: 'friday-ai-banner friday-ai-banner--warning' });

		const iconEl = banner.createDiv({ cls: 'friday-ai-banner-icon' });
		setIcon(iconEl, 'alert-triangle');

		const textEl = banner.createDiv({ cls: 'friday-ai-banner-text' });
		textEl.createEl('strong', { text: t('ai_provider_not_configured') });
		textEl.createEl('p', { text: t('ai_provider_not_configured_desc') });

		const btn = banner.createEl('button', {
			cls: 'friday-ai-banner-btn',
			text: t('ai_provider_go_to_settings'),
		});
		btn.addEventListener('click', () => {
			(this.plugin.app as any).setting?.open();
			(this.plugin.app as any).setting?.openTabById(this.plugin.manifest.id);
		});
	}

	// ─────────────────────────────────────────
	// Build: Messages area
	// ─────────────────────────────────────────

	private buildMessagesArea(container: HTMLElement): void {
		this.messagesWrapperEl = container.createDiv({ cls: 'friday-chat-messages-wrapper' });
		this.messagesEl = this.messagesWrapperEl.createDiv({ cls: 'friday-chat-messages' });

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
			attr: {
				placeholder: 'Message Friday... (/ for commands, @ for folders)',
				rows: '3',
			},
		});

		const toolbar = this.inputWrapperEl.createDiv({ cls: 'friday-chat-input-toolbar' });
		toolbar.createSpan({ cls: 'friday-chat-input-hint', text: '↵ send · ⇧↵ newline' });
		this.sendBtn = toolbar.createEl('button', { cls: 'friday-chat-send-btn', text: 'Send' });

		this.sendBtn.addEventListener('click', () => this.handleSend());
		this.inputEl.addEventListener('keydown', (e) => this.handleInputKeydown(e));
		this.inputEl.addEventListener('input', () => {
			this.handleInputChange();
			this.resizeInput();
		});
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
			['/ask question',  'ask a question across your notes'],
			['/save [title]', 'save this conversation'],
			['/publish',      'publish your site'],
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
			if (e.key === 'Tab')    { e.preventDefault(); picker.confirm(); return; }
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
		const pos  = this.inputEl.selectionStart ?? 0;
		const newBefore = text.substring(0, pos).replace(/\/\w*$/, `${command.name} `);
		this.inputEl.value = newBefore + text.substring(pos);
		this.inputEl.selectionStart = this.inputEl.selectionEnd = newBefore.length;
		this.inputEl.focus();
		this.resizeInput();
	}

	private insertFolder(folder: TFolder): void {
		if (!this.inputEl) return;
		const text = this.inputEl.value;
		const pos  = this.inputEl.selectionStart ?? 0;
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
		this.toolBlocks.clear();

		this.appendUserMessage(text);
		this.conversationHistory.push({ role: 'user', content: text });

		const assistantEl = this.messagesEl.createDiv({ cls: 'friday-chat-message assistant' });
		const contentEl   = assistantEl.createDiv({ cls: 'friday-chat-message-content' });
		let   assistantText = '';

		// Thinking indicator (shown before first chunk)
		const thinkingEl = contentEl.createDiv({ cls: 'friday-thinking' });
		thinkingEl.createDiv({ cls: 'friday-spinner' });
		thinkingEl.appendText('Thinking…');

		// Debounced Markdown render: we schedule a re-render 120ms after the last
		// text token, so the user sees progressively rendered Markdown during streaming.
		let mdRenderTimer: ReturnType<typeof setTimeout> | null = null;
		const scheduleMdRender = () => {
			if (mdRenderTimer) clearTimeout(mdRenderTimer);
			mdRenderTimer = setTimeout(async () => {
				if (assistantText.trim()) {
					await this.renderMarkdown(contentEl, assistantText);
					this.scrollToBottom();
				}
			}, 120);
		};

		try {
			const turn = this.runtime.prepareTurn({ text });

			for await (const chunk of this.runtime.query(turn, this.conversationHistory)) {
				thinkingEl.remove(); // no-op after first call

				const c = chunk as any; // Friday uses custom chunk types beyond StreamChunk

				if (c.type === 'text') {
					assistantText += c.content as string;
					// Show plain text immediately for responsiveness, schedule MD render
					this.renderStreamingText(contentEl, assistantText);
					scheduleMdRender();
					this.scrollToBottom();

				} else if (c.type === 'tool_call_start') {
					this.beginToolBlock(contentEl, c.id as string, c.name as string);
					this.scrollToBottom();

				} else if (c.type === 'tool_call_delta') {
					const delta = (c.delta as string) ?? '';
					this.appendToolDelta(c.id as string, delta);
					this.scrollToBottom();

				} else if (c.type === 'tool_call_result') {
					const result  = (c.result as string) ?? '';
					const isError = !!(c.isError as boolean);
					this.finalizeToolBlock(c.id as string, result, isError);
					this.scrollToBottom();
				}
			}

			// Cancel any pending debounced render and do a final definitive Markdown pass
			if (mdRenderTimer) clearTimeout(mdRenderTimer);
			thinkingEl.remove();
			if (assistantText.trim()) {
				await this.renderMarkdown(contentEl, assistantText);
			}

			if (assistantText.trim()) {
				this.conversationHistory.push({ role: 'assistant', content: assistantText.trim() });
			}

		} catch (error) {
			if (mdRenderTimer) clearTimeout(mdRenderTimer);
			thinkingEl.remove();
			contentEl.empty();
			contentEl.createSpan({ text: `Error: ${(error as Error).message}`, cls: 'friday-error' });
			console.error('[Friday Chat] Query error:', error);
		}

		this.setStreaming(false);
		this.scrollToBottom();
	}

	// ─────────────────────────────────────────
	// Tool block: create / delta / finalize
	// ─────────────────────────────────────────

	/**
	 * Create a Claudian-style tool call block (header + collapsible content).
	 * The content area auto-expands and shows live progress lines.
	 */
	private beginToolBlock(containerEl: HTMLElement, id: string, name: string): void {
		const toolEl = containerEl.createDiv({ cls: 'friday-tool-call' });
		toolEl.dataset.toolId = id;

		// ── Header ─────────────────────────────────────────────────────────
		const header = toolEl.createDiv({ cls: 'friday-tool-header' });
		header.setAttribute('tabindex', '0');
		header.setAttribute('role', 'button');
		header.setAttribute('aria-expanded', 'false');

		const iconEl = header.createDiv({ cls: 'friday-tool-icon' });
		setIcon(iconEl, getToolIcon(name));

		const nameEl = header.createSpan({ cls: 'friday-tool-name', text: name });
		const summaryEl = header.createSpan({ cls: 'friday-tool-summary' });

		// Spinner in status slot (pure CSS animation — no JS interval needed)
		const statusEl = header.createDiv({ cls: 'friday-tool-status running' });
		this.setStatusSpinner(statusEl);

		// ── Content (expandable) ────────────────────────────────────────────
		const contentEl = toolEl.createDiv({ cls: 'friday-tool-content' });
		contentEl.style.display = 'none'; // collapsed by default

		const linesEl = contentEl.createDiv({ cls: 'friday-tool-lines' });

		// Click to toggle expand/collapse
		const toggle = () => {
			const expanded = toolEl.hasClass('expanded');
			toolEl.toggleClass('expanded', !expanded);
			contentEl.style.display = expanded ? 'none' : 'block';
			header.setAttribute('aria-expanded', String(!expanded));
		};
		header.addEventListener('click', toggle);
		header.addEventListener('keydown', (e) => {
			if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); }
		});

		this.toolBlocks.set(id, {
			toolEl, summaryEl, statusEl, linesEl,
			buffer: '', expanded: false,
		});

		// Suppress unused-variable lint for nameEl (kept for potential future updates)
		void nameEl;
	}

	/**
	 * Handle a streaming delta for a tool call.
	 *
	 * Behavior:
	 * - Deltas that end with '\n' are treated as discrete progress lines
	 *   (each becomes its own line in the content area, summary shows the latest)
	 * - Deltas without trailing '\n' are streaming tokens — they are buffered
	 *   and appended to the last line (streaming text output, e.g. wiki_query LLM response)
	 */
	private appendToolDelta(id: string, delta: string): void {
		const block = this.toolBlocks.get(id);
		if (!block) return;

		// Auto-expand the content area on first delta
		if (!block.expanded) {
			block.toolEl.addClass('expanded');
			(block.linesEl.closest('.friday-tool-content') as HTMLElement | null)
				?.style.setProperty('display', 'block');
			block.expanded = true;
		}

		// Accumulate into buffer
		block.buffer += delta;

		// Split on newlines: completed lines → DOM, remainder stays in buffer
		const parts = block.buffer.split('\n');
		// Everything except the last element is a completed line
		const completedLines = parts.slice(0, -1);
		block.buffer = parts[parts.length - 1]; // may be '' or partial token

		for (const line of completedLines) {
			if (!line.trim()) continue; // skip blank lines
			this.addToolLine(block, line);
		}

		// If no newline yet but buffer has content, update the in-progress last line
		if (block.buffer) {
			this.updateLastToolLine(block, block.buffer);
		}
	}

	/** Appends a completed line to the tool content and updates the summary. */
	private addToolLine(block: ToolBlock, text: string): void {
		const lineEl = block.linesEl.createDiv({ cls: 'friday-tool-line', text });
		lineEl.scrollIntoView?.({ block: 'nearest' });

		// Summary: last non-empty line, truncated to 60 chars
		const truncated = text.length > 60 ? text.slice(0, 60) + '…' : text;
		block.summaryEl.textContent = truncated;
	}

	/** Updates or creates the last in-progress (no-newline-yet) line. */
	private updateLastToolLine(block: ToolBlock, text: string): void {
		let last = block.linesEl.lastElementChild as HTMLElement | null;
		if (!last || last.hasClass('friday-tool-line-complete')) {
			last = block.linesEl.createDiv({ cls: 'friday-tool-line' });
		}
		last.textContent = text;

		const truncated = text.length > 60 ? text.slice(0, 60) + '…' : text;
		block.summaryEl.textContent = truncated;
	}

	/**
	 * Finalize a tool block after `tool_call_result`.
	 * Shows the result lines in content, marks header status as done/error.
	 */
	private finalizeToolBlock(id: string, result: string, isError: boolean): void {
		const block = this.toolBlocks.get(id);
		if (!block) return;

		// Flush remaining buffer: reuse the existing in-progress line if present
		// (avoids duplicating content that updateLastToolLine already rendered)
		if (block.buffer.trim()) {
			const last = block.linesEl.lastElementChild as HTMLElement | null;
			if (last && !last.hasClass('friday-tool-line-complete')) {
				last.textContent = block.buffer;
				last.addClass('friday-tool-line-complete');
			} else {
				const lineEl = block.linesEl.createDiv({ cls: 'friday-tool-line friday-tool-line-complete' });
				lineEl.textContent = block.buffer;
			}
			block.buffer = '';
		}

		// Mark all existing lines as complete (no further updates)
		block.linesEl.querySelectorAll('.friday-tool-line:not(.friday-tool-line-complete)')
			.forEach(el => el.addClass('friday-tool-line-complete'));

		// Trivial completion tokens ("Done", "Search complete", etc.) don't need
		// a visible result line — the ✓/✗ icon already signals the outcome.
		// Only show result lines when they contain substantive output (errors, stats, etc.)
		const isTrivial = !isError && /^(done|complete|search complete|query completed|ok)\.?$/i.test(result.trim());

		if (!isTrivial && result.trim()) {
			const sep = block.linesEl.createDiv({ cls: 'friday-tool-result-sep' });
			sep.style.cssText = 'height:1px;background:var(--background-modifier-border);margin:4px 0;';

			for (const line of result.split('\n')) {
				if (!line.trim()) continue;
				const lineEl = block.linesEl.createDiv({ cls: 'friday-tool-line friday-tool-result-line' });
				lineEl.textContent = line;
			}
		}

		// Update summary
		if (isError) {
			const short = result.replace(/^error:\s*/i, '').split('\n')[0];
			block.summaryEl.textContent = short.length > 60 ? short.slice(0, 60) + '…' : short;
		} else if (!isTrivial) {
			block.summaryEl.textContent = result.split('\n')[0]?.slice(0, 60) ?? '';
		}
		// For trivial results, keep the last progress line visible in summary

		// Update status icon: check or ×
		block.statusEl.removeClass('running');
		block.statusEl.addClass(isError ? 'error' : 'done');
		block.statusEl.empty();
		setIcon(block.statusEl, isError ? 'x' : 'check');

		this.toolBlocks.delete(id);
	}

	/** Sets status element to CSS-animated spinner (loader-2 + spin class). */
	private setStatusSpinner(statusEl: HTMLElement): void {
		statusEl.empty();
		const spinnerEl = statusEl.createDiv({ cls: 'friday-status-spinner' });
		setIcon(spinnerEl, 'loader-2');
	}

	// ─────────────────────────────────────────
	// Message rendering
	// ─────────────────────────────────────────

	private appendUserMessage(text: string): void {
		if (!this.messagesEl) return;
		const messageEl = this.messagesEl.createDiv({ cls: 'friday-chat-message user' });
		messageEl.createDiv({ cls: 'friday-chat-message-content', text });

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

	// renderStreamingText is defined below alongside renderMarkdown

	/** Full Markdown render (called on streaming debounce and at end of stream). */
	private async renderMarkdown(el: HTMLElement, content: string): Promise<void> {
		if (!content.trim()) return;

		// Preserve tool-call blocks — detach them, re-attach after render
		const toolCalls = Array.from(el.querySelectorAll('.friday-tool-call'));
		el.empty();
		for (const tc of toolCalls) el.appendChild(tc);

		// Render Markdown into a fresh container placed after any tool blocks
		const mdEl = el.createDiv({ cls: 'friday-md-content' });
		await MarkdownRenderer.render(this.plugin.app, content, mdEl, '', this);
	}

	/** Lightweight streaming-text render — keeps tool blocks, shows plain text immediately. */
	private renderStreamingText(el: HTMLElement, content: string): void {
		// Keep any existing tool-call blocks
		const toolCalls = Array.from(el.querySelectorAll('.friday-tool-call'));
		// Remove any previous md-content or plain-text nodes, but keep tool blocks
		const mdContainer = el.querySelector('.friday-md-content');
		if (mdContainer) mdContainer.remove();

		// Remove plain-text nodes (Text nodes + br elements not inside tool blocks)
		const childrenToRemove: ChildNode[] = [];
		el.childNodes.forEach(node => {
			if (!toolCalls.includes(node as HTMLElement)) {
				childrenToRemove.push(node);
			}
		});
		childrenToRemove.forEach(n => n.remove());

		// Append plain text after tool blocks
		const lines = content.split('\n');
		lines.forEach((line, i) => {
			if (i > 0) el.createEl('br');
			if (line) el.appendText(line);
		});
	}

	// ─────────────────────────────────────────
	// Scroll
	// ─────────────────────────────────────────

	private scrollToBottom(): void {
		if (this.messagesEl) this.messagesEl.scrollTop = this.messagesEl.scrollHeight;
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
		this.toolBlocks.clear();
		if (this.messagesEl) {
			this.messagesEl.empty();
			this.appendWelcomeMessage();
		}
		this.inputEl?.focus();
	}

	private switchToManualMode(): void {
		this.plugin.activateView();
		new Notice('Switched to Manual Mode');
	}
}
