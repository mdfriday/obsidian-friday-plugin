/**
 * Obsidian Mobile Repository Implementation
 * 
 * 为 Mobile 端实现基于 Vault Adapter 的 Repository
 * 参考 foundry/persistence/node-*.ts，使用 Obsidian API 实现
 */

import type {Vault} from 'obsidian';
import type {
	ContentFolderInfo,
	FileSystemRepository,
	FolderScanResult,
	FolderStructure,
	ProjectRegistry,
	StaticFolderInfo,
	SymlinkResult,
	WorkspaceMetadataData,
	WorkspaceRepository,
} from '@mdfriday/foundry/obsidian/mobile';
import {joinVaultPath} from '../utils/common';

const MDFRIDAY_DIR = '.mdfriday';
const WORKSPACE_FILE = 'workspace.json';
const PROJECTS_FILE = 'projects.json';

/**
 * 语言代码映射（参考 Friday 实现）
 */
const LANGUAGE_CODE_MAP: Record<string, string> = {
	'zh': 'zh',
	'cn': 'zh',
	'zh-cn': 'zh',
	'zh-hans': 'zh',
	'en': 'en',
	'ja': 'ja',
	'jp': 'ja',
	'ko': 'ko',
	'kr': 'ko',
	'es': 'es',
	'fr': 'fr',
	'de': 'de',
	'it': 'it',
	'pt': 'pt',
	'ru': 'ru',
};

/**
 * 映射语言代码
 */
function mapLanguageCode(code: string): string {
	const normalized = code.toLowerCase().trim();
	return LANGUAGE_CODE_MAP[normalized] || normalized;
}

/**
 * Obsidian Mobile Workspace Repository
 * 
 * 基于 Vault Adapter 实现 WorkspaceRepository 接口
 * 
 * 路径约定：
 * - workspacePath 参数是相对于 vault 根目录的路径（如 .obsidian/plugins/mdfriday/workspace）
 * - vault.adapter 接受相对路径
 */
export class ObsidianMobileWorkspaceRepository implements WorkspaceRepository {
	constructor(
		private vault: Vault,
		private pluginDir: string
	) {}

	/**
	 * 获取工作空间内的相对路径
	 * 
	 * @param workspacePath - workspace 根路径（相对于 vault）
	 * @param segments - 子路径段
	 * @returns 完整的相对路径
	 */
	private getWorkspacePath(workspacePath: string, ...segments: string[]): string {
		// workspacePath 已经是完整路径（如 .obsidian/plugins/mdfriday/workspace）
		// 使用 joinVaultPath 拼接子路径（Obsidian 约定使用 /）
		if (segments.length === 0) {
			return workspacePath;
		}
		return joinVaultPath(workspacePath, ...segments);
	}

	async isWorkspace(workspacePath: string): Promise<boolean> {
		try {
			const metadataPath = this.getWorkspacePath(workspacePath, MDFRIDAY_DIR, WORKSPACE_FILE);
			return await this.vault.adapter.exists(metadataPath);
		} catch {
			return false;
		}
	}

	async initWorkspaceStructure(
		workspacePath: string,
		modulesDir: string,
		projectsDir: string
	): Promise<void> {
		const mdfridayDir = this.getWorkspacePath(workspacePath, MDFRIDAY_DIR);
		const modulesDirPath = this.getWorkspacePath(workspacePath, modulesDir);
		const projectsDirPath = this.getWorkspacePath(workspacePath, projectsDir);

		// 创建目录（Obsidian adapter.mkdir 已支持 recursive）
		await this.vault.adapter.mkdir(mdfridayDir);
		await this.vault.adapter.mkdir(modulesDirPath);
		await this.vault.adapter.mkdir(projectsDirPath);
	}

	async saveWorkspaceMetadata(workspacePath: string, metadata: WorkspaceMetadataData): Promise<void> {
		const metadataPath = this.getWorkspacePath(workspacePath, MDFRIDAY_DIR, WORKSPACE_FILE);
		await this.vault.adapter.write(metadataPath, JSON.stringify(metadata, null, 2));
	}

	async loadWorkspaceMetadata(workspacePath: string): Promise<WorkspaceMetadataData> {
		const metadataPath = this.getWorkspacePath(workspacePath, MDFRIDAY_DIR, WORKSPACE_FILE);

		const content = await this.vault.adapter.read(metadataPath);

		return JSON.parse(content);
	}

	async saveProjectRegistry(workspacePath: string, registry: ProjectRegistry): Promise<void> {
		const registryPath = this.getWorkspacePath(workspacePath, MDFRIDAY_DIR, PROJECTS_FILE);
		await this.vault.adapter.write(registryPath, JSON.stringify(registry, null, 2));
	}

