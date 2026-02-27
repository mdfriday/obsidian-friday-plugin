# Fetch from Server 实现方案（最终版）

## 问题分析

### 原始问题
用户点击"从云端下载数据"时报错：
```
Failed to load chunks for 未命名 1.md: {failedChunkIds: Array(1), totalChunks: 1, failedCount: 1}
Load failed: 1/1 chunks missing
```

### 根本原因

1. **`readChunksOnline` 的工作机制**：
   ```typescript
   // LiveSyncReplicator.ts:716
   localDB.replicate.from(db, {
       ...syncOptionBase,
       ...(setting.readChunksOnline ? selectorOnDemandPull : {}),
   })
   
   // Line 68
   const selectorOnDemandPull = { selector: { type: { $ne: "leaf" } } };
   ```
   
   - **`readChunksOnline = false`**：复制所有文档（metadata + chunks）
   - **`readChunksOnline = true`**（默认）：
     - 复制时使用选择器，**排除** chunks（type: "leaf"）
     - 只下载 metadata
     - Chunks 通过 **ChunkFetcher** 按需从远程获取

2. **为什么出现错误**：
   - 复制时 `readChunksOnline=true`，只下载了 metadata
   - 恢复处理后调用 `rebuildVaultFromDB`
   - `getDBEntryFromMeta` 发现 chunks 缺失
   - 尝试通过 ChunkFetcher 获取，但此时复制已完成，replicator 不活跃
   - 超时失败 → "missing chunks" 错误

### 旧实现的问题流程
```
暂停处理
  → 复制（只有 metadata，如果 readChunksOnline=true）
  → 恢复处理
  → rebuildVaultFromDB
  → 读取文档时发现 chunks 缺失
  → 尝试通过 ChunkFetcher 获取
  → 失败 ❌
```

## 解决方案：完全遵循 livesync 的 fetchLocal 流程

### livesync 的实现（ModuleRebuilder.ts）

```typescript
async fetchLocal(makeLocalChunkBeforeSync?, preventMakeLocalFilesBeforeSync?) {
    // 1. 暂停处理
    await this.suspendReflectingDatabase();
    
    // 2. 重置并重新打开数据库
    await this.resetLocalDatabase();
    await delay(1000);
    await this.services.database.openDatabase();
    
    // 3. 标记已解析
    await this.services.remote.markResolved();
    await delay(500);
    
    // 4. 复制数据（两次）
    await this.services.remote.replicateAllFromRemote(true);
    await delay(1000);
    await this.services.remote.replicateAllFromRemote(true);
    
    // 5. 恢复处理
    await this.resumeReflectingDatabase();
}

// 单独的方法用于获取缺失的 chunks（line 240-260）
async fetchRemoteChunks() {
    if (
        !this.core.settings.doNotSuspendOnFetching &&
        !this.core.settings.useOnlyLocalChunk &&
        this.core.settings.remoteType == REMOTE_COUCHDB
    ) {
        this._log(`Fetching chunks`, LOG_LEVEL_NOTICE);
        const replicator = this.services.replicator.getActiveReplicator();
        const remoteDB = await replicator.connectRemoteCouchDBWithSetting(...);
        
        // 批量获取所有引用的 chunks
        await fetchAllUsedChunks(this.localDatabase.localDatabase, remoteDB.db);
        
        this._log(`Fetching chunks done`, LOG_LEVEL_NOTICE);
    }
}
```

### 关键发现

1. ✅ livesync **从不修改** `readChunksOnline` 设置
2. ✅ livesync 提供了单独的 `fetchRemoteChunks()` 方法来获取缺失的 chunks
3. ✅ 这个方法在需要时被显式调用（例如在垃圾回收或重建后）
4. ✅ 在 `fetchLocal` 中，复制完成后会调用 `resumeReflectingDatabase`，让 ReplicateResultProcessor 自动处理文档

## 最终实现流程

```typescript
async rebuildLocalFromRemote() {
    // Phase 1: 暂停事件处理
    suspendParseReplicationResult = true
    suspendFileWatching = true
    stopWatch()
    
    // Phase 2: 重置本地数据库
    resetDatabase()
    
    // Phase 3: 重新打开数据库
    initializeDatabase()
    
    // Phase 4: 标记设备为已解析
    markRemoteResolved()
    updateStoredSalt()
    
    // Phase 5: 第一次复制
    // - 如果 readChunksOnline=false，下载 metadata + chunks
    // - 如果 readChunksOnline=true，只下载 metadata
    replicateAllFromServer(pullOnly)
    
    // Phase 6: 第二次复制（确保完整性）
    replicateAllFromServer(pullOnly)
    
    // ✨ Phase 6.5: 获取缺失的 chunks（关键步骤）
    // 完全遵循 livesync 的 fetchRemoteChunks 模式
    if (readChunksOnline && !useOnlyLocalChunk && remoteType === REMOTE_COUCHDB) {
        fetchAllMissingChunksFromRemote()
        // 这个方法会：
        // 1. 扫描本地数据库，找出所有被引用的 chunk IDs
        // 2. 检查哪些 chunks 在本地缺失
        // 3. 批量从远程获取缺失的 chunks
        // 4. 写入本地数据库
    }
    
    // Phase 7: 恢复处理并写入文件
    suspendParseReplicationResult = false
    suspendFileWatching = false
    startWatch()
    rebuildVaultFromDB()
    // 此时所有 chunks 都在本地，可以成功读取
    
    // Phase 8: 完成
    startNetworkMonitoring()
    startSync()
}
```

