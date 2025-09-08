import type { Plugin, TFile } from "obsidian";
import type { ObsidianRendererOptions, RenderContext } from "./types";
import { ObsidianCSSCollector } from "./css-collector";
import { BaseRenderer } from "./base-renderer";
import { waitForResourcesLoaded, getCurrentTheme } from "./dom-utils";

/**
 * 基于 Obsidian 的 MarkdownRenderer 实现
 * 重命名为 OBStyleRenderer 以区分Hugo风格渲染器
 */
export class OBStyleRenderer extends BaseRenderer {
  // 保持向后兼容的别名
  static ObsidianRenderer = OBStyleRenderer;
  private cssCollector: ObsidianCSSCollector;
  private context: RenderContext;

  constructor(
    plugin: Plugin,
    options: ObsidianRendererOptions = {}
  ) {
    // 设置OBStyleRenderer的默认配置，包括自动标题ID
    const defaultOptions: ObsidianRendererOptions = {
      autoHeadingID: true,        // 默认启用自动标题ID
      includeCSS: true,
      waitForPlugins: true,
      waitForStable: true,        // OB渲染器需要等待插件
      timeout: 500,
      containerWidth: "1000px",
      includeTheme: true,
      ...options
    };

    super(plugin, defaultOptions);

    this.context = {
      plugin,
      options: defaultOptions
    };

    this.cssCollector = new ObsidianCSSCollector(plugin);
  }

  /**
   * 渲染 Markdown 源码为 HTML
   * @param source Markdown 源码
   */
  async render(source: string): Promise<string> {
    try {
      // 创建临时文件用于渲染上下文
      const tempFile = this.createVirtualFile(source);
      
      // 使用基类的渲染方法，包含主题，并根据需要等待资源加载
      let html = await this.renderWithObsidian(
        source, 
        this.context.options.includeTheme,
        this.context.options.containerWidth,
        this.context.options.waitForPlugins  // 传递是否等待插件加载
      );

      // 处理自动标题ID（基类会根据配置自动处理）
      html = this.ensureHeadingIDs(html);

      // 处理资源路径
      html = await this.processResources(html, tempFile);

      // 如果需要包含 CSS，则生成完整的 HTML 文档
      if (this.context.options.includeCSS) {
        html = await this.wrapWithCSS(html, tempFile.basename || "Document");
      }

      return html;
      
    } catch (error) {
      console.error("渲染 Markdown 时出错:", error);
      throw new Error(`渲染失败: ${error.message}`);
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
   * 设置基准文件（重写基类方法以同时更新context）
   */
  setBaseFile(file: TFile): void {
    super.setBaseFile(file);
    this.context.options.baseFile = file;
    this.context.file = file;
  }

  /**
   * 获取当前配置（重写基类方法以返回正确的类型）
   */
  getOptions(): ObsidianRendererOptions {
    return { ...this.context.options };
  }

  /**
   * 更新配置（重写基类方法以同时更新context）
   */
  updateOptions(options: Partial<ObsidianRendererOptions>): void {
    super.updateOptions(options);
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
   * 获取资源处理器（重写基类方法以保持接口一致性）
   */
  getResourceProcessor() {
    return super.getResourceProcessor();
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
