# Salt Mismatch Blocking - 阻止旧子库污染主库

## 问题场景

**用户报告的问题：**
1. 主库执行RESET，生成新的salt
2. 旧子库启动，检测到salt变化，正确提示用户"主库已重置"
3. **但是**旧子库仍然能连接同步服务，并且能上传本地旧数据到云端
4. 结果：旧子库的删除操作影响了主库，污染了已重置的数据库

## 问题根本原因分析

### Friday当前实现（有缺陷）

```typescript
// src/sync/core/replication/couchdb/LiveSyncReplicator.ts (第817-825行)
async openOneShotReplication(...) {
    if (!retrying) {
        const saltCheck = await this.checkSaltConsistency(setting);
        if (!saltCheck.ok) {
            // 检测到salt不一致
            Logger(saltCheck.message!, LOG_LEVEL_NOTICE); // ✅ 提示用户
            this.syncStatus = "ERRORED";                  // ✅ 设置错误状态
            this.updateInfo();
            return false;                                  // ⚠️ 只返回false，没有持久化阻止标志！
        }
    }
    // ... 继续同步流程
}
```

**关键问题：**
1. ❌ **没有持久化标志**：`return false`只阻止了这一次replication
2. ❌ **retrying绕过检查**：如果`retrying=true`，完全跳过salt检查
3. ❌ **后续sync不被阻止**：用户修改文件 → 触发新sync → 重新调用`openReplication` → 没有检查就继续同步
4. ❌ **连接仍然有效**：replicator连接已建立，LiveSync模式下会持续同步

**结果：**
```
旧子库（salt已过期）
  ↓
检测到salt不一致 → 提示用户 → return false
  ↓
BUT：标志未持久化
  ↓
用户修改文件/自动重试 → 新的sync请求
  ↓
openReplication() 被再次调用
  ↓
openOneShotReplication(retrying=true) ← 跳过salt检查！
  ↓
同步继续进行 ← 旧数据污染云端！
```

### Livesync正确实现（livesync/src/lib/src）

```typescript
// 第1030-1035行：检测到database reset后设置持久化标志
if (ensure == "CHECKAGAIN") {
    Logger("...", LOG_LEVEL_NOTICE);
    this.remoteLockedAndDeviceNotAccepted = true;  // ← 持久化标志！
    this.remoteLocked = true;
    this.remoteCleaned = true;
    return false;
}
```

```typescript
// livesync/src/modules/core/ModuleReplicator.ts (第238-248行)
// 在每次replication前检查标志
if (this.core.replicator?.remoteLockedAndDeviceNotAccepted) {
    if (this.core.replicator.remoteCleaned && this.settings.useIndexedDBAdapter) {
        await this.cleaned(showMessage);  // ← 自动执行Fetch
    } else {
        // 弹出对话框让用户选择
        const ret = await this.core.confirm.askSelectStringDialogue(
            message,
            [CHOICE_FETCH, CHOICE_UNLOCK, CHOICE_DISMISS]
        );
        // ... 根据用户选择执行操作
    }
    // ← 阻止继续同步！
    return;
}
```

**Livesync的关键设计：**
1. ✅ **持久化标志**：`remoteLockedAndDeviceNotAccepted = true`一直存在
2. ✅ **前置检查**：每次replication前先检查这个标志
3. ✅ **彻底阻止**：标志为true时，完全不进入replication流程
4. ✅ **用户确认**：只有用户执行Fetch/Unlock操作后才清除标志
5. ✅ **数据安全**：确保旧设备不会污染已重置的数据库

## 对比差异总结

