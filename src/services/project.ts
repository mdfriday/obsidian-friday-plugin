import type FridayPlugin from '../main';
import type {TFile, TFolder} from 'obsidian';
import type {ProgressUpdate} from '../types/events';

/**
 * Project Service Manager
 * 
 * 统一管理项目相关的所有 Foundry 服务
 * 提供高层次的业务接口，隐藏 Foundry 服务细节
 */
export class ProjectServiceManager {
	private plugin: FridayPlugin;

	constructor(plugin: FridayPlugin) {
		this.plugin = plugin;
	}

	// ==================== 项目管理 ====================

	/**
	 * 创建新项目
	 */
	async createProject(options: {
		name: string;
		folder: TFolder | null;
		file: TFile | null;
		initialConfig?: Record<string, any>;
	}): Promise<ProjectResult> {
		const { name, folder, file, initialConfig } = options;

		try {
			// 准备创建选项
			const basePath = (this.plugin.app.vault.adapter as any).getBasePath();
			const createOptions: any = {
				name,
				workspacePath: this.plugin.absWorkspacePath,
			};

			if (folder && !file) {
				// Create from folder
				const sourceFolderPath = `${basePath}/${folder.path}`;
				createOptions.sourceFolder = sourceFolderPath;
			} else if (file) {
				// Create from single file
				const sourceFilePath = `${basePath}/${file.path}`;
				createOptions.sourceFile = sourceFilePath;
			}

			// 调用 Foundry 创建项目
			const result = await this.plugin.foundryProjectService.createProject(createOptions);

			if (!result.success) {
				return { success: false, error: result.error };
			}

			console.log('[ProjectServiceManager] Project created:', name);

			// 应用初始配置（如果有）
			if (initialConfig) {
				const configResult = await this.plugin.foundryProjectConfigService.setAll(
					this.plugin.absWorkspacePath,
					name,
					initialConfig
				);

				if (!configResult.success) {
					console.warn('[ProjectServiceManager] Failed to apply initial config:', configResult.error);
				} else {
					console.log('[ProjectServiceManager] Initial config applied');
				}
			}

			return {
				success: true,
				data: {
					name,
					folder,
					file
				}
			};

		} catch (error) {
			console.error('[ProjectServiceManager] Error creating project:', error);
			return {
				success: false,
				error: (error as Error).message
			};
		}
	}

	/**
	 * 获取所有项目
	 */
	async listProjects(): Promise<ProjectInfo[]> {
		try {
			const result = await this.plugin.foundryProjectService.listProjects(
				this.plugin.absWorkspacePath
			);

			if (result.success && result.data) {
				return result.data;
			}

			return [];
		} catch (error) {
			console.error('[ProjectServiceManager] Error listing projects:', error);
			return [];
		}
	}

	/**
	 * 获取项目信息
	 */
	async getProjectInfo(projectName: string): Promise<ProjectInfo | null> {
		try {
			const result = await this.plugin.foundryProjectService.getProjectInfo(
				this.plugin.absWorkspacePath,
				projectName
			);

			if (result.success && result.data) {
				return result.data;
			}

			return null;
		} catch (error) {
			console.error('[ProjectServiceManager] Error getting project info:', error);
			return null;
		}
	}

	// ==================== 配置管理 ====================

	/**
	 * 获取项目配置
	 */
	async getConfig(projectName: string): Promise<Record<string, any>> {
		try {
			const result = await this.plugin.foundryProjectConfigService.list(
				this.plugin.absWorkspacePath,
				projectName
			);

			if (result.success && result.data) {
				return result.data.config;
			}

			return {};
		} catch (error) {
			console.error('[ProjectServiceManager] Error getting config:', error);
			return {};
		}
	}

	/**
	 * 保存单个配置项
	 */
	async saveConfig(
		projectName: string,
		key: string,
		value: any
	): Promise<boolean> {
		try {
			const result = await this.plugin.foundryProjectConfigService.set(
				this.plugin.absWorkspacePath,
				projectName,
				key,
				value
			);

			if (result.success) {
				console.log(`[ProjectServiceManager] Config saved: ${key}`);
			} else {
				console.error(`[ProjectServiceManager] Failed to save config ${key}:`, result.error);
			}

			return result.success;
		} catch (error) {
			console.error('[ProjectServiceManager] Error saving config:', error);
			return false;
		}
	}

