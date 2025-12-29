import { Plugin, MarkdownRenderer as ObsidianMarkdownRenderer, TFile } from "obsidian";
import { AutoIDGenerator } from "@mdfriday/foundry";
import type { MarkdownRenderer, ParsingResult } from "@mdfriday/foundry";
import type { BaseRendererOptions } from "./types";
import { ObsidianParsingResult } from "./obsidian-parser-result";
import { ObsidianResourceProcessor } from "./resource-processor";
import { createRenderContainer, cleanupContainer, getCurrentTheme, waitForDomStable, waitForResourcesLoaded } from "./dom-utils";

/**
 * 基础渲染器抽象类
 * 包含两个渲染器的通用逻辑
 */
export abstract class BaseRenderer implements MarkdownRenderer {
  protected options: Required<BaseRendererOptions>;
  protected resourceProcessor: ObsidianResourceProcessor;

  constructor(
    protected plugin: Plugin,
    options: BaseRendererOptions = {}
  ) {
    // 设置默认选项
    this.options = {
      autoHeadingID: true,
      containerWidth: "800px", 
      waitForStable: false,
      timeout: 100,
      baseFile: undefined,
      ...options
    } as Required<BaseRendererOptions>;

    this.resourceProcessor = new ObsidianResourceProcessor(plugin);
  }

  /**
   * 渲染Markdown为HTML - 抽象方法，子类必须实现
   */
  abstract render(source: string): Promise<string>;

  /**
   * 解析Markdown结构
   */
  async parse(source: string): Promise<ParsingResult> {
    try {
      // 创建虚拟文件用于解析
      const virtualFile = this.createVirtualFile(source);
      
      // 使用ObsidianParsingResult，但直接从源码解析
      return new ObsidianParsingResult(this.plugin, virtualFile, source);
      
    } catch (error) {
      console.error("BaseRenderer解析失败:", error);
      throw new Error(`解析失败: ${error.message}`);
    }
  }

  /**
   * 使用Obsidian渲染引擎进行基础渲染
   */
  protected async renderWithObsidian(
    source: string, 
    includeTheme?: boolean,
    customContainerWidth?: string,
    waitForResources?: boolean
  ): Promise<string> {
    // 创建虚拟文件
    const virtualFile = this.createVirtualFile(source);
    
    // 创建渲染容器
    const theme = includeTheme ? getCurrentTheme() : undefined;
    const containerWidth = customContainerWidth || this.options.containerWidth;
    const container = createRenderContainer(theme, containerWidth);
    
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
        await waitForDomStable(container, this.options.timeout, source);
      }

      // 如果需要等待资源加载（主要用于OBStyleRenderer）
      if (waitForResources) {
        await waitForResourcesLoaded(container, 3000);
      }
      
      // 获取渲染后的HTML内容
      return container.innerHTML;
      
    } finally {
      // 清理容器
      cleanupContainer(container);
    }
  }

  /**
   * 确保标题有ID（如果需要）
   */
  protected ensureHeadingIDs(html: string): string {
    if (!this.options.autoHeadingID) {
      return html;
    }

    const idGenerator = new AutoIDGenerator();
    
    return html.replace(/<h([1-6])(?![^>]*\sid=)([^>]*)>([^<]+)<\/h[1-6]>/g, (match, level, attrs, text) => {
      const id = idGenerator.generateID(text.trim());
      return `<h${level}${attrs} id="${id}">${text}</h${level}>`;
    });
  }

  /**
   * 处理资源路径
   */
  protected async processResources(html: string, baseFile?: TFile): Promise<string> {
    return await this.resourceProcessor.processAllResources(
      html, 
      this.options.baseFile || baseFile
    );
  }

  /**
   * 创建虚拟文件
   */
  protected createVirtualFile(source: string, customName?: string): TFile {
    // 生成唯一的文件名，避免缓存冲突
    const timestamp = Date.now();
    const randomId = Math.random().toString(36).substring(2, 8);
    const fileName = customName || `virtual_${timestamp}_${randomId}.md`;
    const baseName = fileName.replace(/\.md$/, '');
    
    return {
      path: fileName,
      name: fileName,
      basename: baseName,
      extension: 'md',
      parent: null,
      vault: this.plugin.app.vault,
      stat: {
        ctime: timestamp,
        mtime: timestamp,
        size: source.length
      }
    } as TFile;
  }

  /**
   * 获取配置
   */
  getOptions(): BaseRendererOptions {
    return { ...this.options };
  }

  /**
   * 设置基准文件
   */
  setBaseFile(file: TFile): void {
    this.options.baseFile = file;
  }

  /**
   * 获取资源处理器实例
   */
  getResourceProcessor(): ObsidianResourceProcessor {
    return this.resourceProcessor;
  }

  /**
   * 更新配置
   */
  updateOptions(options: Partial<BaseRendererOptions>): void {
    this.options = {
      ...this.options,
      ...options
    } as Required<BaseRendererOptions>;
  }
}
