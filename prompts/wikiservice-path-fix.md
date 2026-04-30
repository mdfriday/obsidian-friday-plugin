# WikiService 路径修复

## 问题描述

输入 `/wiki @How` 时出现错误：

```
❌ **Error**: Ingest failed: ENOENT: no such file or directory, 
open '/Users/weisun/github/mdfriday/sunwei/.mdfriday/workspace.json'
```

**错误路径**: `/Users/weisun/github/mdfriday/sunwei/.mdfriday/workspace.json`
**正确路径**: `/Users/weisun/github/mdfriday/sunwei/.obsidian/plugins/mdfriday/workspace/workspace.json`

## 根本原因

`WikiService` 使用了错误的 workspace 路径。

### 错误代码

**文件**: `src/services/wiki/WikiService.ts` (第 15 行)

```typescript
constructor(private plugin: FridayPlugin) {
	this.workspacePath = plugin.app.vault.adapter.getBasePath(); // ❌ 错误
}
```

**问题**:
- `plugin.app.vault.adapter.getBasePath()` 返回的是 **vault 根目录**
- 例如：`/Users/weisun/github/mdfriday/sunwei`
- Foundry 会在这个路径下查找 `.mdfriday/workspace.json`
- 但实际上 workspace 在 `.obsidian/plugins/mdfriday/workspace/` 下

## 正确路径结构

### Vault 结构
```
/Users/weisun/github/mdfriday/sunwei/           # ← vault 根目录 (getBasePath())
├── .obsidian/
│   └── plugins/
│       └── mdfriday/                            # ← plugin 目录
│           └── workspace/                       # ← Friday workspace
│               ├── workspace.json               # ← Foundry workspace 配置
│               └── projects/                    # ← Foundry projects
│                   └── How-wiki/                # ← Wiki project
│                       └── ...
└── How/                                         # ← 用户的文件夹
    └── ...
```

### 正确路径

- **vault 根目录**: `plugin.app.vault.adapter.getBasePath()`
  - 例如: `/Users/weisun/github/mdfriday/sunwei`
  
- **plugin 目录**: `plugin.pluginDir`
  - 例如: `.obsidian/plugins/mdfriday`
  
- **workspace 绝对路径**: `plugin.absWorkspacePath`
  - 例如: `/Users/weisun/github/mdfriday/sunwei/.obsidian/plugins/mdfriday/workspace`

## 解决方案

### 修改 WikiService.ts

```typescript
export class WikiService {
	private wikiService = createObsidianWikiService();
	private workspacePath: string;
	
	constructor(private plugin: FridayPlugin) {
		// ✅ 使用 plugin.absWorkspacePath
		this.workspacePath = plugin.absWorkspacePath;
	}
	
	async ingest(projectName: string): Promise<IngestResult> {
		const result = await this.wikiService.ingest({
			workspacePath: this.workspacePath, // 现在是正确的路径
			projectName,
			temperature: 0.3,
		});
		// ...
	}
}
```

## 参考：main.ts 中的正确用法

在 `main.ts` 中，所有 Foundry services 都使用 `this.absWorkspacePath`：

### 初始化 Workspace (第 504-543 行)

```typescript
private async initializeWorkspace(): Promise<void> {
	// 1. 创建 workspace service
	this.workspaceService = createObsidianWorkspaceService();
	
	// 2. 使用 absWorkspacePath 检查和初始化
	const existsResult = await this.workspaceService.workspaceExists(this.absWorkspacePath);
	
	if (existsResult.success && !existsResult.data) {
		const initResult = await this.workspaceService.initWorkspace(this.absWorkspacePath);
		// ...
	}
	
	// 3. 创建其他服务
	this.foundryProjectService = createObsidianProjectService();
	this.foundryGlobalConfigService = createObsidianGlobalConfigService();
	// ...
}
```

### ProjectServiceManager 创建项目 (project.ts 第 40-42 行)

