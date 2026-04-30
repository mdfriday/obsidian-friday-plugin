# Wiki Project outputDir 配置修复

## 问题描述

输入 `/wiki @What` 时出现错误：

```
❌ **Error**: Ingest failed: Project What-wiki does not have 'outputDir' configured
```

## 根本原因

创建 Wiki 项目后，没有配置 `outputDir` 字段。Foundry Wiki Service 的 `ingest` 操作需要 `outputDir` 来存储生成的知识库文件（如 `kb.json`）。

## 正确流程（参考集成测试）

从 `obsidian-wiki-interface.integration.test.ts` 中可以看到完整的调用顺序：

### Step 1: Initialize Workspace
```typescript
const initResult = await workspaceService.initWorkspace(tempWorkspacePath, {
  name: 'Wiki Test Workspace',
});
```

### Step 2: Configure Global LLM Config
```typescript
await globalConfigService.set(tempWorkspacePath, 'llm', {
  type: 'lmstudio',
  model: 'qwen2.5-coder:14b',
  baseUrl: 'http://localhost:1234',
  maxTokens: 32768,
  contextLength: 262144,
});
```

### Step 3: Create Wiki Project
```typescript
const createProjectResult = await projectService.createProject({
  name: wikiProjectName,
  workspacePath: tempWorkspacePath,
  sourceFolder: tempSourcePath,
  type: 'wiki', // ← 重要：指定项目类型为 'wiki'
});
```

### Step 4: Configure Project Config (关键！)
```typescript
// outputDir 与源文件夹同级，添加 ' wiki' 后缀
const wikiOutputDir = path.join(tempWorkspacePath, 'ddd-notes wiki');

const setConfigResult = await projectConfigService.set(
  tempWorkspacePath,
  wikiProjectName,
  'outputDir',
  wikiOutputDir
);
```

### Step 5: Ingest Source Files
```typescript
const ingestResult = await wikiService.ingest({
  workspacePath: tempWorkspacePath,
  projectName: wikiProjectName,
  temperature: 0.3,
});
```

## outputDir 路径规则

**源文件夹**: `What`
**输出目录**: `What wiki` (与源文件夹同级)

### 示例路径结构

```
/Users/weisun/github/mdfriday/sunwei/           # vault 根目录
├── What/                                        # 源文件夹
│   ├── file1.md
│   └── file2.md
└── What wiki/                                   # 输出目录（与 What 同级）
    ├── kb.json                                  # 知识库文件
    └── ... (其他生成的文件)
```

### 完整路径

- **源文件夹绝对路径**: `/Users/weisun/github/mdfriday/sunwei/What`
- **输出目录绝对路径**: `/Users/weisun/github/mdfriday/sunwei/What wiki`

## 解决方案

### 修改 `main.ts` 中的 `getOrCreateProjectForFolder` 方法

**文件**: `src/main.ts` (第 2458-2510 行)

```typescript
async getOrCreateProjectForFolder(folderPath: string): Promise<string> {
	// 生成项目名（folder name + -wiki 后缀）
	const projectName = `${folderPath}-wiki`;
	
	// 检查项目是否已存在
	const existingProject = await this.getFoundryProject(projectName);
	
	if (existingProject) {
		return projectName;
	}
	
	// 项目不存在，创建新的 wiki 项目
	const folder = this.app.vault.getAbstractFileByPath(folderPath);
	if (!(folder instanceof TFolder)) {
		throw new Error(`Folder not found: ${folderPath}`);
	}
	
	// 创建项目（type: 'wiki' 很重要）
	const basePath = this.vaultBasePath;
	if (!basePath) {
		throw new Error('Vault base path not available');
	}
	
	const createOptions: any = {
		name: projectName,
		workspacePath: this.absWorkspacePath,
		sourceFolder: joinPath(basePath, folder.path),
		type: 'wiki', // ← 指定为 wiki 类型项目
	};
	
	const result = await this.foundryProjectService.createProject(createOptions);
	
	if (!result.success) {
		throw new Error(`Failed to create project: ${result.error}`);
	}
	
	// ✅ 配置 outputDir（与源文件夹同级，添加 ' wiki' 后缀）
	// 例如：源文件夹 'What' -> outputDir 'What wiki'
	const outputDirName = `${folderPath} wiki`;
	const outputDirPath = joinPath(basePath, outputDirName);
	
	const configResult = await this.foundryProjectConfigService.set(
		this.absWorkspacePath,
		projectName,
		'outputDir',
		outputDirPath
	);
	
	if (!configResult.success) {
		console.error(`[Friday] Failed to set outputDir for ${projectName}:`, configResult.error);
		throw new Error(`Failed to configure outputDir: ${configResult.error}`);
	}
	
	return projectName;
}
```

## 关键改动

### 1. 直接调用 Foundry ProjectService

**修改前**（使用 `createFoundryProject` 包装方法）:
```typescript
const created = await this.createFoundryProject(projectName, folder, null);
if (!created) {
	throw new Error(`Failed to create project: ${projectName}`);
}
```