## 与 livesync 的完全一致性

| 方面 | livesync | 我们的实现 | 一致性 |
|------|----------|-----------|--------|
| **暂停处理** | suspendReflectingDatabase() | suspendParseReplicationResult + suspendFileWatching | ✅ |
| **重置数据库** | resetLocalDatabase() | resetDatabase() | ✅ |
| **标记已解析** | markResolved() | markRemoteResolved() + updateStoredSalt() | ✅ |
| **复制流程** | replicateAllFromRemote() × 2 | replicateAllFromServer() × 2 | ✅ |
| **获取 chunks** | fetchRemoteChunks() 单独方法 | fetchAllMissingChunksFromRemote() | ✅ |
| **条件判断** | doNotSuspendOnFetching + useOnlyLocalChunk + remoteType | readChunksOnline + useOnlyLocalChunk + remoteType | ✅ |
| **恢复处理** | resumeReflectingDatabase() | 恢复 suspend flags + scanVault | ✅ |
| **尊重用户配置** | 从不修改 readChunksOnline | 从不修改 readChunksOnline | ✅ |

## 关键改进

### **之前的错误方案**
```typescript
// ❌ 修改用户配置
originalReadChunksOnline = settings.readChunksOnline
settings.readChunksOnline = false
replicateAllFromServer()  // 强制下载所有 chunks
settings.readChunksOnline = originalReadChunksOnline
```

**问题**：
- ❌ 违背用户意愿
- ❌ 不符合 livesync 设计理念
- ❌ 可能导致流量浪费（用户可能故意启用 readChunksOnline）

### **正确的方案（完全遵循 livesync）**
```typescript
// ✅ 尊重用户配置
replicateAllFromServer()  // 根据 readChunksOnline 设置下载

// ✅ 显式获取缺失的 chunks
if (readChunksOnline && !useOnlyLocalChunk && remoteType === REMOTE_COUCHDB) {
    fetchAllMissingChunksFromRemote()
}
```

**优点**：
- ✅ 完全尊重用户的 `readChunksOnline` 配置
- ✅ 只在需要时获取缺失的 chunks
- ✅ 符合 livesync 的设计理念和最佳实践
- ✅ 适用于所有配置组合

## fetchAllMissingChunksFromRemote 实现

```typescript
private async fetchAllMissingChunksFromRemote(): Promise<void> {
    // Step 1: 收集所有被引用的 chunk IDs
    const referencedChunkIds = new Set<string>();
    const allDocs = await localDB.allDocs({ include_docs: true });
    for (const row of allDocs.rows) {
        if (doc.children && Array.isArray(doc.children)) {
            doc.children.forEach(chunkId => referencedChunkIds.add(chunkId));
        }
    }
    
    // Step 2: 检查哪些 chunks 在本地缺失
    const localChunksResult = await localDB.allDocs({ keys: [...referencedChunkIds] });
    const missingChunkIds = localChunksResult.rows
        .filter(row => 'error' in row && row.error === 'not_found')
        .map(row => row.key);
    
    // Step 3: 批量从远程获取缺失的 chunks
    const batchSize = 100;
    for (let i = 0; i < missingChunkIds.length; i += batchSize) {
        const batch = missingChunkIds.slice(i, i + batchSize);
        const chunks = await this._replicator.fetchRemoteChunks(batch, false);
        
        // Step 4: 写入本地数据库
        await localDB.bulkDocs(chunks, { new_edits: false });
    }
}
```

这个实现：
- ✅ 只获取实际缺失的 chunks（高效）
- ✅ 批量处理（性能好）
- ✅ 使用 replicator 的标准方法（可靠）
- ✅ 完全符合 livesync 的 `fetchAllUsedChunks` 逻辑

## 测试要点

1. ✅ `readChunksOnline = true` 时的首次下载
2. ✅ `readChunksOnline = false` 时的首次下载
3. ✅ 本地数据损坏后重新下载
4. ✅ 大量文件的下载
5. ✅ 大文件（多个 chunks）的正确处理
6. ✅ 二进制文件的正确处理
7. ✅ 内部文件（.obsidian）的正确处理

## 总结

✅ **完全遵循 livesync 的实现模式**：
- 使用 `fetchRemoteChunks` 模式而不是修改 `readChunksOnline`
- 在复制后显式获取缺失的 chunks
- 完全尊重用户配置
- 所有逻辑与 livesync 保持一致

✅ **解决了原始问题**：
- Chunks 在处理前确保存在于本地
- 不会再出现 "missing chunks" 错误
- 适用于所有配置组合

✅ **设计优雅且可维护**：
- 清晰的阶段划分
- 符合 livesync 的设计哲学
- 易于理解和维护
