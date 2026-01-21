# Friday Sync 工作流程与状态

## 一、同步状态 (DatabaseConnectingStatus)

共有 **8 种状态**：

| 图标 | 状态 | 含义 | 触发时机 |
|:----:|------|------|----------|
| ⏹️ | `NOT_CONNECTED` | 未连接 | 初始状态、网络离线、连接失败 |
| 🌀 | `STARTED` | 启动中 | 调用 `startSync()` 开始 |
| ⚡ | `CONNECTED` | 已连接/活跃同步 | 正在传输数据 |
| 💤 | `PAUSED` | 空闲等待 | **最常见状态** - 连接正常，等待新变化 |
| ✅ | `COMPLETED` | 完成 | OneShot 同步完成 |
| ⏹️ | `CLOSED` | 已关闭 | 主动关闭 replication |
| ⚠️ | `ERRORED` | 错误 | 认证失败、数据库重置等 |

> **注意**: 原 livesync 代码中没有独立的 `LIVE` 状态，LiveSync 模式正常运行时在 `CONNECTED` (有数据传输) 和 `PAUSED` (空闲等待) 之间切换。

### 状态说明

- **⏹️ NOT_CONNECTED** - 插件初始化后的默认状态，或网络不可用时的状态
- **🌀 STARTED** - 同步正在启动，正在建立连接
- **⚡ CONNECTED** - 正在活跃地传输数据（上传或下载）
- **💤 PAUSED** - **这是最常见的正常状态！** 表示 LiveSync 连接正常，当前没有数据需要同步，正在等待新的变化
- **✅ COMPLETED** - OneShot 同步（Pull/Push）完成
- **⏹️ CLOSED** - 用户主动停止同步
- **⚠️ ERRORED** - 发生错误（认证失败、数据库重置等）

### 💤 PAUSED 状态详解

`PAUSED` 是 PouchDB LiveSync 的**正常空闲状态**，不是错误！

当 `live: true` 选项启用时，PouchDB replication 会：
1. 传输完当前所有变化后进入 `PAUSED` 状态
2. 等待本地或远程有新变化
3. 检测到变化后切换到 `CONNECTED` 状态传输数据
4. 传输完成后再次进入 `PAUSED` 状态

```
     有数据传输              传输完成
⚡ CONNECTED ◄──────────────► 💤 PAUSED
                              (空闲等待)
```

**所以看到 💤 是好事！** 说明：
- ✅ 连接正常
- ✅ 所有数据已同步完成
- ✅ 正在监听新变化

---

## 二、状态转换图

```
                        ┌─────────────────────────────────────────┐
                        │                                         │
                        ▼                                         │
                ┌───────────────┐                                 │
   初始化 ────► │ ⏹️ NOT_CONNECTED │ ◄────────────────────────────┤
                └───────┬───────┘                                 │
                        │ startSync()                             │
                        ▼                                         │
                ┌───────────────┐                                 │
                │ 🌀 STARTED     │                                 │
                └───────┬───────┘                                 │
                        │                                         │
            ┌───────────┴───────────┐                             │
            │                       │                             │
            ▼                       ▼                             │
       连接成功               连接失败                            │
            │                       │                             │
            ▼                       ▼                             │
    ┌───────────────┐       ┌───────────────┐                     │
    │ ⚡ CONNECTED   │       │ ⚠️ ERRORED     │─────────────────────┤
    └───────┬───────┘       └───────────────┘                     │
            │                                                     │
            │ LiveSync 模式 (正常循环)                            │
            │                                                     │
            ▼                                                     │
    ┌─────────────────────────────────────────┐                   │
    │                                         │                   │
    │   ⚡ CONNECTED  ◄────────► 💤 PAUSED    │                   │
    │    (传输数据)      (空闲等待)            │                   │
    │                                         │                   │
    │   这是 LiveSync 的正常工作循环！        │                   │
    │   大部分时间处于 💤 PAUSED 状态         │                   │
    │                                         │                   │
    └─────────────────────────────────────────┘                   │
            │                                                     │
            │ OneShot 模式                                        │
            ▼                                                     │
    ┌───────────────┐                                             │
    │ ✅ COMPLETED   │                                             │
    └───────┬───────┘                                             │
            │                                                     │
            ▼                                                     │
    ┌───────────────┐                                             │
    │ ⏹️ CLOSED      │─────────────────────────────────────────────┘
    └───────────────┘
```

### 状态转换规则