**修改后**（直接调用，指定 type）:
```typescript
const createOptions: any = {
	name: projectName,
	workspacePath: this.absWorkspacePath,
	sourceFolder: joinPath(basePath, folder.path),
	type: 'wiki', // ← 关键：指定项目类型
};

const result = await this.foundryProjectService.createProject(createOptions);

if (!result.success) {
	throw new Error(`Failed to create project: ${result.error}`);
}
```

### 2. 配置 outputDir

**新增代码**:
```typescript
// 配置 outputDir（与源文件夹同级，添加 ' wiki' 后缀）
const outputDirName = `${folderPath} wiki`;
const outputDirPath = joinPath(basePath, outputDirName);

const configResult = await this.foundryProjectConfigService.set(
	this.absWorkspacePath,
	projectName,
	'outputDir',
	outputDirPath
);

if (!configResult.success) {
	console.error(`[Friday] Failed to set outputDir for ${projectName}:`, configResult.error);
	throw new Error(`Failed to configure outputDir: ${configResult.error}`);
}
```

## 参考：ProjectServiceManager 设置配置

在 `src/services/project.ts` (第 183-206 行) 中，可以看到如何使用 `projectConfigService.set`：

```typescript
/**
 * 保存单个配置项
 */
async saveConfig(
	projectName: string,
	key: string,
	value: any
): Promise<boolean> {
	try {
		const result = await this.plugin.foundryProjectConfigService.set(
			this.plugin.absWorkspacePath,
			projectName,
			key,
			value
		);

		if (!result.success) {
			console.error(`[ProjectServiceManager] Failed to save config ${key}:`, result.error);
		}

		return result.success;
	} catch (error) {
		console.error('[ProjectServiceManager] Error saving config:', error);
		return false;
	}
}
```

## Wiki Project 类型的重要性

创建 Wiki 项目时，必须指定 `type: 'wiki'`：

```typescript
const createOptions = {
	name: projectName,
	workspacePath: this.absWorkspacePath,
	sourceFolder: '/path/to/source',
	type: 'wiki', // ← 这个很重要！
};
```

**原因**：
1. Foundry 会根据 `type` 来识别项目类型
2. Wiki 项目有特定的处理逻辑（如 ingest、query 等）
3. 不同类型的项目有不同的配置要求

## 完整工作流程

### 创建并配置 Wiki 项目

```typescript
// 1. 创建项目（指定 type: 'wiki'）
const result = await this.foundryProjectService.createProject({
	name: 'What-wiki',
	workspacePath: this.absWorkspacePath,
	sourceFolder: '/Users/weisun/github/mdfriday/sunwei/What',
	type: 'wiki',
});

// 2. 配置 outputDir
await this.foundryProjectConfigService.set(
	this.absWorkspacePath,
	'What-wiki',
	'outputDir',
	'/Users/weisun/github/mdfriday/sunwei/What wiki'
);

// 3. Ingest
await wikiService.ingest({
	workspacePath: this.absWorkspacePath,
	projectName: 'What-wiki',
	temperature: 0.3,
});
```

## 测试验证

修复后，执行 `/wiki @What` 应该：

1. ✅ 创建项目：`What-wiki`
2. ✅ 配置 `outputDir`：`/path/to/vault/What wiki`
3. ✅ 成功 ingest
4. ✅ 在 `What wiki/` 目录下生成 `kb.json`

预期输出：
```
🚀 Starting wiki ingest for `What`...
⚙️  Initializing workspace...
🔧 Configuring LLM (LM Studio)...
📚 Getting wiki project...
📁 Project: What-wiki
📥 Ingesting files...
✅ Ingest completed!
- Entities: X
- Concepts: Y
- Connections: Z
- Total Knowledge: X+Y
```

## 路径示例

### 输入
```
/wiki @What
```

### 计算
- **folderPath**: `What`
- **projectName**: `What-wiki`
- **sourceFolder**: `/Users/weisun/github/mdfriday/sunwei/What`
- **outputDirName**: `What wiki`
- **outputDirPath**: `/Users/weisun/github/mdfriday/sunwei/What wiki`

### 结果
```
vault/
├── What/                   # 源文件夹
│   └── *.md
└── What wiki/              # 输出目录（自动创建）
    ├── kb.json             # 知识库
    └── ...
```

## 总结

**修改文件**: `src/main.ts` (第 2458-2510 行)

**核心改动**:
1. ✅ 直接调用 `foundryProjectService.createProject`
2. ✅ 指定 `type: 'wiki'`
3. ✅ 配置 `outputDir`（源文件夹名 + ` wiki` 后缀）
4. ✅ 使用绝对路径（`joinPath(basePath, ...)`）

**关键点**:
- `type: 'wiki'` 必须指定
- `outputDir` 必须配置（在 ingest 之前）
- `outputDir` 与源文件夹同级
- 所有路径使用绝对路径
