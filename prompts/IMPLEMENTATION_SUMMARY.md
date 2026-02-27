# Fetch from Server 实现总结

## 修改完成 ✅

已完全按照 livesync 的 `fetchLocal` 和 `fetchRemoteChunks` 模式重新实现了 `rebuildLocalFromRemote` 方法。

## 关键修改

### 1. **移除了对 `readChunksOnline` 的修改**

**之前（错误方案）**：
```typescript
const originalReadChunksOnline = this._settings.readChunksOnline;
this._settings.readChunksOnline = false;  // ❌ 修改用户配置
// ... 复制 ...
this._settings.readChunksOnline = originalReadChunksOnline;
```

**现在（正确方案）**：
```typescript
// ✅ 完全不修改 readChunksOnline 设置
// 复制时尊重用户配置
await this._replicator?.replicateAllFromServer(this._settings, true);
```

### 2. **添加了 Phase 6.5：显式获取缺失的 chunks**

```typescript
// Phase 6.5: Fetch Missing Chunks (livesync: fetchRemoteChunks)
if (this._settings.readChunksOnline && 
    !this._settings.useOnlyLocalChunk &&
    this._settings.remoteType === REMOTE_COUCHDB) {
    Logger("[Fetch] Phase 6.5: Fetching missing chunks from remote", LOG_LEVEL_INFO);
    await this.fetchAllMissingChunksFromRemote();
}
```

这完全遵循 livesync 的模式：
- `livesync/src/modules/core/ModuleRebuilder.ts:240-260` 的 `fetchRemoteChunks()` 方法
- 只在必要时（`readChunksOnline=true`）才调用
- 批量获取所有缺失的 chunks

## 完整流程（与 livesync 一致）

```
┌─────────────────────────────────────────────────────────────┐
│ Phase 1: 暂停事件处理                                        │
│  - suspendParseReplicationResult = true                     │
│  - suspendFileWatching = true                               │
│  - stopWatch()                                              │
└─────────────────────────────────────────────────────────────┘
                         ↓
┌─────────────────────────────────────────────────────────────┐
│ Phase 2-4: 重置数据库、打开数据库、标记已解析                │
│  - resetDatabase()                                          │
│  - initializeDatabase()                                     │
│  - markRemoteResolved() + updateStoredSalt()                │
└─────────────────────────────────────────────────────────────┘
                         ↓
┌─────────────────────────────────────────────────────────────┐
│ Phase 5-6: 从远程复制数据（两次）                            │
│  - replicateAllFromServer() × 2                             │
│  - 如果 readChunksOnline=false: 下载 metadata + chunks     │
│  - 如果 readChunksOnline=true: 只下载 metadata             │
└─────────────────────────────────────────────────────────────┘
                         ↓
┌─────────────────────────────────────────────────────────────┐
│ ✨ Phase 6.5: 获取缺失的 chunks（关键！）                    │
│  - 仅当 readChunksOnline=true 时执行                        │
│  - fetchAllMissingChunksFromRemote()                        │
│    1. 扫描本地数据库，找出所有被引用的 chunk IDs             │
│    2. 检查哪些 chunks 在本地缺失                             │
│    3. 批量从远程获取缺失的 chunks                            │
│    4. 写入本地数据库                                         │
└─────────────────────────────────────────────────────────────┘
                         ↓
┌─────────────────────────────────────────────────────────────┐
│ Phase 7: 恢复处理并写入文件                                  │
│  - suspendParseReplicationResult = false                    │
│  - suspendFileWatching = false                              │
│  - startWatch()                                             │
│  - rebuildVaultFromDB() ← 此时所有 chunks 都在本地          │
└─────────────────────────────────────────────────────────────┘
                         ↓
┌─────────────────────────────────────────────────────────────┐
│ Phase 8: 完成                                                │
│  - startNetworkMonitoring()                                 │
│  - startSync() (如果之前开启了同步)                         │
└─────────────────────────────────────────────────────────────┘
```

## 为什么这个方案有效

### 1. **尊重用户配置**
- ✅ 不修改 `readChunksOnline` 设置
- ✅ 如果用户启用了 `readChunksOnline`，复制时只下载 metadata（节省流量）
- ✅ 如果用户禁用了 `readChunksOnline`，复制时下载所有数据（chunks 已包含）

### 2. **显式获取缺失的 chunks**
- ✅ Phase 6.5 专门处理 `readChunksOnline=true` 的情况
- ✅ 批量获取所有缺失的 chunks，确保完整性
- ✅ 使用 `replicator.fetchRemoteChunks()` 标准方法，可靠性高

