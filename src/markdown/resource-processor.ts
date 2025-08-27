import type { Plugin, TFile } from "obsidian";
import type { ResourceProcessingOptions } from "./types";
import * as path from "path";
import * as fs from "fs";

/**
 * Obsidian 资源处理器
 */
export class ObsidianResourceProcessor {
  private obImagesDir?: string;
  private sitePath?: string;
  private selectedFolderName?: string;

  constructor(private plugin: Plugin) {}

  /**
   * 配置 ob-images 目录和 sitePath
   * @param obImagesDir ob-images 目录的绝对路径
   * @param sitePath 站点路径
   * @param selectedFolderName 用户选中的文件夹名称（用于内部链接转换）
   */
  configureImageOutput(obImagesDir: string, sitePath: string, selectedFolderName?: string) {
    this.obImagesDir = obImagesDir;
    this.sitePath = sitePath;
    this.selectedFolderName = selectedFolderName;
  }

  /**
   * 处理相对路径资源（图片、附件等）
   * @param html HTML 内容
   * @param basePath 基准路径
   * @param options 处理选项
   */
  async processRelativeResources(
    html: string, 
    basePath?: string,
    options: ResourceProcessingOptions = {}
  ): Promise<string> {
    const {
      processInternalLinks = true,
      processRelativePaths = true
    } = options;

    let processedHtml = html;

    // 处理 Obsidian 内部链接格式 [[filename]] 和 ![[filename]]
    if (processInternalLinks) {
      processedHtml = await this.processObsidianLinks(processedHtml, basePath);
    }

    // 处理标准 markdown 图片语法中的相对路径
    if (processRelativePaths) {
      processedHtml = await this.processRelativePaths(processedHtml, basePath);
    }

    // 处理 app:// 图片路径
    processedHtml = await this.processAppUrls(processedHtml);

    // 处理内部链接（指向 markdown 文件的链接）
    processedHtml = await this.processInternalLinks(processedHtml);

    return processedHtml;
  }

  /**
   * 处理 app:// 格式的图片 URL
   * @param html HTML 内容
   */
  private async processAppUrls(html: string): Promise<string> {
    if (!this.obImagesDir || !this.sitePath) {
      // 如果没有配置输出目录，跳过处理
      return html;
    }

    // 匹配所有 app:// 开头的图片 src
    const appUrlPattern = /<img([^>]*?)src=["'](app:\/\/[^"']+)["']([^>]*?)>/g;
    const matches = Array.from(html.matchAll(appUrlPattern));
    
    let processedHtml = html;
    
    // 逐个处理匹配项
    for (const match of matches) {
      try {
        const [fullMatch, before, appUrl, after] = match;
        
        // 解析 app:// URL，提取实际的文件路径
        // macOS: app://62244c1b041bc9fdd27dbfda8203cb39bde1/Users/weisun/github/sunwei/obsidian-vault/book/mdfriday.png?1754632371797
        // Windows: app://f7298a11456e4f08f4983a1e41a7e5065bfc/D:/BaiduSyncdisk/mdfriday/%E5%B0%8F%E7%BA%A2%E4%B9%A6/%E5%B7%B2%E7%9C%8B/1.png?1748075861217
        const urlParts = appUrl.match(/^app:\/\/[^\/]+(.+?)(?:\?.*)?$/);
        if (!urlParts || !urlParts[1]) {
          continue; // 无法解析，跳过
        }

        // 规范化路径，处理跨平台兼容性
        const imagePath = this.normalizeAppUrlPath(urlParts[1]);
        
        const imageName = path.basename(imagePath);
        
        // 检查文件是否存在
        try {
          await fs.promises.access(imagePath);
        } catch (error) {
          console.warn(`Image file not found: ${imagePath}`, error);
          continue; // 文件不存在，跳过
        }

        // 目标文件路径
        const targetPath = path.join(this.obImagesDir, imageName);
        
        // 复制文件到 ob-images 目录
        try {
          await fs.promises.copyFile(imagePath, targetPath);
        } catch (copyError) {
          console.error(`Failed to copy image: ${imagePath}`, copyError);
          continue; // 复制失败，跳过
        }
        
        // 生成新的 src 路径 (使用正斜杠，因为这是网页路径)
        const newSrc = path.posix.join(this.sitePath, 'ob-images', imageName);
        
        // 替换原始匹配
        const newImgTag = `<img${before}src="${newSrc}"${after}>`;
        processedHtml = processedHtml.replace(fullMatch, newImgTag);
        
      } catch (error) {
        console.error(`Error processing app:// URL:`, error);
        // 出错时继续处理下一个
      }
    }

    return processedHtml;
  }

