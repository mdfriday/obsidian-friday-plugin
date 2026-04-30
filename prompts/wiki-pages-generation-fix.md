# Wiki Pages 生成问题修复

## 问题描述

用户报告：
```
显示成功， 也分析出了 entity concept, connection 等等。
但没看到任何 WIKI 文件写入到 outputDir.
outputDir: "/Users/weisun/github/mdfriday/sunwei/How wiki"
文件夹是已经创建了，但里面是空的。
```

## 问题原因

查看代码发现：
1. ✅ **Ingest 成功** - 提取了 entities, concepts, connections
2. ✅ **KB 保存成功** - `kb.json` 已保存
3. ❌ **缺少 generatePages 调用** - 没有生成 Wiki 页面文件

### Foundry 的完整流程

根据 `obsidian-wiki-interface.integration.test.ts` 和 Foundry 源码：

```
1. initWorkspace()         - 初始化工作空间
2. createProject()          - 创建 Wiki 项目
3. set outputDir            - 配置输出目录
4. ingest()                 - 提取知识到 KB
5. generateAllPages()       - ⚠️ 生成 Wiki 页面（我们缺少这步！）
6. queryStream()            - 查询 Wiki
7. saveConversation()       - 保存对话
```

### 测试中的验证

`obsidian-wiki-interface.integration.test.ts` (第 220-224 行):
```typescript
// 验证 KB 文件
const kbPath = path.join(wikiOutputDir, 'kb.json');
const kbExists = await fs.access(kbPath).then(() => true).catch(() => false);
expect(kbExists).toBe(true);
console.log(`✅ KB file exists: ${kbPath}\n`);
```

**注意**: 测试中**只验证了 kb.json**，**没有验证 Wiki 页面文件**！

## Foundry generateWikiPages 详情

### KnowledgeBase.generateWikiPages()

`foundry/internal/domain/wiki/entity/knowledge-base.ts` (第 877-927 行):

```typescript
async generateWikiPages(dependencies: {
  wikiPageRepo: IWikiPageRepository;
  pathService: IPathService;
}): Promise<void> {
  const pages = new Map<string, string>();

  // 1. 生成 Entity 页面
  for (const entity of this._entities.values()) {
    const content = this.renderEntityPage(entity, annotator);
    const filename = this.sanitizeFilename(entity.name);
    pages.set(`entities/${filename}.md`, content);
  }

  // 2. 生成 Concept 页面
  for (const concept of this._concepts.values()) {
    const content = this.renderConceptPage(concept, annotator);
    const filename = this.sanitizeFilename(concept.name);
    pages.set(`concepts/${filename}.md`, content);
  }

  // 3. 生成 Source 页面
  for (const source of this._sources.values()) {
    const content = await this.renderSourcePage(source, annotator, dependencies.pathService);
    const filename = this.getSourceFilename(source.path, dependencies.pathService);
    pages.set(`sources/${filename}`, content);
  }

  // 4. 生成 Index
  pages.set('index.md', this.generateIndex());

  // 5. 生成 Glossary
  pages.set('GLOSSARY.md', this.generateGlossary());

  // 6. 生成 Log
  if (this._operationLog.count > 0) {
    pages.set('log.md', this._operationLog.toMarkdown());
  }

  // 7. 写入所有页面
  await dependencies.wikiPageRepo.writePages(pages);
}
```

### WikiService.generateAllPages()

`foundry/internal/application/wiki-service.ts` (第 335-344 行):

```typescript
async generateAllPages(): Promise<void> {
  if (!this.kb) {
    throw new Error('KB not loaded. Call loadKB() first.');
  }

  await this.kb.generateWikiPages({
    wikiPageRepo: this.factory.getWikiPageRepository(),
    pathService: this.pathService
  });
}
```

## 修复方案

### 修改 WikiService.ts

**文件**: `src/services/wiki/WikiService.ts`

**修改前**:
```typescript
async ingest(projectName: string): Promise<IngestResult> {
  const result = await this.wikiService.ingest({
    workspacePath: this.workspacePath,
    projectName,
    temperature: 0.3,
  });
  
  if (!result.success || !result.data) {
    throw new Error(`Ingest failed: ${result.error}`);
  }
  
  return {
    success: true,
    extractedEntities: result.data.extractedEntities || 0,
    extractedConcepts: result.data.extractedConcepts || 0,
    extractedConnections: result.data.extractedConnections || 0,
  };
}
```

**修改后**:
```typescript
async ingest(projectName: string): Promise<IngestResult> {
  const result = await this.wikiService.ingest({
    workspacePath: this.workspacePath,
    projectName,
    temperature: 0.3,
  });
  
  if (!result.success || !result.data) {
    throw new Error(`Ingest failed: ${result.error}`);
  }
  
  // ✅ Ingest 完成后，生成所有 Wiki 页面
  await this.generatePages(projectName);
  
  return {
    success: true,
    extractedEntities: result.data.extractedEntities || 0,
    extractedConcepts: result.data.extractedConcepts || 0,
    extractedConnections: result.data.extractedConnections || 0,
  };
}

/**
 * 生成所有 Wiki 页面（entities, concepts, sources, index, glossary, log）
 */
async generatePages(projectName: string): Promise<void> {
  await this.wikiService.generateAllPages({
    workspacePath: this.workspacePath,
    projectName,
  });
}
```

