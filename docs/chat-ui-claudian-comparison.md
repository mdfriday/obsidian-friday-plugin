# Friday Chat UI vs Claudian UI — 全面对比分析与实现计划

> 目标：让 Friday Chat 在布局、样式、交互体验上与 Claudian 完全对齐。

---

## 目录

1. [背景与概述](#1-背景与概述)
2. [整体布局对比](#2-整体布局对比)
3. [Header 区域对比](#3-header-区域对比)
4. [消息区域对比](#4-消息区域对比)
5. [输入框对比](#5-输入框对比)
6. [Slash 命令下拉菜单对比](#6-slash-命令下拉菜单对比)
7. [@提及下拉菜单对比](#7-提及下拉菜单对比)
8. [工具调用渲染对比](#8-工具调用渲染对比)
9. [CSS 变量与主题对比](#9-css-变量与主题对比)
10. [缺失功能一览](#10-缺失功能一览)
11. [实现计划（分步骤）](#11-实现计划分步骤)
12. [可直接复用的 Claudian 源码](#12-可直接复用的-claudian-源码)
13. [需要适配的部分与原因](#13-需要适配的部分与原因)

---

## 1. 背景与概述

### Claudian

- Obsidian 插件，主 UI 类：`ClaudianView extends ItemView`
- CSS 采用**模块化拆分**，47 个 CSS 文件通过 `style/index.css` 统一引入
- DOM 类名前缀：`claudian-*`
- 支持多标签（TabManager）、历史会话、多 AI provider（Claude / Codex / OpenCode）
- 输入框采用"wrapper + 透明 textarea"架构，内含 context-row（文件 chip）+ 工具栏

### Friday Chat（当前）

- 同为 Obsidian 插件，主 UI 类：`ChatView extends ItemView`
- CSS 单文件：`src/chat/styles/chat.css`（489 行）
- DOM 类名前缀：`friday-*`
- 单标签、单会话，无历史，目前只有一个 AI provider（通过 `FridayWikiRuntime`）
- 输入框是一个简单的 `<textarea>` + 独立 Send 按钮

**核心问题汇总：**

| 问题 | 现状 | 目标 |
|------|------|------|
| 整体布局 | 简单三段式（header/messages/input） | Claudian 的 header + nav-row + messages + input-wrapper 结构 |
| 输入框外观 | 带边框 textarea + 独立 Send 按钮 | 整体 wrapper 内嵌透明 textarea + 底部工具栏（含 Send） |
| 消息气泡样式 | user 消息用 accent 色，assistant 消息用 secondary + border | user 消息半透明暗色气泡；assistant 消息透明背景全宽 |
| Markdown 渲染 | 简单 innerHTML/换行处理 | 使用 Obsidian MarkdownRenderer 正确渲染 |
| 命令高亮 | 无（纯文本 textarea） | 下拉菜单选中后样式一致，与 Claudian 对齐 |
| 欢迎屏 | assistant 气泡内文字列表 | 居中卡片 + 衬线字体大标题 |
| 字体/排版 | 使用默认 Obsidian 变量 | 明确 14px / line-height 1.4 / 正确 BiDi |
| 动效 | 仅 fadeIn | 与 Claudian 对齐：thinking-pulse, spin 等 |

---

## 2. 整体布局对比

### Claudian DOM 结构

```
.claudian-container            ← ItemView 容器，flex column，height: 100%
  ├─ .claudian-header          ← 顶部：logo + title/tabs slot + actions
  └─ .claudian-tab-content-container
       └─ .claudian-tab-content  ← 当前活跃 tab
            ├─ .claudian-messages-wrapper   ← flex: 1，min-height: 0
            │    └─ .claudian-messages      ← overflow-y: auto，内含消息列表
            └─ .claudian-input-container    ← position: relative，padding-top: 12px
                 ├─ .claudian-input-nav-row ← tab badges（start）+ icon buttons（end）
                 └─ .claudian-input-wrapper ← border + radius，flex column
                      ├─ .claudian-context-row   ← 文件 chip，默认隐藏
                      ├─ .claudian-input          ← textarea，透明背景无边框
                      └─ .claudian-input-toolbar  ← 工具栏：mode/model selector + Send
```

### Friday Chat DOM 结构（当前）

```
.friday-chat-view              ← ItemView 容器，flex column
  ├─ .friday-chat-header       ← 顶部：logo + title + actions
  ├─ .friday-chat-messages     ← flex: 1，overflow-y: auto
  └─ .friday-chat-input-container  ← position: relative
       ├─ .friday-chat-input        ← textarea，有边框，radius 12px
       └─ .friday-chat-send-btn     ← 独立 Send 按钮，align-self: flex-end
```

### 关键差异

| 维度 | Friday | Claudian |
|------|--------|----------|
| 多标签 | ✗ | ✓（TabManager + TabBar） |
| 输入框 wrapper | ✗（textarea 直接有边框） | ✓（wrapper 提供边框，textarea 透明） |
| Context row（文件 chip） | ✗ | ✓（默认折叠，有内容时展开） |
| 工具栏 | ✗（Send 按钮在外部） | ✓（Send 在工具栏内，model/mode 选择器） |
| Nav row | ✗ | ✓（tab 徽章 + header 图标按钮） |
| 消息 wrapper | ✗（messages 直接 flex: 1） | ✓（messages-wrapper → messages，双层保证 scroll-to-bottom 按钮定位） |

---

## 3. Header 区域对比

### Claudian `header.css`

```css
.claudian-header {
  position: relative;
  display: flex;
  align-items: center;
  padding: 0 12px 12px 12px;   /* 上 0，下 12px，左右 12px */
}
.claudian-logo { color: var(--claudian-brand); }   /* 使用品牌色 SVG */
.claudian-title-text { font-size: 14px; font-weight: 600; }
.claudian-header-actions { gap: 12px; }
.claudian-header-btn { color: var(--text-faint); }  /* 按钮默认更淡 */
.claudian-header-btn:hover { color: var(--text-normal); }
.claudian-header-btn svg { width: 16px; height: 16px; }
```

### Friday `chat.css`（当前）

```css
.friday-chat-header {
  padding: 0.75rem 1rem;          /* 更大的内边距 */
  border-bottom: 1px solid ...;
  min-height: 48px;               /* 固定最小高度 */
}
.friday-chat-icon-btn { width: 32px; height: 32px; }  /* 更大的按钮点击区 */
.friday-chat-icon-btn { color: var(--text-muted); }    /* 不够淡 */
```

### 差异

| 维度 | Friday | Claudian |
|------|--------|----------|
| padding | `0.75rem 1rem`（12/16px） | `0 12px 12px 12px`（上无，下 12px） |
| border-bottom | 有 | 无（通过 padding 分隔） |
| logo | `<img>` 外链 SVG | inline SVG，受 `--claudian-brand` 着色 |
| 按钮颜色 | `--text-muted` | `--text-faint`（更淡） |
| 按钮大小 | 32×32px | 无固定尺寸（content-box） |
| 标题字号 | `1em`（继承） | 固定 `14px` |

---

## 4. 消息区域对比

### Claudian `messages.css`

```css
/* 消息容器 */
.claudian-messages { padding: 12px 0; gap: 12px; }

/* User 消息：右对齐气泡 */
.claudian-message-user {
  background: rgba(0, 0, 0, 0.3);   /* 半透明暗色 */
  align-self: flex-end;
  border-end-end-radius: 4px;       /* 右下角小圆角（iMessage 风格） */
  padding: 10px 14px;
  border-radius: 8px;
  max-width: 95%;
}

/* Assistant 消息：透明背景，全宽 */
.claudian-message-assistant {
  background: transparent;
  align-self: stretch;
  width: 100%;
  max-width: 100%;
  border-end-start-radius: 4px;    /* 左下角小圆角 */
}

/* 欢迎屏（居中卡片） */
.claudian-welcome {
  flex: 1; display: flex; align-items: center; justify-content: center;
}
.claudian-welcome-greeting {
  font-family: 'Copernicus', 'Tiempos Headline', Georgia, serif;  /* 衬线字体 */
  font-size: 28px; font-weight: 300;
  color: var(--text-muted);
}
```

### Friday `chat.css`（当前）

```css
.friday-chat-messages { padding: 1.5rem; gap: 1.5rem; }   /* 更大 */

.friday-chat-message.user {
  align-self: flex-end; max-width: 80%;
}
.friday-chat-message.user .friday-chat-message-content {
  background: var(--interactive-accent);   /* accent 纯色，不透明 */
  color: var(--text-on-accent);
  padding: 0.875rem 1.125rem;
  border-radius: 12px;                     /* 所有角都是 12px */
}
.friday-chat-message.assistant .friday-chat-message-content {
  background: var(--background-secondary);
  border: 1px solid var(--background-modifier-border);  /* 有边框 */
}
```

### 差异

| 维度 | Friday | Claudian |
|------|--------|----------|
| 消息间距 | `1.5rem`（24px） | `12px` （更紧凑） |
| User 背景 | `--interactive-accent`（蓝色/紫色） | `rgba(0,0,0,0.3)`（半透明暗灰） |
| User border-radius | 所有角 `12px` | `8px` + 右下角 `4px`（iMessage 风格） |
| User max-width | `80%` | `95%` |
| Assistant 背景 | `--background-secondary` + border | 完全透明，无边框 |
| Assistant 宽度 | `max-width: 100%` + `align-self: flex-start` | `width: 100%` + `align-self: stretch` |
| 欢迎屏 | 普通 assistant 气泡内文字 | 居中全屏卡片，衬线大字 |
| 文字选择 | 无特殊处理 | `user-select: text`，user 消息选中用白色高亮 |
| 复制按钮 | ✗ | ✓（hover 显示） |
| Markdown 渲染 | innerHTML 或换行拼接 | Obsidian `MarkdownRenderer.render()` |
| 段落间距 | `white-space: pre-wrap` | `p { margin: 0 0 8px 0 }` |

---

## 5. 输入框对比

### Claudian 输入框架构

```
.claudian-input-container（position: relative）
  ├─ .claudian-input-nav-row（可隐藏）
  └─ .claudian-input-wrapper（bordered wrapper，flex column）
       ├─ .claudian-context-row（文件 chip，default: display:none）
       ├─ .claudian-input（textarea，透明，无边框）
       └─ .claudian-input-toolbar（flex row，含工具按钮 + Send）
```

```css
.claudian-input-wrapper {
  border: 1px solid var(--background-modifier-border);
  border-radius: 6px;
  background: var(--background-primary);
  min-height: 140px;
}
.claudian-input {
  border: none !important;
  background: transparent !important;
  font-size: 14px;
  line-height: 1.4;
  padding: 8px 10px 10px 10px;
  resize: none;              /* 不可拖拽 resize */
  min-height: 60px;
  /* max-height 由 JS 动态设置：max(150px, 55% 视口高度) */
}
.claudian-input:focus { outline: none; border: none; }
/* wrapper 上加 class 表达不同模式边框颜色 */
.claudian-input-instruction-mode { border-color: #60a5fa; box-shadow: 0 0 0 1px #60a5fa; }
.claudian-input-bang-bash-mode   { border-color: #f472b6; box-shadow: 0 0 0 1px #f472b6; }
```

### Friday 输入框（当前）

```css
.friday-chat-input {
  width: 100%;
  min-height: 80px; max-height: 200px;
  padding: 0.875rem;
  border: 1px solid var(--background-modifier-border);
  border-radius: 12px;              /* 大圆角，与 Claudian 不同 */
  background: var(--background-secondary);  /* 有背景色 */
  resize: vertical;                 /* 可垂直拖拽 */
  font-size: 0.95em;               /* 相对单位 */
}
.friday-chat-send-btn {
  align-self: flex-end;             /* 按钮在外部，不在 wrapper 内 */
  padding: 0.625rem 1.5rem;
  background: var(--interactive-accent);
}
```

### 差异

| 维度 | Friday | Claudian |
|------|--------|----------|
| 架构 | textarea 直接加边框 | wrapper 提供边框，textarea 透明 |
| border-radius | `12px` | `6px` |
| 背景色 | `--background-secondary`（灰色） | `transparent`（wrapper 用 `--background-primary`） |
| resize | `vertical`（可拖） | `none`（不可拖，JS 动态调高） |
| 字号 | `0.95em` | 固定 `14px` |
| line-height | 默认继承 | `1.4` |
| Send 按钮位置 | textarea 外部，独立元素 | wrapper 内工具栏里 |
| 焦点样式 | `border-color: --interactive-accent; box-shadow` | `none`（由 wrapper class 控制） |
| 模式边框 | ✗ | ✓（instruction/bash 模式变色） |
| 文件 chip | ✗ | ✓（context-row） |
| 工具栏 | ✗ | ✓（model/mode selector） |
| placeholder | 描述命令语法 | 简短提示 |

---

## 6. Slash 命令下拉菜单对比

### Claudian `slash-commands.css`

```css
.claudian-slash-dropdown {
  position: absolute; bottom: 100%; left: 0; right: 0;
  margin-bottom: 4px;
  background: var(--background-secondary);
  backdrop-filter: blur(20px);               /* ✓ 毛玻璃效果 */
  border: 1px solid var(--background-modifier-border);
  border-radius: 6px;
  box-shadow: 0 -4px 16px rgba(0, 0, 0, 0.2);
  max-height: 300px;
}
.claudian-slash-item { padding: 8px 12px; }
.claudian-slash-name { font-size: 12px; font-family: var(--font-monospace); }  /* monospace */
.claudian-slash-hint { font-size: 12px; color: var(--text-muted); margin-left: 8px; }
.claudian-slash-desc { font-size: 11px; margin-top: 2px; }
/* 滚动条 6px，track 透明 */
```

### Friday `chat.css`（当前）

```css
.friday-command-picker {
  position: absolute; bottom: 100%;
  left: 1rem; right: 1rem;           /* 左右内缩 1rem */
  margin-bottom: 0.5rem;
  background: var(--background-secondary);
  /* ✗ 无 backdrop-filter */
  border-radius: 8px;                /* 比 Claudian 大 */
  box-shadow: 0 4px 16px ...;
  max-height: 300px;
}
.friday-command-item { padding: 0.75rem 1rem; }  /* 更大 padding */
.friday-command-name { font-size: 0.95em; }      /* ✗ 不是 monospace */
.friday-command-slash { color: var(--interactive-accent); font-weight: 600; }
.friday-command-description { font-size: 0.85em; }
/* 滚动条 8px */
```

### 差异

| 维度 | Friday | Claudian |
|------|--------|----------|
| 定位偏移 | `left: 1rem; right: 1rem`（内缩） | `left: 0; right: 0`（与 wrapper 对齐） |
| backdrop-filter | ✗ | ✓ `blur(20px)` |
| border-radius | `8px` | `6px` |
| 命令名字体 | `0.95em` 非等宽 | `12px` monospace |
| padding | `0.75rem 1rem` | `8px 12px` |
| 滚动条宽度 | `8px` | `6px` |
| margin-bottom | `0.5rem` | `4px` |

---

## 7. @提及下拉菜单对比

### Claudian `file-context.css`

```css
.claudian-mention-dropdown {
  backdrop-filter: blur(20px);
  border-radius: 6px;
  box-shadow: 0 -4px 16px rgba(0, 0, 0, 0.2);
  max-height: 250px;
}
.claudian-mention-item { display: flex; align-items: center; gap: 8px; padding: 8px 12px; }
.claudian-mention-icon svg { width: 14px; height: 14px; }   /* SVG 图标 */
.claudian-mention-path { font-size: 13px; }
```

### Friday（当前）

```css
.friday-folder-picker { border-radius: 8px; max-height: 300px; }
.friday-folder-item { display: flex; align-items: center; gap: 0.75rem; padding: 0.75rem 1rem; }
.friday-folder-icon { font-size: 1.2em; }    /* Emoji 图标（📁）*/
.friday-folder-name { font-size: 0.95em; font-weight: 500; }
.friday-folder-path { font-size: 0.8em; }
```

### 差异

| 维度 | Friday | Claudian |
|------|--------|----------|
| backdrop-filter | ✗ | ✓ |
| 图标类型 | Emoji（📁） | SVG（14×14px） |
| 路径字号 | `0.8em` | `13px` |
| 最大高度 | `300px` | `250px` |
| 双行显示（name+path） | ✓ | ✓（`claudian-mention-text` flex column） |

---

## 8. 工具调用渲染对比

### Claudian

- 完整的 `ToolCallRenderer.ts`（1074 行）
- `claudian-tool-call` → `claudian-tool-header`（可折叠）
- Header 内：icon + name（monospace）+ summary（muted，ellipsis）+ status
- Content 区：代码输出，diff，图片等
- Bash 命令特殊样式（粉色边框 + monospace）
- 工具调用状态：running（spinner）、success（✓）、error（✗）

### Friday（当前）

```css
.friday-chat-tool-call {
  margin: 0.5rem 0; padding: 0.5rem;
  background: var(--background-primary-alt);
  border-left: 3px solid var(--interactive-accent);
  border-radius: 4px;
}
.friday-chat-tool-name { font-family: var(--font-monospace); font-size: 0.9em; }
```

工具调用只有简单的左边框 + 工具名，无折叠、无 summary、无状态、无详情。

---

## 9. CSS 变量与主题对比

### Claudian 品牌变量

```css
.claudian-container {
  --claudian-brand: #D97757;              /* 橙色品牌色 */
  --claudian-brand-rgb: 217, 119, 87;
  /* 不同 provider 对应不同品牌色 */
}
/* 通过 [data-provider="claude/codex/opencode"] 切换品牌色 */
```

### Friday（当前）

使用 Obsidian 内置变量，无自定义品牌 token：
- `--interactive-accent`（蓝/紫）
- `--background-secondary`
- `--text-normal / --text-muted / --text-faint`

**建议**：Friday 应定义自己的品牌 token（如 `--friday-brand: #4F9CF9`），在 `.friday-chat-view` 上声明，保持与 Claudian 同样的架构模式。

---

## 10. 缺失功能一览

以下是 Claudian 有、Friday 当前没有的功能（按优先级排序）：

| # | 功能 | Claudian 实现位置 | 优先级 |
|---|------|-----------------|--------|
| 1 | **Markdown 正确渲染**（assistant 消息） | `MessageRenderer.ts` + Obsidian `MarkdownRenderer` | 🔴 高 |
| 2 | **输入框 wrapper 架构**（透明 textarea） | `components/input.css` + `InputController.ts` | 🔴 高 |
| 3 | **欢迎屏居中设计** + 衬线字体 | `components/messages.css` | 🔴 高 |
| 4 | **下拉菜单毛玻璃效果** + 尺寸对齐 | `features/slash-commands.css`, `file-context.css` | 🔴 高 |
| 5 | **消息气泡样式对齐**（user 半透明，assistant 透明） | `components/messages.css` | 🔴 高 |
| 6 | **滚动到底部按钮** | `MessageRenderer.ts` + `messages.css` | 🟡 中 |
| 7 | **用户消息 hover 复制按钮** | `MessageRenderer.ts` + `messages.css` | 🟡 中 |
| 8 | **工具调用折叠展开** | `ToolCallRenderer.ts` + `toolcalls.css` | 🟡 中 |
| 9 | **动效对齐**（thinking-pulse, spin） | `base/animations.css` | 🟡 中 |
| 10 | **文件 chip（@提及视觉化）** | `features/file-context.css` + `InputController.ts` | 🟡 中 |
| 11 | **多标签（TabManager）** | `tabs/TabManager.ts` + `components/tabs.css` | 🔵 低 |
| 12 | **历史会话面板** | `components/history.css` | 🔵 低 |
| 13 | **Model/Mode 选择器工具栏** | `toolbar/*.css` | 🔵 低 |
| 14 | **Plan mode / Bash mode 输入框变色** | `features/plan-mode.css` | 🔵 低 |

---

## 11. 实现计划（分步骤）

以下按"最小可见改善"到"完整对齐"排序。每步都是独立可发布的增量。

---

### Step 1：CSS 基础对齐（1-2天）

**目标**：不动 TS 逻辑，只改 CSS，让视觉效果迅速接近 Claudian。

**修改文件**：`src/chat/styles/chat.css`

**具体改动**：

#### 1.1 引入品牌变量

```css
.friday-chat-view {
  --friday-brand: #4F9CF9;
  --friday-brand-rgb: 79, 156, 249;
}
```

#### 1.2 Header 对齐

```css
.friday-chat-header {
  padding: 0 12px 12px 12px;   /* 改：去掉上 padding，减小下 padding */
  border-bottom: none;          /* 改：去掉下边框（靠 padding 分隔） */
  min-height: unset;            /* 改：不固定高度 */
}
.friday-chat-icon-btn {
  color: var(--text-faint);     /* 改：更淡 */
  width: unset; height: unset;  /* 改：不固定尺寸 */
}
.friday-chat-icon-btn svg { width: 16px; height: 16px; }  /* 改：与 Claudian 对齐 */
.friday-chat-title { font-size: 14px; }  /* 改：固定字号 */
```

#### 1.3 消息区域对齐

```css
.friday-chat-messages {
  padding: 12px 0;    /* 改：去掉左右 padding（消息气泡自带） */
  gap: 12px;          /* 改：从 1.5rem 改为 12px */
}
/* User 消息：半透明暗色，iMessage 风格圆角 */
.friday-chat-message.user .friday-chat-message-content {
  background: rgba(0, 0, 0, 0.3);      /* 改 */
  color: var(--text-normal);            /* 改：去掉 on-accent 白色 */
  border-radius: 8px;                   /* 改：从 12px 改为 8px */
  border-end-end-radius: 4px;           /* 新：右下角小圆角 */
  padding: 10px 14px;                   /* 改：减小 padding */
  max-width: 95%;                       /* 改：从 80% 改为 95% */
}
/* Assistant 消息：透明背景，全宽 */
.friday-chat-message.assistant { align-self: stretch; width: 100%; }
.friday-chat-message.assistant .friday-chat-message-content {
  background: transparent;             /* 改 */
  border: none;                        /* 改：去掉边框 */
  padding: 10px 14px;
  border-radius: 8px;
  border-end-start-radius: 4px;        /* 新 */
}
/* Markdown 段落间距 */
.friday-chat-message-content p { margin: 0 0 8px 0; }
.friday-chat-message-content p:last-child { margin-bottom: 0; }
.friday-chat-message-content ul,
.friday-chat-message-content ol { margin: 8px 0; padding-inline-start: 20px; }
```

#### 1.4 欢迎屏重设计

```css
/* 删除旧的 .friday-welcome-* 样式，替换为居中设计 */
.friday-chat-welcome {
  flex: 1; display: flex; flex-direction: column;
  align-items: center; justify-content: center;
  text-align: center; padding: 20px; min-height: 200px;
}
.friday-chat-welcome-greeting {
  font-family: 'Copernicus', 'Tiempos Headline', Georgia, 'Times New Roman', serif;
  font-size: 28px; font-weight: 300;
  color: var(--text-muted); letter-spacing: -0.01em;
}
.friday-chat-welcome-hint { font-size: 13px; color: var(--text-faint); margin-top: 8px; }
```

#### 1.5 下拉菜单对齐

```css
/* Slash 命令下拉 */
.friday-command-picker {
  left: 0; right: 0;                   /* 改：不再内缩 */
  margin-bottom: 4px;                  /* 改：从 0.5rem 改为 4px */
  backdrop-filter: blur(20px);         /* 新 */
  -webkit-backdrop-filter: blur(20px);
  border-radius: 6px;                  /* 改：从 8px 改为 6px */
  box-shadow: 0 -4px 16px rgba(0, 0, 0, 0.2);  /* 改：方向向上 */
}
.friday-command-item { padding: 8px 12px; }   /* 改：减小 padding */
.friday-command-name { font-family: var(--font-monospace); font-size: 12px; }  /* 改 */
.friday-command-description { font-size: 11px; margin-top: 2px; }
/* @提及下拉 */
.friday-folder-picker {
  left: 0; right: 0; margin-bottom: 4px;
  backdrop-filter: blur(20px);
  border-radius: 6px;
  box-shadow: 0 -4px 16px rgba(0, 0, 0, 0.2);
  max-height: 250px;                   /* 改：从 300px 改为 250px */
}
.friday-folder-item { padding: 8px 12px; gap: 8px; }
.friday-folder-name { font-size: 13px; font-weight: normal; }  /* 改 */
.friday-folder-path { font-size: 12px; }
```

#### 1.6 工具调用对齐

```css
.friday-chat-tool-call {
  margin: 8px 0;
  /* 去掉 border-left，改为与 Claudian 一致的 header+content 模式 */
}
.friday-chat-tool-name {
  font-family: var(--font-monospace);
  font-size: 13px; font-weight: 400;
  color: var(--text-normal);           /* 改：从 muted 改为 normal */
}
```

#### 1.7 动效对齐

```css
/* 对齐 Claudian animations.css */
@keyframes friday-thinking-pulse {
  0%, 100% { opacity: 0.5; }
  50% { opacity: 1; }
}
@keyframes friday-spin {
  to { transform: rotate(360deg); }
}
/* 消息 fadeIn 保持不变 */
```

#### 1.8 滚动条对齐

```css
.friday-chat-messages::-webkit-scrollbar { width: 6px; }  /* 改：从 8px 改为 6px */
.friday-chat-messages::-webkit-scrollbar-track { background: transparent; }  /* 改 */
.friday-chat-messages::-webkit-scrollbar-thumb { border-radius: 3px; }      /* 改 */
```

---

### Step 2：输入框 Wrapper 架构（2-3天）

**目标**：将输入框从"带边框 textarea + 外部按钮"重构为"wrapper + 透明 textarea + 内嵌工具栏"。

**修改文件**：`src/chat/ChatView.ts` + `src/chat/styles/chat.css`

#### 2.1 CSS 新增 wrapper 结构

```css
.friday-chat-input-container {
  position: relative;
  padding: 12px 0 0 0;  /* 改：与 Claudian 对齐 */
}
.friday-chat-input-wrapper {
  position: relative;
  display: flex; flex-direction: column;
  min-height: 140px;
  border: 1px solid var(--background-modifier-border);
  border-radius: 6px;
  background: var(--background-primary);
}
.friday-chat-input {
  width: 100%; flex: 1 1 0;
  min-height: 60px;
  resize: none;
  padding: 8px 10px 10px 10px;
  border: none !important;
  background: transparent !important;
  font-size: 14px; line-height: 1.4;
  box-shadow: none !important;
  color: var(--text-normal);
}
.friday-chat-input:focus { outline: none !important; border: none !important; }
.friday-chat-input-toolbar {
  display: flex; align-items: center;
  justify-content: flex-end;   /* Send 按钮在右侧 */
  padding: 4px 6px 6px 6px;
  flex-shrink: 0;
}
.friday-chat-send-btn {
  /* 从外部移入工具栏内，样式相同 */
  align-self: unset;
}
```

#### 2.2 ChatView.ts DOM 重构

将 `onOpen()` 中的输入区域从：

```typescript
// 旧：textarea + 独立 button
this.inputEl = this.inputContainerEl.createEl('textarea', { cls: 'friday-chat-input' });
const sendBtn = this.inputContainerEl.createEl('button', { cls: 'friday-chat-send-btn' });
```

改为：

```typescript
// 新：wrapper 内嵌 textarea + 工具栏
const inputWrapper = this.inputContainerEl.createDiv({ cls: 'friday-chat-input-wrapper' });
this.inputEl = inputWrapper.createEl('textarea', { cls: 'friday-chat-input', attr: { placeholder: 'Message Friday...', rows: '3' } });
const toolbar = inputWrapper.createDiv({ cls: 'friday-chat-input-toolbar' });
const sendBtn = toolbar.createEl('button', { cls: 'friday-chat-send-btn', text: 'Send' });
```

同时将下拉菜单的 anchor 从 `inputContainerEl` 改为 `inputWrapper`（保证 `position: absolute; bottom: 100%` 正确相对于 wrapper 定位）。

---

### Step 3：Markdown 渲染（1-2天）

**目标**：assistant 消息使用 Obsidian 内置 Markdown 渲染器，正确渲染标题、列表、代码块、表格等。

**修改文件**：`src/chat/ChatView.ts`

```typescript
import { MarkdownRenderer, Component } from 'obsidian';

// 替换 renderContent 方法
private async renderMarkdown(el: HTMLElement, content: string): Promise<void> {
  el.empty();
  await MarkdownRenderer.render(
    this.plugin.app,
    content,
    el,
    '',   // sourcePath，空字符串即可
    this  // component（用于生命周期管理）
  );
}
```

在 `handleSend()` 中，streaming 期间用纯文本追加（性能），完成后调用 `renderMarkdown()` 最终渲染：

```typescript
// streaming 期间
this.renderContent(contentEl, assistantContent);  // 保留轻量实现

// 流结束后，正式渲染 Markdown
await this.renderMarkdown(contentEl, assistantContent);
```

---

### Step 4：欢迎屏重设计（0.5天）

**目标**：把 assistant 气泡内的欢迎文字改为居中卡片设计。

**修改文件**：`src/chat/ChatView.ts`

```typescript
private appendWelcomeMessage(): void {
  if (!this.messagesEl) return;
  const welcomeEl = this.messagesEl.createDiv({ cls: 'friday-chat-welcome' });
  welcomeEl.createEl('div', { cls: 'friday-chat-welcome-greeting', text: 'Good morning, explorer.' });
  welcomeEl.createEl('div', { cls: 'friday-chat-welcome-hint', text: 'Type / for commands, @ to mention a folder' });
}
```

---

### Step 5：消息 Hover 操作（1天）

**目标**：user 消息 hover 时显示复制按钮（与 Claudian 一致）。

**修改文件**：`src/chat/ChatView.ts` + CSS

```typescript
private appendUserMessage(text: string): void {
  const messageEl = this.messagesEl.createDiv({ cls: 'friday-chat-message user' });
  messageEl.createDiv({ cls: 'friday-chat-message-content', text });
  // 添加 actions
  const actions = messageEl.createDiv({ cls: 'friday-chat-user-msg-actions' });
  const copyBtn = actions.createSpan({ attr: { title: 'Copy' } });
  setIcon(copyBtn, 'copy');
  copyBtn.addEventListener('click', () => {
    navigator.clipboard.writeText(text);
    copyBtn.addClass('copied');
    setTimeout(() => copyBtn.removeClass('copied'), 1500);
  });
  this.scrollToBottom();
}
```

---

### Step 6：工具调用渲染升级（2-3天）

**目标**：可折叠的工具调用块，与 Claudian 视觉一致。

从 Claudian 的 `ToolCallRenderer.ts` 中提取核心部分，简化为只支持 `wiki` 工具，保留：
- 折叠/展开逻辑
- header（icon + name + summary + status）
- content 区（文本输出）

对于 bash、diff、图片等复杂工具的渲染，Friday 暂时不需要，可跳过。

---

### Step 7：滚动到底部按钮（0.5天）

**目标**：消息区域有未读内容时，显示"↓"按钮。

```typescript
private createScrollToBottomBtn(): void {
  const btn = this.messagesEl!.parentElement!.createDiv({ cls: 'friday-chat-scroll-btn' });
  setIcon(btn, 'chevron-down');
  btn.addEventListener('click', () => this.scrollToBottom());
  // IntersectionObserver 监测最后一条消息是否可见
}
```

---

## 12. 可直接复用的 Claudian 源码

以下 Claudian 源文件可以**直接复制并重命名前缀**（`claudian-` → `friday-chat-`）使用：

| 文件 | 用途 | 复用方式 |
|------|------|---------|
| `style/base/variables.css` | 品牌变量模式 | 参考结构，替换颜色为 Friday 品牌色 |
| `style/base/animations.css` | thinking-pulse, spin 等动效 | 直接复用，重命名 keyframe |
| `style/components/input.css` | 输入框 wrapper 架构 | 重命名 `.claudian-` → `.friday-chat-`，保留核心逻辑 |
| `style/components/messages.css` | 消息气泡样式 | 重命名，去掉 Claudian 特有的 compact/rewind 部分 |
| `style/features/slash-commands.css` | Slash 下拉样式 | 直接复用，重命名 |
| `style/features/file-context.css` | @提及下拉样式 | 直接复用前 70 行（mention-dropdown/item/icon/path/empty） |
| `style/components/toolcalls.css` | 工具调用样式 | 复用前 100 行（header/name/summary/status 部分） |
| `features/chat/rendering/MessageRenderer.ts` | 消息渲染器 | 提取 `addMessage` 和 `renderContent` 核心方法，适配 FridayPlugin 类型 |

---

## 13. 需要适配的部分与原因

| Claudian 功能 | 适配原因 | Friday 替代方案 |
|--------------|---------|----------------|
| `TabManager` / `TabBar` | Friday 目前单会话，引入多标签复杂度高，且 FridayWikiRuntime 不支持多 session | Step 7 之后根据需求评估，暂用单 tab |
| `ClaudianPlugin` 类型 | Claudian 的所有 UI 文件 `import type ClaudianPlugin from '../../main'`，Friday 是 `FridayPlugin` | 将导入改为 `import type FridayPlugin from '../../../main'`，类型替换 |
| `ProviderRegistry` / 多 provider | Claudian 支持 Claude/Codex/OpenCode，Friday 通过 `ChatRuntime` 抽象不同 provider | 保留 Friday 的 `FridayWikiRuntime` 接口，按需扩展 provider |
| `ConversationHistoryService` | 依赖 Claudian 特有的 SDK 存储层 | Friday 目前用内存 `conversationHistory` 数组，需要单独实现持久化（可用 Obsidian 的 `loadData/saveData`） |
| `SlashCommandDropdown.ts` 中的 custom slash 功能 | 依赖 Claudian settings 中的用户自定义命令 | Friday 的 `ChatCommands.ts` 已有 wiki/ask/save/publish，保留此文件 |
| `MentionDropdownController.ts` 的 MCP server 支持 | Friday 目前不需要 MCP | 只保留 vault folder 部分，移除 MCP/agent 相关代码 |
| `InputController.ts` 的 streaming queue | 复杂的排队/取消/审批机制 | Friday 的 streaming 逻辑更简单（`for await...of` 即可），保持当前实现 |
| 图片上传功能 | 依赖 Claudian 特有的图片处理 pipeline | Friday 暂不支持图片上传 |

---

## 附录：文件变更总览

实现上述所有步骤需要修改/新增的文件：

```
src/chat/
├── ChatView.ts                    ← 修改：DOM 结构重构（Step 2、4、5、7）
├── styles/
│   └── chat.css                   ← 修改：全面样式对齐（Step 1）
├── features/
│   ├── input/
│   │   ├── CommandPicker.ts       ← 微调：anchor 改为 wrapper
│   │   └── FolderPicker.ts        ← 微调：anchor 改为 wrapper
│   └── messages/
│       └── MessageRenderer.ts     ← 修改：从 Claudian 适配，增加 Markdown 渲染（Step 3）
```

---

*最后更新：2026-05-03*
*分析基于 Claudian v2.0.10 与 Friday Chat 当前开发版本*
