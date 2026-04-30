# Friday Plugin - Wiki AI 对话框集成方案

## 一、现状分析

### 1.1 你们的架构

```typescript
// 现有服务（来自 @internal/interfaces/obsidian/desktop）
createObsidianWorkspaceService()     // 工作空间管理
createObsidianGlobalConfigService()  // 全局配置（LLM 配置）
createObsidianProjectConfigService() // 项目配置
createObsidianProjectService()       // 项目管理（创建 wiki 项目）
createObsidianWikiService()          // Wiki 服务（ingest/query）
```

### 1.2 现有的工作流程

```
1. initWorkspace() → 初始化工作空间
2. 配置 LLM（支持多种 provider，包括 LM Studio）
3. createProject() → 创建 wiki 项目
4. ingest() → 摄取文件到 KB
5. queryStream() → 流式查询（支持多轮对话）
6. saveConversation() → 保存对话历史
```

### 1.3 LLM Provider 支持

根据测试代码，你们支持：
- **LM Studio**（本地）
- 其他 LLM Provider（通过 `loadLLMConfigFromEnv()`）
- 支持 Embedding Model 配置

## 二、核心需求重新定义

你们**不是**要复用整个 Claudian 架构，而是：

### ✅ 需要的
1. **Claudian 的 UI 框架**：对话框界面
2. **Slash Command 系统**：`/wiki @folder` 命令
3. **流式渲染**：进度显示、消息渲染
4. **状态管理**：会话历史、多标签（可选）

### ❌ 不需要的
1. Claude SDK 适配器
2. Codex/Opencode Provider
3. MCP 协议支持
4. Provider Registry 复杂架构

## 三、推荐方案：轻量级集成

### 方案架构

```
┌────────────────────────────────────────────────────────┐
│          Friday Obsidian Plugin                        │
│      (你们现有的 Friday plugin)                         │
└────────────────────────────────────────────────────────┘
                    ↓ 集成
┌────────────────────────────────────────────────────────┐
│      Claudian UI Components (精简复用)                 │
│  - ClaudianView (对话框容器)                            │
│  - MessageRenderer (消息渲染)                          │
│  - InputController (输入处理 + Slash Command)          │
│  - StreamController (流式响应)                         │
└────────────────────────────────────────────────────────┘
                    ↓ 调用
┌────────────────────────────────────────────────────────┐
│      Friday Wiki Runtime (新建适配层)                   │
│  - FridayWikiRuntime implements ChatRuntime           │
│  - 适配你们的 ObsidianWikiService                       │
└────────────────────────────────────────────────────────┘
                    ↓ 调用
┌────────────────────────────────────────────────────────┐
│      @internal/interfaces/obsidian/desktop             │
│  - createObsidianWikiService()                         │
│  - wikiService.ingest()                                │
│  - wikiService.queryStream()                           │
│  - wikiService.saveConversation()                      │
└────────────────────────────────────────────────────────┘
```

## 四、实现步骤

### Step 1: 创建 FridayWikiRuntime (核心适配器)

