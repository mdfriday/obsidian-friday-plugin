import type { Plugin, TFile } from "obsidian";

/**
 * Obsidian MarkdownRenderer 的配置选项
 */
export interface ObsidianRendererOptions {
  /** 是否包含 CSS 样式 */
  includeCSS?: boolean;
  
  /** 是否等待插件异步渲染完成 */
  waitForPlugins?: boolean;
  
  /** 用于解析相对路径的基准文件 */
  baseFile?: TFile;
  
  /** DOM 稳定等待超时时间（毫秒） */
  timeout?: number;
  
  /** 渲染容器宽度 */
  containerWidth?: string;
  
  /** 是否包含主题类 */
  includeTheme?: boolean;
  
  /** 是否使用样式隔离（用于与外部主题集成） */
  useStyleIsolation?: boolean;
  
  /** 样式隔离的容器选择器 */
  isolationSelector?: string;
}

/**
 * CSS 收集选项
 */
export interface CSSCollectionOptions {
  /** 是否包含 app.css */
  includeAppCSS?: boolean;
  
  /** 是否包含计算出的 CSS 变量 */
  includeCSSVariables?: boolean;
  
  /** 是否包含基础样式 */
  includeBaseStyles?: boolean;
}

/**
 * 资源处理选项
 */
export interface ResourceProcessingOptions {
  /** 基准文件路径 */
  basePath?: string;
  
  /** 是否处理 Obsidian 内部链接 */
  processInternalLinks?: boolean;
  
  /** 是否处理相对路径 */
  processRelativePaths?: boolean;
}

/**
 * 渲染上下文
 */
export interface RenderContext {
  plugin: Plugin;
  file?: TFile;
  options: ObsidianRendererOptions;
}

/**
 * CSS 收集结果
 */
export interface CSSCollectionResult {
  /** 核心 app.css 内容 */
  appCSS: string;
  
  /** 其他样式表内容 */
  additionalCSS: string;
  
  /** 基础样式 */
  baseStyles: string;
  
  /** 跳过的样式表列表 */
  skippedSheets: string[];
}

/**
 * DOM 渲染结果
 */
export interface DOMRenderResult {
  /** 渲染后的 HTML 内容 */
  html: string;
  
  /** 渲染容器 */
  container: HTMLElement;
  
  /** 是否渲染成功 */
  success: boolean;
  
  /** 错误信息（如果有） */
  error?: Error;
}

/**
 * 标题信息
 */
export interface HeaderInfo {
  /** 标题文本 */
  text: string;
  
  /** 标题级别 (1-6) */
  level: number;
  
  /** 标题 ID */
  id?: string;
  
  /** 在文档中的位置 */
  position?: {
    start: { line: number; ch: number };
    end: { line: number; ch: number };
  };
}

/**
 * 目录项
 */
export interface TOCItem {
  /** 标题文本 */
  text: string;
  
  /** 标题级别 */
  level: number;
  
  /** 锚点 ID */
  anchor: string;
  
  /** 子项 */
  children: TOCItem[];
}
