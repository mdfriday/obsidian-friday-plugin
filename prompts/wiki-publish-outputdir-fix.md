# /publish 发布 Wiki outputDir 修复

## 🐛 问题描述

用户报告：`/publish` 命令发布的是原始的 content 文件夹，而不是生成的 Wiki 页面（outputDir）。

**错误行为**:
```
🔄 Publishing: /Users/.../workspace/projects/How-wiki/content/llm-wiki-karpathy.md
```

**期望行为**:
```
🔄 Publishing: /Users/.../How wiki/
```

## 🎯 解决方案

### 核心思路

1. ✅ Wiki project 在创建时已配置 `outputDir`
2. ✅ 通过 `projectName` 可以获取 `outputDir` 配置
3. ✅ `/publish` 应该发布 `outputDir`（生成的 Wiki 页面）
4. ✅ 为 `outputDir` 创建一个独立的 **site project**

### 实现流程

```
用户输入 /wiki @How
  ↓
创建 Wiki project: "How-wiki"
  ├─ sourceFolder: /vault/How/
  └─ outputDir: /vault/How wiki/
  ↓
Ingest 并生成 Wiki 页面
  ↓
用户输入 /publish
  ↓
1. 获取 Wiki project config
2. 读取 outputDir 配置
3. 创建 site project: "How-wiki-site"
4. 发布 outputDir
```

## 📝 代码修改

### 文件: `src/main.ts`

#### 1. 修改 `publishFolder()` 方法

**修改前**:
```typescript
async publishFolder(folderPath: string): Promise<{...}> {
  // ❌ 直接发布原始 content 文件夹
  const folder = this.app.vault.getAbstractFileByPath(folderPath);
  await this.publishTo(folder, 'mdf-free');
  
  const projectName = `${folderPath}-wiki`;
  const url = `https://mdfriday.com/f/${previewId}`;
  return { success: true, url };
}
```

**修改后**:
```typescript
async publishFolder(folderPath: string): Promise<{...}> {
  // 1. 获取 Wiki 项目名
  const projectName = `${folderPath}-wiki`;
  
  // 2. ✅ 获取项目的 outputDir 配置
  const configResult = await this.foundryProjectConfigService.get(
    this.absWorkspacePath,
    projectName,
    'outputDir'
  );
  
  if (!configResult.success || !configResult.data?.value) {
    throw new Error(`Wiki project ${projectName} does not have outputDir configured`);
  }
  
  const outputDirPath = configResult.data.value as string;
  
  // 3. 将绝对路径转换为相对于 vault 的路径
  const basePath = this.vaultBasePath;
  const relativePath = outputDirPath.startsWith(basePath)
    ? outputDirPath.slice(basePath.length + 1)
    : outputDirPath;
  
  // 4. ✅ 获取 outputDir 文件夹对象
  const outputFolder = this.app.vault.getAbstractFileByPath(relativePath);
  if (!(outputFolder instanceof TFolder)) {
    throw new Error(`Wiki output folder not found: ${relativePath}`);
  }
  
  // 5. ✅ 为 outputDir 创建一个 site 项目
  const siteProjectName = `${folderPath}-wiki-site`;
  await this.getOrCreateSiteProjectForOutputDir(siteProjectName, outputDirPath);
  
  // 6. ✅ 发布 outputDir（生成的 Wiki 页面）
  await this.publishTo(outputFolder, 'mdf-free');
  
  // 7. 构建 URL
  const previewId = await nameToIdAsync(siteProjectName);
  const url = `https://mdfriday.com/f/${previewId}`;
  
  return { success: true, url };
}
```

#### 2. 新增 `getOrCreateSiteProjectForOutputDir()` 方法

```typescript
/**
 * 为 Wiki outputDir 创建或获取 site 项目
 */
private async getOrCreateSiteProjectForOutputDir(
  projectName: string,
  outputDirPath: string
): Promise<string> {
  // 检查项目是否已存在
  const existingProject = await this.getFoundryProject(projectName);
  
  if (existingProject) {
    return projectName;
  }
  
  // 创建新的 site 项目
  const createOptions: any = {
    name: projectName,
    workspacePath: this.absWorkspacePath,
    sourceFolder: outputDirPath,
    type: 'site', // ✅ site 类型项目，用于发布
  };
  
  const result = await this.foundryProjectService.createProject(createOptions);
  
  if (!result.success) {
    throw new Error(`Failed to create site project: ${result.error}`);
  }
  
  return projectName;
}
```

## 🔍 项目结构

### Wiki Project vs Site Project

#### 1. Wiki Project (`How-wiki`)
- **类型**: `wiki`
- **用途**: Ingest 和生成 Wiki 页面
- **sourceFolder**: `/vault/How/` (原始 markdown 文件)
- **outputDir**: `/vault/How wiki/` (生成的 Wiki 页面)
- **包含**:
  - KB (`kb.json`)
  - 生成的页面 (`entities/`, `concepts/`, `sources/`)

#### 2. Site Project (`How-wiki-site`)
- **类型**: `site`
- **用途**: 发布 Wiki 到 MDFriday
- **sourceFolder**: `/vault/How wiki/` (Wiki 的 outputDir)
- **发布内容**:
  - 所有生成的 Wiki 页面
  - `index.md`
  - `GLOSSARY.md`
  - `log.md`

## 📊 完整流程示例

### 用户操作流程

```
1. /wiki @How
   ├─ 创建 Wiki project: "How-wiki"
   │  ├─ sourceFolder: /vault/How/
   │  └─ outputDir: /vault/How wiki/
   ├─ Ingest: How/llm-wiki-karpathy.md
   ├─ 生成 Wiki 页面到 How wiki/
   │  ├─ entities/
   │  ├─ concepts/
   │  ├─ sources/
   │  ├─ index.md
   │  └─ GLOSSARY.md
   └─ 保存 KB: How wiki/kb.json

