// Theme Selection Modal
import {App, Modal, Notice} from "obsidian";
import {themeApiService} from "./themeApiService";
import type {ThemeItem} from "./types";
import type FridayPlugin from "../main";

export class ThemeSelectionModal extends Modal {
	private selectedTheme: string;
	private onSelect: (themeUrl: string, themeName?: string, themeId?: string) => void;
	private themes: ThemeItem[] = [];
	private allThemes: ThemeItem[] = []; // Store all themes for filtering
	private allTags: string[] = [];
	private selectedTags: string[] = [];
	private searchTerm: string = '';
	private loading = false;
	private loadingTags = false;
	private loadingError: string | null = null;
	private loadingState: 'initial' | 'tags' | 'themes' | 'search' | 'idle' | 'error' = 'idle';
	private searchTimeout: NodeJS.Timeout | null = null;
	private plugin: FridayPlugin;
	private isForSingleFile: boolean = false;

	constructor(app: App, selectedTheme: string, onSelect: (themeUrl: string, themeName?: string, themeId?: string) => void, plugin: FridayPlugin, isForSingleFile: boolean = false) {
		super(app);
		this.selectedTheme = selectedTheme;
		this.onSelect = onSelect;
		this.plugin = plugin;
		this.isForSingleFile = isForSingleFile;
		this.setTitle(plugin.i18n.t('theme.choose_theme'));
	}

	// Helper function for translations
	private t(key: string, params?: Record<string, any>): string {
		return this.plugin.i18n.t(key, params);
	}

	async onOpen() {
		const {contentEl, modalEl} = this;
		modalEl.addClass('friday-theme-modal');

		contentEl.empty();
		
		// Set initial loading state
		this.loadingState = 'initial';
		this.renderModal();

		// Load initial data
		try {
			await this.loadTags();
			await this.loadThemes();
			// After loading completes, render the full modal
			this.renderModal();
		} catch (error) {
			console.error('Failed to load initial data:', error);
			this.loadingState = 'error';
			this.loadingError = error instanceof Error ? error.message : 'Unknown error';
			this.renderModal();
		}
	}

	private async loadTags() {
		this.loadingTags = true;
		this.loadingState = 'tags';
		try {
			// Get all themes first
			this.allThemes = await themeApiService.getAllThemes(this.plugin);
			
			// Filter themes for single file mode
			if (this.isForSingleFile) {
				this.allThemes = this.allThemes.filter(theme =>
					theme.tags.some(tag => tag.toLowerCase() === 'page')
				);
			}
			
			// Extract tags from the filtered themes
			this.allTags = this.extractTagsFromThemes(this.allThemes);
		} catch (error) {
			console.error('Failed to load tags:', error);
			throw error;
		} finally {
			this.loadingTags = false;
		}
	}

	private extractTagsFromThemes(themes: ThemeItem[]): string[] {
		const allTags = themes.flatMap(theme => theme.tags);
		const uniqueTags = [...new Set(allTags)];
		return uniqueTags.sort((a, b) => a.localeCompare(b));
	}

	private async loadThemes() {
		this.loading = true;
		this.loadingState = this.searchTerm || this.selectedTags.length > 0 ? 'search' : 'themes';
		this.loadingError = null;
		
		try {
			// Use the pre-filtered themes (already filtered for single file mode if needed)
			let filteredThemes = [...this.allThemes];
			
			// Apply search term filter
			if (this.searchTerm.trim()) {
				const term = this.searchTerm.trim().toLowerCase();
				filteredThemes = filteredThemes.filter(theme => 
					theme.name.toLowerCase().includes(term) ||
					theme.author.toLowerCase().includes(term) ||
					theme.tags.some(tag => tag.toLowerCase().includes(term))
				);
			}
			
			// Apply tags filter
			if (this.selectedTags.length > 0) {
				filteredThemes = filteredThemes.filter(theme =>
					this.selectedTags.every(selectedTag =>
						theme.tags.some(tag => tag === selectedTag)
					)
				);
			}
			
			// Apply pagination (show first 20)
			this.themes = filteredThemes.slice(0, 20);
			this.loadingState = 'idle';
		} catch (error) {
			console.error('Failed to load themes:', error);
			this.themes = [];
			this.loadingState = 'error';
			this.loadingError = error instanceof Error ? error.message : 'Unknown error';
		} finally {
			this.loading = false;
		}
	}