### 3. **时机正确**
- ✅ 在恢复处理**之前**获取 chunks
- ✅ 确保 `rebuildVaultFromDB` 执行时，所有 chunks 都在本地
- ✅ 避免 ChunkFetcher 在复制完成后无法获取 chunks 的问题

### 4. **完全符合 livesync 的设计**
- ✅ 流程与 livesync 的 `fetchLocal` 完全一致
- ✅ 使用 livesync 的 `fetchRemoteChunks` 模式
- ✅ 所有判断条件与 livesync 保持一致

## 对比：错误方案 vs 正确方案

| 方面 | 错误方案（修改 readChunksOnline） | 正确方案（fetchRemoteChunks） |
|------|----------------------------------|-------------------------------|
| **用户配置** | ❌ 临时修改用户设置 | ✅ 完全尊重用户设置 |
| **设计理念** | ❌ 违背 livesync 设计 | ✅ 完全符合 livesync 设计 |
| **流量控制** | ❌ 强制下载所有 chunks | ✅ 根据配置智能处理 |
| **可维护性** | ❌ 难以理解和维护 | ✅ 清晰且易于维护 |
| **可靠性** | ⚠️ 可能有副作用 | ✅ 经过 livesync 验证 |

## 涉及的文件

1. **`src/sync/FridaySyncCore.ts`**
   - 修改了 `rebuildLocalFromRemote()` 方法
   - 移除了对 `readChunksOnline` 的修改
   - 添加了 Phase 6.5：调用 `fetchAllMissingChunksFromRemote()`
   - 已有的 `fetchAllMissingChunksFromRemote()` 方法保持不变

2. **`src/sync/FridayStorageEventManager.ts`**
   - 添加了 `startWatch()` 方法（与 `stopWatch()` 配对）

3. **`FETCH_FROM_SERVER_IMPLEMENTATION.md`**
   - 完整的实现方案文档
   - 详细的对比分析
   - 与 livesync 的一致性说明

## 测试建议

请测试以下场景：

### 基础场景
1. ✅ 首次从服务器下载数据
2. ✅ 本地数据库损坏后重新下载
3. ✅ 包含大量文件的 vault

### readChunksOnline 配置
4. ✅ `readChunksOnline = true` 时的下载（应该看到 Phase 6.5 的日志）
5. ✅ `readChunksOnline = false` 时的下载（应该跳过 Phase 6.5）

### 文件类型
6. ✅ 大文件（多个 chunks）的正确处理
7. ✅ 二进制文件的下载
8. ✅ `.obsidian` 内部文件的下载

### 错误恢复
9. ✅ 网络中断时的处理
10. ✅ 部分 chunks 缺失时的错误提示

## 预期行为

### 当 `readChunksOnline = true`（默认）
```
[Fetch] Phase 5: First replication pass (metadata + chunks)
[Fetch] Phase 6: Second replication pass (ensure completeness)
[Fetch] Phase 6.5: Fetching missing chunks from remote  ← 应该看到这个
Fetching file data from server...
Scanning database for referenced chunks...
Found 45 referenced chunks
Found 45 missing chunks, fetching from remote...
Fetched chunks: 45 / 45
Chunk fetching complete: 45 chunks fetched
[Fetch] Phase 7: Resuming database and storage reflection
Writing files to vault...
```

### 当 `readChunksOnline = false`
```
[Fetch] Phase 5: First replication pass (metadata + chunks)
[Fetch] Phase 6: Second replication pass (ensure completeness)
[Fetch] Phase 6.5: Skipped chunk fetching (readChunksOnline=false, chunks already downloaded)  ← 应该看到这个
[Fetch] Phase 7: Resuming database and storage reflection
Writing files to vault...
```

## 成功标志

✅ **不再出现 "missing chunks" 错误**
✅ **所有文件都能正确下载和恢复**
✅ **流程日志清晰，可以看到每个阶段**
✅ **完全符合 livesync 的行为**

## 参考

- livesync 源码：`livesync/src/modules/core/ModuleRebuilder.ts`
- fetchRemoteChunks：`ModuleRebuilder.ts:240-260`
- fetchAllUsedChunks：`livesync/src/lib/livesync-commonlib/src/pouchdb/chunks.ts:162-171`

---

**实现完成时间**：2026-02-27
**实现者**：根据 livesync 源码完全重构
**状态**：✅ 已完成，等待测试验证