	async loadProjectRegistry(workspacePath: string): Promise<ProjectRegistry> {
		const registryPath = this.getWorkspacePath(workspacePath, MDFRIDAY_DIR, PROJECTS_FILE);
		const content = await this.vault.adapter.read(registryPath);

		return JSON.parse(content);
	}
}

/**
 * Obsidian Mobile FileSystem Repository
 * 
 * 基于 Vault Adapter 实现 FileSystemRepository 接口
 */
export class ObsidianMobileFileSystemRepository implements FileSystemRepository {
	constructor(
		private vault: Vault,
		private pluginDir: string
	) {}

	/**
	 * 规范化路径（相对于 vault 根目录）
	 * 
	 * Mobile 环境下的路径处理规则：
	 * 1. workspace 相关路径应该在 ${pluginDir}/workspace 下
	 * 2. vault.adapter 接受相对于 vault 根目录的路径（始终使用 /）
	 * 3. 传入的路径可能是：
	 *    - 绝对路径：/Users/.../workspace/...（需要提取相对部分）
	 *    - 相对路径：workspace/... 或 modules/...（需要加上 pluginDir）
	 *    - 已规范化：.obsidian/plugins/mdfriday/workspace/...（直接返回）
	 */
	private normalizePath(filePath: string): string {
		// 1. 如果路径已经包含完整的 pluginDir/workspace 前缀，直接返回
		const workspacePrefix = joinVaultPath(this.pluginDir, 'workspace');
		if (filePath.startsWith(workspacePrefix)) {
			return filePath;
		}
		
		// 2. 如果路径已经包含 pluginDir 前缀（但可能没有 workspace）
		if (filePath.startsWith(this.pluginDir)) {
			return filePath;
		}
		
		// 3. 如果是绝对路径，提取相对于 workspace 的部分
		if (filePath.startsWith('/')) {
			// 尝试找到 workspace 后面的部分
			const workspaceIndex = filePath.indexOf('/workspace/');
			if (workspaceIndex !== -1) {
				// 提取 workspace/ 之后的相对路径
				const relativePart = filePath.substring(workspaceIndex + '/workspace/'.length);
				return joinVaultPath(workspacePrefix, relativePart);
			}
			// 如果找不到 workspace，可能是 workspace 本身
			if (filePath.endsWith('/workspace')) {
				return workspacePrefix;
			}
			// 否则，去掉开头的 / 并加上前缀
			const result = joinVaultPath(workspacePrefix, filePath.substring(1));
			console.warn('[Mobile FileSystemRepo] WARNING: This might be incorrect! Path looks like vault content, not workspace.');
			return result;
		}
		
		// 4. 相对路径，直接加上 workspace 前缀
		return joinVaultPath(workspacePrefix, filePath);
	}

	async exists(filePath: string): Promise<boolean> {
		try {
			const path = this.normalizePath(filePath);
			return await this.vault.adapter.exists(path);
		} catch {
			return false;
		}
	}

	async isDirectory(filePath: string): Promise<boolean> {
		try {
			const path = this.normalizePath(filePath);
			const stat = await this.vault.adapter.stat(path);
			return stat?.type === 'folder';
		} catch {
			return false;
		}
	}

	async isFile(filePath: string): Promise<boolean> {
		try {
			const path = this.normalizePath(filePath);
			const stat = await this.vault.adapter.stat(path);
			return stat?.type === 'file';
		} catch {
			return false;
		}
	}

	async readDirectory(dirPath: string): Promise<FolderScanResult[]> {
		try {
			const path = this.normalizePath(dirPath);
			const list = await this.vault.adapter.list(path);
			
			const results: FolderScanResult[] = [];
			
			// 处理文件
			for (const filePath of list.files) {
				const name = this.basename(filePath);
				results.push({
					path: filePath,
					name,
					isDirectory: false,
					isFile: true,
				});
			}
			
			// 处理目录
			for (const folderPath of list.folders) {
				const name = this.basename(folderPath);
				results.push({
					path: folderPath,
					name,
					isDirectory: true,
					isFile: false,
				});
			}
			
			return results;
		} catch (error) {
			console.error(`[Mobile] Failed to read directory: ${dirPath}`, error);
			throw new Error(`Failed to read directory: ${(error as Error).message}`);
		}
	}

