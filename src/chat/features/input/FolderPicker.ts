/**
 * Folder Picker - @ mention autocomplete for folders
 */

import type { TFolder, Vault } from 'obsidian';
import { setIcon } from 'obsidian';

export interface FolderPickerOptions {
	vault: Vault;
	onSelect: (folder: TFolder) => void;
	onCancel: () => void;
}

export class FolderPicker {
	private containerEl: HTMLElement;
	private listEl: HTMLElement;
	private folders: TFolder[];
	private filteredFolders: TFolder[];
	private selectedIndex: number = 0;
	private options: FolderPickerOptions;
	
	constructor(
		parentEl: HTMLElement,
		options: FolderPickerOptions
	) {
		this.options = options;
		
		// Get all folders from vault
		this.folders = this.getAllFolders();
		this.filteredFolders = [...this.folders];
		
		// Create picker container
		this.containerEl = parentEl.createDiv({ cls: 'friday-folder-picker' });
		this.listEl = this.containerEl.createDiv({ cls: 'friday-folder-list' });
		
		this.render();
	}
	
	/**
	 * Get all folders from vault
	 */
	private getAllFolders(): TFolder[] {
		const folders: TFolder[] = [];
		const rootFolder = this.options.vault.getRoot();
		
		const traverse = (folder: TFolder) => {
			// Skip system folders
			if (folder.path.startsWith('.') || folder.name === '.obsidian') {
				return;
			}
			
			folders.push(folder);
			
			for (const child of folder.children) {
				if (child instanceof this.options.vault.adapter.constructor) {
					continue;
				}
				if ('children' in child) {
					traverse(child as TFolder);
				}
			}
		};
		
		traverse(rootFolder);
		return folders;
	}
	
	/**
	 * Filter folders by query
	 */
	public filter(query: string): void {
		const lowerQuery = query.toLowerCase();
		this.filteredFolders = this.folders.filter(folder =>
			folder.name.toLowerCase().includes(lowerQuery) ||
			folder.path.toLowerCase().includes(lowerQuery)
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
			this.filteredFolders.length - 1,
			this.selectedIndex + 1
		);
		this.render();
	}
	
	/**
	 * Confirm current selection
	 */
	public confirm(): void {
		const selected = this.filteredFolders[this.selectedIndex];
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
	 * Render folder list
	 */
	private render(): void {
		this.listEl.empty();
		
		if (this.filteredFolders.length === 0) {
			this.listEl.createDiv({
				cls: 'friday-folder-item-empty',
				text: 'No folders found'
			});
			return;
		}
		
		// Limit to 10 items for performance
		const displayFolders = this.filteredFolders.slice(0, 10);
		
		displayFolders.forEach((folder, index) => {
			const itemEl = this.listEl.createDiv({
				cls: `friday-folder-item ${index === this.selectedIndex ? 'selected' : ''}`
			});
			
			// Folder icon (SVG via setIcon)
			const iconEl = itemEl.createDiv({ cls: 'friday-folder-icon' });
			setIcon(iconEl, 'folder');
			
			// Folder name and path
			const textEl = itemEl.createDiv({ cls: 'friday-folder-text' });
			textEl.createDiv({ cls: 'friday-folder-name', text: folder.name });
			if (folder.path !== folder.name) {
				textEl.createDiv({
					cls: 'friday-folder-path',
					text: folder.path
				});
			}
			
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
		
		// Show count if more items available
		if (this.filteredFolders.length > 10) {
			this.listEl.createDiv({
				cls: 'friday-folder-more',
				text: `...and ${this.filteredFolders.length - 10} more`
			});
		}
		
		// Scroll selected item into view
		const selectedEl = this.listEl.querySelector('.friday-folder-item.selected');
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
