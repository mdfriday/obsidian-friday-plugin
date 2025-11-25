import { App, Modal, Notice } from "obsidian";
import type FridayPlugin from "../main";
import type { ProjectConfig, ProjectBuildHistory } from "./types";
import type { ProjectService } from "./service";

/**
 * Project Management Modal
 */
export class ProjectManagementModal extends Modal {
	private plugin: FridayPlugin;
	private projectService: ProjectService;
	private selectedProjectId: string | null = null;
	private projects: ProjectConfig[] = [];
	private currentProject: ProjectConfig | null = null;
	private buildHistory: ProjectBuildHistory[] = [];
	private onApply: (project: ProjectConfig) => void;
	private onExport: (previewId: string) => Promise<void>;
	private onClearHistory: (projectId: string) => Promise<void>;

	constructor(
		app: App,
		plugin: FridayPlugin,
		projectService: ProjectService,
		onApply: (project: ProjectConfig) => void,
		onExport: (previewId: string) => Promise<void>,
		onClearHistory: (projectId: string) => Promise<void>
	) {
		super(app);
		this.plugin = plugin;
		this.projectService = projectService;
		this.onApply = onApply;
		this.onExport = onExport;
		this.onClearHistory = onClearHistory;
		this.setTitle(plugin.i18n.t('projects.manage_projects'));
	}

	private t(key: string, params?: Record<string, any>): string {
		return this.plugin.i18n.t(key, params);
	}

	async onOpen() {
		const { contentEl, modalEl } = this;
		modalEl.addClass('friday-projects-modal');
		contentEl.empty();

		// Load projects data
		await this.loadProjects();

		// Render the modal with left-right layout
		this.renderModal();
	}

	private async loadProjects() {
		this.projects = this.projectService.getProjects();
		
		// Select first project by default if none selected
		if (!this.selectedProjectId && this.projects.length > 0) {
			this.selectedProjectId = this.projects[0].id;
		}

		// Load selected project details
		if (this.selectedProjectId) {
			this.currentProject = this.projectService.getProject(this.selectedProjectId) || null;
			this.buildHistory = this.projectService.getBuildHistory(this.selectedProjectId, 10);
		} else {
			this.currentProject = null;
			this.buildHistory = [];
		}
	}

	private renderModal() {
		const { contentEl } = this;
		contentEl.empty();

		// Main container with left-right layout
		const mainContainer = contentEl.createDiv('projects-main-container');

		// Left sidebar - 30%
		const leftSidebar = mainContainer.createDiv('projects-left-sidebar');
		this.renderProjectsList(leftSidebar);

		// Right content - 70%
		const rightContent = mainContainer.createDiv('projects-right-content');
		this.renderProjectDetails(rightContent);
	}

	private renderProjectsList(container: HTMLElement) {
		container.empty();

		// Header
		const header = container.createDiv('projects-list-header');
		header.createEl('h3', { text: this.t('projects.project_list'), cls: 'projects-list-title' });

		// Projects list
		const listContainer = container.createDiv('projects-list-container');

		if (this.projects.length === 0) {
			const emptyState = listContainer.createDiv('projects-empty-state');
			emptyState.createEl('p', { text: this.t('projects.no_projects'), cls: 'empty-message' });
			return;
		}

		this.projects.forEach(project => {
			const projectItem = listContainer.createDiv(
				`project-item ${this.selectedProjectId === project.id ? 'selected' : ''}`
			);

			// Project name
			projectItem.createEl('div', { text: project.name, cls: 'project-name' });

			// Project path (ID)
			projectItem.createEl('div', { text: project.id, cls: 'project-path' });

			// Click to select
			projectItem.addEventListener('click', async () => {
				this.selectedProjectId = project.id;
				await this.loadProjects();
				this.renderModal();
			});
		});
	}

