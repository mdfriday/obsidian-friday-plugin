import { Plugin, MarkdownRenderer as ObsidianMarkdownRenderer } from "obsidian";
import { MarkdownRenderer, ParsingResult, AutoIDGenerator } from "@mdfriday/foundry";
import { ObsidianParsingResult } from "./obsidian-parser-result";
import { ObsidianResourceProcessor } from "./resource-processor";
import { createRenderContainer, cleanupContainer, getCurrentTheme, waitForDomStable } from "./dom-utils";

/**
 * Hugo风格渲染器配置
 */
export interface StyleRendererOptions {
  /** 是否自动生成标题ID */
  autoHeadingID?: boolean;
  
  /** 渲染容器宽度 */
  containerWidth?: string;
  
  /** 是否等待DOM稳定（默认不等待，提高性能） */
  waitForStable?: boolean;
  
  /** DOM稳定等待时间 */
  timeout?: number;
}

/**
 * 默认Hugo风格渲染器
 * 轻量级，高性能，类似example中的MarkdownIt实现
 */
export class StyleRenderer implements MarkdownRenderer {
  private options: Required<StyleRendererOptions>;
  private resourceProcessor?: ObsidianResourceProcessor;

  constructor(
    private plugin: Plugin,
    options: StyleRendererOptions = {}
  ) {
    this.options = {
      autoHeadingID: true,
      containerWidth: "800px",
      waitForStable: false,
      timeout: 100,
      ...options
    };

	this.resourceProcessor = new ObsidianResourceProcessor(plugin);
  }

  /**
   * 渲染Markdown为HTML
   * @param source Markdown源码
   */
  async render(source: string): Promise<string> {
    try {
      // 使用Obsidian的渲染引擎进行轻量级渲染
      let html = await this.renderWithObsidian(source);
      
      // 处理标题ID（如果需要）
      if (this.options.autoHeadingID) {
        html = this.ensureHeadingIDs(html);
      }
      
      // 处理资源路径（如果需要）
      if (this.resourceProcessor) {
        html = await this.resourceProcessor.processAllResources(html);
      }
      
      return html;
      
    } catch (error) {
      console.error("StyleRenderer渲染失败:", error);
      throw new Error(`渲染失败: ${error.message}`);
    }
  }

  /**
   * 解析Markdown结构
   * @param source Markdown源码
   */
  async parse(source: string): Promise<ParsingResult> {
    try {
      // 创建一个虚拟文件用于解析
      const virtualFile = this.createVirtualFile(source);
      
      // 使用ObsidianParsingResult，但直接从源码解析
      return new ObsidianParsingResult(this.plugin, virtualFile, source);
      
    } catch (error) {
      console.error("StyleRenderer解析失败:", error);
      throw new Error(`解析失败: ${error.message}`);
    }
  }

  /**
   * 使用Obsidian渲染引擎进行轻量级渲染
   */
  private async renderWithObsidian(source: string): Promise<string> {
    // 创建虚拟文件
    const virtualFile = this.createVirtualFile(source);
    
    // 创建渲染容器（轻量级，不包含主题）
    const container = createRenderContainer(undefined, this.options.containerWidth);
    
    try {
      // 使用Obsidian的MarkdownRenderer
      await ObsidianMarkdownRenderer.render(
        this.plugin.app,
        source,
        container,
        virtualFile.path,
        this.plugin
      );
      
      // 根据配置决定是否等待DOM稳定
      if (this.options.waitForStable) {
        // 使用优化的等待机制，传入源码进行预检查
        await waitForDomStable(container, this.options.timeout, source);
      }
      
      // 获取渲染后的HTML内容
      return container.innerHTML;
      
    } finally {
      // 清理容器
      cleanupContainer(container);
    }
  }

  /**
   * 确保标题有ID（如果Obsidian没有自动添加）
   */
  private ensureHeadingIDs(html: string): string {
    const idGenerator = new AutoIDGenerator();
    
    return html.replace(/<h([1-6])(?![^>]*\sid=)([^>]*)>([^<]+)<\/h[1-6]>/g, (match, level, attrs, text) => {
      const id = idGenerator.generateID(text.trim());
      return `<h${level}${attrs} id="${id}">${text}</h${level}>`;
    });
  }



  /**
   * 创建虚拟文件
   */
  private createVirtualFile(source: string): any {
    return {
      path: 'virtual-hugo.md',
      name: 'virtual-hugo.md',
      basename: 'virtual-hugo',
      extension: 'md',
      parent: null,
      vault: this.plugin.app.vault,
      stat: {
        ctime: Date.now(),
        mtime: Date.now(),
        size: source.length
      }
    };
  }

  /**
   * 获取配置
   */
  getOptions(): StyleRendererOptions {
    return { ...this.options };
  }


  /**
   * 获取资源处理器实例
   * @returns 资源处理器实例，如果未启用资源处理则返回 null
   */
  getResourceProcessor(): ObsidianResourceProcessor | null {
    return this.resourceProcessor || null;
  }
}
