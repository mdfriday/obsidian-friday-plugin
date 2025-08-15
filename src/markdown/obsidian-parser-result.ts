import type { Plugin, TFile, HeadingCache, CachedMetadata } from "obsidian";
import type { ParsingResult, Header, TocFragments } from "@mdfriday/foundry";
import type { HeaderInfo, TOCItem } from "./types";

/**
 * Obsidian 标题实现
 */
export class ObsidianHeader implements Header {
  constructor(
    private _text: string,
    private _level: number,
    private _id?: string,
    private _position?: { line: number; ch: number }
  ) {}

  // Header interface methods
  name(): string {
    return this._text;
  }

  level(): number {
    return this._level;
  }

  links(): any[] {
    return []; // Obsidian headers don't track links by default
  }

  paragraphs(): any[] {
    return []; // Obsidian headers don't track paragraphs by default
  }

  listParagraphs(): any[] {
    return []; // Obsidian headers don't track list paragraphs by default
  }

  // Additional methods for compatibility
  text(): string {
    return this._text;
  }

  id(): string {
    return this._id || this.generateId();
  }

  private generateId(): string {
    // 生成类似 GitHub 风格的 ID
    return this._text
      .toLowerCase()
      .replace(/[^\w\s\u4e00-\u9fff]/g, '') // 保留中文字符
      .replace(/\s+/g, '-')
      .replace(/^-+|-+$/g, '');
  }
}

/**
 * Obsidian 目录实现
 */
export class ObsidianTocFragments implements TocFragments {
  constructor(private items: TOCItem[]) {}

  toHTML(): string {
    if (this.items.length === 0) {
      return '';
    }

    return `<nav class="table-of-contents">\n${this.renderItems(this.items)}\n</nav>`;
  }

  toMarkdown(): string {
    if (this.items.length === 0) {
      return '';
    }

    return this.renderMarkdownItems(this.items, 0);
  }

  isEmpty(): boolean {
    return this.items.length === 0;
  }

  getItems(): TOCItem[] {
    return [...this.items];
  }

  private renderItems(items: TOCItem[], level = 0): string {
    if (items.length === 0) return '';

    const indent = '  '.repeat(level);
    let html = `${indent}<ul>\n`;

    for (const item of items) {
      html += `${indent}  <li>\n`;
      html += `${indent}    <a href="#${item.anchor}">${this.escapeHtml(item.text)}</a>\n`;
      
      if (item.children.length > 0) {
        html += this.renderItems(item.children, level + 2);
      }
      
      html += `${indent}  </li>\n`;
    }

    html += `${indent}</ul>\n`;
    return html;
  }

  private renderMarkdownItems(items: TOCItem[], level: number): string {
    let markdown = '';

    for (const item of items) {
      const indent = '  '.repeat(level);
      markdown += `${indent}- [${item.text}](#${item.anchor})\n`;
      
      if (item.children.length > 0) {
        markdown += this.renderMarkdownItems(item.children, level + 1);
      }
    }

    return markdown;
  }

  private escapeHtml(text: string): string {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }
}

/**
 * Obsidian ParsingResult 实现
 */
export class ObsidianParsingResult implements ParsingResult {
  private _headers: Header[] = [];
  private _toc: TocFragments;

  constructor(
    private plugin: Plugin,
    private file: TFile,
    private source: string
  ) {
    this.buildFromMetadata();
  }

  headers(): Header[] {
    return [...this._headers];
  }

  tableOfContents(): TocFragments {
    return this._toc;
  }

  /**
   * 从 Obsidian 的 MetadataCache 构建解析结果
   */
  private buildFromMetadata(): void {
    const metadata = this.plugin.app.metadataCache.getFileCache(this.file);
    
    if (metadata?.headings) {
      this._headers = this.buildHeaders(metadata.headings);
      this._toc = this.buildTableOfContents(metadata.headings);
    } else {
      // 如果没有缓存的元数据，尝试解析源码
      this.parseFromSource();
    }
  }

  /**
   * 从标题缓存构建标题列表
   */
  private buildHeaders(headings: HeadingCache[]): Header[] {
    return headings.map(heading => {
      return new ObsidianHeader(
        heading.heading,
        heading.level,
        undefined, // Obsidian 的标题缓存没有直接的 ID
        heading.position?.start ? {
          line: heading.position.start.line,
          ch: heading.position.start.col
        } : undefined
      );
    });
  }

