import { App, Modal, SuggestModal, Notice, setIcon, TFolder, TFile, FileSystemAdapter } from 'obsidian';
import type { ObsidianProjectInfo } from '@mdfriday/foundry';
import type FridayPlugin from '../main';
import { join, relative } from 'path';

/**
 * Project Management Modal using Obsidian's native SuggestModal
 * - Quick search by project name
 * - Apply project configuration to panel on selection
 * - Delete projects with confirmation
 */
export class FoundryProjectManagementModal extends SuggestModal<ObsidianProjectInfo> {
	private plugin: FridayPlugin;
	private projects: ObsidianProjectInfo[] = [];

	constructor(app: App, plugin: FridayPlugin) {
		super(app);
		this.plugin = plugin;
		
		// Set modal title
		this.setPlaceholder('Search projects...');
		
		// Set modal instructions
		this.setInstructions([
			{ command: '↑↓', purpose: 'to navigate' },
			{ command: '↵', purpose: 'to apply project' },
			{ command: 'esc', purpose: 'to dismiss' }
		]);
	}

	/**
	 * Load projects when modal opens
	 */
	async onOpen() {
		super.onOpen();
		await this.loadProjects();
	}

	/**
	 * Load all projects from Foundry
	 */
	private async loadProjects() {
		if (!this.plugin.foundryProjectService) {
			new Notice('Foundry services not initialized');
			this.close();
			return;
		}

		try {
			const result = await this.plugin.foundryProjectService.listProjects(
				this.plugin.absWorkspacePath
			);

			if (result.success && result.data) {
				this.projects = result.data;
				// Trigger re-render of suggestions
				this.inputEl.dispatchEvent(new Event('input'));
			} else {
				new Notice('Failed to load projects');
				this.close();
			}
		} catch (error) {
			console.error('[Friday] Error loading projects:', error);
			new Notice('Error loading projects');
			this.close();
		}
	}

	/**
	 * Get suggestions (filtered projects based on search input)
	 */
	getSuggestions(query: string): ObsidianProjectInfo[] {
		const lowerQuery = query.toLowerCase();
		return this.projects.filter(project =>
			project.name.toLowerCase().includes(lowerQuery)
		);
	}

	/**
	 * Render each suggestion item
	 */
	renderSuggestion(project: ObsidianProjectInfo, el: HTMLElement) {
		el.addClass('friday-project-suggestion');
		
		// Create container for project name
		const nameEl = el.createDiv({ cls: 'friday-project-name' });
		nameEl.setText(project.name);
		
		// Create delete button (right-aligned)
		const deleteEl = el.createDiv({ cls: 'friday-project-delete' });
		deleteEl.setAttribute('aria-label', 'Delete project');
		setIcon(deleteEl, 'trash-2');
		
		// Prevent delete button from triggering selection
		deleteEl.addEventListener('click', async (e) => {
			e.stopPropagation();
			e.preventDefault();
			await this.deleteProject(project);
		});
	}

	/**
	 * Handle project selection - apply to panel
	 */
	async onChooseSuggestion(project: ObsidianProjectInfo, evt: MouseEvent | KeyboardEvent) {
		// Apply project to panel using the same flow as openPublishPanel
		await this.applyProjectToPanel(project);
		
		// Open the publish panel
		await this.plugin.activateView();
	}

