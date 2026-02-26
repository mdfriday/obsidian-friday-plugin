# ChunkFetcher 调试日志使用指南

## 已添加的调试日志位置

### 1. LiveSyncManagers 初始化日志

**位置**: `src/sync/core/managers/LiveSyncManagers.ts` Line ~150

**日志内容**:
```javascript
[LiveSyncManagers] Managers initialized: {
  hasChunkManager: true/false,
  hasChunkFetcher: true/false,
  hasEntryManager: true/false,
  hasReplicator: true/false,  // 关键！检查 replicator 是否存在
  settings: {
    remoteType: "COUCHDB",
    useOnlyLocalChunk: false,  // 必须是 false
    readChunksOnline: true,    // 必须是 true
    concurrencyOfReadChunksOnline: 40,
    minimumIntervalOfReadChunksOnline: 50,
  }
}
```

### 2. ChunkFetcher 构造函数日志

**位置**: `src/sync/core/managers/ChunkFetcher.ts` Line ~40

**日志内容**:
```javascript
[ChunkFetcher] Constructor called: {
  hasChunkManager: true/false,
  hasReplicator: true/false,  // 初始化时可能是 false
  replicatorType: "LiveSyncCouchDBReplicator" / "null",
  settings: {
    remoteType: "COUCHDB",
    useOnlyLocalChunk: false,
    readChunksOnline: true,
    concurrency: 40,
    interval: 50,
  }
}

[ChunkFetcher] Event listener registered for EVENT_MISSING_CHUNKS
```

### 3. EVENT_MISSING_CHUNKS 接收日志

**位置**: `src/sync/core/managers/ChunkFetcher.ts` Line ~53

**日志内容**:
```javascript
[ChunkFetcher] Received EVENT_MISSING_CHUNKS: {
  newChunks: 171,            // 新收到的缺失 chunks 数量
  firstFewIds: ["h:abc", "h:def", "h:ghi"],  // 前几个 chunk ID
  currentQueueSize: 0,       // 当前队列大小
  currentProcessing: 0,      // 正在处理的请求数
  concurrencyLimit: 40,      // 并发限制
}

[ChunkFetcher] After merging queue: {
  totalQueueSize: 171,       // 合并后的队列大小
  canRequestMore: true,      // 是否可以发起新请求
  currentProcessing: 0,
}
```

### 4. 开始拉取 chunks 日志

**位置**: `src/sync/core/managers/ChunkFetcher.ts` Line ~98

**日志内容**:
```javascript
[ChunkFetcher] Starting requestMissingChunks: {
  queueLength: 171,          // 队列中的 chunks 数量
  currentProcessing: 0,      // 当前正在处理的请求
  batchSize: 100,            // 每批拉取的数量
}

[ChunkFetcher] Request details: {
  requestedChunks: 100,      // 本次请求的 chunks 数量
  firstFewIds: ["h:abc", "h:def", "h:ghi"],
  timeToWait: 0,             // 需要等待的时间（防止请求过快）
  remainingInQueue: 71,      // 队列中剩余的 chunks
}
```

### 5. Replicator 检查日志

**位置**: `src/sync/core/managers/ChunkFetcher.ts` Line ~121

**成功情况**:
```javascript
[ChunkFetcher] Replicator found, fetching from remote...: {
  replicatorType: "LiveSyncCouchDBReplicator",
  chunksToFetch: 100,
}
```

**失败情况** (这是最关键的！):
```javascript
[ChunkFetcher] ERROR: No active replicator found! {
  requestIDs: ["h:abc", "h:def", ...],
  queueLength: 171,
}
```

### 6. 拉取结果日志

**位置**: `src/sync/core/managers/ChunkFetcher.ts` Line ~135

**成功情况**:
```javascript
[ChunkFetcher] Fetch result: {
  success: true,
  fetchedCount: 100,         // 实际拉取到的数量
  requestedCount: 100,       // 请求的数量
}
```

**失败情况**:
```javascript
[ChunkFetcher] No chunks returned from remote: {
  requestedIds: ["h:abc", "h:def", ...],
}
```

### 7. 存储结果日志

**位置**: `src/sync/core/managers/ChunkFetcher.ts` Line ~162

**成功情况**:
```javascript
[ChunkFetcher] Chunks stored successfully: {
  stored: 100,
  written: 95,     // 实际写入数据库的
  cached: 5,       // 已在缓存中的
  duplicated: 0,   // 冲突的
}
```

**失败情况**:
```javascript
[ChunkFetcher] Failed to store chunks: {
  failedChunks: ["h:abc", "h:def", ...],
}
```

### 8. EntryManager 读取 chunks 日志

**位置**: `src/sync/core/managers/EntryManager/EntryManager.ts` Line ~270

**日志内容**:
```javascript
[ChunkFetcher Debug] Loading sync-theme.mov: {
  chunksCount: 171,
  isOnDemandChunkEnabled: true,     // 必须是 true
  isNetworkEnabled: true,            // 必须是 true
  preventRemoteRequest: false,       // 必须是 false
  timeout: 30000,
  remoteType: "COUCHDB",
  useOnlyLocalChunk: false,
  waitForReady: true,
}
```

