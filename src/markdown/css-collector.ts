import type {Plugin} from "obsidian";
import type {CSSCollectionOptions, CSSCollectionResult} from "./types";

/**
 * Obsidian CSS 收集器
 */
export class ObsidianCSSCollector {
	private options: CSSCollectionOptions = {}

  constructor(private plugin: Plugin) {}

  /**
   * 直接从 Obsidian 内部获取 app.css 内容
   */
  async getObsidianAppCSS(): Promise<string> {

	  if (!this.options.includeAppCSS){
		  return '';
	  }

    try {
      const appCssUrl = 'app://obsidian.md/app.css';
      try {
        const response = await fetch(appCssUrl);
        if (response.ok) {
			return await response.text();
        }
      } catch (e) {
        console.error("fetch app.css 失败，尝试其他方法:", e.message);
      }

      return "";
    } catch (error) {
      console.error("获取 app.css 时出错:", error);
      return "";
    }
  }

  /**
   * 获取当前 Obsidian 已加载的全部 CSS 规则
   */
  async getAllLoadedCSS(): Promise<CSSCollectionResult> {
    let additionalCSS = "";
    let skippedSheets: string[] = [];
    
    // 首先尝试获取 Obsidian 的核心 app.css
    const appCSS = await this.getObsidianAppCSS();
    
    // 然后获取其他可访问的样式表（插件、主题等）
    for (const sheet of Array.from(document.styleSheets)) {
      try {
        const rules = sheet.cssRules || sheet.rules;
        if (!rules) continue;
        
        // 如果是 app.css，跳过（已经通过直接获取添加了）
        if (sheet.href && sheet.href.includes('app.css')) {
          continue;
        }
        
        for (const rule of Array.from(rules)) {
          additionalCSS += rule.cssText + "\n";
        }
      } catch (e) {
        // 跨域样式表无法读取，记录下来
        if (sheet.href) {
          skippedSheets.push(sheet.href);
          console.warn("无法读取样式表:", sheet.href, e);
        }
      }
    }
    
    const baseStyles = '';
    
    return {
      appCSS,
      additionalCSS,
      baseStyles,
      skippedSheets
    };
  }

  /**
   * 获取基础的 Obsidian 样式规则（类似 export-html.ts）
   * 这些是一些关键的样式，确保基本的显示效果
   */
  private getObsidianBaseStyles(): string {
    return "";
  }

  /**
   * 收集所有 CSS 并组装成完整样式
   */
  async collectAllCSS(options: CSSCollectionOptions = {}): Promise<string> {
    const {
      includeAppCSS = true,
      includeBaseStyles = true
    } = options;

	this.options = options;

    const result = await this.getAllLoadedCSS();
    
    let fullCSS = "";
    
    // 基础样式（使用增强的基础样式，类似 export-html.ts）
    if (includeBaseStyles) {
      fullCSS += "/* Obsidian Base Styles (fallback styles with defaults) */\n";
      fullCSS += this.getObsidianBaseStyles() + "\n\n";
    }
    
    // 核心 app.css
    if (includeAppCSS && result.appCSS) {
      fullCSS += "/* Obsidian Core Styles (app.css) */\n";
      fullCSS += result.appCSS + "\n\n";
    }
    
    // 插件和主题样式
    if (result.additionalCSS) {
      fullCSS += "/* Obsidian Plugin and Theme Styles */\n";
      fullCSS += result.additionalCSS + "\n\n";
    }
    
    return fullCSS;
  }

}
