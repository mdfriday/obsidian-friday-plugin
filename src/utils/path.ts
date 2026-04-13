/**
 * 路径工具函数
 * 
 * 提供跨平台路径处理功能，配合 Obsidian API 使用
 */

import { normalizePath } from 'obsidian';

/**
 * 跨平台文件系统路径拼接
 * 
 * 用于 Desktop 环境的文件系统绝对路径拼接
 * 自动检测平台并使用正确的路径分隔符（Windows: \, Unix/Mac: /）
 * 
 * @param basePath - 基础路径（用于检测路径分隔符）
 * @param segments - 要拼接的路径段
 * @returns 拼接后的完整路径
 * 
 * @example
 * // Unix/Mac
 * joinPath('/Users/name/vault', 'folder', 'file.md')
 * // => '/Users/name/vault/folder/file.md'
 * 
 * // Windows
 * joinPath('D:\\vault', 'folder', 'file.md')
 * // => 'D:\\vault\\folder\\file.md'
 */
export function joinPath(basePath: string, ...segments: string[]): string {
	if (!basePath) {
		return segments.join('/');
	}

	// 检测路径分隔符：如果 basePath 包含反斜杠，说明是 Windows 路径
	const isWindows = basePath.includes('\\');
	const separator = isWindows ? '\\' : '/';

	// 规范化所有路径段：移除前后多余的分隔符
	const normalizedSegments = segments
		.filter(seg => seg && seg.length > 0)
		.map(seg => {
			// 移除路径段两端的所有类型分隔符
			let normalized = seg.replace(/^[/\\]+/, '').replace(/[/\\]+$/, '');
			// 统一内部分隔符为当前平台的分隔符
			if (isWindows) {
				normalized = normalized.replace(/\//g, '\\');
			} else {
				normalized = normalized.replace(/\\/g, '/');
			}
			return normalized;
		})
		.filter(seg => seg.length > 0);

	// 移除 basePath 末尾的分隔符
	const normalizedBase = basePath.replace(/[/\\]+$/, '');

	// 拼接路径
	if (normalizedSegments.length === 0) {
		return normalizedBase;
	}

	return normalizedBase + separator + normalizedSegments.join(separator);
}

/**
 * Obsidian Vault 相对路径拼接
 * 
 * 专门用于 Obsidian vault.adapter 的相对路径拼接
 * 使用 Obsidian 官方的 normalizePath API 确保路径格式正确
 * Obsidian 在所有平台都使用 / 作为路径分隔符
 * 
 * @param basePath - 基础路径
 * @param segments - 要拼接的路径段
 * @returns 规范化后的相对路径（使用 / 分隔符）
 * 
 * @example
 * joinVaultPath('.obsidian/plugins/mdfriday', 'workspace')
 * // => '.obsidian/plugins/mdfriday/workspace'
 * 
 * joinVaultPath('workspace', 'projects', 'my-site')
 * // => 'workspace/projects/my-site'
 * 
 * // 即使输入包含 \，也会规范化为 /
 * joinVaultPath('.obsidian\\plugins', 'mdfriday')
 * // => '.obsidian/plugins/mdfriday'
 */
export function joinVaultPath(basePath: string, ...segments: string[]): string {
	// 简单拼接所有路径段
	const allParts = [basePath, ...segments].filter(Boolean);
	const joined = allParts.join('/');
	
	// 使用 Obsidian 官方 API 规范化路径
	// normalizePath 会：
	// 1. 统一使用 / 分隔符
	// 2. 移除多余的连续斜杠
	// 3. 处理 . 和 .. 等特殊路径
	return normalizePath(joined);
}