```typescript
// src/friday/runtime/FridayWikiRuntime.ts
import type { ChatRuntime } from '../../core/runtime/ChatRuntime';
import type { StreamChunk, ChatMessage } from '../../core/types';
import type { PreparedChatTurn, ChatTurnRequest } from '../../core/runtime/types';
import { 
  createObsidianWikiService,
  createObsidianProjectService,
  createObsidianWorkspaceService 
} from '@internal/interfaces/obsidian/desktop';

export class FridayWikiRuntime implements ChatRuntime {
  readonly providerId = 'friday-wiki';
  
  private wikiService = createObsidianWikiService();
  private projectService = createObsidianProjectService();
  private workspaceService = createObsidianWorkspaceService();
  
  private currentWorkspacePath: string;
  private currentProjectName: string | null = null;
  
  constructor(
    private plugin: FridayPlugin,
    workspacePath: string
  ) {
    this.currentWorkspacePath = workspacePath;
  }
  
  // 注册 Slash Commands
  async getSupportedCommands(): Promise<SlashCommand[]> {
    return [
      {
        id: 'friday:wiki-ingest',
        name: 'wiki',
        description: '📚 Ingest folder into wiki',
        argumentHint: '@folder-name',
        content: '',
        source: 'plugin',
      },
      {
        id: 'friday:wiki-query',
        name: 'ask',
        description: '🔍 Query wiki',
        argumentHint: '[your question]',
        content: '',
        source: 'plugin',
      },
      {
        id: 'friday:wiki-save',
        name: 'save',
        description: '💾 Save conversation',
        argumentHint: '[title]',
        content: '',
        source: 'plugin',
      },
    ];
  }
  
  // 核心查询方法
  async *query(
    turn: PreparedChatTurn,
    conversationHistory: ChatMessage[] = [],
  ): AsyncGenerator<StreamChunk> {
    const text = turn.request.text.trim();
    
    // 路由命令
    if (text.startsWith('/wiki ')) {
      yield* this.handleWikiIngest(text.slice(6));
    } else if (text.startsWith('/ask ')) {
      yield* this.handleWikiQuery(text.slice(5), conversationHistory);
    } else if (text.startsWith('/save ')) {
      yield* this.handleSaveConversation(text.slice(6), conversationHistory);
    } else {
      // 默认：直接查询（如果有活跃的 wiki 项目）
      yield* this.handleWikiQuery(text, conversationHistory);
    }
  }
  
  // 处理 Wiki Ingest
  private async *handleWikiIngest(args: string): AsyncGenerator<StreamChunk> {
    // 1. 解析文件夹路径
    const folderPath = this.parseFolderPath(args);
    
    if (!folderPath) {
      yield {
        type: 'text',
        content: '❌ **Error**: Please specify a folder.\n\n' +
                 '**Usage**: `/wiki @folder-name`',
      };
      return;
    }
    
    yield {
      type: 'text',
      content: `🚀 Starting wiki ingest for \`${folderPath}\`...\n\n`,
    };
    
    const toolId = `ingest-${Date.now()}`;
    yield {
      type: 'tool_call_start',
      id: toolId,
      name: 'wiki_ingest',
      input: { folderPath },
    };
    
    try {
      // 2. 获取绝对路径
      const absolutePath = this.getAbsoluteFolderPath(folderPath);
      
      // 3. 创建或获取 wiki 项目
      const projectName = await this.ensureWikiProject(folderPath);
      this.currentProjectName = projectName;
      
      yield {
        type: 'tool_call_delta',
        id: toolId,
        delta: `📁 Project: ${projectName}\n📍 Source: ${folderPath}\n\n`,
      };
      
      // 4. 调用 ingest（你们的服务）
      const ingestResult = await this.wikiService.ingest({
        workspacePath: this.currentWorkspacePath,
        projectName,
        temperature: 0.3,
      });
      
      if (!ingestResult.success || !ingestResult.data) {
        throw new Error(ingestResult.error || 'Ingest failed');
      }
      
      // 5. 显示结果
      const stats = ingestResult.data;
      const resultText = [
        `✅ **Ingest completed successfully!**\n`,
        `- **Entities**: ${stats.extractedEntities}`,
        `- **Concepts**: ${stats.extractedConcepts}`,
        `- **Connections**: ${stats.extractedConnections}`,
        `- **Total Knowledge**: ${stats.extractedEntities + stats.extractedConcepts}\n`,
      ].join('\n');
      
      yield {
        type: 'tool_call_result',
        id: toolId,
        result: resultText,
      };
      
      yield {
        type: 'text',
        content: `\n### Next Steps\n\n` +
                 `1. Ask questions using \`/ask [question]\`\n` +
                 `2. Or simply type your question directly\n` +
                 `3. Save conversation with \`/save [title]\`\n`,
      };
      
    } catch (error) {
      yield {
        type: 'tool_call_result',
        id: toolId,
        result: `❌ **Error**: ${error.message}`,
      };
    }
  }
  
  // 处理 Wiki Query（流式）
  private async *handleWikiQuery(
    question: string,
    conversationHistory: ChatMessage[],
  ): AsyncGenerator<StreamChunk> {
    if (!this.currentProjectName) {
      yield {
        type: 'text',
        content: '⚠️ **No active wiki project**\n\n' +
                 'Please ingest a folder first using `/wiki @folder-name`',
      };
      return;
    }
    
    yield {
      type: 'text',
      content: `🔍 Searching wiki...\n\n`,
    };
    
    try {
      // 调用你们的流式查询服务
      let answer = '';
      let isFirstChunk = true;
      
      for await (const chunk of this.wikiService.queryStream({
        workspacePath: this.currentWorkspacePath,
        projectName: this.currentProjectName,
        question,
      })) {
        answer += chunk;
        
        // 流式输出
        if (isFirstChunk) {
          isFirstChunk = false;
        }
        
        yield {
          type: 'text',
          content: chunk,
        };
      }
      
      // 查询完成提示
      if (answer.length === 0) {
        yield {
          type: 'text',
          content: '\n\n_No relevant information found in the wiki._',
        };
      }
      
    } catch (error) {
      yield {
        type: 'text',
        content: `\n\n❌ **Query error**: ${error.message}`,
      };
    }
  }
  
  // 保存对话
  private async *handleSaveConversation(
    titleArg: string,
    conversationHistory: ChatMessage[],
  ): AsyncGenerator<StreamChunk> {
    if (!this.currentProjectName) {
      yield {
        type: 'text',
        content: '⚠️ No active wiki project to save conversation to.',
      };
      return;
    }
    
    const title = titleArg || 'Untitled Conversation';
    
    yield {
      type: 'text',
      content: `💾 Saving conversation: "${title}"...\n\n`,
    };
    
    try {
      // 转换 ChatMessage 格式到你们的格式
      const history = this.convertToWikiConversationHistory(conversationHistory);
      
      const saveResult = await this.wikiService.saveConversation({
        workspacePath: this.currentWorkspacePath,
        projectName: this.currentProjectName,
        title,
        topic: 'General Discussion',
        conversationHistory: history,
        filename: this.generateConversationFilename(title),
      });
      
      if (!saveResult.success) {
        throw new Error(saveResult.error || 'Save failed');
      }
      
      yield {
        type: 'text',
        content: `✅ **Conversation saved!**\n\n` +
                 `File: \`${path.basename(saveResult.data?.savedPath || '')}\`\n\n` +
                 `The conversation has been automatically ingested into the wiki.`,
      };
      
    } catch (error) {
      yield {
        type: 'text',
        content: `❌ **Save error**: ${error.message}`,
      };
    }
  }
  
  // 辅助方法
  private parseFolderPath(args: string): string | null {
    if (!args) return null;
    
    // 处理 @folder 格式
    let path = args.trim();
    if (path.startsWith('@')) {
      path = path.slice(1);
    }
    if (path.endsWith('/')) {
      path = path.slice(0, -1);
    }
    
    return path;
  }
  
  private getAbsoluteFolderPath(relativePath: string): string {
    const vaultPath = this.plugin.app.vault.adapter.getBasePath();
    return path.join(vaultPath, relativePath);
  }
  
  private async ensureWikiProject(folderName: string): Promise<string> {
    const projectName = `${folderName}-wiki`;
    
    // 检查项目是否存在
    // 如果不存在，创建新项目
    const createResult = await this.projectService.createProject({
      name: projectName,
      workspacePath: this.currentWorkspacePath,
      sourceFolder: this.getAbsoluteFolderPath(folderName),
      type: 'wiki',
    });
    
    if (!createResult.success) {
      throw new Error(`Failed to create project: ${createResult.error}`);
    }
    
    return projectName;
  }
  
  private convertToWikiConversationHistory(
    messages: ChatMessage[]
  ): Array<{ question: string; answer: string }> {
    const history: Array<{ question: string; answer: string }> = [];
    
    for (let i = 0; i < messages.length; i += 2) {
      const userMsg = messages[i];
      const assistantMsg = messages[i + 1];
      
      if (userMsg?.role === 'user' && assistantMsg?.role === 'assistant') {
        history.push({
          question: userMsg.content,
          answer: assistantMsg.content,
        });
      }
    }
    
    return history;
  }
  
  private generateConversationFilename(title: string): string {
    const date = new Date().toISOString().split('T')[0];
    const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    return `${date}-${slug}.md`;
  }
  
  // ChatRuntime 必需方法
  getCapabilities() {
    return {
      providerId: 'friday-wiki',
      supportsPersistentRuntime: true,
      supportsNativeHistory: true,
      supportsPlanMode: false,
      supportsRewind: false,
      supportsFork: false,
      supportsProviderCommands: false,
      supportsImageAttachments: false,
      supportsInstructionMode: false,
      supportsMcpTools: false,
      reasoningControl: 'none' as const,
    };
  }
  
  prepareTurn(request: ChatTurnRequest) {
    return {
      persistedContent: request.text,
      request,
      isCompact: false,
    };
  }
  
  cancel() {
    // 可以添加取消逻辑
  }
  
  resetSession() {
    this.currentProjectName = null;
  }
  
  getSessionId(): string | null {
    return this.currentProjectName;
  }
  
  isReady(): boolean {
    return true;
  }
  
  cleanup() {}
  
  consumeSessionInvalidation(): boolean {
    return false;
  }
  
  onReadyStateChange() {
    return () => {};
  }
  
  setResumeCheckpoint() {}
  syncConversationState() {}
  reloadMcpServers() { return Promise.resolve(); }
  ensureReady() { return Promise.resolve(true); }
  consumeTurnMetadata() {
    return {
      userMessageId: undefined,
      assistantMessageId: undefined,
      wasSent: false,
      planCompleted: false,
    };
  }
  
  setApprovalCallback() {}
  setApprovalDismisser() {}
  setAskUserQuestionCallback() {}
  setExitPlanModeCallback() {}
  setPermissionModeSyncCallback() {}
  setSubagentHookProvider() {}
  setAutoTurnCallback() {}
  
  buildSessionUpdates() {
    return {
      created: [],
      resumed: [],
      invalidated: [],
    };
  }
  
  resolveSessionIdForFork() {
    return null;
  }
  
  async rewind() {
    throw new Error('Rewind not supported');
  }
}
```

### Step 2: 注册到 Friday Plugin

```typescript
// src/friday/FridayPlugin.ts (你们的主插件文件)
import { Plugin } from 'obsidian';
import { ProviderRegistry } from '../core/providers/ProviderRegistry';
import { FridayWikiRuntime } from './runtime/FridayWikiRuntime';
import { ClaudianView, VIEW_TYPE_CLAUDIAN } from '../features/chat/ClaudianView';

