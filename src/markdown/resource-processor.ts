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
        // app://62244c1b041bc9fdd27dbfda8203cb39bde1/Users/weisun/github/sunwei/obsidian-vault/book/mdfriday.png?1754632371797
        const urlParts = appUrl.match(/^app:\/\/[^\/]+(.+?)(?:\?.*)?$/);
        if (!urlParts || !urlParts[1]) {
          continue; // 无法解析，跳过
        }

        const imagePath = decodeURIComponent(urlParts[1]);
        const imageName = path.basename(imagePath);
        
        // 检查文件是否存在
        try {
          await fs.promises.access(imagePath);
        } catch {
          console.warn(`Image file not found: ${imagePath}`);
          continue; // 文件不存在，跳过
        }

        // 目标文件路径
        const targetPath = path.join(this.obImagesDir, imageName);
        
        // 复制文件到 ob-images 目录
        await fs.promises.copyFile(imagePath, targetPath);
        
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
   * 将形如 <a class="internal-link" href="ob plugins/games/game1.md">game1</a> 
   * 转换为 <a class="internal-link" href="/sitePath/games/game1.html">game1</a>
   * @param html HTML 内容
   */
  private async processInternalLinks(html: string): Promise<string> {
    if (!this.sitePath || !this.selectedFolderName) {
      return html;
    }

    // 匹配所有 a 标签
    const aTagPattern = /<a[^>]*>/g;
    
    let processedHtml = html;
    const matches = Array.from(html.matchAll(aTagPattern));
    
    for (const match of matches) {
      try {
        const fullTag = match[0];
        
        // 检查是否包含 internal-link 类
        if (!fullTag.includes('internal-link')) {
          continue;
        }
        
        // 提取 href 属性值
        const hrefMatch = fullTag.match(/href=["']([^"']+\.md)["']/);
        if (!hrefMatch) {
          continue;
        }
        
        const originalHref = hrefMatch[1];
        
        // 检查 href 是否以 selectedFolderName 开头
        if (originalHref.startsWith(this.selectedFolderName + '/')) {
          // 提取相对于 selectedFolder 的路径
          const relativePath = originalHref.substring(this.selectedFolderName.length + 1);
          
          // 将 .md 扩展名替换为 .html
          const htmlPath = relativePath.replace(/\.md$/, '.html');
          
          // 构建新的 href
          const newHref = path.posix.join(this.sitePath, htmlPath);
          
          // 替换 href 属性中的原始值
          const newTag = fullTag.replace(`href="${originalHref}"`, `href="${newHref}"`).replace(`href='${originalHref}'`, `href='${newHref}'`);
          
          processedHtml = processedHtml.replace(fullTag, newTag);
        }
        
      } catch (error) {
        console.error('Error processing internal link:', error);
      }
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
