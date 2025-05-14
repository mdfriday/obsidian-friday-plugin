/**
 * Utilities for handling Obsidian paths and assets
 * Provides functions for resolving and transforming image paths
 */

import {App, TFile} from 'obsidian';

/**
 * 图片文件扩展名列表
 */
const IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'bmp', 'ico'];

/**
 * 检查路径是否为图片路径
 * @param path 路径字符串
 * @returns 是否为图片路径
 */
function isImagePath(path: string): boolean {
    // 排除空字符串
    if (!path || path.trim() === '') return false;
    
    // 转换为小写以进行不区分大小写的比较
    const lowerPath = path.toLowerCase();
    
    // 检查是否以图片扩展名结尾
    return IMAGE_EXTENSIONS.some(ext => lowerPath.endsWith(`.${ext}`));
}

/**
 * 检查路径是否为外部 URL
 * @param path 路径字符串
 * @returns 是否为外部 URL
 */
function isExternalUrl(path: string): boolean {
    return path.startsWith('http://') || path.startsWith('https://');
}

/**
 * 获取 Obsidian 资源的原生 URI
 * 使用 Obsidian 的 API 生成指向资源的 URI
 * @param app Obsidian app 实例
 * @param file 文件对象
 * @param sourcePath 源文件路径（用于相对链接）
 * @returns Obsidian 资源 URI
 */
async function getObsidianResourceUri(app: App, file: TFile, sourcePath: string): Promise<string> {
    try {
		return app.vault.adapter.getResourcePath(file.path);
    } catch (error) {
        console.error(`生成资源 URI 时出错: ${error}`);
        return `app://obsidian.md/${file.path}`;
    }
}

/**
 * 解析图片路径，使用 Obsidian 的原生方法
 * @param imagePath 原始图片路径
 * @param app Obsidian app 实例
 * @param currentFilePath 当前文件路径，用于解析相对路径
 * @returns 解析后的图片文件对象和路径
 */
async function resolveImagePath(imagePath: string, app: App, currentFilePath: string): Promise<{file: TFile, uri: string} | null> {
    // 如果是外部 URL，直接返回原始路径
    if (isExternalUrl(imagePath)) {
        return null;
    }
    
    try {
        // 获取当前文件
        const currentFile = app.vault.getAbstractFileByPath(currentFilePath);
        if (!currentFile || !(currentFile instanceof TFile)) {
            return null;
        }
        
        // 使用 Obsidian 的链接路径工具解析链接
        // 这会正确处理相对路径和绝对路径
        const resolvedFile = app.metadataCache.getFirstLinkpathDest(imagePath, currentFilePath);
        
        if (resolvedFile && resolvedFile instanceof TFile) {
            // 使用 Obsidian 的方法获取正确的资源 URI
            const uri = await getObsidianResourceUri(app, resolvedFile, currentFilePath);
            return { file: resolvedFile, uri };
        } else {
            console.error(`无法解析图片路径: ${imagePath}`);
            return null;
        }
    } catch (error) {
        console.error(`解析图片路径时出错: ${error}`);
        return null;
    }
}

/**
 * 转换 HTML 或 Markdown 内容中的图片路径
 * @param content 要转换的内容
 * @param app Obsidian app 实例
 * @param currentFilePath 当前文件路径
 * @returns 已转换图片路径的内容
 */