export default class FridayPlugin extends Plugin {
  async onload() {
    console.log('Loading Friday Plugin with Wiki AI Chat...');
    
    // 获取工作空间路径
    const workspacePath = this.getWorkspacePath();
    
    // 注册 Friday Wiki Provider
    ProviderRegistry.register('friday-wiki', {
      displayName: 'Friday Wiki',
      blankTabOrder: 10,
      isEnabled: () => true,
      capabilities: {
        providerId: 'friday-wiki',
        supportsPersistentRuntime: true,
        supportsNativeHistory: true,
        supportsPlanMode: false,
        supportsRewind: false,
        supportsFork: false,
        supportsProviderCommands: false,
        supportsImageAttachments: false,
        supportsInstructionMode: false,
        supportsMcpTools: false,
        reasoningControl: 'none',
      },
      createRuntime: ({ plugin }) => {
        return new FridayWikiRuntime(plugin as FridayPlugin, workspacePath);
      },
      chatUIConfig: {
        // UI 配置
        getProviderIcon: () => ({
          viewBox: '0 0 24 24',
          path: 'M12 2L2 7v10c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V7l-10-5z',
        }),
        getModelOptions: () => [],
        ownsModel: () => false,
        getCustomModelIds: () => [],
        getContextWindowSize: () => 32768,
      },
      settingsReconciler: {
        reconcileModelWithEnvironment: () => ({ 
          changed: false, 
          invalidatedConversations: [] 
        }),
        normalizeModelVariantSettings: () => false,
      },
      createTitleGenerationService: () => ({
        generateTitle: async () => {},
      }),
      createInstructionRefineService: () => ({
        refineInstruction: async () => ({ success: false }),
        continueConversation: async () => ({ success: false }),
        resetConversation: () => {},
        cancel: () => {},
      }),
      createInlineEditService: () => ({
        editSelection: async () => {
          throw new Error('Inline edit not supported');
        },
      }),
      historyService: {
        // 使用你们自己的历史记录服务
        list: async () => [],
        load: async () => ({ messages: [] }),
        delete: async () => {},
      },
      taskResultInterpreter: {
        extractResult: () => null,
      },
    });
    
    // 注册 Claudian 视图
    this.registerView(
      VIEW_TYPE_CLAUDIAN,
      (leaf) => new ClaudianView(leaf, this)
    );
    
    // 添加 Ribbon 图标
    this.addRibbonIcon('message-square', 'Friday Wiki Chat', () => {
      this.activateView();
    });
    
    // 添加命令
    this.addCommand({
      id: 'open-wiki-chat',
      name: 'Open Wiki Chat',
      callback: () => {
        this.activateView();
      },
    });
  }
  
