# 实施方案 - 修复大文件同步问题（不修改 core 代码）

## 方案概述

在 `FridaySyncCore.ts` 中添加空壳 chunk 清理逻辑，在 ChunkFetcher 拉取前删除这些空壳文档，确保拉取的完整 chunks 能够被正确保存。

## 详细实施

### 步骤 1：添加空壳 chunk 检测和删除方法

**文件**：`src/sync/FridaySyncCore.ts`

**位置**：在类的私有方法部分

**代码**：

```typescript
/**
 * 删除指定的空壳 chunks（只有元数据但没有 data 的 chunks）
 * 这些空壳 chunks 会阻止 ChunkFetcher 保存完整的 chunks
 * 
 * @param chunkIds 要检查的 chunk IDs
 * @returns 删除的 chunk 数量
 */
private async deleteShellChunks(chunkIds: string[]): Promise<number> {
    if (!this._localDatabase || chunkIds.length === 0) {
        return 0;
    }
    
    try {
        const db = this._localDatabase.localDatabase;
        
        // 批量获取这些 chunk 文档
        const docs = await db.allDocs({
            keys: chunkIds,
            include_docs: true,
        });
        
        // 找出空壳 chunks（type 是 leaf 但没有 data 或 data 为空）
        const shellChunks = docs.rows
            .filter(row => {
                if (!('doc' in row) || !row.doc) return false;
                const doc = row.doc as any;
                // 检查是否是空壳：type 是 leaf 但没有有效的 data
                return doc.type === 'leaf' && (!doc.data || doc.data.length === 0);
            })
            .map(row => ({
                ...(row as any).doc,
                _deleted: true,  // 标记为删除
            }));
        
        if (shellChunks.length > 0) {
            Logger(
                `[Friday Sync] Deleting ${shellChunks.length} shell chunks before fetching...`,
                LOG_LEVEL_VERBOSE
            );
            
            // 批量删除
            await db.bulkDocs(shellChunks);
            
            Logger(
                `[Friday Sync] Successfully deleted ${shellChunks.length} shell chunks`,
                LOG_LEVEL_VERBOSE
            );
        }
        
        return shellChunks.length;
    } catch (error) {
        Logger(
            `[Friday Sync] Failed to delete shell chunks: ${error}`,
            LOG_LEVEL_VERBOSE
        );
        return 0;
    }
}

/**
 * 清理所有空壳 chunks（定期维护任务）
 * 这个方法会扫描所有 chunk 文档并清理空壳
 */
private async cleanupAllShellChunks(): Promise<void> {
    if (!this._localDatabase) return;
    
    try {
        const db = this._localDatabase.localDatabase;
        let totalDeleted = 0;
        let hasMore = true;
        let startKey = 'h:';
        
        // 分批处理，避免一次加载太多文档
        while (hasMore) {
            const result = await db.allDocs({
                startkey: startKey,
                endkey: 'h:\uffff',
                include_docs: true,
                limit: 500,  // 每次处理 500 个
            });
            
            if (result.rows.length === 0) {
                hasMore = false;
                break;
            }
            
            const shellChunks = result.rows
                .filter(row => {
                    if (!('doc' in row) || !row.doc) return false;
                    const doc = row.doc as any;
                    return doc.type === 'leaf' && (!doc.data || doc.data.length === 0);
                })
                .map(row => ({
                    ...(row as any).doc,
                    _deleted: true,
                }));
            
            if (shellChunks.length > 0) {
                await db.bulkDocs(shellChunks);
                totalDeleted += shellChunks.length;
            }
            
            // 如果返回的结果少于 limit，说明已经到末尾了
            if (result.rows.length < 500) {
                hasMore = false;
            } else {
                // 更新 startKey 为最后一个文档的 ID
                const lastRow = result.rows[result.rows.length - 1];
                startKey = lastRow.id + '\u0000';  // 确保不重复处理同一个文档
            }
        }
        
        if (totalDeleted > 0) {
            Logger(
                `[Friday Sync] Cleanup completed: ${totalDeleted} shell chunks deleted`,
                LOG_LEVEL_INFO
            );
        }
    } catch (error) {
        Logger(
            `[Friday Sync] Failed to cleanup shell chunks: ${error}`,
            LOG_LEVEL_VERBOSE
        );
    }
}
```

### 步骤 2：注册 ChunkManager 事件监听器

**文件**：`src/sync/FridaySyncCore.ts`

**位置**：在 `initialize` 方法中，数据库初始化之后

**代码**：

```typescript
async initialize(config: SyncConfig): Promise<boolean> {
    try {
        // ... 现有的初始化代码 ...
        
        // Initialize local database
        const vaultName = this.getVaultName();
        this._localDatabase = new LiveSyncLocalDB(vaultName, this);
        
        const dbInitialized = await this._localDatabase.initializeDatabase();
        if (!dbInitialized) {
            this.setStatus("ERRORED", "Failed to initialize local database");
            return false;
        }
        
        // 🆕 注册 EVENT_MISSING_CHUNKS 监听器
        // 在 ChunkFetcher 拉取前删除空壳 chunks
        this._managers.chunkManager.addListener('missingChunks', async (chunkIds: string[]) => {
            Logger(
                `[Friday Sync] Detected ${chunkIds.length} missing chunks, checking for shell chunks...`,
                LOG_LEVEL_VERBOSE
            );
            const deletedCount = await this.deleteShellChunks(chunkIds);
            if (deletedCount > 0) {
                Logger(
                    `[Friday Sync] Deleted ${deletedCount} shell chunks, ChunkFetcher can now save the complete chunks`,
                    LOG_LEVEL_VERBOSE
                );
            }
        });
        
        Logger('[Friday Sync] Shell chunk cleanup listener registered', LOG_LEVEL_VERBOSE);
        
        // ... 继续现有的初始化代码 ...
        
        // 🆕 可选：在初始化时清理一次所有空壳 chunks
        // 这可以作为数据库健康检查的一部分
        await this.cleanupAllShellChunks();
        
        // ... 其余的初始化代码 ...
        
        return true;
    } catch (error) {
        // ... 错误处理 ...
    }
}
```