	private renderProjectDetails(container: HTMLElement) {
		container.empty();

		if (!this.currentProject) {
			const emptyState = container.createDiv('project-details-empty');
			emptyState.createEl('p', { 
				text: this.t('projects.select_project_to_view'), 
				cls: 'empty-message' 
			});
			return;
		}

		// Header with Apply button
		const header = container.createDiv('project-details-header');
		const titleSection = header.createDiv('project-details-title-section');
		titleSection.createEl('h2', { text: this.currentProject.name, cls: 'project-details-title' });

		const actionsSection = header.createDiv('project-details-actions');
		
		// Apply button (only button in header now)
		const applyBtn = actionsSection.createEl('button', {
			text: this.t('projects.apply_to_panel'),
			cls: 'apply-project-btn'
		});
		applyBtn.addEventListener('click', () => {
			if (this.currentProject) {
				this.onApply(this.currentProject);
				new Notice(this.t('projects.project_applied'));
				this.close();
			}
		});

		// Project details content
		const detailsContent = container.createDiv('project-details-content');

		// Configuration section
		const configSection = detailsContent.createDiv('project-config-section');
		configSection.createEl('h3', { text: this.t('projects.configuration'), cls: 'section-title' });

		const configGrid = configSection.createDiv('config-grid');

		// Site Name
		this.renderConfigItem(configGrid, this.t('ui.site_name'), this.currentProject.name);

		// Content paths (multi-language) - show folder names only
		const contentLabel = this.t('ui.multilingual_content');
		const contentValue = this.currentProject.contents
			.map(c => {
				const folderName = c.contentPath.split('/').pop() || c.contentPath;
				return `${folderName} (${c.languageCode})`;
			})
			.join(', ');
		this.renderConfigItem(configGrid, contentLabel, contentValue);

		// Default language
		this.renderConfigItem(
			configGrid,
			this.t('ui.default_language'),
			this.currentProject.defaultContentLanguage
		);

		// Site assets - show folder name only
		if (this.currentProject.assetsPath) {
			const assetsFolderName = this.currentProject.assetsPath.split('/').pop() || this.currentProject.assetsPath;
			this.renderConfigItem(configGrid, this.t('ui.site_assets'), assetsFolderName);
		}

		// Theme
		this.renderConfigItem(configGrid, this.t('ui.theme'), this.currentProject.themeName);

		// Advanced settings
		const advancedSection = configSection.createDiv('advanced-config-section');
		advancedSection.createEl('h4', { text: this.t('ui.advanced_settings'), cls: 'subsection-title' });

		const advancedGrid = advancedSection.createDiv('config-grid');

		// Site path
		this.renderConfigItem(advancedGrid, this.t('ui.site_path'), this.currentProject.sitePath);

		// Google Analytics
		if (this.currentProject.googleAnalyticsId) {
			this.renderConfigItem(
				advancedGrid,
				this.t('ui.google_analytics_id'),
				this.currentProject.googleAnalyticsId
			);
		}

		// Disqus
		if (this.currentProject.disqusShortname) {
			this.renderConfigItem(
				advancedGrid,
				this.t('ui.disqus_shortname'),
				this.currentProject.disqusShortname
			);
		}

		// Site password - show plain text for user convenience
		if (this.currentProject.sitePassword) {
			this.renderConfigItem(
				advancedGrid,
				this.t('ui.site_password'),
				this.currentProject.sitePassword
			);
		}

		// Publish configuration section
		if (this.currentProject.publishConfig) {
			const publishSection = configSection.createDiv('publish-config-section');
			publishSection.createEl('h4', { text: this.t('ui.publish'), cls: 'subsection-title' });

			const publishGrid = publishSection.createDiv('config-grid');

			// Publish method
			const methodLabel = this.currentProject.publishConfig.method === 'netlify' 
				? this.t('ui.publish_option_netlify')
				: this.currentProject.publishConfig.method === 'ftp'
				? this.t('ui.publish_option_ftp')
				: this.t('ui.publish_option_mdfriday');
			this.renderConfigItem(publishGrid, this.t('ui.publish_method'), methodLabel);

			// Netlify configuration
			if (this.currentProject.publishConfig.netlify && 
				(this.currentProject.publishConfig.netlify.accessToken || this.currentProject.publishConfig.netlify.projectId)) {
				if (this.currentProject.publishConfig.netlify.accessToken) {
					this.renderConfigItem(
						publishGrid,
						this.t('settings.netlify_access_token'),
						'••••••' + this.currentProject.publishConfig.netlify.accessToken.slice(-4)
					);
				}
				if (this.currentProject.publishConfig.netlify.projectId) {
					this.renderConfigItem(
						publishGrid,
						this.t('settings.netlify_project_id'),
						this.currentProject.publishConfig.netlify.projectId
					);
				}
			}

			// FTP configuration
			if (this.currentProject.publishConfig.ftp && 
				(this.currentProject.publishConfig.ftp.server || this.currentProject.publishConfig.ftp.username)) {
				if (this.currentProject.publishConfig.ftp.server) {
					this.renderConfigItem(
						publishGrid,
						this.t('settings.ftp_server'),
						this.currentProject.publishConfig.ftp.server
					);
				}
				if (this.currentProject.publishConfig.ftp.username) {
					this.renderConfigItem(
						publishGrid,
						this.t('settings.ftp_username'),
						this.currentProject.publishConfig.ftp.username
					);
				}
				if (this.currentProject.publishConfig.ftp.remoteDir) {
					this.renderConfigItem(
						publishGrid,
						this.t('settings.ftp_remote_dir'),
						this.currentProject.publishConfig.ftp.remoteDir
					);
				}
			}
		}

		// Build history section
		const historySection = detailsContent.createDiv('project-history-section');
		historySection.createEl('h3', { text: this.t('projects.build_history'), cls: 'section-title' });

		const historyList = historySection.createDiv('history-list');

		if (this.buildHistory.length === 0) {
			historyList.createEl('p', { text: this.t('projects.no_build_history'), cls: 'empty-message' });
		} else {
			this.buildHistory.forEach(history => {
				const historyItem = historyList.createDiv('history-item');

				// Build type and status
				const typeIcon = history.type === 'preview' ? '👁️' : '🚀';
				const statusIcon = history.success ? '✅' : '❌';
				const typeText = history.type === 'preview' 
					? this.t('ui.preview') 
					: this.t('ui.publish');
				
				const typeStatus = historyItem.createDiv('history-type-status');
				typeStatus.createEl('span', { text: `${typeIcon} ${typeText} ${statusIcon}`, cls: 'history-type' });

				// Timestamp
				const timeAgo = this.formatTimeAgo(history.timestamp);
				historyItem.createEl('span', { text: timeAgo, cls: 'history-time' });

				// Publish method if applicable
				if (history.type === 'publish' && history.publishMethod) {
					const methodText = history.publishMethod === 'netlify' 
						? 'Netlify' 
						: history.publishMethod === 'ftp' 
						? 'FTP' 
						: 'MDFriday';
					historyItem.createEl('span', { text: methodText, cls: 'history-method' });
				}

				// URL if available (for published sites)
				if (history.url && history.type === 'publish') {
					const urlLink = historyItem.createEl('a', {
						text: this.t('projects.view_site'),
						cls: 'history-url',
						href: history.url
					});
					urlLink.target = '_blank';
				}

				// Export button if previewId is available
				if (history.previewId && history.success) {
					const exportBtn = historyItem.createEl('button', {
						text: this.t('projects.export_build'),
						cls: 'history-export-btn'
					});
					exportBtn.addEventListener('click', async () => {
						try {
							await this.onExport(history.previewId!);
						} catch (error) {
							console.error('Export failed:', error);
							new Notice(this.t('messages.export_failed', { error: error.message }), 5000);
						}
					});
				}

				// Error message if failed
				if (!history.success && history.error) {
					historyItem.createEl('div', { text: history.error, cls: 'history-error' });
				}
			});
		}

		// Danger Zone section at the bottom
		const dangerZone = detailsContent.createDiv('project-danger-zone');
		dangerZone.createEl('h3', { text: this.t('projects.danger_zone'), cls: 'danger-zone-title' });
		
		// Clear preview history section
		const clearHistoryContent = dangerZone.createDiv('danger-zone-content');
		const clearHistoryWarning = clearHistoryContent.createDiv('danger-zone-warning');
		clearHistoryWarning.createEl('strong', { text: this.t('projects.clear_history_title') });
		clearHistoryWarning.createEl('p', { text: this.t('projects.clear_history_message') });
		
		const clearHistoryBtn = clearHistoryContent.createEl('button', {
			text: this.t('projects.clear_preview_history'),
			cls: 'danger-zone-action-btn'
		});
		clearHistoryBtn.addEventListener('click', async () => {
			if (this.currentProject) {
				try {
					await this.onClearHistory(this.currentProject.id);
					// Reload the project to refresh build history
					await this.loadProjects();
					this.renderModal();
				} catch (error) {
					console.error('Clear history failed:', error);
				}
			}
		});
		
		// Separator
		dangerZone.createDiv('danger-zone-separator');
		
		// Delete project section
		const deleteContent = dangerZone.createDiv('danger-zone-content');
		const deleteWarning = deleteContent.createDiv('danger-zone-warning');
		deleteWarning.createEl('strong', { text: this.t('projects.delete_warning_title') });
		deleteWarning.createEl('p', { text: this.t('projects.delete_warning_message') });
		
		const deleteBtn = deleteContent.createEl('button', {
			text: this.t('projects.delete_project_permanent'),
			cls: 'danger-zone-delete-btn'
		});
		deleteBtn.addEventListener('click', async () => {
			if (this.currentProject && confirm(this.t('projects.confirm_delete', { name: this.currentProject.name }))) {
				await this.projectService.deleteProject(this.currentProject.id);
				this.selectedProjectId = null;
				await this.loadProjects();
				this.renderModal();
				new Notice(this.t('projects.project_deleted'));
			}
		});
	}

	private renderConfigItem(container: HTMLElement, label: string, value: string) {
		const item = container.createDiv('config-item');
		item.createEl('div', { text: label, cls: 'config-label' });
		item.createEl('div', { text: value, cls: 'config-value' });
	}

	private formatTimeAgo(timestamp: number): string {
		const now = Date.now();
		const diff = now - timestamp;
		
		const minutes = Math.floor(diff / 60000);
		const hours = Math.floor(diff / 3600000);
		const days = Math.floor(diff / 86400000);
		
		if (minutes < 1) {
			return this.t('projects.just_now');
		} else if (minutes < 60) {
			return this.t('projects.minutes_ago', { count: minutes });
		} else if (hours < 24) {
			return this.t('projects.hours_ago', { count: hours });
		} else {
			return this.t('projects.days_ago', { count: days });
		}
	}

	onClose() {
		const { contentEl } = this;
		contentEl.empty();
	}
}

