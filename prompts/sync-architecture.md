# Friday Sync 架构总结

## 整体分层结构

```
src/sync/
├── 适配层 (Adaptation Layer) - Friday 插件专属实现
│   ├── SyncService.ts           # 最外层服务入口
│   ├── FridaySyncCore.ts        # 核心同步控制器
│   ├── FridayServiceHub.ts      # 服务中心（实现 core 的服务接口）
│   ├── FridayStorageEventManager.ts  # 本地文件监听器
│   ├── SyncStatusDisplay.ts     # UI状态显示
│   └── types.ts / index.ts      # 类型定义和导出
│
└── core/                        # 核心层 (来自 livesync 的核心库)
    ├── pouchdb/                 # PouchDB 封装、加密、复制
    ├── replication/             # 同步复制逻辑
    ├── managers/                # 各类管理器 (Chunk/Hash/Change等)
    ├── services/                # 服务接口定义
    ├── common/                  # 通用类型、工具、日志
    └── ...                      # 其他核心功能模块
```

---

## 适配层各组件职责

| 组件 | 职责 |
|------|------|
| **SyncService** | 最外层高级 API，提供简单的 `initialize()`, `startSync()`, `pullFromServer()`, `pushToServer()` 等方法给 `main.ts` 调用 |
| **FridaySyncCore** | 核心控制器，实现 `LiveSyncLocalDBEnv` 和 `LiveSyncCouchDBReplicatorEnv` 接口，管理本地数据库、远程复制器、设置配置 |
| **FridayServiceHub** | 服务中心，提供 15+ 种服务的 Friday 专属实现（API/Path/Database/Replication 等），将 core 层的抽象服务接口与 Obsidian 平台对接 |
| **FridayStorageEventManager** | 监听 Obsidian Vault 的文件事件（create/modify/delete/rename），将本地修改存入 PouchDB |
| **SyncStatusDisplay** | 管理右上角状态显示和底部状态栏，响应式更新同步状态 |

---

## 核心层主要模块

| 模块 | 职责 |
|------|------|
| **pouchdb/LiveSyncLocalDB** | 本地 PouchDB 数据库管理，文档的增删改查、分块存储 |
| **replication/LiveSyncReplicator** | CouchDB 远程复制器，处理双向同步、LiveSync 持续复制 |
| **pouchdb/encryption** | 端对端加密 (E2EE)，使用 `transform-pouch` 插件 |
| **managers/ChunkManager** | 大文件分块管理 |
| **managers/HashManager** | 文件内容哈希计算 |
| **services/ServiceHub** | 定义服务接口抽象层，让适配层可以注入自己的实现 |
| **common/logger** | 统一日志系统 |

---

## 数据流和协作方式

