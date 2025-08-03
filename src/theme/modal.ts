// Theme Selection Modal
import {App, Modal, Notice} from "obsidian";
import {themeApiService} from "./themeApiService";
import type {ThemeItem} from "./types";

export class ThemeSelectionModal extends Modal {
	private selectedTheme: string;
	private onSelect: (themeUrl: string, themeName?: string, themeId?: string) => void;
	private themes: ThemeItem[] = [];
	private allTags: string[] = [];
	private selectedTags: string[] = [];
	private searchTerm: string = '';
	private loading = false;

	constructor(app: App, selectedTheme: string, onSelect: (themeUrl: string, themeName?: string, themeId?: string) => void) {
		super(app);
		this.selectedTheme = selectedTheme;
		this.onSelect = onSelect;
		this.setTitle("Choose a Theme");
	}

	async onOpen() {
		const {contentEl, modalEl} = this;
		modalEl.addClass('friday-theme-modal');

		contentEl.empty();

		// Load initial data
		await this.loadTags();
		await this.loadThemes();

		// Render the modal content
		this.renderModal();
	}

	private async loadTags() {
		try {
			this.allTags = await themeApiService.fetchAllTags();
		} catch (error) {
			console.error('Failed to load tags:', error);
		}
	}

	private async loadThemes() {
		this.loading = true;
		try {
			const result = await themeApiService.searchThemes(1, 20, this.searchTerm, this.selectedTags);
			this.themes = result.themes;
		} catch (error) {
			console.error('Failed to load themes:', error);
			this.themes = [];
		} finally {
			this.loading = false;
		}
	}

	private renderModal() {
		const {contentEl} = this;
		contentEl.empty();

		// Search section
		const searchSection = contentEl.createDiv('search-section');
		
		// Search input
		const searchWrapper = searchSection.createDiv('search-input-wrapper');
		const searchInput = searchWrapper.createEl('input', {
			type: 'text',
			placeholder: 'Search themes...',
			cls: 'search-input'
		});
		searchWrapper.createDiv('search-icon').setText('🔍');

		searchInput.addEventListener('input', async (e) => {
			this.searchTerm = (e.target as HTMLInputElement).value;
			await this.loadThemes();
			this.renderThemes();
		});

		// Tags section
		const tagsSection = searchSection.createDiv('tags-section');
		const tagsHeader = tagsSection.createDiv('tags-header');
		tagsHeader.createEl('span', {text: 'Filter by tags:', cls: 'tags-label'});
		
		if (this.selectedTags.length > 0) {
			const clearBtn = tagsHeader.createEl('button', {text: 'Clear filters', cls: 'clear-filters-btn'});
			clearBtn.addEventListener('click', async () => {
				this.selectedTags = [];
				this.searchTerm = '';
				searchInput.value = '';
				await this.loadThemes();
				this.renderModal();
			});
		}

		const tagsGrid = tagsSection.createDiv('tags-grid');
		this.allTags.forEach(tag => {
			const tagBtn = tagsGrid.createEl('button', {
				text: tag,
				cls: `tag-btn ${this.selectedTags.includes(tag) ? 'selected' : ''}`
			});
			tagBtn.addEventListener('click', async () => {
				if (this.selectedTags.includes(tag)) {
					this.selectedTags = this.selectedTags.filter(t => t !== tag);
				} else {
					this.selectedTags.push(tag);
				}
				await this.loadThemes();
				this.renderModal();
			});
		});

		// Themes section
		const themesSection = contentEl.createDiv('themes-section');
		this.renderThemes(themesSection);
	}

	private renderThemes(container?: HTMLElement) {
		const themesSection = container || this.contentEl.querySelector('.themes-section') as HTMLElement;
		if (!themesSection) return;

		themesSection.empty();

		if (this.loading) {
			themesSection.createDiv('loading-message').setText('Loading themes...');
			return;
		}

		if (this.themes.length === 0) {
			const noResults = themesSection.createDiv('no-results');
			noResults.createEl('p', {text: 'No themes found'});
			return;
		}

		const themesGrid = themesSection.createDiv('themes-grid');
		this.themes.forEach(theme => {
			const themeCard = themesGrid.createDiv(`theme-card ${theme.id === this.selectedTheme ? 'selected' : ''}`);
			
			// Set background image
			if (theme.thumbnail) {
				themeCard.style.backgroundImage = `url("${theme.thumbnail}")`;
			} else {
				// Fallback gradient background based on theme name hash
				const gradients = [
					'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
					'linear-gradient(135deg, #f093fb 0%, #f5576c 100%)',
					'linear-gradient(135deg, #4facfe 0%, #00f2fe 100%)',
					'linear-gradient(135deg, #43e97b 0%, #38f9d7 100%)',
					'linear-gradient(135deg, #fa709a 0%, #fee140 100%)',
					'linear-gradient(135deg, #a8edea 0%, #fed6e3 100%)',
					'linear-gradient(135deg, #ffecd2 0%, #fcb69f 100%)',
					'linear-gradient(135deg, #ff8a80 0%, #ea80fc 100%)'
				];
				const hash = theme.name.split('').reduce((a, b) => {
					a = ((a << 5) - a) + b.charCodeAt(0);
					return a & a;
				}, 0);
				const gradientIndex = Math.abs(hash) % gradients.length;
				themeCard.style.background = gradients[gradientIndex];
			}

			// Theme overlay with all info
			const overlay = themeCard.createDiv('theme-overlay');
			
			overlay.createEl('h3', {text: theme.name, cls: 'theme-title'});
			
			// Author and version info
			if (theme.author || theme.version) {
				const authorInfo = overlay.createDiv('theme-author-info');
				if (theme.author) {
					authorInfo.createEl('span', {text: `by ${theme.author}`, cls: 'theme-author'});
				}
				if (theme.version) {
					if (theme.author) {
						authorInfo.createEl('span', {text: ' • ', cls: 'separator'});
					}
					authorInfo.createEl('span', {text: `v${theme.version}`, cls: 'theme-version'});
				}
			}
			
			overlay.createEl('p', {text: theme.description || '', cls: 'theme-description'});

			// Theme tags
			if (theme.tags && theme.tags.length > 0) {
				const tags = overlay.createDiv('theme-tags');
				theme.tags.forEach(tag => {
					tags.createEl('span', {text: tag, cls: 'tag'});
				});
			}

			// Theme actions
			const actions = overlay.createDiv('theme-actions');
			if (theme.demo) {
				const demoLink = actions.createEl('a', {text: 'View Demo', cls: 'demo-link'});
				demoLink.href = theme.demo;
				demoLink.target = '_blank';
				// Prevent event bubbling to card click
				demoLink.addEventListener('click', (e) => {
					e.stopPropagation();
				});
			}

			const useBtn = actions.createEl('button', {
				text: theme.id === this.selectedTheme ? 'Current' : 'Use It',
				cls: `use-theme-btn ${theme.id === this.selectedTheme ? 'current' : ''}`
			});

			useBtn.addEventListener('click', (e) => {
				e.stopPropagation();
				this.onSelect(theme.download_url, theme.name, theme.id);
				this.close();
			});
			
			// Make entire card clickable
			themeCard.addEventListener('click', () => {
				this.onSelect(theme.download_url, theme.name, theme.id);
				this.close();
			});
		});
	}

	onClose() {
		const {contentEl} = this;
		contentEl.empty();
	}
}