  private getWorkspacePath(): string {
    return this.app.vault.adapter.getBasePath();
  }
  
  async activateView() {
    const { workspace } = this.app;
    
    let leaf = workspace.getLeavesOfType(VIEW_TYPE_CLAUDIAN)[0];
    
    if (!leaf) {
      leaf = workspace.getRightLeaf(false);
      await leaf?.setViewState({
        type: VIEW_TYPE_CLAUDIAN,
        active: true,
      });
    }
    
    workspace.revealLeaf(leaf!);
  }
}
```

### Step 3: LLM Provider 配置集成

你们已经有 LLM 配置系统，需要将其与 Claudian 的设置集成：

```typescript
// src/friday/settings/FridaySettings.ts
import { PluginSettingTab, Setting } from 'obsidian';
import type FridayPlugin from '../FridayPlugin';
import { loadLLMConfigFromEnv } from '@internal/infrastructure/llm/llm-config';

export class FridaySettingsTab extends PluginSettingTab {
  plugin: FridayPlugin;
  
  constructor(app: App, plugin: FridayPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }
  
  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    
    containerEl.createEl('h2', { text: 'Friday Wiki Chat Settings' });
    
    // LLM Provider
    new Setting(containerEl)
      .setName('LLM Provider')
      .setDesc('Select your LLM provider')
      .addDropdown(dropdown => dropdown
        .addOption('lmstudio', 'LM Studio (Local)')
        .addOption('openai', 'OpenAI')
        .addOption('anthropic', 'Anthropic')
        .addOption('custom', 'Custom')
        .setValue(this.plugin.settings.llmProvider || 'lmstudio')
        .onChange(async (value) => {
          this.plugin.settings.llmProvider = value;
          await this.plugin.saveSettings();
        }));
    
