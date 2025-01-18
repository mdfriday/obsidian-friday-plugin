import * as crypto from 'crypto';
import type {TFile} from "obsidian";
import type FridayPlugin from "./main";

export class Store {
	plugin: FridayPlugin
	debounceSaveProjects: any
	currentProject: {[key: string]: any}

	constructor(plugin: FridayPlugin) {
		this.plugin = plugin;
	}

	loadProject(projectId: string) {
		this.currentProject = this.projectJson(this.projectKey(projectId));
	}

	saveProjects(key: string, data:{[key: string]: any}) {
		if (this.debounceSaveProjects) {
			clearTimeout(this.debounceSaveProjects);
		}
		this.debounceSaveProjects = setTimeout(() => {
			localStorage.setItem(key, JSON.stringify(data));
			console.log('Projects saved');
		}, 1000);
	}

	projectKey(projectId: string): string {
		return `mdf_proj_${projectId}`
	}

	projectJson(projectKey: string): {[key: string]: any} {
		const data = localStorage.getItem(projectKey);
		return data ? JSON.parse(data) : {};
	}

	createProject(projectId: string, file: TFile) {
		if (localStorage.getItem(this.projectKey(projectId)) !== null) {
			throw new Error(`project ID ${projectId} already exists`);
		}
		this.currentProject = {
			project_id: projectId,
			created_at: file.stat.ctime,
			updated_at: file.stat.mtime,
			hash: "",
			files: {},
		}
		this.saveProject(projectId, file)
	}

	saveProject(projectId: string, file: TFile) {
		this.getFileHash(file).then((hash) => {
			this.currentProject.hash = hash
			this.saveProjects(this.projectKey(projectId), this.currentProject);
		})
	}

	async updateProject(projectId: string, file: TFile): Promise<boolean> {
		const project = this.currentProject;
		if (!project) {
			throw new Error(`Project ID ${projectId} does not exist`);
		}

		if (await this.hasUpdated(project, file)) {
			this.saveProject(projectId, file)
			return true
		}

		return false
	}

	getRemovedPaths(activePaths: string[]): string[] {
		const filePaths = Object.keys(this.currentProject.files);  // 获取所有已存储的路径

		// 找出 files 中未出现在 currentProjectPaths 中的路径
		return filePaths.filter(path => !activePaths.includes(path));
	}

	isFileInProject(projectId: string, filePath: string): boolean {
		const project = this.currentProject;
		if (!project) {
			throw new Error(`Project ID ${projectId} does not exist`);
		}
		return project.files[filePath] !== undefined
	}

	getFileId(projectId: string, filePath: string): string {
		const project = this.currentProject;
		if (!project) {
			throw new Error(`Project ID ${projectId} does not exist`);
		}
		return project.files[filePath].file_id
	}

	getAssociatedId(projectId: string, filePath: string): string {
		const project = this.currentProject;
		if (!project) {
			throw new Error(`Project ID ${projectId} does not exist`);
		}
		return project.files[filePath].associated_id
	}

	getAssociatedType(projectId: string, filePath: string): string {
		const project = this.currentProject;
		if (!project) {
			throw new Error(`Project ID ${projectId} does not exist`);
		}
		return project.files[filePath].associated_type
	}

	addFileToProject(projectId: string, fileId: string, aid:string, aType: string, file: TFile) {
		const project = this.currentProject;
		if (!project) {
			throw new Error(`Project ID ${projectId} does not exist`);
		}

		this.saveFileToProject(project, fileId, aid, aType, file)
	}

	saveFileToProject(project: any, fileId: string, aid:string, aType: string, file: TFile) {
		this.getFileHash(file).then((hash) => {
			project.files[file.path] = {
				file_id: fileId,
				associated_id: aid,
				associated_type: aType,
				path: file.path,
				created_at: file.stat.ctime,
				updated_at: file.stat.mtime,
				hash: hash,
			};
			this.saveProjects(this.projectKey(project.project_id), project);
		})
	}

	removeFileFromProject(projectId: string, filePath: string) {
		const project = this.currentProject;
		if (!project) {
			throw new Error(`Project ID ${projectId} does not exist`);
		}

		if (project.files[filePath]) {
			delete project.files[filePath];
			this.saveProjects(this.projectKey(projectId), project);
		} else {
			throw new Error(`File path ${filePath} does not exist in project ${projectId}`);
		}
	}

	async updateFileInProject(projectId: string, fileId: string, file: TFile): Promise<boolean> {
		const project = this.currentProject;
		if (!project) {
			throw new Error(`Project ID ${projectId} does not exist`);
		}

		const fileEntity = project.files[file.path];
		if (!fileEntity) {
			throw new Error(`File path ${fileId} does not exist in project ${projectId}`);
		}

		if (await this.hasUpdated(fileEntity, file)) {
			this.saveFileToProject(project, fileId, fileEntity.associated_id, fileEntity.associated_type, file)
			return true;
		}

		return false;
	}

	async hasUpdated(entity: any, file: TFile): Promise<boolean> {
		if (entity['created_at'] == file.stat.ctime
			&& entity['updated_at'] == file.stat.mtime){
			return false
		}

		return entity['created_at'] !== file.stat.ctime
			|| entity['updated_at'] < file.stat.mtime
			|| entity['hash'] !== await this.getFileHash(file);
	}

	async getFileHash(file: TFile): Promise<string> {
		// 创建哈希计算器
		const hash = crypto.createHash('sha256');  // 可以选择不同的哈希算法，SHA-256 是常用的
		const fileBuffer = await this.plugin.app.vault.readBinary(file);

		// 更新哈希计算
		const buffer = Buffer.from(fileBuffer);
		hash.update(buffer);

		// 获取文件的哈希值（以十六进制字符串返回）
		return hash.digest('hex');
	}

}