export async function transformImagePaths(content: string, app: App, currentFilePath: string): Promise<string> {
    // 匹配 Markdown 和 HTML 图片模式
    // Markdown: ![alt](path)
    // HTML: <img src="path">
    const markdownPattern = /!\[.*?\]\(([^)]+)\)/g;
    const htmlPattern = /<img[^>]*src=["']([^"']+)["'][^>]*>/g;
    
    // 存储所有替换操作的 Promise
    const replacementPromises: Promise<{original: string, replacement: string}>[] = [];
    
    // 收集 Markdown 图片替换
    const markdownMatches = Array.from(content.matchAll(markdownPattern));
    for (const match of markdownMatches) {
        const fullMatch = match[0];
        const imagePath = match[1];
        
        // 如果是外部 URL，跳过
        if (isExternalUrl(imagePath)) continue;
        
        // 创建替换 Promise
        const promise = (async () => {
            const resolved = await resolveImagePath(imagePath, app, currentFilePath);
            if (resolved) {
                return {
                    original: fullMatch,
                    replacement: fullMatch.replace(imagePath, resolved.uri)
                };
            }
            return { original: fullMatch, replacement: fullMatch };
        })();
        
        replacementPromises.push(promise);
    }
    
    // 收集 HTML 图片替换
    const htmlMatches = Array.from(content.matchAll(htmlPattern));
    for (const match of htmlMatches) {
        const fullMatch = match[0];
        const imagePath = match[1];
        
        // 如果是外部 URL，跳过
        if (isExternalUrl(imagePath)) continue;
        
        // 创建替换 Promise
        const promise = (async () => {
            const resolved = await resolveImagePath(imagePath, app, currentFilePath);
            if (resolved) {
                return {
                    original: fullMatch,
                    replacement: fullMatch.replace(imagePath, resolved.uri)
                };
            }
            return { original: fullMatch, replacement: fullMatch };
        })();
        
        replacementPromises.push(promise);
    }
    
    // 等待所有替换完成
    const replacements = await Promise.all(replacementPromises);
    
    // 应用替换
    let transformedContent = content;
    for (const { original, replacement } of replacements) {
        transformedContent = transformedContent.replace(original, replacement);
    }
    
    return transformedContent;
}

/**
 * 在 shortcode 属性值中转换图片路径
 * @param content 要转换的 shortcode 内容
 * @param app Obsidian app 实例
 * @param currentFilePath 当前文件路径
 * @returns 已转换图片路径的 shortcode 内容
 */
export async function transformShortcodeImagePaths(content: string, app: App, currentFilePath: string): Promise<string> {
    // 匹配任何 attribute="value" 模式
    const attributePattern = /(\w+)=["']([^"']*)["']/g;
    const matches = Array.from(content.matchAll(attributePattern));
    
    // 存储所有替换操作的 Promise
    const replacementPromises: Promise<{
        index: number,
        fullMatch: string,
        replacement: string,
        length: number
    }>[] = [];
    
    // 收集所有替换
    for (const match of matches) {
        const fullMatch = match[0];
        const attrName = match[1];
        const attrValue = match[2];
        const matchIndex = match.index || 0;
        
        // 检查属性值是否是图片路径
        if (isImagePath(attrValue) && !isExternalUrl(attrValue)) {
            // 创建替换 Promise
            const promise = (async () => {
                const resolved = await resolveImagePath(attrValue, app, currentFilePath);
                
                if (resolved) {
                    // 使用 Obsidian 的资源 URI 创建新属性值
                    const newAttr = `${attrName}="${resolved.uri}"`;
                    return {
                        index: matchIndex,
                        fullMatch,
                        replacement: newAttr,
                        length: fullMatch.length
                    };
                } else {
                    // 如果路径无法解析，保留原始属性
                    return {
                        index: matchIndex,
                        fullMatch,
                        replacement: fullMatch,
                        length: fullMatch.length
                    };
                }
            })();
            
            replacementPromises.push(promise);
        }
    }
    
    // 如果没有需要替换的内容，直接返回原始内容
    if (replacementPromises.length === 0) {
        return content;
    }
    
    // 等待所有替换完成并按索引排序
    const replacements = (await Promise.all(replacementPromises))
        .sort((a, b) => a.index - b.index);
    
    // 应用替换
    let newContent = '';
    let lastIndex = 0;
    
    for (const { index, fullMatch, replacement } of replacements) {
        // 添加从上次位置到当前匹配开始的内容
        newContent += content.substring(lastIndex, index);
        // 添加替换后的内容
        newContent += replacement;
        // 更新最后位置
        lastIndex = index + fullMatch.length;
    }
    
    // 添加剩余内容
    newContent += content.substring(lastIndex);
    
    return newContent;
} 