```
┌─────────────────────────────────────────────────────────────────────┐
│                        main.ts (Plugin Entry)                       │
└─────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────┐
│                        SyncService (高级 API)                        │
│   • initialize(config)  • startSync()  • pullFromServer()           │
└─────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────┐
│                      FridaySyncCore (核心控制器)                      │
│   持有:                                                             │
│   • _localDatabase (LiveSyncLocalDB)                               │
│   • _replicator (LiveSyncCouchDBReplicator)                        │
│   • _services (FridayServiceHub)                                   │
│   • _storageEventManager (FridayStorageEventManager)               │
└─────────────────────────────────────────────────────────────────────┘
            │                       │                      │
            ▼                       ▼                      ▼
┌───────────────────┐  ┌────────────────────┐  ┌────────────────────┐
│ FridayServiceHub  │  │ StorageEventManager│  │ SyncStatusDisplay  │
│ (服务实现)         │  │ (文件监听)          │  │ (UI显示)            │
│                   │  │                    │  │                    │
│ 实现 15+ 服务接口: │  │ • 监听 vault 事件   │  │ • 右上角状态区域    │
│ • API             │  │ • modify/create    │  │ • 底部状态栏        │
│ • Path            │  │ • delete/rename    │  │ • Notice 通知      │
│ • Database        │  │ • 存入 PouchDB     │  │                    │
│ • Remote          │  │                    │  │                    │
│ • FileProcessing  │  │                    │  │                    │
│ • Replication     │  │                    │  │                    │
│ • ...             │  │                    │  │                    │
└───────────────────┘  └────────────────────┘  └────────────────────┘
            │
            ▼
┌─────────────────────────────────────────────────────────────────────┐
│                         core/ (核心层)                               │
│                                                                     │
│  ┌──────────────────┐   ┌──────────────────┐   ┌─────────────────┐ │
│  │ LiveSyncLocalDB  │   │ LiveSyncReplicator│   │ ChunkManager    │ │
│  │ (本地数据库)      │◄──│ (远程复制器)       │   │ HashManager     │ │
│  │                  │   │                  │   │ ChangeManager   │ │
│  │ • putDBEntry()   │   │ • openReplication│   │ ...             │ │
│  │ • getDBEntry()   │   │ • closeReplication│  │                 │ │
│  │ • deleteDBEntry()│   │ • continuous sync │  │                 │ │
│  └──────────────────┘   └──────────────────┘   └─────────────────┘ │
│                                                                     │
│  ┌──────────────────┐   ┌──────────────────┐                       │
│  │ encryption.ts    │   │ pouchdb-browser  │                       │
│  │ (E2EE加密)       │   │ (PouchDB配置)     │                       │
│  │ transform-pouch  │   │ • idb adapter    │                       │
│  └──────────────────┘   │ • http adapter   │                       │
│                         └──────────────────┘                       │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 关键数据流

### 1. 本地修改 → 服务器

```
用户编辑文件 
  → Obsidian vault.on("modify") 
  → FridayStorageEventManager.watchVaultChange()
  → storeFileToDB() (创建 SavingEntry，加密)
  → LiveSyncLocalDB.putDBEntry() (分块存储)
  → [自动] LiveSyncReplicator 持续复制到远程
```

### 2. 服务器 → 本地

```
远程有变更 
  → LiveSyncReplicator 接收变更
  → FridayServiceHub.defaultProcessSynchroniseResult()
  → 读取文档内容、解密
  → Obsidian vault.adapter.write() (写入文件)
  → 日志: "DB -> STORAGE" + 文件路径
```

### 3. 状态显示流

```
操作日志 
  → Logger(message, level)
  → FridaySyncCore._logCallback()
  → SyncStatusDisplay.addLog()
  → 根据 LOG_LEVEL 决定:
    • LOG_LEVEL_INFO: 显示在右上角 logMessage
    • LOG_LEVEL_NOTICE: 同时弹出 Notice
    • LOG_LEVEL_VERBOSE/DEBUG: 不显示
```

---

## 设计原则

1. **核心层不修改** - `core/` 目录来自 livesync，保持原样以便升级
2. **适配层桥接** - Friday 专属实现都在适配层，通过实现 core 定义的接口来对接
3. **服务注入模式** - `FridayServiceHub` 继承 `ServiceHub`，注入自定义服务实现
4. **响应式状态** - 使用 `octagonal-wheels` 的 reactive 系统管理状态更新
5. **日志分级** - INFO 给用户看业务信息，VERBOSE/DEBUG 用于调试

---

## 日志级别说明

| 级别 | 常量 | 用途 | UI 显示 |
|------|------|------|---------|
| DEBUG | `LOG_LEVEL_DEBUG` | 开发调试信息 | 不显示 |
| VERBOSE | `LOG_LEVEL_VERBOSE` | 详细技术信息 | 不显示 |
| INFO | `LOG_LEVEL_INFO` | 业务操作信息 | 右上角状态区 |
| NOTICE | `LOG_LEVEL_NOTICE` | 重要通知 | 右上角 + Notice弹窗 |

---

## 文件同步消息格式

- **上传**: `STORAGE -> DB (datatype) filepath`
- **下载**: `DB -> STORAGE filepath`
- **删除**: `STORAGE -> DB (delete) filepath`

其中 `datatype` 可以是：
- `plain` - 纯文本文件
- `newnote` - 新建笔记
- `binary` - 二进制文件