	private renderModal() {
		const {contentEl} = this;
		contentEl.empty();
		
		// If still in initial loading state, show loading screen
		if (this.loadingState === 'initial' || this.loadingState === 'tags') {
			const themesSection = contentEl.createDiv('themes-section');
			this.renderLoadingState(themesSection);
			return;
		}

		// Search section
		const searchSection = contentEl.createDiv('search-section');
		
		// Search input
		const searchWrapper = searchSection.createDiv('search-input-wrapper');
		const searchInput = searchWrapper.createEl('input', {
			type: 'text',
			placeholder: this.t('theme.search_themes'),
			cls: 'search-input'
		});
		searchWrapper.createDiv('search-icon').setText('🔍');

		searchInput.addEventListener('input', async (e) => {
			this.searchTerm = (e.target as HTMLInputElement).value;
			
			// Clear existing timeout
			if (this.searchTimeout) {
				clearTimeout(this.searchTimeout);
			}
			
			// Debounce search
			this.searchTimeout = setTimeout(async () => {
				await this.loadThemes();
				this.renderThemes();
			}, 300); // 300ms delay
		});

		// Tags section
		const tagsSection = searchSection.createDiv('tags-section');
		const tagsHeader = tagsSection.createDiv('tags-header');
		tagsHeader.createEl('span', {text: this.t('theme.filter_by_tags'), cls: 'tags-label'});
		
		if (this.selectedTags.length > 0) {
			const clearBtn = tagsHeader.createEl('button', {text: this.t('theme.clear_filters'), cls: 'clear-filters-btn'});
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

		// Handle error state
		if (this.loadingState === 'error') {
			this.renderErrorState(themesSection);
			return;
		}

		// Handle different loading states
		if (this.loading || this.loadingState !== 'idle') {
			this.renderLoadingState(themesSection);
			return;
		}

		if (this.themes.length === 0) {
			const noResults = themesSection.createDiv('no-results');
			noResults.createEl('p', {text: this.t('theme.no_themes_found')});
			return;
		}

		const themesGrid = themesSection.createDiv('themes-grid');
		this.themes.forEach(theme => {
			const themeCard = themesGrid.createDiv(`theme-card ${theme.id === this.selectedTheme ? 'selected' : ''}`);
			
			// Theme image section (top)
			const imageSection = themeCard.createDiv('theme-image-section');
			if (theme.thumbnail) {
				imageSection.style.backgroundImage = `url("${theme.thumbnail}")`;
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
				imageSection.style.background = gradients[gradientIndex];
			}

			// Live Demo button (shown on hover)
			if (theme.demo) {
				const liveDemoBtn = imageSection.createEl('a', {
					text: this.t('theme.live_demo'),
					cls: 'live-demo-btn'
				});
				liveDemoBtn.href = theme.demo;
				liveDemoBtn.target = '_blank';
				liveDemoBtn.addEventListener('click', (e) => {
					e.stopPropagation();
				});
			}

			// Theme info section (bottom)
			const infoSection = themeCard.createDiv('theme-info-section');
			
			// Left side: name and description
			const leftInfo = infoSection.createDiv('theme-info-left');
			
			leftInfo.createEl('h3', {text: theme.name, cls: 'theme-title'});
			
			// Author and version info
			if (theme.author || theme.version) {
				const metaInfo = leftInfo.createDiv('theme-meta-info');
				if (theme.author) {
					metaInfo.createEl('span', {text: this.t('theme.by_author', { author: theme.author }), cls: 'theme-author'});
				}
				if (theme.version) {
					if (theme.author) {
						metaInfo.createEl('span', {text: ' • ', cls: 'separator'});
					}
					metaInfo.createEl('span', {text: `v${theme.version}`, cls: 'theme-version'});
				}
			}
			
			leftInfo.createEl('p', {text: theme.description || '', cls: 'theme-description'});

			// Right side: price
			const rightInfo = infoSection.createDiv('theme-info-right');
			rightInfo.createEl('div', {text: this.t('theme.free'), cls: 'theme-price'});

			// Bottom actions: tags and use button
			const bottomSection = themeCard.createDiv('theme-bottom-section');
			
			// Theme tags
			if (theme.tags && theme.tags.length > 0) {
				const tags = bottomSection.createDiv('theme-tags');
				theme.tags.forEach(tag => {
					tags.createEl('span', {text: tag, cls: 'tag'});
				});
			}

			// Use button
			const useBtn = bottomSection.createEl('button', {
				text: theme.id === this.selectedTheme ? this.t('theme.current') : this.t('theme.use_it'),
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

	private renderLoadingState(container: HTMLElement) {
		// For initial loading, show full loading screen
		if (this.loadingState === 'initial' || this.loadingState === 'tags') {
			const loadingContainer = container.createDiv('loading-container');
			
			let loadingText = this.t('theme.loading_initial');
			if (this.loadingState === 'tags') {
				loadingText = this.t('theme.loading_tags');
			}
			
			// Create spinner
			loadingContainer.createDiv('loading-spinner');
			
			// Create text elements
			loadingContainer.createDiv('loading-text').setText(loadingText);
			return;
		}
		
		// For other loading states, show simple loading message
		if (this.loading) {
			let loadingText = this.t('theme.loading_themes');
			if (this.loadingState === 'search') {
				loadingText = this.t('theme.loading_search');
			}
			
			container.createDiv('loading-message').setText(loadingText);
		}
	}
	
	private renderErrorState(container: HTMLElement) {
		const errorContainer = container.createDiv('error-container');
		
		// Error icon
		errorContainer.createDiv('error-icon').setText('⚠️');
		
		// Error message
		const errorMessage = this.loadingError || this.t('theme.loading_error');
		errorContainer.createDiv('error-message').setText(errorMessage);
		
		// Retry button
		const retryButton = errorContainer.createEl('button', {
			text: this.t('theme.retry'),
			cls: 'retry-button'
		});
		
		retryButton.addEventListener('click', async () => {
			try {
				await this.loadThemes();
			} catch (error) {
				console.error('Retry failed:', error);
			}
		});
	}

	onClose() {
		const {contentEl} = this;
		contentEl.empty();
		
		// Clear search timeout
		if (this.searchTimeout) {
			clearTimeout(this.searchTimeout);
			this.searchTimeout = null;
		}
	}
}