	/**
	 * Apply project configuration to panel
	 * Follows the same architecture as openPublishPanel but without folder/file context
	 */
	private async applyProjectToPanel(project: ObsidianProjectInfo) {
		if (!this.plugin.foundryProjectConfigService || !this.plugin.projectServiceManager) {
			new Notice('Foundry services not initialized');
			return;
		}

		try {
			// Ensure right panel is expanded (same as openPublishPanel)
			const rightSplit = this.app.workspace.rightSplit;
			if (rightSplit?.collapsed) {
				rightSplit.expand();
			}
			
			// Step 1: Set project initialization flag to prevent auto-saving during load
			this.plugin.isProjectInitializing = true;
			
			// Step 2: Set current project name FIRST
			this.plugin.currentProjectName = project.name;
			
			// Step 3: Load content from project's contentLinks
			// This is crucial for language and content configuration
			await this.loadProjectContents(project);
			
			// Step 4: Get complete project configuration from Foundry
			const config = await this.plugin.projectServiceManager.getConfig(project.name);
			
			// Step 5: Prepare complete ProjectState
			const projectState = {
				name: project.name,
				folder: null,
				file: null,
				config,
				status: 'active' as const
			};
			
			// Step 6: Call Site.svelte's initialize method (event architecture)
			if (this.plugin.siteComponent?.initialize) {
				await this.plugin.siteComponent.initialize(projectState);
				new Notice(`Loaded project: ${project.name}`);
			} else {
				console.error('[Friday] Site component not registered - cannot apply configuration');
				new Notice('Failed to apply project configuration');
			}
			
			// Step 7: Reset initialization flag
			this.plugin.isProjectInitializing = false;
			
		} catch (error) {
			console.error('[Friday] Error applying project to panel:', error);
			new Notice('Error loading project configuration');
			// Make sure to reset flag even on error
			this.plugin.isProjectInitializing = false;
		}
	}

	/**
	 * Convert absolute path to vault-relative path
	 */
	private getVaultRelativePath(absolutePath: string): string {
		const adapter = this.app.vault.adapter;
		if (adapter instanceof FileSystemAdapter) {
			const vaultBasePath = adapter.getBasePath();
			// Use path.relative to get the relative path
			const relativePath = relative(vaultBasePath, absolutePath);
			
			// Convert Windows backslashes to forward slashes (Obsidian convention)
			// This ensures cross-platform compatibility
			return relativePath.replace(/\\/g, '/');
		}
		// Fallback: return the path as-is if we can't determine the base path
		return absolutePath;
	}

	/**
	 * Load project contents from contentLinks or fileLink
	 * This restores the content files/folders associated with the project
	 */
	private async loadProjectContents(project: ObsidianProjectInfo) {
		// Clear existing contents first
		this.plugin.site.languageContents.set([]);
		
		let contentLoaded = false;
		
		// Handle folder-based projects (contentLinks)
		if (project.contentLinks && project.contentLinks.length > 0) {
			// Load each content link
			for (let i = 0; i < project.contentLinks.length; i++) {
				const contentLink = project.contentLinks[i];
				// Convert absolute path to vault-relative path
				const relativePath = this.getVaultRelativePath(contentLink.sourcePath);
				const abstractFile = this.app.vault.getAbstractFileByPath(relativePath);

				if (!abstractFile) {
					console.warn(`[Friday] Content path not found: ${contentLink.sourcePath} (relative: ${relativePath})`);
					continue;
				}

				// Determine if it's a folder or file
				let folder: TFolder | null = null;
				let file: TFile | null = null;

				if (abstractFile instanceof TFolder) {
					folder = abstractFile;
				} else if (abstractFile instanceof TFile && abstractFile.extension === 'md') {
					file = abstractFile;
				} else {
					console.warn(`[Friday] Invalid content type: ${contentLink.sourcePath}`);
					continue;
				}

				if (i === 0) {
					// First content: initialize with language
					this.plugin.site.initializeContentWithLanguage(
						folder,
						file,
						contentLink.languageCode
					);
				} else {
					// Additional contents: add with language
					this.plugin.site.addLanguageContentWithCode(
						folder,
						file,
						contentLink.languageCode
					);
				}
			}
			
			contentLoaded = true;
		}
		
		// Handle file-based projects (fileLink)
		if (project.fileLink) {
			// Convert absolute path to vault-relative path
			const relativePath = this.getVaultRelativePath(project.fileLink.sourcePath);
			const abstractFile = this.app.vault.getAbstractFileByPath(relativePath);
			
			if (!abstractFile) {
				console.warn(`[Friday] File path not found: ${project.fileLink.sourcePath} (relative: ${relativePath})`);
				this.plugin.site.initializeContent(null, null);
			} else if (abstractFile instanceof TFile && abstractFile.extension === 'md') {
				// Initialize with single file and language (use project.language as default)
				this.plugin.site.initializeContentWithLanguage(
					null,
					abstractFile,
					project.language || 'en'
				);
				contentLoaded = true;
			} else {
				console.warn(`[Friday] Invalid file type: ${project.fileLink.sourcePath}`);
				this.plugin.site.initializeContent(null, null);
			}
		}
		
		// If no content was loaded, initialize with empty content
		if (!contentLoaded) {
			console.warn('[Friday] No content links or file link found in project, initializing with empty content');
		}
		
		// Load static assets folder if specified
		if (project.staticLink) {
			// Convert absolute path to vault-relative path
			const relativePath = this.getVaultRelativePath(project.staticLink.sourcePath);
			const abstractFile = this.app.vault.getAbstractFileByPath(relativePath);
			
			if (abstractFile instanceof TFolder) {
				this.plugin.site.setSiteAssets(abstractFile);
			} else {
				console.warn(`[Friday] Static assets path not found or not a folder: ${project.staticLink.sourcePath} (relative: ${relativePath})`);
			}
		}
	}