| 当前状态 | 事件 | 目标状态 |
|----------|------|----------|
| ⏹️ NOT_CONNECTED | 调用 startSync() | 🌀 STARTED |
| 🌀 STARTED | 连接成功 | ⚡ CONNECTED |
| 🌀 STARTED | 连接失败 | ⚠️ ERRORED / ⏹️ NOT_CONNECTED |
| ⚡ CONNECTED | 数据传输完成 | 💤 PAUSED |
| 💤 PAUSED | 检测到新变化 | ⚡ CONNECTED |
| 💤 PAUSED | 网络断开 | 保持 💤 PAUSED (PouchDB 会自动重试) |
| 💤 PAUSED | 长时间无法连接 | ⏹️ CLOSED 或 ⚠️ ERRORED |
| ⚡ CONNECTED | OneShot 完成 | ✅ COMPLETED |
| ✅ COMPLETED | 关闭连接 | ⏹️ CLOSED |
| 任意状态 | 严重错误 | ⚠️ ERRORED |
| 任意状态 | 主动停止 | ⏹️ CLOSED |

### LiveSync 正常运行时的状态循环

```
用户修改文件
     │
     ▼
💤 PAUSED ──► 检测到变化 ──► ⚡ CONNECTED ──► 传输完成 ──► 💤 PAUSED
  (空闲)                       (同步中)                    (空闲)
```

**关键理解**：在 LiveSync 模式下，`💤 PAUSED` 是你最常看到的状态，这是**完全正常**的！

---

## 三、同步工作流程

### 3.1 初始化流程

```
Plugin 加载
    │
    ▼
FridaySyncCore.initialize()
    │
    ├── 初始化本地数据库 (PouchDB)
    ├── 初始化 Replicator
    ├── 初始化 StorageEventManager
    ├── 初始化 HiddenFileSync
    ├── 初始化 NetworkEvents (注册网络事件监听)
    ├── 初始化 ConnectionMonitor (启动健康检查)
    ├── 初始化 ConnectionFailureHandler
    └── 初始化 OfflineTracker
    │
    ▼
startSync(continuous=true)
    │
    ▼
状态: ⏹️ NOT_CONNECTED → 🌀 STARTED → ⚡ CONNECTED → 💤 PAUSED
```

### 3.2 LiveSync 模式启动流程

```
startSync(continuous=true)
    │
    ├── 检查网络: navigator.onLine
    │       │
    │       └── 离线 → 状态: ⏹️ NOT_CONNECTED, 启用 OfflineTracker
    │
    ├── 状态: 🌀 STARTED
    │
    ├── openReplication(keepAlive=true)
    │       │
    │       └── openContinuousReplication() [后台运行]
    │               │
    │               ├── openOneShotReplication("pullOnly") - 先拉取
    │               │
    │               └── 启动双向 LiveSync
    │                       │
    │                       ├── 状态: ⚡ CONNECTED (有数据传输)
    │                       │
    │                       └── 状态: 💤 PAUSED (空闲等待)
    │
    └── 延迟 1.5 秒后启动 File Watcher
            │
            └── beginWatch() - 监听本地文件变化
```

### 3.3 本地文件同步流程

```
用户修改文件
    │
    ▼
FridayStorageEventManager 捕获事件
    │
    ├── 检查 recentlyTouched (防止循环)
    ├── 检查 ignorePatterns (过滤规则)
    ├── 检查 selectiveSync (文件类型过滤)
    │
    ▼
storeFileToDB()
    │
    ├── 读取文件内容
    ├── 比较 mtime 和内容 (避免重复写入)
    ├── 创建 SavingEntry
    └── localDatabase.putDBEntry()
            │
            ▼
        状态: 💤 PAUSED → ⚡ CONNECTED (传输) → 💤 PAUSED
```

### 3.4 远端变化同步流程

```
远端数据库有变化
    │
    ▼
状态: 💤 PAUSED → ⚡ CONNECTED (拉取中)
    │
    ▼
replicationChangeDetected()
    │
    ▼
FridayServiceHub.parseSynchroniseResult()
    │
    ├── 普通文件 → 写入 Vault
    └── 内部文件 (i: 前缀) → HiddenFileSync 处理
            │
            ▼
        touch() - 标记为已处理，防止循环
            │
            ▼
        状态: ⚡ CONNECTED → 💤 PAUSED (完成)
```

### 3.5 网络恢复流程