    // LM Studio Base URL
    new Setting(containerEl)
      .setName('LM Studio Base URL')
      .setDesc('Base URL for LM Studio (default: http://localhost:1234)')
      .addText(text => text
        .setPlaceholder('http://localhost:1234')
        .setValue(this.plugin.settings.lmStudioBaseUrl || '')
        .onChange(async (value) => {
          this.plugin.settings.lmStudioBaseUrl = value;
          await this.plugin.saveSettings();
        }));
    
    // Model Name
    new Setting(containerEl)
      .setName('Model Name')
      .setDesc('Name of the LLM model to use')
      .addText(text => text
        .setPlaceholder('qwen2.5-coder:14b')
        .setValue(this.plugin.settings.llmModel || '')
        .onChange(async (value) => {
          this.plugin.settings.llmModel = value;
          await this.plugin.saveSettings();
        }));
    
    // Embedding Model
    new Setting(containerEl)
      .setName('Embedding Model')
      .setDesc('Model for text embeddings (optional)')
      .addText(text => text
        .setPlaceholder('nomic-embed-text')
        .setValue(this.plugin.settings.embeddingModel || '')
        .onChange(async (value) => {
          this.plugin.settings.embeddingModel = value;
          await this.plugin.saveSettings();
        }));
    
    // Test Connection
    new Setting(containerEl)
      .setName('Test Connection')
      .setDesc('Test your LLM configuration')
      .addButton(button => button
        .setButtonText('Test')
        .onClick(async () => {
          await this.testConnection();
        }));
  }
  
  async testConnection() {
    try {
      const llmConfig = loadLLMConfigFromEnv();
      // 测试连接逻辑
      new Notice('✅ LLM connection successful!');
    } catch (error) {
      new Notice(`❌ Connection failed: ${error.message}`);
    }
  }
}
```

## 五、用户交互流程（完整示例）

### 场景：用户第一次使用

```
┌─────────────────────────────────────────────────────────┐
│ 1. 用户打开 Obsidian                                     │
│    - 点击 Friday 图标 或 命令面板 "Open Wiki Chat"      │
└─────────────────────────────────────────────────────────┘
                      ↓