	/**
	 * 处理内部链接（指向 markdown 文件的链接）
	 * 只处理带有 data-href 且以 app:// 开头的链接
	 * 例如：<a data-href="app://xxx/path/to/file.md" href="file1" class="internal-link">file1</a>
	 * @param html HTML 内容
	 */
	private async processInternalLinks(html: string): Promise<string> {
		if (!this.sitePath || !this.selectedFolderName) {
			return html;
		}

		let processedHtml = html;

		// 使用正则表达式匹配完整的 a 标签（包括内容和闭合标签）
		const aTagPattern = /<a[^>]*data-href=["'](app:\/\/[^"']+)["'][^>]*>.*?<\/a>/g;

		const replacements: Array<{original: string, replacement: string}> = [];
		let match;

		// 收集所有需要替换的内容
		while ((match = aTagPattern.exec(html)) !== null) {
			try {
				const fullATag = match[0];
				const dataHref = match[1];

				// 从 app:// URL 中提取文件路径
				// macOS: app://6ed7f74e07ef94016f98d6fb6a21317b8511/Users/weisun/github/sunwei/obsidian-vault/tests/file1.md?1756105631239
				// Windows: app://f7298a11456e4f08f4983a1e41a7e5065bfc/D:/BaiduSyncdisk/mdfriday/%E5%B0%8F%E7%BA%A2%E4%B9%A6/%E5%B7%B2%E7%9C%8B/file1.md?1748075861217
				const urlParts = dataHref.match(/^app:\/\/[^\/]+(.+?)(?:\?.*)?$/);
				if (!urlParts || !urlParts[1]) {
					continue;
				}

				// 规范化路径，处理跨平台兼容性
				const fullPath = this.normalizeAppUrlPath(urlParts[1]);

				// 查找选中文件夹在路径中的位置 - 使用系统路径分隔符
				const folderPattern = path.sep + this.selectedFolderName + path.sep;
				const folderIndex = fullPath.indexOf(folderPattern);
				if (folderIndex === -1) {
					continue;
				}

				// 提取相对于选中文件夹的路径
				const relativePath = fullPath.substring(folderIndex + this.selectedFolderName.length + 2);

				// 将 .md 扩展名替换为 .html
				const htmlPath = relativePath.replace(/\.md$/, '.html');

				// 构建新的 href
				const newHref = path.posix.join(this.sitePath, htmlPath);

				// 提取开始标签部分
				const openTagMatch = fullATag.match(/^<a[^>]*>/);
				if (!openTagMatch) {
					continue;
				}

				const openTag = openTagMatch[0];

				// 提取当前的 href 属性值并替换（确保不匹配 data-href）
				const hrefMatch = openTag.match(/(?<!data-)href=["']([^"']+)["']/);
				if (hrefMatch) {
					const currentHref = hrefMatch[1];

					// 只替换 href 属性，使用负向后瞻确保不替换 data-href
					const newOpenTag = openTag.replace(
						/(?<!data-)href=["'][^"']*["']/,
						`href="${newHref}"`
					);

					const newFullATag = fullATag.replace(openTag, newOpenTag);

					replacements.push({
						original: fullATag,
						replacement: newFullATag
					});
				}

			} catch (error) {
				console.error('Error processing internal link:', error);
			}
		}

		// 执行所有替换
		for (const replacement of replacements) {
			processedHtml = processedHtml.replace(replacement.original, replacement.replacement);
		}

		return processedHtml;
	}