| 方面 | Friday当前实现 | Livesync实现 |
|------|---------------|-------------|
| **检测机制** | Salt consistency check | MILESTONE document + node acceptance |
| **检测时机** | 在`openOneShotReplication`中 | 在`checkReplicationConnectivity`中 |
| **持久化标志** | ❌ 无 | ✅ `remoteLockedAndDeviceNotAccepted` |
| **阻止机制** | ⚠️ 单次`return false` | ✅ 前置检查 + 持久化阻止 |
| **retrying绕过** | ⚠️ 会绕过salt检查 | ✅ 标志不会被绕过 |
| **后续sync** | ❌ 不被阻止 | ✅ 完全阻止 |
| **用户操作** | 提示但不强制 | 必须Fetch/Unlock才能恢复 |
| **数据安全** | ❌ 旧设备可能污染云端 | ✅ 彻底阻止污染 |

## 解决方案

### 方案概述

**核心思路：** 引入livesync的持久化标志机制，确保检测到salt不一致后，彻底阻止所有同步操作，直到用户明确执行"Fetch from Server"。

### 实施步骤

#### 1. 在LiveSyncAbstractReplicator中添加持久化标志

**目的：** 记录"设备未被远程接受"的状态

```typescript
// src/sync/core/replication/LiveSyncAbstractReplicator.ts

export abstract class LiveSyncAbstractReplicator {
    syncStatus: DatabaseConnectingStatus = "NOT_CONNECTED";
    // ... existing properties ...
    
    // 新增：持久化标志 - 检测到salt不一致时设置为true
    remoteLockedAndDeviceNotAccepted = false;
    remoteLocked = false;
    remoteCleaned = false;
    
    // 已存在
    tweakSettingsMismatched = false;
    preferredTweakValue?: TweakValues;
}
```

#### 2. 在checkSaltConsistency检测后设置标志

**目的：** Salt不一致时，设置持久化标志

```typescript
// src/sync/core/replication/LiveSyncAbstractReplicator.ts

async checkSaltConsistency(setting: RemoteDBSettings): Promise<SaltCheckResult> {
    const saltKey = this._getKnownSaltKey(setting.couchDB_DBNAME);
    const saltStore = this.env.services.database.openSimpleStore<string>("friday-sync-salt");

    try {
        const remoteSalt = await this.getReplicationPBKDF2Salt(setting, true);
        const remoteSaltBase64 = await arrayBufferToBase64Single(remoteSalt);
        const storedSalt = await saltStore.get(saltKey);

        if (!storedSalt) {
            Logger(`First sync detected, storing initial salt`, LOG_LEVEL_VERBOSE);
            await saltStore.set(saltKey, remoteSaltBase64);
            return { ok: true, needsFetch: false };
        }

        // 比较salts
        if (storedSalt !== remoteSaltBase64) {
            Logger(`Salt mismatch detected! Stored: ${storedSalt.substring(0, 16)}..., Remote: ${remoteSaltBase64.substring(0, 16)}...`, LOG_LEVEL_INFO);
            
            // 🔴 新增：设置持久化标志，阻止所有后续同步
            this.remoteLockedAndDeviceNotAccepted = true;
            this.remoteLocked = true;
            this.remoteCleaned = true;  // 需要从远程重新获取数据
            
            return {
                ok: false,
                message: $msg("fridaySync.saltChanged.message"),
                needsFetch: true,
            };
        }

        Logger(`Salt consistency check passed`, LOG_LEVEL_VERBOSE);
        return { ok: true, needsFetch: false };
    } catch (ex) {
        Logger($msg("fridaySync.saltCheck.failed"), LOG_LEVEL_VERBOSE);
        Logger(ex, LOG_LEVEL_VERBOSE);
        return { ok: true, needsFetch: false };
    }
}
```

#### 3. 在openReplication开始时检查标志

**目的：** 前置检查，彻底阻止同步

