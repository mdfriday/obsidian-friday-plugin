# Friday Wiki Chat 架构文档

## 一、概述

Friday Wiki Chat 是 Friday Plugin 的 AI 对话功能模块，提供通过自然语言交互来创建、查询和发布 Wiki 的能力。

### 核心理念
- **AI 交互方式**: 通过对话完成 Wiki 操作
- **完全复用**: 复用现有的项目管理和发布逻辑
- **极简集成**: 最小化新增代码，最大化复用
- **Desktop Only**: 仅在桌面环境可用

## 二、架构分层

```
┌──────────────────────────────────────────────────┐
│              Presentation Layer                   │
│  ┌────────────────┐      ┌───────────────────┐  │
│  │  Site.svelte   │◄────►│  ChatView.ts      │  │
│  │  (手动操作)     │ 切换  │  (AI 对话)         │  │
│  └────────────────┘      └───────────────────┘  │
└──────────────────────────────────────────────────┘
                      │
                      ▼
┌──────────────────────────────────────────────────┐
│           Application Layer                       │
│  ┌────────────────────────────────────────────┐  │
│  │      FridayWikiRuntime (命令路由)          │  │
│  │  - /wiki → ingest                          │  │
│  │  - query → queryStream                     │  │
│  │  - /save → saveConversation                │  │
│  │  - /publish → publishFolder ✅              │  │
│  └────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────┘
                      │
                      ▼
┌──────────────────────────────────────────────────┐
│              Service Layer                        │
│  ┌──────────────┐    ┌───────────────────────┐  │
│  │ WikiService  │    │  Site.ts (复用)        │  │
│  │ - ingest     │    │  - getOrCreateProject │  │
│  │ - queryStream│    │  - publishFolder ✅    │  │
│  │ - save       │    │    (右键发布逻辑)      │  │
│  └──────────────┘    └───────────────────────┘  │
└──────────────────────────────────────────────────┘
                      │
                      ▼
┌──────────────────────────────────────────────────┐
│           Infrastructure (Desktop)                │
│  - @mdfriday/foundry (npm link)                  │
│  - LM Studio (localhost:1234)                    │
└──────────────────────────────────────────────────┘
```

## 三、目录结构

```
src/
├── chat/                           # AI Chat 模块
│   ├── ChatView.ts                 # Chat 视图（从 Claudian 复制改名）
│   ├── ChatRuntime.ts              # Friday Wiki Runtime（~250行）
│   ├── ChatCommands.ts             # Slash 命令定义（~40行）
│   │
│   ├── core/                       # 核心组件（从 Claudian 复制）
│   │   ├── runtime/
│   │   │   ├── ChatRuntime.ts      # ChatRuntime 接口
│   │   │   └── types.ts
│   │   ├── types/
│   │   │   ├── chat.ts
│   │   │   ├── provider.ts
│   │   │   └── index.ts
│   │   └── providers/
│   │       ├── ProviderRegistry.ts
│   │       └── types.ts
│   │
│   ├── features/                   # 功能组件（从 Claudian 复制）
│   │   ├── input/
│   │   │   ├── InputController.ts
│   │   │   └── SlashCommandMenu.ts
│   │   └── messages/
│   │       ├── MessageRenderer.ts
│   │       ├── StreamRenderer.ts
│   │       └── ToolCallRenderer.ts
│   │
│   ├── utils/                      # 工具函数（从 Claudian 复制）
│   │   ├── markdown.ts
│   │   └── streaming.ts
│   │
│   └── styles/                     # 样式（从 Claudian 复制）
│       └── chat.css
│
├── services/
│   └── wiki/                       # Wiki 服务（极简）
│       ├── index.ts                # 导出
│       ├── WikiService.ts          # Wiki Service 封装（~60行）
│       └── types.ts                # 类型定义
│
├── svelte/
│   └── Site.svelte                 # 修改：添加 AI 切换按钮
│
└── main.ts                         # 修改：集成 Chat
```

## 四、核心模块

### 4.1 ChatRuntime.ts（核心适配器）

**职责**:
- 实现 ChatRuntime 接口
- 路由 Slash 命令
- 调用 WikiService（ingest、query、save）
- 调用现有的项目和发布逻辑

**命令处理**:
```typescript
/wiki @folder    → handleWikiIngest()     → 创建项目 + ingest
直接输入问题      → handleWikiQuery()      → 流式查询
/save [title]   → handleSaveConversation() → 保存对话
/publish        → handlePublish()         → 发布（复用现有逻辑）
```