┌─────────────────────────────────────────────────────────┐
│ 2. Friday Wiki Chat 对话框打开（右侧边栏）               │
│    显示欢迎消息:                                         │
│                                                         │
│    👋 Welcome to Friday Wiki Chat!                      │
│                                                         │
│    Get started by ingesting a folder:                   │
│    `/wiki @your-folder`                                │
│                                                         │
│    Type `/` to see all commands                        │
└─────────────────────────────────────────────────────────┘
                      ↓
┌─────────────────────────────────────────────────────────┐
│ 3. 用户输入: /                                           │
│    自动显示命令菜单:                                     │
│    ┌─────────────────────────────────────────────────┐ │
│    │ 📚 /wiki @folder-name                           │ │
│    │    Ingest folder into wiki                      │ │
│    │                                                 │ │
│    │ 🔍 /ask [your question]                        │ │
│    │    Query wiki                                   │ │
│    │                                                 │ │
│    │ 💾 /save [title]                               │ │
│    │    Save conversation                            │ │
│    └─────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────┘
                      ↓
┌─────────────────────────────────────────────────────────┐
│ 4. 用户选择 /wiki，输入 @                                │
│    显示文件夹选择器:                                     │
│    ┌─────────────────────────────────────────────────┐ │
│    │ MyNotes/                                        │ │
│    │ ProjectDocs/                                    │ │
│    │ PersonalJournal/                                │ │
│    └─────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────┘
                      ↓
┌─────────────────────────────────────────────────────────┐
│ 5. 用户选择 MyNotes，提交: /wiki @MyNotes               │
└─────────────────────────────────────────────────────────┘
                      ↓
┌─────────────────────────────────────────────────────────┐
│ 6. 系统响应 (实时流式显示):                             │
│                                                         │
│    🚀 Starting wiki ingest for `MyNotes`...             │
│                                                         │
│    [wiki_ingest]                                        │
│    📁 Project: MyNotes-wiki                             │
│    📍 Source: MyNotes                                   │
│                                                         │
│    ✅ Ingest completed successfully!                    │
│    - Entities: 23                                       │
│    - Concepts: 45                                       │
│    - Connections: 67                                    │
│    - Total Knowledge: 68                                │
│                                                         │
│    ### Next Steps                                       │
│    1. Ask questions using `/ask [question]`            │
│    2. Or simply type your question directly            │
│    3. Save conversation with `/save [title]`           │
└─────────────────────────────────────────────────────────┘
                      ↓
┌─────────────────────────────────────────────────────────┐
│ 7. 用户直接输入问题: What is Domain-Driven Design?      │
└─────────────────────────────────────────────────────────┘
                      ↓
┌─────────────────────────────────────────────────────────┐
│ 8. 系统响应 (流式显示):                                 │
│                                                         │
│    🔍 Searching wiki...                                 │
│                                                         │
│    Domain-Driven Design (DDD) is a software            │
│    development approach that focuses on modeling       │
│    software to match the business domain...            │
│    (流式输出，逐字显示)                                  │
└─────────────────────────────────────────────────────────┘
                      ↓
┌─────────────────────────────────────────────────────────┐
│ 9. 用户继续提问: What is a Bounded Context?             │
│    (系统继续流式回答)                                    │
└─────────────────────────────────────────────────────────┘
                      ↓
┌─────────────────────────────────────────────────────────┐
│ 10. 用户保存对话: /save DDD Q&A                         │
└─────────────────────────────────────────────────────────┘
                      ↓