  /**
   * 处理 Obsidian 内部链接
   * @param html HTML 内容
   * @param basePath 基准路径
   */
  private async processObsidianLinks(html: string, basePath?: string): Promise<string> {
    // 处理嵌入图片 ![[filename]]
    html = html.replace(/!\[\[([^\]]+)\]\]/g, (match, filename) => {
      const linkedFile = this.findLinkedFile(filename, basePath);
      if (linkedFile) {
        const resourcePath = this.plugin.app.vault.adapter.getResourcePath(linkedFile.path);
        return `<img src="${resourcePath}" alt="${filename}">`;
      }
      return match;
    });

    // 处理普通链接 [[filename]]
    html = html.replace(/(?<!!)\[\[([^\]]+)\]\]/g, (match, filename) => {
      const linkedFile = this.findLinkedFile(filename, basePath);
      if (linkedFile) {
        // 对于普通链接，我们可以创建一个指向文件的链接
        const resourcePath = this.plugin.app.vault.adapter.getResourcePath(linkedFile.path);
        return `<a href="${resourcePath}">${filename}</a>`;
      }
      return match;
    });

    return html;
  }

  /**
   * 处理相对路径
   * @param html HTML 内容
   * @param basePath 基准路径
   */
  private async processRelativePaths(html: string, basePath?: string): Promise<string> {
    // 处理标准 markdown 图片语法中的相对路径
    html = html.replace(/<img([^>]*?)src=["']([^"']+)["']([^>]*?)>/g, (match, before, src, after) => {
      if (!this.isAbsoluteOrDataUrl(src)) {
        // 相对路径，尝试解析为 Obsidian 资源路径
        const linkedFile = this.findLinkedFile(src, basePath);
        if (linkedFile) {
          const resourcePath = this.plugin.app.vault.adapter.getResourcePath(linkedFile.path);
          return `<img${before}src="${resourcePath}"${after}>`;
        }
      }
      return match;
    });

    // 处理其他资源链接（如音频、视频等）
    html = html.replace(/<a([^>]*?)href=["']([^"']+)["']([^>]*?)>/g, (match, before, href, after) => {
      if (!this.isAbsoluteOrDataUrl(href)) {
        const linkedFile = this.findLinkedFile(href, basePath);
        if (linkedFile) {
          const resourcePath = this.plugin.app.vault.adapter.getResourcePath(linkedFile.path);
          return `<a${before}href="${resourcePath}"${after}>`;
        }
      }
      return match;
    });

    return html;
  }

  /**
   * 查找链接的文件
   * @param filename 文件名或路径
   * @param basePath 基准路径
   */
  private findLinkedFile(filename: string, basePath?: string): TFile | null {
    // 首先尝试使用 basePath 解析
    if (basePath) {
      const linkedFile = this.plugin.app.metadataCache.getFirstLinkpathDest(filename, basePath);
      if (linkedFile) {
        return linkedFile;
      }
    }

    // 如果没有 basePath 或者解析失败，尝试直接查找
    const files = this.plugin.app.vault.getFiles();
    
    // 精确匹配文件名
    let foundFile = files.find(file => file.name === filename);
    if (foundFile) {
      return foundFile;
    }

    // 匹配不带扩展名的文件名
    const nameWithoutExt = filename.replace(/\.[^/.]+$/, "");
    foundFile = files.find(file => {
      const fileNameWithoutExt = file.name.replace(/\.[^/.]+$/, "");
      return fileNameWithoutExt === nameWithoutExt;
    });
    if (foundFile) {
      return foundFile;
    }

    // 模糊匹配路径
    foundFile = files.find(file => file.path.includes(filename));
    if (foundFile) {
      return foundFile;
    }

    return null;
  }

  /**
   * 规范化 app:// URL 中的文件路径，处理跨平台兼容性
   * @param rawPath 从 app:// URL 中提取的原始路径
   */
  private normalizeAppUrlPath(rawPath: string): string {
    // URL 解码
    let normalizedPath = decodeURIComponent(rawPath);
    
    // 处理 Windows 路径的特殊情况
    if (process.platform === 'win32') {
      // 如果路径以 /D: 或 /C: 等格式开始，去掉开头的斜杠
      if (/^\/[A-Za-z]:/.test(normalizedPath)) {
        normalizedPath = normalizedPath.substring(1);
      }
      // 如果路径以 \D: 或 \C: 等格式开始，去掉开头的反斜杠
      else if (/^\\[A-Za-z]:/.test(normalizedPath)) {
        normalizedPath = normalizedPath.substring(1);
      }
      // 处理其他可能的异常情况，如路径以多个斜杠开头
      else if (/^[\/\\]+[A-Za-z]:/.test(normalizedPath)) {
        // 移除所有开头的斜杠和反斜杠，直到找到驱动器字母
        normalizedPath = normalizedPath.replace(/^[\/\\]+/, '');
      }
    }
    
    // 规范化路径分隔符（在处理完开头字符后）
    normalizedPath = path.normalize(normalizedPath);
    
    return normalizedPath;
  }

  /**
   * 检查是否为绝对 URL 或 data URL
   * @param url URL 字符串
   */
  private isAbsoluteOrDataUrl(url: string): boolean {
    return url.startsWith('http') || 
           url.startsWith('https') || 
           url.startsWith('data:') || 
           url.startsWith('app://') ||
           url.startsWith('file://') ||
           url.startsWith('//');
  }

  /**
   * 处理 HTML 中的所有资源引用
   * @param html HTML 内容
   * @param baseFile 基准文件
   */
  async processAllResources(html: string, baseFile?: TFile): Promise<string> {
    const basePath = baseFile?.path;
    
    let processedHtml = await this.processRelativeResources(html, basePath, {
      processInternalLinks: true,
      processRelativePaths: true
    });

    // 处理其他可能的资源类型
    processedHtml = await this.processMediaElements(processedHtml, basePath);
    
    return processedHtml;
  }

  /**
   * 处理媒体元素（音频、视频等）
   * @param html HTML 内容
   * @param basePath 基准路径
   */
  private async processMediaElements(html: string, basePath?: string): Promise<string> {
    // 处理音频元素
    html = html.replace(/<audio([^>]*?)src=["']([^"']+)["']([^>]*?)>/g, (match, before, src, after) => {
      if (!this.isAbsoluteOrDataUrl(src)) {
        const linkedFile = this.findLinkedFile(src, basePath);
        if (linkedFile) {
          const resourcePath = this.plugin.app.vault.adapter.getResourcePath(linkedFile.path);
          return `<audio${before}src="${resourcePath}"${after}>`;
        }
      }
      return match;
    });

    // 处理视频元素
    html = html.replace(/<video([^>]*?)src=["']([^"']+)["']([^>]*?)>/g, (match, before, src, after) => {
      if (!this.isAbsoluteOrDataUrl(src)) {
        const linkedFile = this.findLinkedFile(src, basePath);
        if (linkedFile) {
          const resourcePath = this.plugin.app.vault.adapter.getResourcePath(linkedFile.path);
          return `<video${before}src="${resourcePath}"${after}>`;
        }
      }
      return match;
    });

    // 处理 source 元素
    html = html.replace(/<source([^>]*?)src=["']([^"']+)["']([^>]*?)>/g, (match, before, src, after) => {
      if (!this.isAbsoluteOrDataUrl(src)) {
        const linkedFile = this.findLinkedFile(src, basePath);
        if (linkedFile) {
          const resourcePath = this.plugin.app.vault.adapter.getResourcePath(linkedFile.path);
          return `<source${before}src="${resourcePath}"${after}>`;
        }
      }
      return match;
    });

    return html;
  }

  /**
   * 获取文件的资源路径
   * @param file 文件对象
   */
  getResourcePath(file: TFile): string {
    return this.plugin.app.vault.adapter.getResourcePath(file.path);
  }

  /**
   * 检查文件是否为媒体文件
   * @param file 文件对象
   */
  isMediaFile(file: TFile): boolean {
    const mediaExtensions = [
      'jpg', 'jpeg', 'png', 'gif', 'svg', 'webp', 'bmp', 'ico',
      'mp3', 'wav', 'ogg', 'flac', 'm4a', 'aac',
      'mp4', 'webm', 'ogv', 'mov', 'avi', 'mkv'
    ];
    
    const extension = file.extension.toLowerCase();
    return mediaExtensions.includes(extension);
  }

  /**
   * 获取所有媒体文件
   */
  getAllMediaFiles(): TFile[] {
    return this.plugin.app.vault.getFiles().filter(file => this.isMediaFile(file));
  }
}
