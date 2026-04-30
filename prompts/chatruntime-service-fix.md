# ChatRuntime 修复：使用 Plugin 的 Foundry Services

## 问题描述

输入 `/wiki @How` 时报错：
```
initializing workspace, error, this.workspaceService is not a function
```

## 根本原因

`ChatRuntime.ts` 中自己创建了 Foundry service 实例，但这些服务应该复用 `main.ts` 中已经初始化好的服务实例。

### 错误的做法

```typescript
export class FridayWikiRuntime implements ChatRuntime {
	private globalConfigService = createObsidianGlobalConfigService();
	private workspaceService = createObsidianWorkspaceService();
	private workspacePath: string;
	
	constructor(private plugin: FridayPlugin) {
		this.workspacePath = plugin.app.vault.adapter.getBasePath();
		// ...
	}
	
	private async ensureWorkspaceInitialized(): Promise<void> {
		const check = await this.workspaceService.checkWorkspace(this.workspacePath); // ❌ 错误的方法
		// ...
	}
}
```

**问题**：
1. 重复创建服务实例，而不是复用 plugin 的实例
2. 使用了不存在的 API：`checkWorkspace()` 方法不存在
3. `workspacePath` 应该使用 `plugin.absWorkspacePath`

## 解决方案

### 参考 main.ts 的正确用法

在 `main.ts` 中（第 504-549 行）：

```typescript
private async initializeWorkspace(): Promise<void> {
	// 1. 创建服务（在 plugin 级别）
	this.workspaceService = createObsidianWorkspaceService();
	
	// 2. 使用 workspaceExists 检查
	const existsResult = await this.workspaceService.workspaceExists(this.absWorkspacePath);
	
	if (existsResult.success && !existsResult.data) {
		// 3. 使用 initWorkspace 初始化
		const initResult = await this.workspaceService.initWorkspace(this.absWorkspacePath);
		
		if (!initResult.success) {
			console.error('[Friday] Failed to initialize workspace:', initResult.error);
		}
	}
	
	// 4. 创建其他服务
	this.foundryProjectService = createObsidianProjectService();
	this.foundryBuildService = createObsidianBuildService();
	this.foundryGlobalConfigService = createObsidianGlobalConfigService();
	// ...
}
```

### 修改 ChatRuntime.ts

#### 1. 移除自己创建的服务实例

**修改前**:
```typescript
export class FridayWikiRuntime implements ChatRuntime {
	private wikiService: WikiService;
	private globalConfigService = createObsidianGlobalConfigService();
	private workspaceService = createObsidianWorkspaceService();
	private currentFolderPath: string | null = null;
	private workspacePath: string;
	
	constructor(private plugin: FridayPlugin) {
		this.workspacePath = plugin.app.vault.adapter.getBasePath();
		this.wikiService = new WikiService(plugin);
	}
}
```

**修改后**:
```typescript
export class FridayWikiRuntime implements ChatRuntime {
	readonly providerId = 'friday-wiki';
	
	private wikiService: WikiService;
	private currentFolderPath: string | null = null;
	
	constructor(private plugin: FridayPlugin) {
		this.wikiService = new WikiService(plugin);
	}
}
```

#### 2. 复用 plugin 的 workspaceService

**修改前**:
```typescript
private async ensureWorkspaceInitialized(): Promise<void> {
	const check = await this.workspaceService.checkWorkspace(this.workspacePath); // ❌ 不存在的方法
	if (!check.success || !check.data) {
		await this.workspaceService.initWorkspace(this.workspacePath, {
			name: 'Friday Wiki Workspace',
		});
	}
}
```

**修改后**:
```typescript
private async ensureWorkspaceInitialized(): Promise<void> {
	// 直接使用 plugin 的 workspaceService
	if (!this.plugin.workspaceService) {
		throw new Error('Workspace service not initialized');
	}
	
	const existsResult = await this.plugin.workspaceService.workspaceExists(this.plugin.absWorkspacePath);
	
	if (existsResult.success && !existsResult.data) {
		// Workspace doesn't exist, initialize it
		const initResult = await this.plugin.workspaceService.initWorkspace(this.plugin.absWorkspacePath);
		
		if (!initResult.success) {
			throw new Error(`Failed to initialize workspace: ${initResult.error}`);
		}
	} else if (!existsResult.success) {
		throw new Error(`Failed to check workspace existence: ${existsResult.error}`);
	}
}
```