	/**
	 * Delete a project with confirmation
	 */
	private async deleteProject(project: ObsidianProjectInfo) {
		if (!this.plugin.foundryProjectService) {
			new Notice('Foundry services not initialized');
			return;
		}

		// Confirm deletion
		const confirmed = await this.confirmDelete(project.name);
		if (!confirmed) {
			return;
		}

		try {
			const result = await this.plugin.foundryProjectService.deleteProject(
				this.plugin.absWorkspacePath,
				project.name,
				{ deleteFiles: true }
			);

			if (result.success) {
				new Notice(`Project "${project.name}" deleted`);
				
				// Remove from local list
				this.projects = this.projects.filter(p => p.id !== project.id);
				
				// Trigger re-render
				this.inputEl.dispatchEvent(new Event('input'));
			} else {
				new Notice(`Failed to delete project: ${result.error || result.message}`);
			}
		} catch (error) {
			console.error('[Friday] Error deleting project:', error);
			new Notice('Error deleting project');
		}
	}

	/**
	 * Show confirmation dialog for project deletion
	 */
	private confirmDelete(projectName: string): Promise<boolean> {
		return new Promise((resolve) => {
			const modal = new DeleteConfirmModal(this.app, projectName, resolve);
			modal.open();
		});
	}
}

/**
 * Simple confirmation modal for project deletion
 */
class DeleteConfirmModal extends Modal {
	private projectName: string;
	private callback: (confirmed: boolean) => void;

	constructor(app: App, projectName: string, callback: (confirmed: boolean) => void) {
		super(app);
		this.projectName = projectName;
		this.callback = callback;
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.empty();
		
		contentEl.createEl('h2', { text: 'Delete Project' });
		contentEl.createEl('p', { 
			text: `Are you sure you want to delete "${this.projectName}"?` 
		});
		contentEl.createEl('p', { 
			text: 'This will delete all project files and cannot be undone.',
			cls: 'mod-warning'
		});

		const buttonContainer = contentEl.createDiv({ cls: 'modal-button-container' });
		
		// Cancel button
		const cancelBtn = buttonContainer.createEl('button', { text: 'Cancel' });
		cancelBtn.addEventListener('click', () => {
			this.callback(false);
			this.close();
		});

		// Delete button
		const deleteBtn = buttonContainer.createEl('button', { 
			text: 'Delete',
			cls: 'mod-warning'
		});
		deleteBtn.addEventListener('click', () => {
			this.callback(true);
			this.close();
		});
	}

	onClose() {
		const { contentEl } = this;
		contentEl.empty();
	}
}