## 预期结果

现在 `/wiki @How` 完成后，在 `outputDir` 中应该看到：

```
How wiki/
├── kb.json                      # ✅ 已有（之前就能保存）
├── entities/                    # ✅ 新生成
│   ├── llm.md
│   ├── neural-network.md
│   └── ...
├── concepts/                    # ✅ 新生成
│   ├── backpropagation.md
│   ├── gradient-descent.md
│   └── ...
├── sources/                     # ✅ 新生成
│   └── llm-wiki-karpathy.md
├── index.md                     # ✅ 新生成
├── GLOSSARY.md                  # ✅ 新生成
├── log.md                       # ✅ 新生成
└── conversations/               # 保存对话时创建
    └── 2026-04-30-xxx.md
```

## Wiki 页面格式示例

### Entity 页面 (`entities/llm.md`)

```markdown
---
title: LLM
type: entity
category: technology
---

# LLM

**Type**: technology

**Aliases**: Large Language Model, Transformer Model

## Facts

- LLM stands for Large Language Model
- Uses [[Transformer]] architecture
- Trained on massive text corpora
- Can generate human-like text

## Connections

- [[LLM]] uses [[Backpropagation]]: Training method
- [[LLM]] implements [[Neural Network]]: Core architecture

## Sources

- [[llm-wiki-karpathy]]
```

### Concept 页面 (`concepts/backpropagation.md`)

```markdown
---
title: Backpropagation
type: concept
---

# Backpropagation

**Aliases**: Backward Pass, BP

## Definition

Backpropagation is an algorithm for efficiently computing gradients in neural networks by applying the chain rule backwards through the computational graph.

## Related Concepts

- [[Gradient Descent]]
- [[Neural Network]]
- [[Chain Rule]]

## Sources

- [[llm-wiki-karpathy]]
```

### Index 页面 (`index.md`)

```markdown
---
title: Knowledge Base Index
---

# Knowledge Base

**Last Updated**: 2026-04-30T08:00:00.000Z

## Statistics

- **Entities**: 15
- **Concepts**: 8
- **Connections**: 7
- **Sources**: 1

## Quick Links

- [[GLOSSARY]]
- [[log]]
```

### Glossary 页面 (`GLOSSARY.md`)

```markdown
---
title: Glossary
---

# Glossary

## Entities

- [[Attention Mechanism]] - algorithm
- [[GPT]] - technology
- [[LLM]] - technology
- [[Neural Network]] - algorithm
- [[Transformer]] - technology

## Concepts

- [[Backpropagation]]
- [[Chain Rule]]
- [[Gradient Descent]]
- [[Self-Attention]]
```

## 测试步骤

1. **重新加载 Obsidian 插件**
   ```
   Ctrl/Cmd + P → "Reload app"
   ```

2. **删除旧的 outputDir（可选）**
   ```bash
   rm -rf "/Users/weisun/github/mdfriday/sunwei/How wiki"
   ```

3. **重新运行 Ingest**
   ```
   1. 点击 🤖 AI 按钮
   2. 输入 /wiki @How
   3. 等待 ingest 完成
   ```

4. **验证文件生成**
   ```bash
   ls -la "/Users/weisun/github/mdfriday/sunwei/How wiki/"
   ls -la "/Users/weisun/github/mdfriday/sunwei/How wiki/entities/"
   ls -la "/Users/weisun/github/mdfriday/sunwei/How wiki/concepts/"
   ls -la "/Users/weisun/github/mdfriday/sunwei/How wiki/sources/"
   ```

5. **查看生成的页面**
   - 打开 `How wiki/index.md`
   - 打开 `How wiki/GLOSSARY.md`
   - 打开任意 `How wiki/entities/*.md`
   - 打开任意 `How wiki/concepts/*.md`

## 总结

### 问题
- ✅ Ingest 成功，KB 保存成功
- ❌ 没有生成 Wiki 页面文件

### 原因
- 缺少 `generateAllPages()` 调用

### 修复
- 在 `WikiService.ingest()` 完成后调用 `generatePages()`

### 效果
- 生成完整的 Wiki 站点结构
- 包含 entities, concepts, sources, index, glossary, log
- 支持 Obsidian wikilinks `[[Entity]]` 格式
- 可以直接在 Obsidian 中浏览和编辑

现在用户可以：
1. ✅ Ingest 文件夹生成知识库
2. ✅ 查看生成的 Wiki 页面
3. ✅ 使用 Obsidian Graph View 可视化知识图谱
4. ✅ 通过 wikilinks 在不同页面间导航
5. ✅ 发布到 MDFriday（使用现有的 publish 功能）