#### 3. 复用 plugin 的 foundryGlobalConfigService

**修改前**:
```typescript
private async configureLLM(): Promise<void> {
	await this.globalConfigService.set(this.workspacePath, 'llm', {
		type: 'lmstudio',
		// ...
	});
}
```

**修改后**:
```typescript
private async configureLLM(): Promise<void> {
	// 直接使用 plugin 的 foundryGlobalConfigService
	if (!this.plugin.foundryGlobalConfigService) {
		throw new Error('Global config service not initialized');
	}
	
	await this.plugin.foundryGlobalConfigService.set(this.plugin.absWorkspacePath, 'llm', {
		type: 'lmstudio',
		baseUrl: process.env.LLM_BASE_URL || 'http://localhost:1234',
		model: process.env.LLM_MODEL || 'qwen2.5-coder:14b',
		maxTokens: 32768,
		contextLength: 262144,
	});
	
	await this.plugin.foundryGlobalConfigService.set(
		this.plugin.absWorkspacePath,
		'wiki.outputLanguage',
		'Chinese'
	);
}
```

#### 4. 移除不需要的导入

**修改前**:
```typescript
import {
	createObsidianGlobalConfigService,
	createObsidianWorkspaceService,
} from '@mdfriday/foundry';
```

**修改后**:
```typescript
// 不再需要导入，直接使用 plugin 的服务
```

## 关键要点

### 1. Service 管理模式

✅ **正确**: 在 Plugin 级别创建和管理 Foundry services
```typescript
class FridayPlugin {
	workspaceService: ObsidianWorkspaceService;
	foundryGlobalConfigService: ObsidianGlobalConfigService;
	
	async initializeWorkspace() {
		this.workspaceService = createObsidianWorkspaceService();
		this.foundryGlobalConfigService = createObsidianGlobalConfigService();
	}
}
```

❌ **错误**: 在各个模块中重复创建服务实例
```typescript
class SomeModule {
	private workspaceService = createObsidianWorkspaceService(); // ❌ 不要这样做
}
```

### 2. Workspace Service API

正确的方法：
- ✅ `workspaceExists(path)` - 检查工作空间是否存在
- ✅ `initWorkspace(path, options?)` - 初始化工作空间

不存在的方法：
- ❌ `checkWorkspace(path)` - 这个方法不存在

### 3. 路径使用

- ✅ 使用 `plugin.absWorkspacePath` - 绝对路径
- ❌ 使用 `plugin.app.vault.adapter.getBasePath()` - 这是 vault 根目录，不是 workspace 路径

## 测试验证

现在应该可以正常使用：

1. 打开 Obsidian Friday Plugin
2. 点击 "🤖 AI" 按钮打开 Chat View
3. 输入 `/wiki @FolderName`
4. 应该能看到：
   ```
   🚀 Starting wiki ingest for `FolderName`...
   ⚙️  Initializing workspace...
   🔧 Configuring LLM (LM Studio)...
   📚 Getting wiki project...
   📁 Project: FolderName-wiki
   📥 Ingesting files...
   ✅ Ingest completed!
   ```

## 总结

**修改文件**: `src/chat/ChatRuntime.ts`

**核心改动**:
1. 移除自己创建的 service 实例
2. 复用 `this.plugin.workspaceService`
3. 复用 `this.plugin.foundryGlobalConfigService`
4. 使用 `this.plugin.absWorkspacePath`
5. 使用正确的 API：`workspaceExists()` 和 `initWorkspace()`

**设计原则**:
- Foundry services 在 Plugin 级别统一管理
- 其他模块通过 plugin 引用访问这些服务
- 保持单一服务实例，避免重复创建