```typescript
const createOptions: any = {
	name,
	workspacePath: this.plugin.absWorkspacePath, // ✅ 使用 absWorkspacePath
};
```

### LicenseServiceManager (license.ts)

```typescript
constructor(
	licenseService: ObsidianLicenseService,
	authService: ObsidianAuthService,
	configService: ObsidianGlobalConfigService,
	workspacePath: string  // ← 传入的是 plugin.absWorkspacePath
) {
	this.workspacePath = workspacePath;
}
```

## 一致性原则

### ✅ 所有 Foundry Service 调用都应该使用 `plugin.absWorkspacePath`

**正确示例**：

```typescript
// 1. WorkspaceService
await this.plugin.workspaceService.workspaceExists(this.plugin.absWorkspacePath);
await this.plugin.workspaceService.initWorkspace(this.plugin.absWorkspacePath);

// 2. ProjectService
await this.plugin.foundryProjectService.createProject({
	name: projectName,
	workspacePath: this.plugin.absWorkspacePath,
	sourceFolder: '/path/to/folder'
});

// 3. ConfigService
await this.plugin.foundryGlobalConfigService.set(
	this.plugin.absWorkspacePath,
	'llm',
	{ /* config */ }
);

// 4. WikiService (修复后)
await wikiService.ingest({
	workspacePath: this.plugin.absWorkspacePath, // ← 内部已使用正确路径
	projectName: 'How-wiki'
});
```

### ❌ 错误示例

```typescript
// ❌ 不要使用 vault 根目录
const vaultRoot = plugin.app.vault.adapter.getBasePath();
await wikiService.ingest({
	workspacePath: vaultRoot, // 错误！
	projectName: 'How-wiki'
});

// ❌ 不要手动拼接路径
const wrongPath = joinPath(vaultRoot, '.mdfriday');
await wikiService.ingest({
	workspacePath: wrongPath, // 错误！
	projectName: 'How-wiki'
});
```

## absWorkspacePath 的初始化

在 `main.ts` 第 204-209 行：

```typescript
if (Platform.isDesktop) {
	const adapter = this.app.vault.adapter;
	if (adapter instanceof FileSystemAdapter) {
		const basePath = adapter.getBasePath();
		this.vaultBasePath = basePath;
		this.absWorkspacePath = joinPath(basePath, this.pluginDir, 'workspace');
	}
	// ...
}
```

**计算公式**:
```
absWorkspacePath = vaultBasePath + pluginDir + 'workspace'
                 = vaultBasePath + '.obsidian/plugins/mdfriday' + 'workspace'
```

**实际值**:
```
/Users/weisun/github/mdfriday/sunwei/.obsidian/plugins/mdfriday/workspace
```

## 测试验证

修复后，执行 `/wiki @How` 应该：

1. ✅ 正确找到 workspace: `.obsidian/plugins/mdfriday/workspace/workspace.json`
2. ✅ 正确创建项目: `.obsidian/plugins/mdfriday/workspace/projects/How-wiki/`
3. ✅ 正确 ingest 文件
4. ✅ 显示成功信息

预期输出：
```
🚀 Starting wiki ingest for `How`...
⚙️  Initializing workspace...
🔧 Configuring LLM (LM Studio)...
📚 Getting wiki project...
📁 Project: How-wiki
📥 Ingesting files...
✅ Ingest completed!
- Entities: X
- Concepts: Y
- Connections: Z
```

## 总结

**修改文件**: `src/services/wiki/WikiService.ts` (第 15 行)

**核心改动**:
```typescript
// 修改前
this.workspacePath = plugin.app.vault.adapter.getBasePath();

// 修改后
this.workspacePath = plugin.absWorkspacePath;
```

**设计原则**:
- 所有 Foundry service 调用必须使用 `plugin.absWorkspacePath`
- 这是 Friday plugin workspace 的绝对路径
- 不要使用 vault 根目录 (`getBasePath()`)
- 不要手动拼接路径，使用 plugin 提供的正确路径
