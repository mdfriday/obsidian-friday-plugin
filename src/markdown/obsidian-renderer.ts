import { MarkdownRenderer as ObsidianMarkdownRenderer, Plugin, TFile, Notice } from "obsidian";
import type { MarkdownRenderer, ParsingResult } from "@mdfriday/foundry";
import type { ObsidianRendererOptions, RenderContext } from "./types";
import { ObsidianCSSCollector } from "./css-collector";
import { ObsidianResourceProcessor } from "./resource-processor";
import { ObsidianParsingResult } from "./obsidian-parser-result";
import { 
  createRenderContainer, 
  cleanupContainer, 
  waitForDomStable, 
  waitForResourcesLoaded,
  getCurrentTheme 
} from "./dom-utils";

/**
 * 基于 Obsidian 的 MarkdownRenderer 实现
 * 重命名为 OBStyleRenderer 以区分Hugo风格渲染器
 */
export class OBStyleRenderer implements MarkdownRenderer {
  // 保持向后兼容的别名
  static ObsidianRenderer = OBStyleRenderer;
  private cssCollector: ObsidianCSSCollector;
  private resourceProcessor: ObsidianResourceProcessor;
  private context: RenderContext;

  constructor(
    plugin: Plugin,
    options: ObsidianRendererOptions = {}
  ) {
    this.context = {
      plugin,
      options: {
        includeCSS: true,
        waitForPlugins: true,
        timeout: 500,
        containerWidth: "1000px",
        includeTheme: true,
        ...options
      }
    };

    this.cssCollector = new ObsidianCSSCollector(plugin);
    this.resourceProcessor = new ObsidianResourceProcessor(plugin);
  }

  /**
   * 渲染 Markdown 源码为 HTML
   * @param source Markdown 源码
   */
  async render(source: string): Promise<string> {
    try {
      // 创建临时文件用于渲染上下文
      const tempFile = this.createTempFile(source);
      
      // 创建渲染容器
      const theme = this.context.options.includeTheme ? getCurrentTheme() : undefined;
      const container = createRenderContainer(theme, this.context.options.containerWidth);
      
      try {
        // 使用 Obsidian 的 MarkdownRenderer 进行渲染
        await ObsidianMarkdownRenderer.render(
          this.context.plugin.app,
          source,
          container,
          tempFile?.path || "",
          this.context.plugin
        );

        if (this.context.options.waitForPlugins) {
          await waitForDomStable(container, this.context.options.timeout, source);
          await waitForResourcesLoaded(container, 3000);
        }

        // 处理资源路径
        let html = await this.resourceProcessor.processAllResources(
          container.innerHTML, 
          this.context.options.baseFile || tempFile
        );

        // 如果需要包含 CSS，则生成完整的 HTML 文档
        if (this.context.options.includeCSS) {
          html = await this.wrapWithCSS(html, tempFile?.basename || "Document");
        }

        return html;
        
      } finally {
        cleanupContainer(container);
      }
      
    } catch (error) {
      console.error("渲染 Markdown 时出错:", error);
      throw new Error(`渲染失败: ${error.message}`);
    }
  }

  /**
   * 解析 Markdown 源码，返回解析结果
   * @param source Markdown 源码
   */
  async parse(source: string): Promise<ParsingResult> {
    try {
      // 创建临时文件用于解析上下文
      const tempFile = this.createTempFile(source);
      
      if (tempFile) {
        // 使用文件创建解析结果
        return new ObsidianParsingResult(this.context.plugin, tempFile, source);
      } else {
        // 如果无法创建任何文件上下文，创建一个基本的虚拟文件
        console.warn("无法找到合适的文件上下文，使用虚拟文件进行解析");
        
        // 创建一个最小的虚拟文件对象
        const vault = this.context.plugin.app.vault;
        const virtualFile = {
          path: 'virtual.md',
          name: 'virtual.md',
          basename: 'virtual',
          extension: 'md',
          parent: null,
          vault: vault,
          stat: {
            ctime: Date.now(),
            mtime: Date.now(),
            size: source.length
          }
        } as TFile;
        
        return new ObsidianParsingResult(this.context.plugin, virtualFile, source);
      }
    } catch (error) {
      console.error("解析 Markdown 时出错:", error);
      // 最后的回退：直接从源码解析
      console.warn("尝试直接从源码解析标题结构");
      
      try {
        const vault = this.context.plugin.app.vault;
        const fallbackFile = {
          path: 'fallback.md',
          name: 'fallback.md',
          basename: 'fallback',
          extension: 'md',
          parent: null,
          vault: vault,
          stat: {
            ctime: Date.now(),
            mtime: Date.now(),
            size: source.length
          }
        } as TFile;
        
        return new ObsidianParsingResult(this.context.plugin, fallbackFile, source);
      } catch (fallbackError) {
        console.error("回退解析也失败:", fallbackError);
        throw new Error(`解析失败: ${error.message}`);
      }
    }
  }