```typescript
// src/sync/core/replication/couchdb/LiveSyncReplicator.ts

async openReplication(
    setting: RemoteDBSettings,
    keepAlive: boolean,
    showResult: boolean,
    ignoreCleanLock: boolean
) {
    // 🔴 新增：前置检查 - 如果设备未被接受，阻止所有同步操作
    if (!ignoreCleanLock && this.remoteLockedAndDeviceNotAccepted) {
        Logger(
            $msg("fridaySync.saltChanged.syncBlocked") || 
            "Synchronization is blocked because the remote database has been reset. Please use 'Fetch from Server' in Settings to re-sync.",
            LOG_LEVEL_NOTICE
        );
        this.syncStatus = "ERRORED";
        this.updateInfo();
        return false;
    }
    
    await this.initializeDatabaseForReplication();
    if (keepAlive) {
        void this.openContinuousReplication(setting, showResult, false);
    } else {
        return this.openOneShotReplication(setting, showResult, false, "sync", ignoreCleanLock);
    }
}
```

**关键点：**
- `if (!ignoreCleanLock && this.remoteLockedAndDeviceNotAccepted)` - 只要标志为true，立即阻止
- 在`initializeDatabaseForReplication()`之前检查，避免建立连接
- `ignoreCleanLock`参数允许特定操作（如Fetch/Unlock）绕过检查

#### 4. 在openOneShotReplication中也检查标志（双重保险）

**目的：** 防御性编程，确保标志被尊重

```typescript
// src/sync/core/replication/couchdb/LiveSyncReplicator.ts

async openOneShotReplication(
    setting: RemoteDBSettings,
    showResult: boolean,
    retrying: boolean,
    syncMode: "sync" | "pullOnly" | "pushOnly",
    ignoreCleanLock = false
) {
    // 🔴 新增：双重检查（防御性编程）
    if (!ignoreCleanLock && this.remoteLockedAndDeviceNotAccepted) {
        Logger("Sync blocked: device not accepted by remote", LOG_LEVEL_INFO);
        this.syncStatus = "ERRORED";
        this.updateInfo();
        return false;
    }
    
    // 原有PBKDF2检查
    if ((await this.ensurePBKDF2Salt(setting, showResult, !retrying)) === false) {
        // ...
    }

    // 原有Salt consistency检查
    if (!retrying) {
        const saltCheck = await this.checkSaltConsistency(setting);
        if (!saltCheck.ok) {
            // checkSaltConsistency已经设置了remoteLockedAndDeviceNotAccepted
            Logger(saltCheck.message!, LOG_LEVEL_NOTICE);
            this.syncStatus = "ERRORED";
            this.updateInfo();
            return false;
        }
    }

    // ... 继续同步流程
}
```

#### 5. 在rebuildLocalFromRemote成功后清除标志

**目的：** Fetch from Server成功后，允许设备重新同步

```typescript
// src/sync/FridaySyncCore.ts

async rebuildLocalFromRemote(): Promise<boolean> {
    const originalSuspendParseState = this._settings.suspendParseReplicationResult;
    const originalSuspendFileWatchingState = this._settings.suspendFileWatching;

    try {
        // ... 执行rebuild流程 ...
        
        // Phase N: Rebuild成功后，清除"device not accepted"标志
        Logger("Rebuild completed successfully! Clearing device acceptance flags...", LOG_LEVEL_NOTICE);
        if (this._replicator) {
            this._replicator.remoteLockedAndDeviceNotAccepted = false;
            this._replicator.remoteLocked = false;
            this._replicator.remoteCleaned = false;
        }
        
        // Update stored salt to match the new remote salt
        // 这样设备就"接受"了新的salt
        await this._replicator?.updateStoredSalt(this._settings);
        Logger("Device is now accepted by remote database", LOG_LEVEL_INFO);
        
        // Phase N+1: Restart sync if it was running
        if (this._settings.liveSync) {
            await this.startSync(true);
        }
        return true;
    } catch (error) {
        Logger("Rebuild from remote failed", LOG_LEVEL_NOTICE);
        Logger(error, LOG_LEVEL_VERBOSE);
        this._settings.suspendParseReplicationResult = originalSuspendParseState;
        this._settings.suspendFileWatching = originalSuspendFileWatchingState;
        return false;
    }
}
```

#### 6. 在markRemoteResolved中也清除标志

**目的：** 允许用户手动"解锁"设备