	async scanFolderStructure(dirPath: string): Promise<FolderStructure> {
		try {
			if (!await this.exists(dirPath)) {
				throw new Error(`Path does not exist: ${dirPath}`);
			}

			if (!await this.isDirectory(dirPath)) {
				throw new Error(`Path is not a directory: ${dirPath}`);
			}

			const entries = await this.readDirectory(dirPath);
			const contentFolders: ContentFolderInfo[] = [];
			let staticFolder: StaticFolderInfo | null = null;

			for (const entry of entries) {
				if (!entry.isDirectory) continue;

				const entryName = entry.name.toLowerCase();

				// Check for content directories
				if (entryName === 'content') {
					contentFolders.push({
						path: entry.path,
						languageCode: 'en', // Default language for 'content'
						weight: 0, // Highest priority
					});
				} else if (entryName.startsWith('content.')) {
					const langCode = entryName.split('.')[1];
					const mappedLangCode = mapLanguageCode(langCode);
					contentFolders.push({
						path: entry.path,
						languageCode: mappedLangCode,
						weight: 1, // Lower priority
					});
				}

				// Check for static directory
				if (entryName === 'static') {
					staticFolder = { path: entry.path };
				}
			}

			// Sort content folders: 'content' first, then others alphabetically
			contentFolders.sort((a, b) => {
				if (a.weight !== b.weight) {
					return a.weight - b.weight;
				}
				return this.basename(a.path).localeCompare(this.basename(b.path));
			});

			const isStructured = contentFolders.length > 0;

			return {
				rootPath: dirPath,
				contentFolders,
				staticFolder,
				isStructured,
			};
		} catch (error) {
			console.error(`[Mobile] Failed to scan folder structure: ${dirPath}`, error);
			throw error;
		}
	}

	async createSymlink(source: string, target: string): Promise<SymlinkResult> {
		// Mobile 不支持符号链接
		return {
			source,
			target,
			success: false,
			error: 'Symlinks are not supported on mobile',
		};
	}

	async createSymlinks(links: Array<{ source: string; target: string }>): Promise<SymlinkResult[]> {
		// Mobile 不支持符号链接
		return links.map(link => ({
			source: link.source,
			target: link.target,
			success: false,
			error: 'Symlinks are not supported on mobile',
		}));
	}

	async removeSymlink(filePath: string): Promise<void> {
		// Mobile 不支持符号链接，空操作
		console.warn('[Mobile] removeSymlink called but symlinks are not supported');
	}

	async isSymlink(filePath: string): Promise<boolean> {
		// Mobile 不支持符号链接
		return false;
	}

	async readSymlink(filePath: string): Promise<string> {
		// Mobile 不支持符号链接
		throw new Error('Symlinks are not supported on mobile');
	}

	async createDirectory(dirPath: string, recursive: boolean = false): Promise<void> {
		try {
			const path = this.normalizePath(dirPath);
			await this.vault.adapter.mkdir(path);
		} catch (error) {
			console.error(`[Mobile] Failed to create directory: ${dirPath}`, error);
			throw error;
		}
	}

	async remove(filePath: string, recursive: boolean = false): Promise<void> {
		try {
			const path = this.normalizePath(filePath);
			const isDir = await this.isDirectory(path);
			
			if (isDir) {
				// 删除目录
				await this.vault.adapter.rmdir(path, recursive);
			} else {
				// 删除文件
				await this.vault.adapter.remove(path);
			}
		} catch (error) {
			console.error(`[Mobile] Failed to remove: ${filePath}`, error);
			throw error;
		}
	}

	async stat(filePath: string): Promise<{
		isFile(): boolean;
		isDirectory(): boolean;
		isSymbolicLink(): boolean;
		size: number;
		mtime: Date;
	}> {
		try {
			const path = this.normalizePath(filePath);
			const stat = await this.vault.adapter.stat(path);
			
			if (!stat) {
				throw new Error(`File not found: ${filePath}`);
			}
			
			return {
				isFile: () => stat.type === 'file',
				isDirectory: () => stat.type === 'folder',
				isSymbolicLink: () => false, // Mobile 不支持符号链接
				size: stat.size,
				mtime: new Date(stat.mtime),
			};
		} catch (error) {
			console.error(`[Mobile] Failed to stat: ${filePath}`, error);
			throw error;
		}
	}

	async copyFile(source: string, target: string): Promise<void> {
		try {
			const sourcePath = this.normalizePath(source);
			const targetPath = this.normalizePath(target);
			
			// 确保目标目录存在
			const targetDir = this.dirname(targetPath);
			if (!(await this.exists(targetDir))) {
				await this.createDirectory(targetDir, true);
			}
			
			// 读取源文件内容
			const content = await this.vault.adapter.read(sourcePath);
			
			// 写入目标文件
			await this.vault.adapter.write(targetPath, content);
		} catch (error) {
			console.error(`[Mobile] Failed to copy file: ${source} -> ${target}`, error);
			throw error;
		}
	}

	async readFile(filePath: string, encoding: BufferEncoding = 'utf-8'): Promise<string> {
		try {
			const path = this.normalizePath(filePath);
			return await this.vault.adapter.read(path);
		} catch (error) {
			console.error(`[Mobile FileSystemRepo] Failed to read file: ${filePath}`, error);
			throw error;
		}
	}