```
网络断开
    │
    ▼
FridayNetworkEvents.watchOnline() 检测到 offline
    │
    ├── NetworkManager.setServerReachable(false)
    ├── OfflineTracker.setOffline(true)
    └── Replication 保持 💤 PAUSED (PouchDB 会自动重试)
    
    ...用户继续工作，变化被 OfflineTracker 记录...
    
网络恢复
    │
    ▼
FridayNetworkEvents.watchOnline() 检测到 online
    │
    ▼
handleNetworkRecovery()
    │
    ├── NetworkManager.setServerReachable(true)
    ├── OfflineTracker.setOffline(false)
    ├── 应用离线期间的变化
    │
    └── 检查状态: status !== ⚡ CONNECTED && status !== 💤 PAUSED?
            │
            └── 是 → startSync(true) 重新启动同步
                    │
                    └── 状态: 🌀 STARTED → ⚡ CONNECTED → 💤 PAUSED
```

---

## 四、关键组件职责

| 组件 | 职责 |
|------|------|
| **FridaySyncCore** | 核心协调器，管理所有同步组件 |
| **LiveSyncCouchDBReplicator** | 处理 PouchDB 与 CouchDB 的同步 |
| **FridayStorageEventManager** | 监听 Obsidian Vault 文件变化 |
| **FridayHiddenFileSync** | 处理 .obsidian 文件夹同步 |
| **FridayNetworkEvents** | 监听浏览器网络事件 |
| **FridayConnectionMonitor** | 定期健康检查，调度重连 |
| **FridayConnectionFailureHandler** | 处理连接失败，错误分类 |
| **FridayOfflineTracker** | 跟踪离线期间的变化 |
| **NetworkManager** | 管理网络状态 |

---

## 五、两种同步模式对比

| 特性 | LiveSync 模式 | OneShot 模式 |
|------|---------------|--------------|
| 参数 | `continuous=true` | `continuous=false` |
| 持续性 | 持续运行 | 一次性 |
| 返回值 | `undefined` (fire-and-forget) | `boolean` |
| 用途 | 日常实时同步 | Pull/Push/Fetch 操作 |
| File Watcher | 启动 | 不启动 |
| 正常状态 | 💤 PAUSED / ⚡ CONNECTED 循环 | ✅ COMPLETED |

---

## 六、状态图标在 UI 中的显示 (与 Livesync 一致)

状态栏显示格式：`Sync: {图标} ↑ {sent} ↓ {arrived}`

| 图标 | 状态 | 说明 |
|:----:|------|------|
| 💤 | PAUSED | **最常见** - 空闲等待中，一切正常！ |
| ⚡ | CONNECTED | 正在传输数据 |
| 🌀 | STARTED | 正在启动/连接 |
| ⏹️ | NOT_CONNECTED / CLOSED / COMPLETED | 未连接或已停止 |
| ⚠️ | ERRORED | 发生错误，需要检查 |

### 图标含义速查

- **💤 zzz** = 一切正常，同步空闲中
- **⚡** = 正在同步数据
- **🌀** = 正在连接服务器
- **⏹️** = 已停止或未连接
- **⚠️** = 有问题，需要处理

---

## 七、错误处理流程

```
发生错误
    │
    ▼
FridayConnectionFailureHandler.handleReplicationError()
    │
    ├── 网络错误 (fetch failed, timeout)
    │       │
    │       └── 返回 'retry' → ConnectionMonitor 调度重连
    │               │
    │               └── 状态: ⚠️ ERRORED → ⏹️ NOT_CONNECTED (等待重试)
    │
    ├── 认证错误 (401, 403)
    │       │
    │       └── 返回 'abort' → 显示 Notice, 需要用户修改设置
    │               │
    │               └── 状态: ⚠️ ERRORED
    │
    └── 数据库重置 (Salt 变化)
            │
            └── 显示 Notice: "请使用 Fetch from Server"
                    │
                    └── 状态: ⚠️ ERRORED (needsFetch=true)
```

---

## 八、常见问题 FAQ

### Q: 为什么我一直看到 💤 (zzz) 状态？

**A: 这是完全正常的！** 💤 表示 LiveSync 连接正常，当前没有数据需要同步。这是 PouchDB 在 `live: true` 模式下的空闲等待状态。

### Q: 什么时候会看到 ⚡ 状态？

**A:** 当有文件被修改并正在同步时，状态会短暂变为 ⚡，同步完成后又会回到 💤。

### Q: 状态栏显示 `↑ 1 ↓ 0` 是什么意思？

**A:** 
- `↑ 1` = 已发送 1 个文档到服务器
- `↓ 0` = 从服务器接收 0 个文档