┌─────────────────────────────────────────────────────────┐
│ 11. 系统响应:                                           │
│                                                         │
│     💾 Saving conversation: "DDD Q&A"...                │
│                                                         │
│     ✅ Conversation saved!                              │
│     File: `2026-04-30-ddd-qa.md`                       │
│                                                         │
│     The conversation has been automatically             │
│     ingested into the wiki.                            │
└─────────────────────────────────────────────────────────┘
```

## 六、关键优势

### ✅ 轻量级集成
- 只复用 UI 层，不引入复杂的 Provider 架构
- 直接适配你们的 `ObsidianWikiService`

### ✅ 保持你们的技术栈
- 继续使用 `@internal/interfaces/obsidian/desktop`
- LLM 配置保持不变（LM Studio + 其他 providers）
- KB 文件格式不变

### ✅ 渐进式增强
- 先实现基础功能（ingest + query）
- 后续可添加：
  - 多标签支持
  - 会话历史管理
  - 更丰富的 UI 交互

### ✅ 用户体验
- Slash Command 直观易用
- 流式响应实时反馈
- 自动保存对话历史

## 七、开发时间估算

| 任务 | 工作量 | 说明 |
|------|--------|------|
| **Step 1: FridayWikiRuntime** | 1-2 天 | 核心适配器，约 300-500 行代码 |
| **Step 2: 注册 Provider** | 0.5 天 | 配置和注册 |
| **Step 3: UI 集成** | 1 天 | 复用 ClaudianView 和相关组件 |
| **Step 4: LLM 配置** | 0.5 天 | 设置页面集成 |
| **Step 5: 测试调试** | 1 天 | 端到端测试 |
| **总计** | **4-5 天** | MVP 版本 |

## 八、技术风险与解决方案

### 风险 1: 依赖冲突

**问题**: Claudian 可能有与 Friday 冲突的依赖

**解决方案**:
- 使用 npm workspace 隔离
- 或者只复制必要的 UI 组件代码（约 2000 行）

### 风险 2: LM Studio 连接

**问题**: 确保 LM Studio 服务正常连接

**解决方案**:
```typescript
// 添加连接测试
async testLMStudioConnection() {
  const baseUrl = this.settings.lmStudioBaseUrl || 'http://localhost:1234';
  
  try {
    const response = await fetch(`${baseUrl}/v1/models`);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    return true;
  } catch (error) {
    console.error('LM Studio connection failed:', error);
    return false;
  }
}
```

### 风险 3: 流式响应中断

**问题**: 用户可能中途取消查询

**解决方案**:
```typescript
// 在 FridayWikiRuntime 中添加取消支持
private abortController = new AbortController();

cancel() {
  this.abortController.abort();
  this.abortController = new AbortController();
}

// 在 queryStream 中使用
for await (const chunk of this.wikiService.queryStream({
  workspacePath: this.currentWorkspacePath,
  projectName: this.currentProjectName,
  question,
  signal: this.abortController.signal,  // 传递取消信号
})) {
  // ...
}
```

## 九、下一步行动

### 立即开始

1. **创建分支**: `git checkout -b feature/friday-wiki-chat`

2. **安装依赖**: 
```bash
npm install
# 确保 @internal/interfaces/obsidian/desktop 可用
```

3. **创建文件结构**:
```bash
mkdir -p src/friday/runtime
mkdir -p src/friday/settings
touch src/friday/runtime/FridayWikiRuntime.ts
touch src/friday/FridayPlugin.ts
touch src/friday/settings/FridaySettings.ts
```

4. **开始实现**: 从 `FridayWikiRuntime.ts` 开始

### 测试计划

创建测试文件 `friday-wiki-chat.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { FridayWikiRuntime } from './runtime/FridayWikiRuntime';

describe('Friday Wiki Chat', () => {
  it('should handle /wiki command', async () => {
    const runtime = new FridayWikiRuntime(mockPlugin, workspacePath);
    
    const chunks = [];
    for await (const chunk of runtime.query({
      persistedContent: '/wiki @TestFolder',
      request: { text: '/wiki @TestFolder' },
      isCompact: false,
    })) {
      chunks.push(chunk);
    }
    
    expect(chunks.length).toBeGreaterThan(0);
    expect(chunks[0].type).toBe('text');
  });
});
```

## 十、总结

### 核心方案

**在 Friday Plugin 中集成 Claudian UI**，通过 `FridayWikiRuntime` 适配器连接你们现有的 Wiki 服务。

### 关键文件

```
src/friday/
├── FridayPlugin.ts              ← 主插件入口
├── runtime/
│   └── FridayWikiRuntime.ts     ← 核心适配器（~500 行）
└── settings/
    └── FridaySettings.ts        ← LLM 配置 UI
```

### 预期效果

用户在 Friday Plugin 中：
1. 打开 Wiki Chat 对话框
2. 使用 `/wiki @folder` 摄取文件
3. 直接提问，获得流式回答
4. 使用 `/save` 保存对话历史
5. 所有数据保存在你们的 KB 格式中

---

**准备好开始了吗？我可以帮你写具体的代码！** 🚀