**关键方法**:
- `async *query(turn, history): AsyncGenerator<StreamChunk>`
- `handleWikiIngest(args: string)` - Ingest 文件夹
- `handleWikiQuery(question, history)` - 流式查询
- `handleSaveConversation(title, history)` - 保存对话
- `handlePublish()` - 发布到 MDFriday

**复用现有逻辑**:
- `this.plugin.getOrCreateProjectForFolder(folderPath)` - 获取/创建项目
- `this.plugin.publishFolder(folderPath, { onProgress })` - 发布

### 4.2 WikiService.ts（极简封装）

**职责**: 只封装 Foundry Wiki Service 的 3 个方法

**核心方法**:
```typescript
async ingest(projectName: string): Promise<IngestResult>
async *queryStream(projectName: string, question: string): AsyncGenerator<string>
async saveConversation(projectName, title, conversationHistory): Promise<void>
```

**特点**:
- 极简设计（~60行）
- 只封装 Wiki 特有逻辑
- Project/Workspace 等通用服务在 ChatRuntime 中直接使用

### 4.3 ChatView.ts（从 Claudian 复制）

**来源**: `claudian/src/features/chat/ClaudianView.ts`

**修改**:
- 重命名: `ClaudianView` → `ChatView`
- 视图类型: `VIEW_TYPE_FRIDAY_CHAT`
- 显示名称: `'Friday Chat (Beta)'`
- 添加切换按钮: 切换到 Site.svelte

**职责**:
- 管理 Chat UI 容器
- 渲染消息流
- 处理输入和命令
- UI 切换

### 4.4 main.ts 集成

**新增内容**:

1. **注册 Provider** (~30行)
   ```typescript
   ProviderRegistry.register('friday-wiki', {
     displayName: 'Friday Wiki',
     createRuntime: ({ plugin }) => new FridayWikiRuntime(plugin),
     // ...
   });
   ```

2. **注册 ChatView** (~5行)
   ```typescript
   this.registerView(VIEW_TYPE_FRIDAY_CHAT, (leaf) => new ChatView(leaf, this));
   ```

3. **复用辅助方法** (~30行)
   ```typescript
   async getOrCreateProjectForFolder(folderPath: string): Promise<string>
   async publishFolder(folderPath, options?): Promise<PublishResult>
   async activateChatView(): Promise<void>
   ```

4. **添加命令和图标** (~15行)

### 4.5 Site.svelte 修改

**新增**: AI 切换按钮（~15行）

```svelte
<button 
  class="friday-ai-switch-btn" 
  on:click={switchToChatView}
  title="Switch to AI Chat (Beta)">
  🤖 AI
</button>
```

## 五、Slash 命令系统

### 命令列表

| 命令 | 语法 | 功能 | 示例 |
|------|------|------|------|
| `/wiki` | `/wiki @folder-name` | Ingest 文件夹到 Wiki | `/wiki @MyNotes` |
| `/ask` | `/ask [question]` | 查询 Wiki（可选） | `/ask What is DDD?` |
| `/save` | `/save [title]` | 保存对话历史 | `/save DDD Q&A` |
| `/publish` | `/publish` | 发布到 MDFriday | `/publish` |

**注意**: 
- 直接输入问题也会触发查询，不需要 `/ask`
- `/ask` 是可选命令，主要用于明确意图

### 命令补全
- 输入 `/` 显示命令菜单
- 输入 `@` 显示文件夹选择器
- Tab 键自动补全

## 六、用户交互流程

### 典型工作流

```
1. 用户打开 Friday Chat
   ↓
2. 输入: /wiki @MyNotes
   ↓
   系统响应:
   - ⚙️  Init workspace...
   - 🔧 Config LLM...
   - 📚 Get project...
   - 📥 Ingesting files...
   - ✅ Completed! (显示统计)
   ↓
3. 用户输入: What is Domain-Driven Design?
   ↓
   系统响应:
   - 🔍 Searching...
   - (流式输出答案)
   ↓
4. 用户继续提问，多轮对话
   ↓
5. 用户输入: /save DDD Introduction
   ↓
   系统响应:
   - 💾 Saving...
   - ✅ Saved and auto-ingested!
   ↓
6. 用户输入: /publish
   ↓
   系统响应:
   - 📤 Publishing...
   - Building... (50%)
   - Uploading... (80%)
   - ✅ Published! (显示 URL)
```

## 七、关键复用点

### 7.1 项目管理（完全复用）

```typescript
// 调用现有逻辑
await this.plugin.getOrCreateProjectForFolder(folderPath)

// 背后执行（site.ts）:
// 1. 查找是否有对应项目
// 2. 如果没有 → 创建默认项目
// 3. 返回项目名
```

### 7.2 发布流程（完全复用）