### 步骤 3：可选 - 在同步完成后清理

**文件**：`src/sync/FridaySyncCore.ts`

**位置**：在同步完成的回调中

**代码**：

```typescript
// 在 stopSync 或同步完成的地方
async stopSync(): Promise<void> {
    // ... 现有的停止同步代码 ...
    
    // 🆕 同步完成后清理所有空壳 chunks
    Logger('[Friday Sync] Sync stopped, performing cleanup...', LOG_LEVEL_VERBOSE);
    await this.cleanupAllShellChunks();
    
    // ... 其余代码 ...
}
```

## 为什么这个方案有效

### 问题原因

1. CouchDB replication 同步 chunk 的元数据（`_id`, `_rev`, `type`）但没有 `data` 字段
2. 本地数据库中有"空壳 chunks"
3. ChunkFetcher 拉取完整 chunks 后，使用 `force: true`（即 `new_edits: false`）保存
4. PouchDB 发现 `_id` 和 `_rev` 相同，认为是重复操作，不更新

### 解决方法

1. 在 ChunkFetcher 拉取前，监听 `EVENT_MISSING_CHUNKS` 事件
2. 检查这些 chunk IDs 对应的本地文档
3. 删除空壳 chunks（有 `_id` 和 `_rev` 但没有 `data` 的文档）
4. ChunkFetcher 拉取完整 chunks 后，本地没有冲突，可以正常保存

### 为什么不修改 core 代码

1. ✅ 我们的 core 代码完全来自 livesync commonlib
2. ✅ Livesync 的实现是正确的（在标准环境下能工作）
3. ✅ 问题可能是 PouchDB/CouchDB 版本差异或特殊配置
4. ✅ 在非 core 代码中处理更安全、更易维护
5. ✅ 方便后续合并 livesync 的更新

## 测试计划

### 测试 1：验证空壳 chunks 存在

**在浏览器控制台运行**：

```javascript
const db = app.plugins.plugins['friday-sync'].syncCore._localDatabase.localDatabase;

db.allDocs({
    startkey: 'h:',
    endkey: 'h:\uffff',
    include_docs: true,
    limit: 100,
}).then(result => {
    const shellChunks = result.rows.filter(row => {
        const doc = row.doc;
        return doc && doc.type === 'leaf' && (!doc.data || doc.data.length === 0);
    });
    console.log('Shell chunks found:', shellChunks.length);
    if (shellChunks.length > 0) {
        console.log('Examples:', shellChunks.slice(0, 3).map(r => ({
            id: r.doc._id,
            rev: r.doc._rev,
            hasData: !!r.doc.data,
        })));
    }
});
```

### 测试 2：验证删除功能

**步骤**：
1. 实施代码
2. 重启 Obsidian
3. 查看控制台日志，应该看到：
   ```
   [Friday Sync] Shell chunk cleanup listener registered
   [Friday Sync] Cleanup completed: X shell chunks deleted
   ```

### 测试 3：验证大文件同步

**步骤**：
1. 在设备 A 上传大文件（> 10MB）
2. 在设备 B 同步
3. 尝试打开大文件
4. 查看日志：
   ```
   [Friday Sync] Detected 108 missing chunks
   [Friday Sync] Deleted 108 shell chunks
   [ChunkFetcher] Chunks stored successfully: {stored: 108, written: 108}
   ```
5. 文件应该能正常打开

### 测试 4：验证不影响小文件

**步骤**：
1. 同步小文件（< 1MB）
2. 确认正常工作
3. 不应该有任何错误或性能问题

## 性能影响

### 内存

- 每次只检查需要拉取的 chunks，不是全部
- 批量操作，最多 500 个文档一批
- **影响**：可忽略

### 速度

- `allDocs` 查询很快（有索引）
- `bulkDocs` 删除操作也很快
- **影响**：几十毫秒级别，用户不会感知

### 数据库大小

- 删除空壳 chunks 会减小数据库大小
- **影响**：正面，改善数据库健康状况

## 回滚计划

如果出现问题，可以：

1. **注释掉监听器注册代码**：
   ```typescript
   // this._managers.chunkManager.addListener('missingChunks', ...);
   ```

2. **或者添加开关控制**：
   ```typescript
   if (this._settings.enableShellChunkCleanup !== false) {
       // 注册监听器
   }
   ```

## 后续优化

### 1. 添加统计信息

记录清理的 chunk 数量，用于分析问题频率。

### 2. 添加用户通知（可选）

如果删除了大量空壳 chunks，可以通知用户数据库已优化。

### 3. 定期后台任务（可选）

每小时或每天运行一次 `cleanupAllShellChunks()`。

### 4. 上报问题

向 livesync 作者报告这个问题，看是否是 PouchDB/CouchDB 版本差异导致的。

## 总结

✅ **不修改 core 代码**（保持与 livesync 一致）  
✅ **在应用层解决问题**（FridaySyncCore）  
✅ **性能影响可忽略**  
✅ **易于测试和回滚**  
✅ **不影响现有功能**  

这个方案既解决了问题，又保持了代码的可维护性和与 livesync 的兼容性。