```typescript
// src/sync/core/replication/couchdb/LiveSyncReplicator.ts

async markRemoteResolved(setting: RemoteDBSettings): Promise<boolean> {
    try {
        // ... 原有逻辑：标记设备为accepted ...
        
        // 🔴 新增：清除blocking标志
        this.remoteLockedAndDeviceNotAccepted = false;
        this.remoteLocked = false;
        this.remoteCleaned = false;
        
        Logger("Device marked as resolved and accepted by remote", LOG_LEVEL_INFO);
        return true;
    } catch (ex) {
        Logger("Failed to mark remote as resolved", LOG_LEVEL_INFO);
        Logger(ex, LOG_LEVEL_VERBOSE);
        return false;
    }
}
```

#### 7. 在startSync中检查标志并引导用户

**目的：** 用户友好的错误提示和恢复引导

```typescript
// src/sync/FridaySyncCore.ts

async startSync(
    continuous: boolean = true,
    options?: {
        reason?: "PLUGIN_STARTUP" | "AUTO_RECONNECT" | "NETWORK_RECOVERY";
        forceCheck?: boolean;
    }
): Promise<boolean> {
    if (!this._replicator) {
        this.setStatus("ERRORED", "Replicator not initialized");
        return false;
    }

    // 🔴 新增：前置检查 - 如果设备被锁定，阻止sync并引导用户
    if (this._replicator.remoteLockedAndDeviceNotAccepted) {
        Logger(
            $msg("fridaySync.saltChanged.actionRequired") || 
            "Remote database has been reset. Please go to Settings → 'Fetch from Server' to re-sync your vault.",
            LOG_LEVEL_NOTICE
        );
        this.setStatus("ERRORED", "Device not accepted - Fetch required");
        return false;
    }

    // ... 原有启动逻辑 ...
}
```

#### 8. 添加i18n消息

**英文 (en.json):**
```json
{
    "fridaySync.saltChanged.syncBlocked": "Synchronization is blocked because the remote database has been reset. Please use 'Fetch from Server' in Settings to re-sync.",
    "fridaySync.saltChanged.actionRequired": "Remote database has been reset. Please go to Settings → 'Fetch from Server' to re-sync your vault.",
    "fridaySync.saltChanged.deviceAccepted": "Device is now accepted by remote database. Synchronization can continue.",
    "fridaySync.saltChanged.clearingFlags": "Clearing device acceptance flags after successful rebuild..."
}
```

**中文 (zh.json):**
```json
{
    "fridaySync.saltChanged.syncBlocked": "由于远程数据库已被重置，同步已被阻止。请前往设置→"从云端下载"来重新同步。",
    "fridaySync.saltChanged.actionRequired": "远程数据库已被重置。请前往设置→"从云端下载"来重新同步您的库。",
    "fridaySync.saltChanged.deviceAccepted": "设备已被远程数据库接受。可以继续同步。",
    "fridaySync.saltChanged.clearingFlags": "成功重建后正在清除设备接受标志..."
}
```

## 流程对比

### Before（有缺陷）

```
旧子库启动
  ↓
startSync()
  ↓
openReplication()
  ↓
openOneShotReplication()
  ↓
checkSaltConsistency() → salt不一致
  ↓
return false ← 只是返回false
  ↓
用户修改文件 → 触发新sync
  ↓
openReplication() ← 没有任何检查！
  ↓
继续同步 ← 污染云端！
```

### After（修复后）

```
旧子库启动
  ↓
startSync()
  ↓
🔴 检查 remoteLockedAndDeviceNotAccepted === true?
  ↓ YES
阻止sync + 提示用户"请执行Fetch from Server"
  ↓
用户修改文件 → 触发新sync
  ↓
startSync()
  ↓
🔴 检查 remoteLockedAndDeviceNotAccepted === true?
  ↓ YES
再次阻止 ← 标志持久化！
  ↓
用户前往Settings → 点击"Fetch from Server"
  ↓
rebuildLocalFromRemote()
  ↓
成功 → 清除 remoteLockedAndDeviceNotAccepted
       更新stored salt
  ↓
设备被接受 ← 可以继续同步
```