  /**
   * 从标题缓存构建目录
   */
  private buildTableOfContents(headings: HeadingCache[]): TocFragments {
    const tocItems = this.buildTocItems(headings);
    return new ObsidianTocFragments(tocItems);
  }

  /**
   * 构建嵌套的目录结构
   */
  private buildTocItems(headings: HeadingCache[]): TOCItem[] {
    const items: TOCItem[] = [];
    const stack: { item: TOCItem; level: number }[] = [];

    for (const heading of headings) {
      const tocItem: TOCItem = {
        text: heading.heading,
        level: heading.level,
        anchor: this.generateAnchor(heading.heading),
        children: []
      };

      // 找到合适的父级
      while (stack.length > 0 && stack[stack.length - 1].level >= heading.level) {
        stack.pop();
      }

      if (stack.length === 0) {
        // 顶级项目
        items.push(tocItem);
      } else {
        // 添加到父级的 children
        stack[stack.length - 1].item.children.push(tocItem);
      }

      stack.push({ item: tocItem, level: heading.level });
    }

    return items;
  }

  /**
   * 生成锚点 ID
   */
  private generateAnchor(text: string): string {
    return text
      .toLowerCase()
      .replace(/[^\w\s\u4e00-\u9fff]/g, '') // 保留中文字符
      .replace(/\s+/g, '-')
      .replace(/^-+|-+$/g, '');
  }

  /**
   * 从源码解析（备用方案）
   */
  private parseFromSource(): void {
    const lines = this.source.split('\n');
    const headings: HeaderInfo[] = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const match = line.match(/^(#{1,6})\s+(.+)$/);
      
      if (match) {
        const level = match[1].length;
        const text = match[2].trim();
        
        headings.push({
          text,
          level,
          position: {
            start: { line: i, ch: 0 },
            end: { line: i, ch: line.length }
          }
        });
      }
    }

    this._headers = headings.map(heading => 
      new ObsidianHeader(heading.text, heading.level, undefined, heading.position?.start)
    );

    const tocItems = this.buildTocItemsFromHeaders(headings);
    this._toc = new ObsidianTocFragments(tocItems);
  }

  /**
   * 从解析的标题构建目录项
   */
  private buildTocItemsFromHeaders(headings: HeaderInfo[]): TOCItem[] {
    const items: TOCItem[] = [];
    const stack: { item: TOCItem; level: number }[] = [];

    for (const heading of headings) {
      const tocItem: TOCItem = {
        text: heading.text,
        level: heading.level,
        anchor: heading.id || this.generateAnchor(heading.text),
        children: []
      };

      // 找到合适的父级
      while (stack.length > 0 && stack[stack.length - 1].level >= heading.level) {
        stack.pop();
      }

      if (stack.length === 0) {
        // 顶级项目
        items.push(tocItem);
      } else {
        // 添加到父级的 children
        stack[stack.length - 1].item.children.push(tocItem);
      }

      stack.push({ item: tocItem, level: heading.level });
    }

    return items;
  }

  /**
   * 获取文件信息
   */
  getFile(): TFile {
    return this.file;
  }

  /**
   * 获取源码
   */
  getSource(): string {
    return this.source;
  }

  /**
   * 获取元数据
   */
  getMetadata(): CachedMetadata | null {
    return this.plugin.app.metadataCache.getFileCache(this.file);
  }

  /**
   * 获取所有标题的扁平列表
   */
  getFlatHeaders(): HeaderInfo[] {
    return this._headers.map(header => {
      const obsHeader = header as ObsidianHeader;
      return {
        text: obsHeader.text(),
        level: header.level(),
        id: obsHeader.id()
      };
    });
  }

  /**
   * 按级别过滤标题
   */
  getHeadersByLevel(level: number): Header[] {
    return this._headers.filter(header => header.level() === level);
  }

  /**
   * 获取指定范围的标题
   */
  getHeadersInRange(minLevel: number, maxLevel: number): Header[] {
    return this._headers.filter(header => {
      const headerLevel = header.level();
      return headerLevel >= minLevel && headerLevel <= maxLevel;
    });
  }
}
