/**
 * Obsidian Markdown 渲染模块
 * 
 * 这个模块提供了基于 Obsidian 的 MarkdownRenderer 实现，
 * 满足 @mdfriday/foundry 库的接口要求，同时保持与 Obsidian 插件生态的完整兼容性。
 */

// 主要类导出
export { BaseRenderer } from "./base-renderer";
export { StyleRenderer } from "./style-renderer";
export { OBStyleRenderer } from "./obsidian-renderer";
export { ObsidianCSSCollector } from "./css-collector";
export { ObsidianResourceProcessor } from "./resource-processor";
export {
  ObsidianParsingResult, 
  ObsidianHeader, 
  ObsidianTocFragments 
} from "./obsidian-parser-result";

// 向后兼容的别名
export { OBStyleRenderer as ObsidianRenderer } from "./obsidian-renderer";

// 类型定义导出
export type {
  BaseRendererOptions,
  ObsidianRendererOptions,
  StyleRendererOptions,
  CSSCollectionOptions,
  CSSCollectionResult,
  ResourceProcessingOptions,
  RenderContext,
  DOMRenderResult,
  HeaderInfo,
  TOCItem
} from "./types";

// 工具函数导出
export {
  createRenderContainer,
  cleanupContainer,
  waitForDomStable,
  waitForResourcesLoaded,
  getCurrentTheme,
  safeExecuteWithContainer,
  withRenderContainer
} from "./dom-utils";

// 主要工厂函数
import type { Plugin } from "obsidian";
import { StyleRenderer } from "./style-renderer";
import { OBStyleRenderer } from "./obsidian-renderer";
import type { ObsidianRendererOptions, StyleRendererOptions } from "./types";

/**
 * 创建默认的 StyleRenderer 实例（Hugo风格，轻量级）
 * 这是给 @mdfriday/foundry 使用的主要工厂函数
 * 
 * @param plugin Obsidian 插件实例
 * @param options 渲染器配置选项
 * @returns StyleRenderer 实例
 * 
 * @example
 * ```typescript
 * import { createStyleRenderer } from './markdown'
 * 
 * const config: IncrementalBuildConfig = {
 *   // ... 其他配置
 *   markdown: createStyleRenderer(plugin, {
 *     autoHeadingID: true,
 *     waitForStable: false
 *   })
 * }
 * ```
 */
export function createStyleRenderer(
  plugin: Plugin,
  options: StyleRendererOptions = {}
): StyleRenderer {
  const defaultOptions: StyleRendererOptions = {
    autoHeadingID: true,
    containerWidth: "800px",
    waitForStable: false,
    timeout: 100,
    ...options
  };

  return new StyleRenderer(plugin, defaultOptions);
}

/**
 * 创建 OBStyleRenderer 实例（Obsidian风格，完整功能）
 * 
 * @param plugin Obsidian 插件实例
 * @param options 渲染器配置选项
 * @returns OBStyleRenderer 实例
 */
export function createOBStyleRenderer(
  plugin: Plugin,
  options: ObsidianRendererOptions = {}
): OBStyleRenderer {
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

  return new OBStyleRenderer(plugin, defaultOptions);
}

// 向后兼容的别名
export const createObsidianRenderer = createOBStyleRenderer;


// 默认导出主要工厂函数
export default createObsidianRenderer;