```typescript
// 调用现有的右键发布逻辑
await this.plugin.publishFolder(folderPath, {
  onProgress: (progress) => {
    // 在 Chat UI 显示进度
  }
})

// 背后执行（site.ts）:
// 1. 获取/创建项目
// 2. 构建（显示进度）
// 3. 打包
// 4. 上传（显示进度）
// 5. 返回 URL
```

### 7.3 LLM Provider 配置

```typescript
// 在 Settings 中配置（未来实现）
// Chat 直接使用全局配置
// 默认使用 LM Studio (http://localhost:1234)
```

## 八、技术栈

### 核心依赖
- **TypeScript**: 主要开发语言
- **Obsidian Plugin API**: 插件框架
- **@mdfriday/foundry**: Wiki Service（npm link）
- **Claudian UI**: Chat UI 组件（复制复用）

### LLM Provider
- **LM Studio**: 默认本地 LLM 服务
- **URL**: http://localhost:1234
- **模型**: qwen2.5-coder:14b（可配置）

### 开发工具
- **esbuild**: 构建工具
- **npm link**: 本地开发链接 foundry

## 九、实现步骤

### Phase 1: 复制文件 (1天)
- [x] 创建 `src/chat/` 目录
- [ ] 从 Claudian 复制 ~18 个核心文件
- [ ] 重命名 `ClaudianView` → `ChatView`
- [ ] 全局替换品牌名称
- [ ] 创建 `src/services/wiki/`
- [ ] 设置 `npm link @mdfriday/foundry`

### Phase 2: 核心实现 (2天)
- [ ] 实现 `WikiService.ts`（~60行）
- [ ] 实现 `ChatRuntime.ts`（~250行）
  - [ ] `handleWikiIngest()`
  - [ ] `handleWikiQuery()`
  - [ ] `handleSaveConversation()`
  - [ ] `handlePublish()`

### Phase 3: main.ts 集成 (1天)
- [ ] 注册 Provider
- [ ] 注册 ChatView
- [ ] 实现 `getOrCreateProjectForFolder()`
- [ ] 实现 `publishFolder()`
- [ ] 添加命令和 Ribbon 图标

### Phase 4: UI 集成 (1天)
- [ ] 修改 `ChatView.ts`（添加切换按钮）
- [ ] 在 Site.svelte 添加 AI 切换按钮
- [ ] 样式调整

### Phase 5: 测试与优化 (2天)
- [ ] 功能测试
- [ ] 错误处理
- [ ] 进度显示优化
- [ ] 文档更新

**总计: 6-7天**

## 十、代码量统计

### 新增代码
```
src/chat/ChatRuntime.ts          ~250 行
src/chat/ChatCommands.ts         ~40 行
src/services/wiki/WikiService.ts ~60 行
src/services/wiki/types.ts       ~30 行
src/services/wiki/index.ts       ~5 行
src/main.ts (新增)               ~80 行
src/svelte/Site.svelte (新增)    ~15 行

总计: ~480 行
```

### 从 Claudian 复制
```
~18 个核心文件
主要是 UI 组件和基础设施
```

## 十一、测试计划

### 功能测试
1. **Ingest 测试**
   - `/wiki @TestFolder`
   - 验证进度显示
   - 验证统计信息

2. **Query 测试**
   - 直接输入问题
   - 验证流式输出
   - 多轮对话测试

3. **Save 测试**
   - `/save TestTitle`
   - 验证文件保存
   - 验证 auto-ingest

4. **Publish 测试**
   - `/publish`
   - 验证进度显示（构建 + 上传）
   - 验证 URL 返回

5. **UI 切换测试**
   - Chat ↔ Site 切换
   - 状态保持

### 错误处理测试
- 无效文件夹路径
- LM Studio 未启动
- 网络错误
- 文件权限问题

### 性能测试
- 大文件夹 ingest
- 长对话历史
- 并发查询

## 十二、未来扩展

### Phase 2 功能
- Settings 页面（LLM Provider 配置）
- 多项目管理
- 对话历史记录
- 模板系统

### 高级功能
- 自动化工作流
- 插件集成
- 自定义命令
- 主题支持

## 十三、注意事项

### Desktop Only
- Wiki Service 依赖本地文件系统
- LM Studio 需要本地运行
- 移动端不支持

### 依赖管理
- 使用 `npm link` 连接本地 foundry
- 确保 foundry 版本兼容

### 错误处理
- 完善的错误提示
- 优雅降级
- 日志记录

### 性能优化
- 流式响应减少延迟
- 进度显示提升体验
- 缓存机制（未来）

---

**文档版本**: v1.0  
**最后更新**: 2026-04-30  
**维护者**: Friday Team
