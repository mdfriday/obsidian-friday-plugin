# Foundry 修改总结

## 问题描述

在 `obsidian-friday-plugin` 尝试使用 `createObsidianWikiService` 时遇到以下错误：

```
TypeError: (0 , import_foundry2.createObsidianWikiService) is not a function
```

原因：
1. `createObsidianWikiService` 没有在 `foundry/index.ts` 中导出
2. 存在类型不兼容问题：`ReadonlyMap<string, number[]>` vs `EmbeddingIndex`

## 修改内容

### 1. 导出 Wiki Service

**文件**: `/Users/weisun/github/mdfriday/foundry/index.ts`

**修改位置**: 第 89 行

**修改内容**:
```typescript
  createObsidianPublishService,
  // Domain
  createObsidianDomainService,
  // Wiki
  createObsidianWikiService,  // ← 添加这一行
  // Container (高级用法)
  createObsidianWorkspaceAppService,
```

### 2. 修复类型兼容性问题

**文件**: `/Users/weisun/github/mdfriday/foundry/internal/domain/wiki/value-object/retrieval.ts`

#### 2.1 修改 `rankByEmbedding` 方法签名

**原代码**:
```typescript
static rankByEmbedding(
  embeddingIndex: EmbeddingIndex,
  queryEmbedding: number[]
): RankedItem[] {
```

**修改后**:
```typescript
static rankByEmbedding(
  embeddingIndex: ReadonlyMap<string, number[]> | EmbeddingIndex,
  queryEmbedding: readonly number[]
): RankedItem[] {
```

#### 2.2 修改 `rankByEmbedding` 方法实现

**原代码**:
```typescript
const scored: RankedItem[] = [];

for (const key of embeddingIndex.keys()) {
  const vec = embeddingIndex.get(key);
  if (!vec) continue;
  
  const score = this.cosineSimilarity(queryEmbedding, vec);
```

**修改后**:
```typescript
const scored: RankedItem[] = [];

// 支持两种类型的索引：ReadonlyMap 和 EmbeddingIndex
const isMap = embeddingIndex instanceof Map;
const getKeys = isMap 
  ? () => embeddingIndex.keys()
  : () => (embeddingIndex as EmbeddingIndex).keys();

const getVec = isMap
  ? (key: string) => (embeddingIndex as Map<string, number[]>).get(key)
  : (key: string) => (embeddingIndex as EmbeddingIndex).get(key);

for (const key of getKeys()) {
  const vec = getVec(key);
  if (!vec) continue;
  
  const score = this.cosineSimilarity(queryEmbedding, vec);
```

#### 2.3 修改 `cosineSimilarity` 方法签名

**原代码**:
```typescript
static cosineSimilarity(a: number[], b: number[]): number {
```

**修改后**:
```typescript
static cosineSimilarity(a: readonly number[], b: readonly number[]): number {
```

## 构建验证

### Foundry 构建

```bash
cd /Users/weisun/github/mdfriday/foundry
npm run build
```

**结果**: ✅ 构建成功

```
✅ 构建完成！
📊 输出文件统计：
   - CJS 主包: 631.98 KB (bundled)
   - ESM 主包: 626.32 KB (bundled)
   - CJS Mobile: 82.57 KB
   - ESM Mobile: 81.94 KB (bundled)
   - 类型声明文件: 306 个 (518.59 KB)
```

### Friday Plugin 构建

```bash
cd /Users/weisun/github/mdfriday/obsidian-friday-plugin
npm run dev
```

**结果**: ✅ 构建成功并进入监听模式

## obsidian-friday-plugin 中的相关修改

**文件**: `src/services/wiki/WikiService.ts`

**修改前**（临时方案）:
```typescript
// 临时方案：直接从 foundry 内部路径导入
import { createObsidianWikiService } from '@mdfriday/foundry/dist/esm/internal/interfaces/obsidian/desktop/index.js';
```

**修改后**（正式方案）:
```typescript
import { createObsidianWikiService } from '@mdfriday/foundry';
```

## 技术要点

### 为什么需要支持两种索引类型？

在 `knowledge-base.ts` 中，`retrieve` 方法接受的 `embeddingIndex` 参数类型是 `ReadonlyMap<string, number[]>`，这是为了：

1. **灵活性**: 允许外部传入简单的 Map 结构
2. **类型安全**: 使用 `readonly` 防止意外修改
3. **向后兼容**: 同时支持 `EmbeddingIndex` 类实例

### 为什么使用 readonly？

- `readonly number[]` 提供了更严格的类型安全
- 防止在检索过程中意外修改向量数据
- 符合函数式编程的不可变原则

## 总结

通过以下三步完成了修复：

1. ✅ 在 `foundry/index.ts` 中导出 `createObsidianWikiService`
2. ✅ 修改 `Retrieval.rankByEmbedding` 支持两种索引类型
3. ✅ 修改 `Retrieval.cosineSimilarity` 支持 `readonly` 参数

现在 `obsidian-friday-plugin` 可以正常导入和使用 `createObsidianWikiService` 了！
