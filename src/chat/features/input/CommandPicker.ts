/**
 * Command Picker - Slash command autocomplete dropdown
 */

import { FRIDAY_CHAT_COMMANDS, SlashCommand } from '../../ChatCommands';

export interface CommandPickerOptions {
	onSelect: (command: SlashCommand) => void;
	onCancel: () => void;
}

export class CommandPicker {
	private containerEl: HTMLElement;
	private listEl: HTMLElement;
	private commands: SlashCommand[];
	private filteredCommands: SlashCommand[];
	private selectedIndex: number = 0;
	private options: CommandPickerOptions;
	
	constructor(
		parentEl: HTMLElement,
		options: CommandPickerOptions
	) {
		this.options = options;
		this.commands = FRIDAY_CHAT_COMMANDS;
		this.filteredCommands = [...this.commands];
		
		// Create picker container
		this.containerEl = parentEl.createDiv({ cls: 'friday-command-picker' });
		this.listEl = this.containerEl.createDiv({ cls: 'friday-command-list' });
		
		this.render();
	}
	
	/**
	 * Filter commands by query
	 */
	public filter(query: string): void {
		const lowerQuery = query.toLowerCase();
		this.filteredCommands = this.commands.filter(cmd =>
			cmd.name.toLowerCase().includes(lowerQuery) ||
			cmd.description.toLowerCase().includes(lowerQuery)
		);
		this.selectedIndex = 0;
		this.render();
	}
	
	/**
	 * Navigate up in the list
	 */
	public selectPrevious(): void {
		this.selectedIndex = Math.max(0, this.selectedIndex - 1);
		this.render();
	}
	
	/**
	 * Navigate down in the list
	 */
	public selectNext(): void {
		this.selectedIndex = Math.min(
			this.filteredCommands.length - 1,
			this.selectedIndex + 1
		);
		this.render();
	}
	
	/**
	 * Confirm current selection
	 */
	public confirm(): void {
		const selected = this.filteredCommands[this.selectedIndex];
		if (selected) {
			this.options.onSelect(selected);
		}
	}
	
	/**
	 * Cancel and close
	 */
	public cancel(): void {
		this.options.onCancel();
	}
	
	/**
	 * Render command list
	 */
	private render(): void {
		this.listEl.empty();
		
		if (this.filteredCommands.length === 0) {
			this.listEl.createDiv({
				cls: 'friday-command-item-empty',
				text: 'No commands found'
			});
			return;
		}
		
		this.filteredCommands.forEach((cmd, index) => {
			const itemEl = this.listEl.createDiv({
				cls: `friday-command-item ${index === this.selectedIndex ? 'selected' : ''}`
			});
			
			// Command name (using cmd.name instead of cmd.command)
			const nameEl = itemEl.createDiv({ cls: 'friday-command-name' });
			nameEl.createSpan({ cls: 'friday-command-slash', text: cmd.name });
			
			// Command description
			itemEl.createDiv({
				cls: 'friday-command-description',
				text: cmd.description
			});
			
			// Click handler - use mousedown to fire before blur
			itemEl.addEventListener('mousedown', (e) => {
				e.preventDefault(); // Prevent input blur
				this.selectedIndex = index;
				this.confirm();
			});
			
			// Hover handler
			itemEl.addEventListener('mouseenter', () => {
				this.selectedIndex = index;
				this.render();
			});
		});
		
		// Scroll selected item into view
		const selectedEl = this.listEl.querySelector('.friday-command-item.selected');
		if (selectedEl) {
			selectedEl.scrollIntoView({ block: 'nearest' });
		}
	}
	
	/**
	 * Remove from DOM
	 */
	public destroy(): void {
		this.containerEl.remove();
	}
}