2. What is LLM?
   └─ 查询 How-wiki 项目的 KB

3. /save Neural Networks
   ├─ 保存对话到 How wiki/conversations/
   └─ 自动 ingest 对话内容

4. /publish
   ├─ 读取 How-wiki 的 outputDir 配置
   ├─ outputDir = /vault/How wiki/
   ├─ 创建 site project: "How-wiki-site"
   │  ├─ type: site
   │  └─ sourceFolder: /vault/How wiki/
   └─ 发布 How wiki/ 到 MDFriday
      └─ URL: https://mdfriday.com/f/<preview-id>
```

## 📁 文件系统结构

```
vault/
├── How/                          # 原始源文件
│   └── llm-wiki-karpathy.md
│
└── How wiki/                     # Wiki 输出目录（发布这个！）
    ├── kb.json
    ├── entities/                 # ✅ 发布
    │   ├── llm.md
    │   ├── neural-network.md
    │   └── ...
    ├── concepts/                 # ✅ 发布
    │   ├── backpropagation.md
    │   └── ...
    ├── sources/                  # ✅ 发布
    │   └── llm-wiki-karpathy.md
    ├── conversations/            # ✅ 发布
    │   └── 2026-04-30-neural-networks.md
    ├── index.md                  # ✅ 发布
    ├── GLOSSARY.md               # ✅ 发布
    └── log.md                    # ✅ 发布

.obsidian/plugins/mdfriday/workspace/
└── projects/
    ├── How-wiki/                 # Wiki project
    │   ├── config.json           # outputDir: "/vault/How wiki/"
    │   └── content/              # 内部副本（不发布）
    │       └── llm-wiki-karpathy.md
    │
    └── How-wiki-site/            # Site project（用于发布）
        └── config.json           # sourceFolder: "/vault/How wiki/"
```

## 🎯 关键改进

### 1. 发布正确的内容
- ❌ 之前：发布 `How/` (原始 markdown)
- ✅ 现在：发布 `How wiki/` (生成的 Wiki 页面)

### 2. 项目分离
- ✅ Wiki project (`How-wiki`): 用于 ingest 和生成
- ✅ Site project (`How-wiki-site`): 用于发布

### 3. 配置驱动
- ✅ 通过 `projectConfigService.get('outputDir')` 获取配置
- ✅ 不依赖硬编码路径

### 4. 完整的 Wiki 站点
发布的内容包括：
- ✅ Entities 页面（wikilinks）
- ✅ Concepts 页面（wikilinks）
- ✅ Sources 页面
- ✅ Index 页面
- ✅ Glossary 页面
- ✅ Conversations 页面
- ✅ Operation log

## 🚀 测试步骤

### 1. 重新加载 Obsidian
```
Ctrl/Cmd + P → "Reload app"
```

### 2. 完整测试流程
```
1. /wiki @How
   - 等待 ingest 完成
   - 检查 How wiki/ 目录是否生成

2. What is LLM?
   - 验证查询功能

3. /save LLM Basics
   - 验证对话保存

4. /publish
   - 验证发布的是 How wiki/ 目录
   - 获取发布 URL
```

### 3. 验证发布内容

打开 MDFriday URL，应该看到：
- ✅ Index 页面（统计信息）
- ✅ Glossary 页面（所有实体和概念）
- ✅ Entity 页面（可点击 wikilinks）
- ✅ Concept 页面（可点击 wikilinks）
- ✅ Sources 页面
- ✅ Conversations 页面

### 4. 检查控制台日志

**预期日志**:
```
📤 Publishing to MDFriday...
✅ Using Wiki project: How-wiki
✅ Output directory: /vault/How wiki/
✅ Creating site project: How-wiki-site
✅ Publishing: How wiki/
✅ Published successfully!
🔗 https://mdfriday.com/f/...
```

## 💡 设计优势

### 1. 清晰的职责分离
- Wiki project: 知识提取和生成
- Site project: 内容发布

### 2. 可重复发布
- 每次 `/publish` 都会更新 site project
- 可以多次 ingest → publish 迭代

### 3. 正确的内容
- 发布的是生成的 Wiki 页面，而不是原始文件
- 用户在 MDFriday 上看到的是完整的 Wiki 站点

### 4. 保持现有逻辑
- ✅ 复用现有的 `publishTo()` 方法
- ✅ 复用现有的 project 管理
- ✅ 最小化代码修改

## 🎉 总结

### 修复的问题
- ✅ `/publish` 现在发布 outputDir（生成的 Wiki 页面）
- ✅ 创建独立的 site project 用于发布
- ✅ 通过 project config 动态获取 outputDir

### 用户体验改进
- ✅ 发布的是完整的 Wiki 站点
- ✅ 包含所有生成的页面和 wikilinks
- ✅ 在 MDFriday 上可以正常导航

### 架构改进
- ✅ Wiki project 和 Site project 分离
- ✅ 配置驱动，而不是硬编码路径
- ✅ 可扩展和维护

现在可以重新加载 Obsidian 并测试 `/publish` 命令了！🚀
