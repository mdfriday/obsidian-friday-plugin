import type { Plugin } from "obsidian";
import type { StyleRendererOptions } from "./types";
import { BaseRenderer } from "./base-renderer";

/**
 * 默认Hugo风格渲染器
 * 轻量级，高性能，类似example中的MarkdownIt实现
 */
export class StyleRenderer extends BaseRenderer {
  constructor(
    plugin: Plugin,
    options: StyleRendererOptions = {}
  ) {
    // 设置StyleRenderer的默认配置
    const defaultOptions: StyleRendererOptions = {
      autoHeadingID: true,
      containerWidth: "800px",
      waitForStable: false,
      timeout: 100,
      ...options
    };

    super(plugin, defaultOptions);
  }

  /**
   * 渲染Markdown为HTML
   * @param source Markdown源码
   */
  async render(source: string): Promise<string> {
    try {
      // 使用基类的渲染方法进行轻量级渲染（不包含主题）
      let html = await this.renderWithObsidian(source, false);
      
      // 处理标题ID（基类会根据配置自动处理）
      html = this.ensureHeadingIDs(html);
      
      // 处理资源路径
      html = await this.processResources(html);
      
      return html;
      
    } catch (error) {
      console.error("StyleRenderer渲染失败:", error);
      throw new Error(`渲染失败: ${error.message}`);
    }
  }

  /**
   * 获取配置（重写基类方法以返回正确的类型）
   */
  getOptions(): StyleRendererOptions {
    return super.getOptions() as StyleRendererOptions;
  }
}
