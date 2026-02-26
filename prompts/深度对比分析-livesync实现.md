# 深度对比分析 - livesync vs 我们的实现

## 对比结果总结

### 完全相同的部分

1. **isChunkDoc 函数**：
   ```typescript
   // 两者完全相同
   function isChunkDoc(doc: any): doc is EntryLeaf {
       return doc && typeof doc._id === "string" && doc.type === "leaf";
   }
   ```

2. **selectorOnDemandPull**：
   ```typescript
   // 两者完全相同
   const selectorOnDemandPull = { selector: { type: { $ne: "leaf" } } };
   ```

3. **ChunkFetcher 保存逻辑**：
   ```typescript
   // 两者完全相同
   await this.chunkManager.write(chunks, {
       skipCache: true,
       force: true,  // 使用 force: true
   }, "ChunkFetcher" as DocumentID);
   ```

4. **默认配置**：
   ```typescript
   // 两者完全相同
   readChunksOnline: true,
   useOnlyLocalChunk: false,
   ```

## 🤔 关键问题

**如果我们的代码和 livesync 完全一样，为什么 livesync 能工作而我们不能？**

### 可能的原因

#### 原因 1：PouchDB replication 行为差异

**假设**：CouchDB 的 selector 在不同版本或配置下行为不同。

**livesync 的行为**：
- Selector `{ type: { $ne: "leaf" } }` **完全阻止** chunk 文档被同步（包括元数据）

**我们的行为**：
- Selector `{ type: { $ne: "leaf" } }` 阻止了 chunk 的 `data` 字段，但同步了元数据（`_id`, `_rev`, `type`）

**验证方法**：
检查用户的 CouchDB 版本和 PouchDB 版本。

#### 原因 2：初始化顺序差异

**从日志看到的问题**：

```javascript
[ChunkFetcher] Constructor called: {hasReplicator: false}  // ← replicator 还未创建
[LiveSyncManagers] Managers initialized: {hasReplicator: false}
```

然后在同步时：

```javascript
[ChunkFetcher] Replicator found, fetching from remote... // ← 这时 replicator 存在了
```

**但是**：chunks 无法保存（`written: 0`）

这说明**不是 replicator 的问题**，而是数据库状态的问题。

#### 原因 3：数据库中已存在空壳 chunks ⭐ 最可能

**关键发现**：

从日志可以看出，ChunkFetcher 成功拉取了 chunks，但 `written: 0`。

让我检查 `bulkDocs` 的 `new_edits: false` 行为：

根据 PouchDB 文档：
- `new_edits: false` - 使用文档的原始 `_rev`，如果本地已存在相同 `_id` 和 `_rev` 的文档，**不会更新**

**livesync 能工作的原因**：
1. Livesync 可能有某种机制**清理或避免**空壳 chunks 的产生
2. 或者 livesync 的 replication 根本不会产生空壳 chunks

#### 原因 4：我们的 replication 过程有差异

让我检查我们的 replication 是如何初始化的：

从你的日志可以看出，在失败之前，ChunkFetcher 就开始工作了，说明：
1. 同步过程中，文档元数据被同步
2. EntryManager 尝试读取文件
3. ChunkManager 发现本地有 chunk 文档（空壳），返回这些空壳
4. EntryManager 检测到数据无效，触发 ChunkFetcher
5. ChunkFetcher 拉取完整 chunks，但无法保存（因为 `_rev` 相同）

## 💡 解决方案

### 方案 1：检查 CouchDB/PouchDB 版本差异

**行动**：
1. 检查用户使用的 CouchDB 版本
2. 检查我们的 PouchDB 版本是否和 livesync 一致
3. 如果版本不同，可能导致 selector 行为差异

### 方案 2：不使用 `force: true`，改用 `force: false` 并处理冲突

**问题**：livesync 使用 `force: true` 能工作，为什么我们不行？

**可能原因**：livesync 的数据库中**没有空壳 chunks**，所以 `force: true` 能正常插入。

**解决方案**：
```typescript
// 方案 2A：使用 force: false，让 PouchDB 检测冲突
await this.chunkManager.write(chunks, {
    skipCache: false,
    force: false,  // 改为 false
}, "ChunkFetcher" as DocumentID);
```

这样会触发 409 冲突，ChunkManager 会比较本地和远程数据，发现不同后会抛出错误或覆盖。

但是！根据 ChunkManager 的代码，如果数据不同会抛出 `LiveSyncFatalError`，这不是我们想要的。

### 方案 3：在 ChunkFetcher 中检测并删除空壳 chunks（我刚才的方案）

**问题**：这不是 livesync 的做法。

**但是**：livesync 可能根本不会遇到这个问题。

### 方案 4：找到 livesync 如何避免空壳 chunks 的产生 ⭐⭐⭐ 推荐

**关键**：我们需要找到为什么 livesync 的数据库中不会有空壳 chunks。

**可能的地方**：
1. PouchDB 的 replication filter 配置
2. CouchDB 的设置
3. Livesync 的初始化过程

让我检查 livesync 是否有额外的 filter 或配置：