## 关键设计要点

### 1. 标志的持久性
- `remoteLockedAndDeviceNotAccepted`是replicator的实例属性
- 一旦设置为true，会一直存在直到明确清除
- 不会因为重试、重新连接而被重置

### 2. 多层防护
- **Layer 1**: `startSync()` - 最外层检查，用户友好提示
- **Layer 2**: `openReplication()` - 阻止建立replication连接
- **Layer 3**: `openOneShotReplication()` - 防御性编程，双重保险

### 3. 清除时机
只有在以下情况下才清除标志：
1. **Fetch from Server成功** (`rebuildLocalFromRemote`)
2. **用户手动Unlock** (`markRemoteResolved`)

### 4. 绕过机制
`ignoreCleanLock`参数允许特定操作绕过检查：
- `rebuildLocalFromRemote`需要连接远程来fetch数据
- `markRemoteResolved`需要连接远程来标记设备
- 这些操作必须能绕过lock

## 测试场景

### 场景1：旧子库不能污染主库（核心场景）
1. 主库执行RESET → 新salt
2. 旧子库启动 → 检测到salt不一致
3. **预期**：
   - ✅ 设置`remoteLockedAndDeviceNotAccepted = true`
   - ✅ 提示用户"请执行Fetch from Server"
   - ✅ 阻止所有同步操作
4. 旧子库修改文件（删除/新增）
5. **预期**：
   - ✅ sync被阻止（标志仍然为true）
   - ✅ 不会上传到云端
   - ✅ 主库不受影响

### 场景2：Fetch后恢复正常
1. 接场景1，旧子库被阻止
2. 用户点击"Fetch from Server"
3. **预期**：
   - ✅ `rebuildLocalFromRemote`成功执行（ignoreCleanLock=true）
   - ✅ 清除`remoteLockedAndDeviceNotAccepted`
   - ✅ 更新stored salt
4. 旧子库变成正常子库
5. **预期**：
   - ✅ sync恢复正常
   - ✅ 可以同步新数据

### 场景3：首次同步（无stored salt）
1. 全新设备，从云端下载
2. **预期**：
   - ✅ `checkSaltConsistency`检测到无stored salt
   - ✅ 保存当前remote salt
   - ✅ 不设置lock标志
   - ✅ 正常同步

### 场景4：正常同步（salt一致）
1. 设备正常启动，salt未变化
2. **预期**：
   - ✅ `checkSaltConsistency`通过
   - ✅ 不设置lock标志
   - ✅ 正常同步

## 与Livesync的对齐程度

| 功能 | Friday实现 | Livesync实现 | 对齐度 |
|------|-----------|-------------|--------|
| 检测机制 | Salt consistency | MILESTONE document | ⚠️ 不同但等效 |
| 持久化标志 | `remoteLockedAndDeviceNotAccepted` | 同名 | ✅ 完全一致 |
| 前置检查 | `startSync/openReplication` | `ModuleReplicator` | ✅ 一致 |
| 阻止逻辑 | 多层检查 + return false | 同样 | ✅ 一致 |
| 清除时机 | Fetch成功 | Fetch/Unlock | ✅ 一致 |
| 用户体验 | Notice提示 + 引导 | Dialog选择 | ⚠️ 简化但合理 |

## 总结

**问题：** 旧子库能污染已重置的主库

**根本原因：** Salt检查后没有持久化阻止标志

**解决方案：** 引入`remoteLockedAndDeviceNotAccepted`持久化标志，在多个层级检查并阻止同步

**数据安全保证：** 标志一旦设置，彻底阻止所有sync操作，直到用户明确执行Fetch/Unlock

**用户体验：** 清晰提示问题原因和恢复步骤

**代码对齐：** 与livesync的设计完全对齐，使用相同的标志名和阻止机制

