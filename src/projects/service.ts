import type FridayPlugin from '../main';
import type { ProjectConfig, ProjectBuildHistory, ProjectsData } from './types';

/**
 * Service class for managing site projects
 */
export class ProjectService {
	private plugin: FridayPlugin;
	private dataFilePath: string = '';
	private data: ProjectsData;

	constructor(plugin: FridayPlugin) {
		this.plugin = plugin;
		this.data = {
			projects: [],
			buildHistory: []
		};
	}

	/**
	 * Initialize service and load data
	 */
	async initialize(): Promise<void> {
		// Initialize data file path after plugin is fully loaded
		// Use plugin directory relative path (already relative to vault)
		this.dataFilePath = `${this.plugin.pluginDir}/projects-data.json`;
		await this.loadData();
	}

	/**
	 * Load projects data from file
	 */
	private async loadData(): Promise<void> {
		try {
			const adapter = this.plugin.app.vault.adapter;

			if (await adapter.exists(this.dataFilePath)) {
				const content = await adapter.read(this.dataFilePath);
				this.data = JSON.parse(content);
				console.log('Projects data loaded successfully:', this.data.projects.length, 'projects');
			} else {
				console.log('No projects data file found, starting fresh');
			}
		} catch (error) {
			console.error('Failed to load projects data:', error);
			this.data = {
				projects: [],
				buildHistory: []
			};
		}
	}

	/**
	 * Save projects data to file
	 */
	private async saveData(): Promise<void> {
		try {
			const adapter = this.plugin.app.vault.adapter;
			await adapter.write(this.dataFilePath, JSON.stringify(this.data, null, 2));
			console.log('Projects data saved successfully:', this.data.projects.length, 'projects');
		} catch (error) {
			console.error('Failed to save projects data:', error);
			console.error('Data file path:', this.dataFilePath);
			throw error;
		}
	}

	/**
	 * Get all projects
	 */
	getProjects(): ProjectConfig[] {
		return this.data.projects;
	}

	/**
	 * Get project by ID
	 */
	getProject(id: string): ProjectConfig | undefined {
		return this.data.projects.find(p => p.id === id);
	}

	/**
	 * Save or update a project
	 */
	async saveProject(project: ProjectConfig): Promise<void> {
		const existingIndex = this.data.projects.findIndex(p => p.id === project.id);
		
		if (existingIndex >= 0) {
			// Update existing project - preserve createdAt from existing project
			const existingProject = this.data.projects[existingIndex];
			project.createdAt = existingProject.createdAt;
			project.updatedAt = Date.now();
			this.data.projects[existingIndex] = project;
			console.log('Project updated:', project.name);
		} else {
			// Add new project
			if (!project.createdAt) {
				project.createdAt = Date.now();
			}
			project.updatedAt = Date.now();
			this.data.projects.push(project);
			console.log('New project created:', project.name);
		}

		await this.saveData();
	}

	/**
	 * Delete a project
	 */
	async deleteProject(id: string): Promise<void> {
		this.data.projects = this.data.projects.filter(p => p.id !== id);
		// Also remove related build history
		this.data.buildHistory = this.data.buildHistory.filter(h => h.projectId !== id);
		await this.saveData();
	}

	/**
	 * Add build history entry
	 */
	async addBuildHistory(history: ProjectBuildHistory): Promise<void> {
		this.data.buildHistory.unshift(history);
		
		// Keep only last 50 entries per project
		const projectHistories = this.data.buildHistory.filter(h => h.projectId === history.projectId);
		if (projectHistories.length > 50) {
			const toRemove = projectHistories.slice(50);
			this.data.buildHistory = this.data.buildHistory.filter(h => !toRemove.includes(h));
		}

		await this.saveData();
	}

	/**
	 * Get build history for a project
	 */
	getBuildHistory(projectId: string, limit: number = 10): ProjectBuildHistory[] {
		return this.data.buildHistory
			.filter(h => h.projectId === projectId)
			.slice(0, limit);
	}

	/**
	 * Get all build history
	 */
	getAllBuildHistory(limit: number = 20): ProjectBuildHistory[] {
		return this.data.buildHistory.slice(0, limit);
	}

	/**
	 * Clear all build history for a project
	 */
	async clearProjectBuildHistory(projectId: string): Promise<void> {
		this.data.buildHistory = this.data.buildHistory.filter(h => h.projectId !== projectId);
		await this.saveData();
	}
}

