# 配置分析报告 - ChunkFetcher 功能状态

## 问题分析

### 第一步：检查默认配置

查看 `src/sync/core/common/types.ts`:

```typescript
// Line 1183
readChunksOnline: true,  // ✅ 默认启用

// Line 1271
useOnlyLocalChunk: false,  // ✅ 默认不阻止 ChunkFetcher
```

### 第二步：检查初始化代码

查看 `src/sync/FridaySyncCore.ts` 的 `initialize()` 方法（Line 509-551）:

```typescript
// Update settings from config
this._settings = {
    ...DEFAULT_SETTINGS,  // ✅ 使用默认设置
    couchDB_URI: config.couchDB_URI,
    couchDB_USER: config.couchDB_USER,
    couchDB_PASSWORD: config.couchDB_PASSWORD,
    couchDB_DBNAME: config.couchDB_DBNAME,
    encrypt: config.encrypt,
    passphrase: config.passphrase,
    usePathObfuscation: config.usePathObfuscation,
    liveSync: config.liveSync,
    syncOnStart: config.syncOnStart,
    syncOnSave: config.syncOnSave,
    remoteType: REMOTE_COUCHDB,  // ✅ 正确设置为 COUCHDB
    isConfigured: true,
    // ... 其他配置
};
```

### 关键发现 ⚠️

**问题**：初始化时只覆盖了部分配置，**没有显式设置 `useOnlyLocalChunk` 和 `readChunksOnline`**！

这意味着：
1. ✅ 这两个配置会使用 `DEFAULT_SETTINGS` 的默认值
2. ✅ `readChunksOnline: true` （启用按需拉取）
3. ✅ `useOnlyLocalChunk: false` （不阻止 ChunkFetcher）
4. ✅ `remoteType: REMOTE_COUCHDB` （支持 ChunkFetcher）

**结论**：配置看起来是正确的！

## 第三步：检查 LiveSyncManagers 初始化

查看 `src/sync/FridaySyncCore.ts` Line 557-567:

```typescript
this._managers = new LiveSyncManagers({
    get database() {
        return getDB();
    },
    getActiveReplicator: () => this._replicator!,  // ✅ 提供 replicator
    id2path: this.id2path.bind(this),
    path2id: this.path2id.bind(this),
    get settings() {
        return getSettings();  // ✅ 返回 this._settings
    },
});
```

查看 `src/sync/core/managers/LiveSyncManagers.ts` Line 136:

```typescript
this.chunkFetcher = new ChunkFetcher(proxy);  // ✅ ChunkFetcher 会被创建
```

**结论**：LiveSyncManagers 和 ChunkFetcher 的初始化看起来是正确的！

## 第四步：检查数据库初始化

查看 `src/sync/FridaySyncCore.ts` Line 609-616:

```typescript
const vaultName = this.getVaultName();
this._localDatabase = new LiveSyncLocalDB(vaultName, this);

const dbInitialized = await this._localDatabase.initializeDatabase();
```

查看 `src/sync/core/pouchdb/LiveSyncLocalDB.ts` Line 152:

```typescript
await this.managers.initManagers();  // ✅ 会调用 managers.initManagers()
```

**结论**：数据库初始化会触发 managers 初始化，ChunkFetcher 会被创建！

## 潜在问题分析

尽管配置看起来正确，但可能存在以下问题：

### 问题 1：Replicator 引用时机 ⚠️⚠️⚠️

```typescript
// FridaySyncCore.ts Line 561
getActiveReplicator: () => this._replicator!,  // 使用 ! 强制断言非空
```

但是：

```typescript
// FridaySyncCore.ts Line 610-625
this._localDatabase = new LiveSyncLocalDB(vaultName, this);  // 创建数据库
const dbInitialized = await this._localDatabase.initializeDatabase();  // 初始化数据库
// ↑ 在这里，managers.initManagers() 被调用，ChunkFetcher 被创建

// ... 之后
this._replicator = new LiveSyncCouchDBReplicator(this);  // 创建 replicator
```

