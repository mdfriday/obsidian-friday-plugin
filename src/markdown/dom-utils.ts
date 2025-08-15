import { DOMRenderResult } from "./types";

/**
 * 渲染复杂度等级
 */
export enum RenderingComplexity {
  SIMPLE = 'simple',        // 纯文本，不需要等待
  BASIC = 'basic',          // 基本格式，需要短暂等待
  COMPLEX = 'complex',      // 复杂内容，需要较长等待
  HEAVY = 'heavy'           // 重度插件内容，需要完整等待
}

/**
 * 分析内容的渲染复杂度
 * @param source Markdown 源码
 * @returns 渲染复杂度等级和建议的超时时间
 */
export function analyzeRenderingComplexity(source: string): { 
  complexity: RenderingComplexity; 
  suggestedTimeout: number;
  patterns: string[];
} {
  const detectedPatterns: string[] = [];
  let complexity = RenderingComplexity.SIMPLE;
  let suggestedTimeout = 50;

  // 简单内容检测
  const simplePatterns = [
    { pattern: /^[^$\[\]`%<]*$/, name: '纯文本', timeout: 0 }
  ];

  // 基础内容检测
  const basicPatterns = [
    { pattern: /\*\*.*?\*\*/, name: '粗体', timeout: 50 },
    { pattern: /\*.*?\*/, name: '斜体', timeout: 50 },
    { pattern: /`.*?`/, name: '行内代码', timeout: 50 },
    { pattern: /^#+\s/, name: '标题', timeout: 50 },
    { pattern: /^\s*[-*+]\s/, name: '列表', timeout: 100 }
  ];

  // 复杂内容检测
  const complexPatterns = [
    { pattern: /```[\s\S]*?```/, name: '代码块', timeout: 200 },
    { pattern: /!\[.*?\]\(.*?\)/, name: '图片链接', timeout: 300 },
    { pattern: /\[.*?\]\(.*?\)/, name: '链接', timeout: 150 },
    { pattern: /\|.*\|/, name: '表格', timeout: 200 },
    { pattern: /\[\[.*?\]\]/, name: '内部链接', timeout: 300 }
  ];

  // 重度插件内容检测
  const heavyPatterns = [
    { pattern: /\$\$[\s\S]*?\$\$/, name: '数学公式块', timeout: 800 },
    { pattern: /\$[^$\n]+\$/, name: '行内数学公式', timeout: 400 },
    { pattern: /```mermaid[\s\S]*?```/, name: 'Mermaid图表', timeout: 1000 },
    { pattern: /```dataview[\s\S]*?```/, name: 'Dataview查询', timeout: 1200 },
    { pattern: /```chart[\s\S]*?```/, name: '图表插件', timeout: 800 },
    { pattern: /%%.+%%/, name: '插件注释', timeout: 300 },
    { pattern: /<canvas/, name: 'Canvas元素', timeout: 600 },
    { pattern: /class=".*plugin.*"/, name: '插件类名', timeout: 500 },
    { pattern: /data-.*plugin/, name: '插件数据属性', timeout: 500 }
  ];

  // 检测重度内容
  for (const { pattern, name, timeout } of heavyPatterns) {
    if (pattern.test(source)) {
      detectedPatterns.push(name);
      complexity = RenderingComplexity.HEAVY;
      suggestedTimeout = Math.max(suggestedTimeout, timeout);
    }
  }

  // 如果没有重度内容，检测复杂内容
  if (complexity === RenderingComplexity.SIMPLE) {
    for (const { pattern, name, timeout } of complexPatterns) {
      if (pattern.test(source)) {
        detectedPatterns.push(name);
        complexity = RenderingComplexity.COMPLEX;
        suggestedTimeout = Math.max(suggestedTimeout, timeout);
      }
    }
  }

  // 如果没有复杂内容，检测基础内容
  if (complexity === RenderingComplexity.SIMPLE) {
    for (const { pattern, name, timeout } of basicPatterns) {
      if (pattern.test(source)) {
        detectedPatterns.push(name);
        complexity = RenderingComplexity.BASIC;
        suggestedTimeout = Math.max(suggestedTimeout, timeout);
      }
    }
  }

  // 检测纯文本
  if (complexity === RenderingComplexity.SIMPLE) {
    for (const { pattern, name, timeout } of simplePatterns) {
      if (pattern.test(source)) {
        detectedPatterns.push(name);
        suggestedTimeout = timeout;
        break;
      }
    }
  }

  return { complexity, suggestedTimeout, patterns: detectedPatterns };
}

/**
 * 快速检查内容是否需要插件渲染
 * @param source Markdown 源码
 * @returns 是否可能需要插件渲染
 */
export function needsPluginRendering(source: string): boolean {
  const { complexity } = analyzeRenderingComplexity(source);
  return complexity === RenderingComplexity.COMPLEX || complexity === RenderingComplexity.HEAVY;
}

/**
 * 智能检查容器是否包含需要异步渲染的元素
 * @param container 渲染容器
 * @returns 是否包含异步元素
 */
export function hasAsyncElements(container: HTMLElement): boolean {
  // 检查常见的异步渲染元素
  const asyncSelectors = [
    '.math', // 数学公式
    '.mermaid', // Mermaid 图表
    '.dataview', // Dataview
    '.chart', // 图表
    'canvas', // Canvas 元素
    '[data-plugin]', // 插件元素
    '.cm-editor', // CodeMirror 编辑器
    '.obsidian-search-match-highlight', // 搜索高亮
    '.internal-link', // 内部链接
  ];

  return asyncSelectors.some(selector => container.querySelector(selector) !== null);
}

/**
 * 监听容器的 DOM 变动，等待变动停止一定时间（timeout ms）后判定渲染完成
 * 优化版本：智能检测是否需要等待
 * @param container 渲染容器
 * @param timeout 变动停止时间，默认 300ms
 * @param source 原始 Markdown 内容（用于预检查）
 */
export function waitForDomStable(container: HTMLElement, timeout = 300, source?: string): Promise<void> {
  return new Promise((resolve) => {
    let timer: NodeJS.Timeout | null = null;
    let changeCount = 0;
    const startTime = Date.now();

    // 智能复杂度分析
    if (source) {
      const analysis = analyzeRenderingComplexity(source);

      // 根据复杂度调整策略
      if (analysis.complexity === RenderingComplexity.SIMPLE) {
        resolve();
        return;
      }
      
      if (analysis.complexity === RenderingComplexity.BASIC) {
        // 基础内容，使用更短的超时
        timeout = Math.min(timeout, 100);
      } else {
        // 复杂内容，使用建议的超时时间
        timeout = Math.min(analysis.suggestedTimeout, timeout);
      }
    }

    // 检查容器是否包含异步元素
    if (!hasAsyncElements(container)) {
      resolve();
      return;
    }

    // 根据复杂度设置最大等待时间
    let maxWaitTime = 2000; // 默认 2 秒
    if (source) {
      const analysis = analyzeRenderingComplexity(source);
      switch (analysis.complexity) {
        case RenderingComplexity.BASIC:
          maxWaitTime = 500;
          break;
        case RenderingComplexity.COMPLEX:
          maxWaitTime = 1500;
          break;
        case RenderingComplexity.HEAVY:
          maxWaitTime = 3000;
          break;
      }
    }

    const observer = new MutationObserver((mutations) => {
      changeCount++;
      
      // 检查是否是重要的变化（避免无关的属性变化触发等待）
      const hasSignificantChange = mutations.some(mutation => 
        mutation.type === 'childList' || 
        (mutation.type === 'characterData' && mutation.target.textContent?.trim()) ||
        (mutation.type === 'attributes' && 
         ['class', 'style', 'data-plugin', 'data-rendered'].includes(mutation.attributeName || ''))
      );

      if (!hasSignificantChange) {
        return;
      }

      if (timer) clearTimeout(timer);
      
      timer = setTimeout(() => {
        observer.disconnect();
        resolve();
      }, timeout);
    });

    observer.observe(container, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
      attributeFilter: ['class', 'style', 'data-plugin', 'data-rendered'] // 只监听重要属性
    });

    // 防止无变动导致卡死，设置最大等待时间
    const maxTimer = setTimeout(() => {
      observer.disconnect();
      if (timer) clearTimeout(timer);
      resolve();
    }, maxWaitTime);

    // 如果在初始 timeout 时间内没有任何变化，也认为渲染完成
    timer = setTimeout(() => {
      observer.disconnect();
      clearTimeout(maxTimer);
      resolve();
    }, timeout);
  });
}

/**
 * 创建渲染容器
 * @param theme 主题类名
 * @param width 容器宽度
 */
export function createRenderContainer(theme?: string, width = "1000px"): HTMLElement {
  const container = document.createElement("div");
  container.addClass("markdown-preview-view", "markdown-rendered");
  
  // 确保容器继承当前主题类
  const bodyClasses = document.body.className;
  if (bodyClasses.includes('theme-light') || bodyClasses.includes('theme-dark')) {
    container.className += ' ' + bodyClasses;
  }
  
  // 如果指定了主题，使用指定的主题
  if (theme) {
    container.addClass(theme);
  }
  
  // 添加到 DOM 中以确保样式正确应用（但不可见）
  container.style.position = "absolute";
  container.style.top = "-9999px";
  container.style.left = "-9999px";
  container.style.width = width;
  container.style.visibility = "hidden"; // 使用 visibility 而不是 display，确保样式计算正确
  
  document.body.appendChild(container);
  
  return container;
}

/**
 * 清理渲染容器
 * @param container 要清理的容器
 */
export function cleanupContainer(container: HTMLElement): void {
  try {
    if (container && container.parentNode) {
      container.parentNode.removeChild(container);
    }
  } catch (error) {
    console.warn("清理容器时出错:", error);
  }
}

/**
 * 获取当前主题类名
 */
export function getCurrentTheme(): string {
  return document.body.classList.contains('theme-dark') ? 'theme-dark' : 'theme-light';
}

/**
 * 安全地执行 DOM 操作，确保在异常情况下也能清理资源
 * @param operation DOM 操作函数
 * @param container 渲染容器
 */
export async function safeExecuteWithContainer<T>(
  operation: (container: HTMLElement) => Promise<T>,
  container: HTMLElement
): Promise<T> {
  try {
    return await operation(container);
  } finally {
    cleanupContainer(container);
  }
}

/**
 * 创建完整的渲染环境并执行渲染操作
 * @param renderFn 渲染函数
 * @param theme 主题
 * @param width 容器宽度
 */
export async function withRenderContainer<T>(
  renderFn: (container: HTMLElement) => Promise<T>,
  theme?: string,
  width?: string
): Promise<T> {
  const container = createRenderContainer(theme, width);
  
  try {
    return await renderFn(container);
  } finally {
    cleanupContainer(container);
  }
}

/**
 * 异步回调类型定义
 */
export type RenderingCallback = (html: string, isComplete: boolean) => void;

/**
 * 带回调的智能等待函数
 * 可以立即返回初步结果，然后通过回调提供完整结果
 * @param container 渲染容器
 * @param source 原始内容
 * @param callback 渲染完成回调
 * @param timeout 等待超时
 * @param maxWaitTime 最大等待时间
 */
export function waitForDomStableWithCallback(
  container: HTMLElement, 
  source: string,
  callback?: RenderingCallback,
  timeout = 300,
  maxWaitTime = 2000 // 降低默认最大等待时间
): Promise<string> {
  return new Promise((resolve) => {
    const startTime = Date.now();
    
    // 立即获取初步结果
    const initialHtml = container.innerHTML;
    
    // 如果不需要插件渲染，立即返回
    if (!needsPluginRendering(source)) {
      callback?.(initialHtml, true);
      resolve(initialHtml);
      return;
    }
    
    // 如果没有异步元素，立即返回
    if (!hasAsyncElements(container)) {
      callback?.(initialHtml, true);
      resolve(initialHtml);
      return;
    }
    
    // 先返回初步结果，不阻塞主流程
    callback?.(initialHtml, false);
    resolve(initialHtml);
    
    // 在后台继续等待完整渲染
    let timer: NodeJS.Timeout | null = null;
    let changeCount = 0;
    
    const observer = new MutationObserver((mutations) => {
      changeCount++;
      
      const hasSignificantChange = mutations.some(mutation => 
        mutation.type === 'childList' || 
        (mutation.type === 'characterData' && mutation.target.textContent?.trim()) ||
        (mutation.type === 'attributes' && 
         ['class', 'style', 'data-plugin', 'data-rendered'].includes(mutation.attributeName || ''))
      );

      if (!hasSignificantChange) {
        return;
      }

      if (timer) clearTimeout(timer);
      
      timer = setTimeout(() => {
        observer.disconnect();
        const finalHtml = container.innerHTML;
        callback?.(finalHtml, true);
      }, timeout);
    });

    observer.observe(container, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
      attributeFilter: ['class', 'style', 'data-plugin', 'data-rendered']
    });

    // 最大等待时间后强制完成
    setTimeout(() => {
      observer.disconnect();
      if (timer) clearTimeout(timer);
      const finalHtml = container.innerHTML;
      callback?.(finalHtml, true);
    }, maxWaitTime);
  });
}

/**
 * 等待元素加载完成（包括图片等异步资源）
 * @param container 容器元素
 * @param timeout 超时时间
 */
export function waitForResourcesLoaded(container: HTMLElement, timeout = 3000): Promise<void> {
  return new Promise((resolve) => {
    const images = container.querySelectorAll('img');
    const videos = container.querySelectorAll('video');
    const iframes = container.querySelectorAll('iframe');
    
    const allElements = [...Array.from(images), ...Array.from(videos), ...Array.from(iframes)];
    
    if (allElements.length === 0) {
      resolve();
      return;
    }
    
    let loadedCount = 0;
    const totalCount = allElements.length;
    
    const checkComplete = () => {
      loadedCount++;
      if (loadedCount >= totalCount) {
        resolve();
      }
    };
    
    // 设置超时
    const timeoutId = setTimeout(() => {
      resolve();
    }, timeout);
    
    allElements.forEach((element) => {
      if (element instanceof HTMLImageElement) {
        if (element.complete) {
          checkComplete();
        } else {
          element.addEventListener('load', () => {
            checkComplete();
          });
          element.addEventListener('error', () => {
            checkComplete();
          });
        }
      } else if (element instanceof HTMLVideoElement) {
        if (element.readyState >= 2) { // HAVE_CURRENT_DATA
          checkComplete();
        } else {
          element.addEventListener('loadeddata', () => {
            checkComplete();
          });
          element.addEventListener('error', () => {
            checkComplete();
          });
        }
      } else if (element instanceof HTMLIFrameElement) {
        element.addEventListener('load', () => {
          checkComplete();
        });
        element.addEventListener('error', () => {
          checkComplete();
        });
      }
    });
    
    // 如果所有元素都已经加载完成，清除超时
    if (loadedCount >= totalCount) {
      clearTimeout(timeoutId);
    }
  });
}