	/**
	 * 保存完整配置
	 */
	async saveAllConfig(
		projectName: string,
		config: Record<string, any>
	): Promise<boolean> {
		try {
			const result = await this.plugin.foundryProjectConfigService.setAll(
				this.plugin.absWorkspacePath,
				projectName,
				config
			);

			if (result.success) {
				console.log('[ProjectServiceManager] All config saved');
			} else {
				console.error('[ProjectServiceManager] Failed to save all config:', result.error);
			}

			return result.success;
		} catch (error) {
			console.error('[ProjectServiceManager] Error saving all config:', error);
			return false;
		}
	}

	// ==================== 构建和预览 ====================

	/**
	 * 构建项目
	 */
	async build(
		projectName: string,
		onProgress?: (progress: ProgressUpdate) => void
	): Promise<BuildResult> {
		try {
			const result = await this.plugin.foundryBuildService.build(
				this.plugin.absWorkspacePath,
				projectName,
				{ onProgress }
			);

			return {
				success: result.success,
				error: result.error,
				outputPath: result.data?.outputPath
			};

		} catch (error) {
			console.error('[ProjectServiceManager] Error building project:', error);
			return {
				success: false,
				error: (error as Error).message
			};
		}
	}

	/**
	 * 启动预览服务器
	 */
	async startPreview(
		projectName: string,
		options: {
			port: number;
			renderer?: any;
			onProgress?: (progress: ProgressUpdate) => void;
		}
	): Promise<PreviewResult> {
		try {
		const { port, renderer, onProgress } = options;

		const result = await this.plugin.foundryServeService.startServer(
			{
				workspacePath: this.plugin.absWorkspacePath,
				projectName,
				port,
				markdown: renderer
			},
			onProgress
		);

			if (result.success && result.data) {
				// Get project info to retrieve the path
				const projectInfo = await this.getProjectInfo(projectName);
				
				return {
					success: true,
					url: result.data.url,
					port: result.data.port,
					path: projectInfo?.path // Add preview directory path
				};
			}

			return {
				success: false,
				error: result.error
			};

		} catch (error) {
			console.error('[ProjectServiceManager] Error starting preview:', error);
			return {
				success: false,
				error: (error as Error).message
			};
		}
	}

	/**
	 * 停止预览服务器
	 */
	async stopPreview(projectName: string): Promise<boolean> {
		try {
			return await this.plugin.foundryServeService.stopServer();
		} catch (error) {
			console.error('[ProjectServiceManager] Error stopping preview:', error);
			return false;
		}
	}

	// ==================== 发布 ====================

	/**
	 * 发布项目
	 */
	async publish(
		projectName: string,
		options: {
			method: string;
			config: any;
			onProgress?: (progress: ProgressUpdate) => void;
		}
	): Promise<PublishResult> {
		try {
			const { method, config, onProgress } = options;

			const result = await this.plugin.foundryPublishService.publish(
				{
					workspacePath: this.plugin.absWorkspacePath,
					projectName,
					method,
					config,
					onProgress
				}
			);

			if (result.success && result.data) {
				return {
					success: true,
					url: result.data.url
				};
			}

			return {
				success: false,
				error: result.error
			};

		} catch (error) {
			console.error('[ProjectServiceManager] Error publishing project:', error);
			return {
				success: false,
				error: (error as Error).message
			};
		}
	}

	/**
	 * 测试连接
	 */
	async testConnection(
		projectName: string,
		config: any
	): Promise<ConnectionResult> {
		try {
			const result = await this.plugin.foundryPublishService.testConnection(
				this.plugin.absWorkspacePath,
				projectName,
				config
			);

			return {
				success: result.success,
				message: result.data?.message,
				error: result.error
			};

		} catch (error) {
			console.error('[ProjectServiceManager] Error testing connection:', error);
			return {
				success: false,
				error: (error as Error).message
			};
		}
	}
}

// ==================== 类型定义 ====================

export interface ProjectResult {
	success: boolean;
	error?: string;
	data?: {
		name: string;
		folder: TFolder | null;
		file: TFile | null;
	};
}

export interface ProjectInfo {
	name: string;
	path: string;
	createdAt?: number;
	updatedAt?: number;
}

export interface BuildResult {
	success: boolean;
	error?: string;
	outputPath?: string;
}

export interface PreviewResult {
	success: boolean;
	error?: string;
	url?: string;
	port?: number;
	path?: string; // Preview directory absolute path
}

export interface PublishResult {
	success: boolean;
	error?: string;
	url?: string;
}

export interface ConnectionResult {
	success: boolean;
	error?: string;
	message?: string;
}