  /**
   * 创建临时文件用于渲染上下文
   * @param source Markdown 源码
   */
  private createTempFile(source: string): TFile | null {
    try {
      // 如果有基准文件，直接使用
      if (this.context.options.baseFile) {
        return this.context.options.baseFile;
      }
      
      // 创建一个虚拟的文件对象用于解析上下文
      // 为了避免TOC冲突，每次都创建唯一的虚拟文件
      const vault = this.context.plugin.app.vault;
      
      // 生成唯一的文件名，避免缓存冲突
      const timestamp = Date.now();
      const randomId = Math.random().toString(36).substring(2, 8);
      const uniqueFileName = `temp_${timestamp}_${randomId}.md`;
      
      // 创建一个唯一的虚拟文件对象
      // 这样每次解析都会有独立的上下文，避免TOC重复
      const virtualFile = {
        path: uniqueFileName,
        name: uniqueFileName,
        basename: `temp_${timestamp}_${randomId}`,
        extension: 'md',
        parent: null,
        vault: vault,
        stat: {
          ctime: timestamp,
          mtime: timestamp,
          size: source.length
        }
      } as TFile;
      
      return virtualFile;
    } catch (error) {
      console.warn("创建临时文件失败:", error);
      return null;
    }
  }

  /**
   * 将 HTML 内容包装成完整的文档（包含 CSS）
   * @param html HTML 内容
   * @param title 文档标题
   */
  private async wrapWithCSS(
    html: string, 
    title: string,
  ): Promise<string> {
    const css = await this.cssCollector.collectAllCSS({
        includeAppCSS: false, // 主题已包含 app.css，不再重复包含
        includeBaseStyles: true
      });

    const currentTheme = getCurrentTheme();

         return `<style>
${css}

</style>

<div class="obsidian-content-wrapper ${currentTheme}">
  <div class="markdown-preview-view markdown-rendered">
    ${html}
  </div>
</div>`;
  }

  /**
   * 转义 HTML 字符
   * @param text 要转义的文本
   */
  private escapeHtml(text: string): string {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  /**
   * 设置基准文件
   * @param file 基准文件
   */
  setBaseFile(file: TFile): void {
    this.context.options.baseFile = file;
    this.context.file = file;
  }

  /**
   * 获取当前配置
   */
  getOptions(): ObsidianRendererOptions {
    return { ...this.context.options };
  }

  /**
   * 更新配置
   * @param options 新的配置选项
   */
  updateOptions(options: Partial<ObsidianRendererOptions>): void {
    this.context.options = {
      ...this.context.options,
      ...options
    };
  }

  /**
   * 获取 CSS 收集器
   */
  getCSSCollector(): ObsidianCSSCollector {
    return this.cssCollector;
  }

  /**
   * 获取资源处理器
   */
  getResourceProcessor(): ObsidianResourceProcessor {
    return this.resourceProcessor;
  }

  /**
   * 渲染纯 HTML（不包含 CSS）
   * @param source Markdown 源码
   */
  async renderHTML(source: string): Promise<string> {
    const originalIncludeCSS = this.context.options.includeCSS;
    
    try {
      this.context.options.includeCSS = false;
      return await this.render(source);
    } finally {
      this.context.options.includeCSS = originalIncludeCSS;
    }
  }

}