	async writeFile(filePath: string, content: string, encoding: BufferEncoding = 'utf-8'): Promise<void> {
		try {
			const path = this.normalizePath(filePath);
			
			// 确保目录存在
			const dir = this.dirname(path);
			if (!(await this.exists(dir))) {
				await this.createDirectory(dir, true);
			}
			
			await this.vault.adapter.write(path, content);
		} catch (error) {
			console.error(`[Mobile] Failed to write file: ${filePath}`, error);
			throw error;
		}
	}

	async unlink(filePath: string): Promise<void> {
		try {
			const path = this.normalizePath(filePath);
			await this.vault.adapter.remove(path);
		} catch (error) {
			console.error(`[Mobile] Failed to delete file: ${filePath}`, error);
			throw error;
		}
	}

	async access(filePath: string): Promise<void> {
		const path = this.normalizePath(filePath);
		if (!(await this.exists(path))) {
			throw new Error(`Cannot access path: ${filePath}`);
		}
	}

	async resolvePath(filePath: string): Promise<string> {
		// Mobile 端直接返回路径，不需要处理绝对路径
		return filePath;
	}

	basename(filePath: string): string {
		// 手动解析路径的最后一段
		const parts = filePath.split('/');
		return parts[parts.length - 1] || '';
	}

	dirname(filePath: string): string {
		// 手动解析父目录
		const parts = filePath.split('/');
		parts.pop();
		return parts.join('/') || '/';
	}

	join(...paths: string[]): string {
		// 简单的路径拼接
		return paths.filter(p => p).join('/').replace(/\/+/g, '/');
	}

	// ============ 新增同步路径方法 (26.4.9) ============

	/**
	 * 同步路径解析（拼接并规范化）
	 * 用于 Domain Layer 的纯路径计算
	 */
	resolvePathSync(...paths: string[]): string {
		// 拼接路径并规范化
		return this.normalize(this.join(...paths));
	}

	/**
	 * 计算相对路径
	 * 从 from 到 to 的相对路径
	 */
	relative(from: string, to: string): string {
		// 规范化输入路径
		const fromNorm = this.normalize(from);
		const toNorm = this.normalize(to);
		
		// 分割路径
		const fromParts = fromNorm.split('/').filter(p => p && p !== '.');
		const toParts = toNorm.split('/').filter(p => p && p !== '.');
		
		// 找到公共前缀长度
		let commonLength = 0;
		const minLength = Math.min(fromParts.length, toParts.length);
		while (commonLength < minLength && fromParts[commonLength] === toParts[commonLength]) {
			commonLength++;
		}
		
		// 计算需要向上的层级数
		const upLevels = fromParts.length - commonLength;
		
		// 构建相对路径
		const relativeParts = [
			...Array(upLevels).fill('..'),
			...toParts.slice(commonLength)
		];
		
		return relativeParts.length > 0 ? relativeParts.join('/') : '.';
	}

	/**
	 * 解析路径为各个组成部分
	 */
	parsePath(path: string): {
		root: string;
		dir: string;
		base: string;
		ext: string;
		name: string;
	} {
		const base = this.basename(path);
		const dir = this.dirname(path);
		
		// 解析扩展名
		const extIndex = base.lastIndexOf('.');
		const ext = extIndex > 0 ? base.substring(extIndex) : '';
		const name = extIndex > 0 ? base.substring(0, extIndex) : base;
		
		return {
			root: path.startsWith('/') ? '/' : '',
			dir,
			base,
			ext,
			name
		};
	}

	/**
	 * 规范化路径
	 * 处理 ./ 和 ../ 等
	 */
	normalize(path: string): string {
		if (!path) return '.';
		
		// 记录是否为绝对路径
		const isAbsolutePath = path.startsWith('/');
		
		// 分割路径
		const parts = path.split('/');
		const normalized: string[] = [];
		
		for (const part of parts) {
			if (part === '' || part === '.') {
				// 跳过空字符串和当前目录
				continue;
			} else if (part === '..') {
				// 返回上级目录
				if (normalized.length > 0 && normalized[normalized.length - 1] !== '..') {
					normalized.pop();
				} else if (!isAbsolutePath) {
					// 非绝对路径时保留 ..
					normalized.push('..');
				}
				// 绝对路径时，.. 在根目录无效，直接忽略
			} else {
				normalized.push(part);
			}
		}
		
		// 构建结果
		let result = normalized.join('/');
		
		// 处理绝对路径
		if (isAbsolutePath) {
			result = '/' + result;
		}
		
		// 如果结果为空，返回当前目录
		return result || (isAbsolutePath ? '/' : '.');
	}

	/**
	 * 判断是否为绝对路径
	 */
	isAbsolute(path: string): boolean {
		return path.startsWith('/');
	}
}