**问题**：
- `initManagers()` 在 Line 612 被调用（通过 `initializeDatabase()`）
- `this._replicator` 在 Line 625 才被赋值
- 但 ChunkFetcher 在初始化时就保存了 `getActiveReplicator` 引用

**这可能导致**：
- ChunkFetcher 的 `getActiveReplicator()` 在初始化时返回 `undefined`
- 后续拉取 chunks 时，replicator 应该已经存在，但需要验证

### 问题 2：ChunkFetcher 何时开始监听？

ChunkFetcher 在构造函数中注册监听器：

```typescript
// ChunkFetcher.ts Line 43-45
this.chunkManager.addListener(EVENT_MISSING_CHUNKS, this.onEventHandler, {
    signal: this.abort.signal,
});
```

但 ChunkManager 也是在 `initManagers()` 中创建的。时序：
1. ChunkManager 创建 (Line 132)
2. ChunkFetcher 创建 (Line 136)
3. ChunkFetcher 注册监听器

**结论**：这个时序应该是正确的！

## 验证方案

### 方案 A：添加初始化日志 ✅ 推荐

在关键位置添加日志，验证初始化流程：

```typescript
// src/sync/core/managers/LiveSyncManagers.ts Line 136
this.chunkFetcher = new ChunkFetcher(proxy);
console.log('[LiveSyncManagers] ChunkFetcher created', {
    hasChunkManager: !!this.chunkManager,
    hasReplicator: !!proxy.getActiveReplicator(),
    settings: {
        remoteType: proxy.settings.remoteType,
        useOnlyLocalChunk: proxy.settings.useOnlyLocalChunk,
        readChunksOnline: proxy.settings.readChunksOnline,
    }
});
```

```typescript
// src/sync/core/managers/ChunkFetcher.ts Line 40
constructor(options: ChunkFetcherOptions) {
    this.options = options;
    console.log('[ChunkFetcher] Constructor called', {
        hasChunkManager: !!this.chunkManager,
        hasReplicator: !!options.getActiveReplicator(),
        settings: options.settings,
    });
    this.chunkManager.addListener(EVENT_MISSING_CHUNKS, this.onEventHandler, {
        signal: this.abort.signal,
    });
    console.log('[ChunkFetcher] Event listener registered');
}
```

### 方案 B：验证运行时状态 ✅ 推荐

在用户遇到问题时，在浏览器控制台运行：

```javascript
// 检查 ChunkFetcher 是否存在
const syncCore = app.plugins.plugins['friday-sync'].syncCore;
const chunkFetcher = syncCore._localDatabase?.managers?.chunkFetcher;

console.log('ChunkFetcher check:', {
    exists: !!chunkFetcher,
    queue: chunkFetcher?.queue,
    currentProcessing: chunkFetcher?.currentProcessing,
    settings: syncCore._settings,
    replicator: !!syncCore._replicator,
    isOnDemandChunkEnabled: syncCore._localDatabase?.managers?.entryManager?.isOnDemandChunkEnabled,
});
```

## 下一步行动

### 立即执行：

1. **添加初始化日志**（上面方案 A 的代码）
2. **让用户重现问题**并收集日志
3. **根据日志判断**：
   - ChunkFetcher 是否被创建？
   - Replicator 在拉取时是否存在？
   - 配置是否正确？

### 如果日志显示一切正常：

那么问题可能在于：
- 同步时机（replicator 未激活）
- 网络问题（无法连接到远程数据库）
- 其他我们还没发现的边缘情况

## 总结

✅ **配置正确**：
- `remoteType: REMOTE_COUCHDB`
- `useOnlyLocalChunk: false`
- `readChunksOnline: true`

✅ **初始化流程正确**：
- LiveSyncManagers 创建
- ChunkManager 创建
- ChunkFetcher 创建并注册监听器

⚠️ **潜在风险**：
- Replicator 在 managers 初始化之后才创建
- 需要验证 `getActiveReplicator()` 在拉取时能正确返回 replicator

🔧 **建议**：
- 添加详细的初始化日志
- 收集用户运行时的状态信息
- 验证 ChunkFetcher 是否真的收到了 EVENT_MISSING_CHUNKS 事件