### 9. ChunkManager 发送事件日志

**位置**: `src/sync/core/managers/ChunkManager.ts` Line ~328

**发送事件**:
```javascript
[ChunkManager] Emitting EVENT_MISSING_CHUNKS for chunk: h:abc123
```

**跳过事件** (有问题！):
```javascript
[ChunkManager] Skipping EVENT_MISSING_CHUNKS (preventRemoteRequest=true) for chunk: h:abc123
```

## 如何使用这些日志诊断问题

### 步骤 1：打开开发者工具

1. 在 Obsidian 中按 `Ctrl+Shift+I` (Windows/Linux) 或 `Cmd+Option+I` (Mac)
2. 切换到 "Console" 标签
3. 清空控制台 (点击 🚫 图标)

### 步骤 2：重现问题

1. 同步大文件或尝试打开大文件
2. 观察控制台输出

### 步骤 3：分析日志

#### 场景 A：初始化问题

如果看到：
```javascript
[LiveSyncManagers] Managers initialized: {
  hasReplicator: false,  // ❌ 问题：没有 replicator
}
```

**原因**: Replicator 在 managers 初始化时还未创建（这是正常的）  
**验证**: 稍后应该看到 ChunkFetcher 能正常工作

#### 场景 B：配置问题 ⭐ 最可能的原因

如果看到：
```javascript
[ChunkFetcher Debug] Loading sync-theme.mov: {
  preventRemoteRequest: true,  // ❌ 问题在这里！
  useOnlyLocalChunk: true,     // ❌ 或者这里！
}
```

**原因**: `useOnlyLocalChunk` 被启用或其他配置问题  
**解决**: 修改配置，确保 `useOnlyLocalChunk: false`

#### 场景 C：Replicator 未激活 ⭐ 第二可能的原因

如果看到：
```javascript
[ChunkFetcher] Received EVENT_MISSING_CHUNKS: { newChunks: 171 }
[ChunkFetcher] Starting requestMissingChunks: { queueLength: 171 }
[ChunkFetcher] ERROR: No active replicator found!  // ❌ 问题！
```

**原因**: 同步未启动或 replicator 已断开  
**解决**: 确保同步连接处于活动状态

#### 场景 D：远程数据库问题

如果看到：
```javascript
[ChunkFetcher] Replicator found, fetching from remote...
[ChunkFetcher] No chunks returned from remote  // ❌ 问题！
```

**原因**: 远程数据库中确实没有这些 chunks  
**可能情况**: 
- 数据库损坏
- 上传时 chunks 未成功保存
- 网络问题导致拉取失败

#### 场景 E：正常工作的情况 ✅

应该看到类似这样的完整流程：
```javascript
[LiveSyncManagers] Managers initialized
[ChunkFetcher] Constructor called
[ChunkFetcher] Event listener registered
[ChunkFetcher Debug] Loading sync-theme.mov: { chunksCount: 171, preventRemoteRequest: false }
[ChunkManager] Emitting EVENT_MISSING_CHUNKS for chunk: h:xxx
[ChunkFetcher] Received EVENT_MISSING_CHUNKS: { newChunks: 171 }
[ChunkFetcher] Starting requestMissingChunks
[ChunkFetcher] Replicator found, fetching from remote...
[ChunkFetcher] Fetch result: { success: true, fetchedCount: 100 }
[ChunkFetcher] Chunks stored successfully: { stored: 100 }
[ChunkFetcher] Starting requestMissingChunks  // 第二批
[ChunkFetcher] Fetch result: { success: true, fetchedCount: 71 }
[ChunkFetcher] Chunks stored successfully: { stored: 71 }
// 文件成功打开
```

### 步骤 4：导出日志

如果需要报告问题，可以：
1. 右键点击控制台
2. 选择 "Save as..."
3. 保存为文本文件
4. 发送给开发者

## 常见问题速查表

| 日志特征 | 问题 | 解决方法 |
|---------|------|---------|
| `hasReplicator: false` (初始化时) | 正常，replicator 稍后创建 | 无需操作 |
| `preventRemoteRequest: true` | 配置错误 | 检查 `useOnlyLocalChunk` |
| `No active replicator found` | Replicator 未激活 | 确保同步连接开启 |
| `No chunks returned` | 远程数据库问题 | 检查网络和数据库完整性 |
| `Failed to store chunks` | 本地数据库问题 | 检查存储空间和数据库状态 |
| 没有任何 ChunkFetcher 日志 | ChunkFetcher 未初始化 | 检查初始化流程 |

## 下一步

收集日志后，根据日志内容判断问题类型，然后：

1. **配置问题** → 修改配置文件或添加配置验证代码
2. **Replicator 问题** → 检查同步启动流程
3. **数据库问题** → 需要更深入的调查，可能涉及数据迁移

## 移除调试日志

如果问题解决，可以将这些 `console.log` 改为 `Logger(..., LOG_LEVEL_VERBOSE)`，这样只在开启详细日志时才显示。
