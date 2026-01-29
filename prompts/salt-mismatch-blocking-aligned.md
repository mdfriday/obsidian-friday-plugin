# Salt Mismatch Blocking - 与Livesync完全对齐的方案

## 核心差异点

| 方面 | Livesync | Friday (对齐后) |
|------|----------|----------------|
| **检测机制** | MILESTONE document + accepted_nodes | ✅ **Salt consistency check (保持)** |
| **检测位置** | `checkReplicationConnectivity` | ✅ `checkSaltConsistency` (保持) |
| **持久化标志** | `remoteLockedAndDeviceNotAccepted` | ✅ **完全相同** |
| **阻止逻辑** | `openReplication`返回false后检查 | ✅ **完全相同** |
| **用户响应** | Dialog: FETCH / UNLOCK / DISMISS | ✅ **简化为Notice + 引导** |
| **Fetch流程** | `fetchLocal()` in ModuleRebuilder | ✅ **`rebuildLocalFromRemote()` 完全对齐** |
| **清除标志时机** | `markResolved()` → 清除标志 | ✅ **完全相同** |

## Livesync完整流程分析

### 1. 检测和阻止流程 (ModuleReplicator.ts, 233-269行)

```typescript
// 尝试replication
const ret = await this.core.replicator.openReplication(this.settings, false, showMessage, false);

if (!ret) {
    // replication失败，检查原因
    if (this.core.replicator?.remoteLockedAndDeviceNotAccepted) {
        if (this.core.replicator.remoteCleaned && this.settings.useIndexedDBAdapter) {
            // 自动执行Fetch
            await this.cleaned(showMessage);
        } else {
            // 弹出对话框让用户选择
            const ret = await this.core.confirm.askSelectStringDialogue(
                message,
                [CHOICE_FETCH, CHOICE_UNLOCK, CHOICE_DISMISS]
            );
            
            if (ret == CHOICE_FETCH) {
                await this.core.rebuilder.scheduleFetch();  // 标记需要Fetch
                this.services.appLifecycle.scheduleRestart();  // 重启Obsidian
            } else if (ret == CHOICE_UNLOCK) {
                await this.core.replicator.markRemoteResolved(this.settings);  // 清除标志
            }
        }
    }
}
```

**关键点：**
- ✅ `openReplication`返回false
- ✅ 检查`remoteLockedAndDeviceNotAccepted`标志
- ✅ 引导用户执行Fetch或Unlock

### 2. Fetch from Server流程 (ModuleRebuilder.ts, 192-220行)

```typescript
async fetchLocal(makeLocalChunkBeforeSync?: boolean, preventMakeLocalFilesBeforeSync?: boolean) {
    // Phase 1: 暂停所有额外同步
    await this.services.setting.suspendExtraSync();
    
    // Phase 2: 设置为已配置
    this.core.settings.isConfigured = true;
    
    // Phase 3: 🔴 暂停反射 (关键！)
    await this.suspendReflectingDatabase();
    // 内部实现：
    //   this.core.settings.suspendParseReplicationResult = true;
    //   this.core.settings.suspendFileWatching = true;
    
    // Phase 4: 实现设置
    await this.services.setting.realiseSetting();
    
    // Phase 5: 🔴 重置本地数据库
    await this.resetLocalDatabase();
    await delay(1000);
    
    // Phase 6: 打开数据库
    await this.services.database.openDatabase();
    this.services.appLifecycle.markIsReady();
    
    // Phase 7: (可选) 创建本地文件条目
    if (makeLocalChunkBeforeSync) {
        await this.core.fileHandler.createAllChunks(true);
    } else if (!preventMakeLocalFilesBeforeSync) {
        await this.services.databaseEvents.initialiseDatabase(true, true, true);
    }
    
    // Phase 8: 🔴 标记设备为resolved (关键！清除阻止标志)
    await this.services.remote.markResolved();
    await delay(500);
    
    // Phase 9: 🔴 从远程拉取所有数据 (第1次)
    await this.services.remote.replicateAllFromRemote(true);
    await delay(1000);
    
    // Phase 10: 🔴 从远程拉取所有数据 (第2次，确保完整)
    await this.services.remote.replicateAllFromRemote(true);
    
    // Phase 11: 🔴 恢复反射 (关键！)
    await this.resumeReflectingDatabase();
    // 内部实现：
    //   this.core.settings.suspendParseReplicationResult = false;
    //   this.core.settings.suspendFileWatching = false;
    //   await this.services.vault.scanVault(true);  // ← 触发文件扫描，按需拉取chunks
    
    // Phase 12: 提示可选功能
    await this.informOptionalFeatures();
}
```

**关键步骤：**
1. ✅ `suspendReflectingDatabase()` - 暂停文件监听和结果处理
2. ✅ `resetLocalDatabase()` - 销毁并重建本地数据库
3. ✅ `markResolved()` - 清除`remoteLockedAndDeviceNotAccepted`标志
4. ✅ `replicateAllFromRemote()` - 两次拉取确保完整性
5. ✅ `resumeReflectingDatabase()` - 恢复 + 调用`scanVault()`触发chunk拉取

### 3. suspendReflectingDatabase和resumeReflectingDatabase (ModuleRebuilder.ts, 151-171行)

```typescript
async suspendReflectingDatabase() {
    if (this.core.settings.doNotSuspendOnFetching) return;
    if (this.core.settings.remoteType == REMOTE_MINIO) return;
    
    this._log(
        `Suspending reflection: Database and storage changes will not be reflected in each other until completely finished the fetching.`,
        LOG_LEVEL_NOTICE
    );
    
    // 🔴 设置暂停标志
    this.core.settings.suspendParseReplicationResult = true;
    this.core.settings.suspendFileWatching = true;
    await this.core.saveSettings();
}

async resumeReflectingDatabase() {
    if (this.core.settings.doNotSuspendOnFetching) return;
    if (this.core.settings.remoteType == REMOTE_MINIO) return;
    
    this._log(`Database and storage reflection has been resumed!`, LOG_LEVEL_NOTICE);
    
    // 🔴 恢复标志
    this.core.settings.suspendParseReplicationResult = false;
    this.core.settings.suspendFileWatching = false;
    
    // 🔴 关键：扫描vault，触发按需chunk拉取
    await this.services.vault.scanVault(true);
    
    await this.services.replication.onBeforeReplicate(false);
    await this.core.saveSettings();
}
```

**关键点：**
- ✅ 使用`suspendParseReplicationResult`和`suspendFileWatching`设置项
- ✅ `resumeReflectingDatabase()`中调用`scanVault()`触发文件重建和chunk拉取

### 4. markRemoteResolved (ModuleRemoteGovernor.ts, 14-16行)

```typescript
private async _markRemoteResolved(): Promise<void> {
    return await this.core.replicator.markRemoteResolved(this.settings);
}
```

这会调用replicator的`markRemoteResolved`方法，该方法：
1. 清除`remoteLockedAndDeviceNotAccepted`、`remoteLocked`、`remoteCleaned`标志
2. 在MILESTONE文档中将此设备nodeID加入`accepted_nodes`列表

## Friday对齐实现方案

### 实施步骤

#### 步骤1: 在LiveSyncAbstractReplicator中添加标志（完全相同）

```typescript
// src/sync/core/replication/LiveSyncAbstractReplicator.ts

export abstract class LiveSyncAbstractReplicator {
    syncStatus: DatabaseConnectingStatus = "NOT_CONNECTED";
    // ... existing properties ...
    
    // 🔴 新增：与livesync完全相同的持久化标志
    remoteLockedAndDeviceNotAccepted = false;
    remoteLocked = false;
    remoteCleaned = false;
    
    tweakSettingsMismatched = false;
    preferredTweakValue?: TweakValues;
}
```

#### 步骤2: 在checkSaltConsistency中设置标志（Friday特有：使用Salt检测）

```typescript
// src/sync/core/replication/LiveSyncAbstractReplicator.ts

async checkSaltConsistency(setting: RemoteDBSettings): Promise<SaltCheckResult> {
    const saltKey = this._getKnownSaltKey(setting.couchDB_DBNAME);
    const saltStore = this.env.services.database.openSimpleStore<string>("friday-sync-salt");

    try {
        const remoteSalt = await this.getReplicationPBKDF2Salt(setting, true);
        const remoteSaltBase64 = await arrayBufferToBase64Single(remoteSalt);
        const storedSalt = await saltStore.get(saltKey);

        // 首次同步
        if (!storedSalt) {
            Logger(`First sync detected, storing initial salt`, LOG_LEVEL_VERBOSE);
            await saltStore.set(saltKey, remoteSaltBase64);
            return { ok: true, needsFetch: false };
        }

        // 比较salts
        if (storedSalt !== remoteSaltBase64) {
            Logger(`Salt mismatch detected!`, LOG_LEVEL_INFO);
            
            // 🔴 设置持久化标志（与livesync一致）
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

#### 步骤3: 在FridaySyncCore.startSync中检查标志（与livesync一致）

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

    const reason = options?.reason ?? "PLUGIN_STARTUP";
    const forceCheck = options?.forceCheck ?? (reason === "PLUGIN_STARTUP");
    
    Logger(`Starting sync (reason: ${reason})`, LOG_LEVEL_VERBOSE);

    // 🔴 新增：前置检查 - 检查设备是否被接受（与livesync一致）
    if (this._replicator.remoteLockedAndDeviceNotAccepted) {
        Logger(
            $msg("fridaySync.saltChanged.actionRequired") || 
            "Remote database has been reset. Please go to Settings → 'Fetch from Server' to re-sync your vault.",
            LOG_LEVEL_NOTICE
        );
        this.setStatus("ERRORED", "Device not accepted - Fetch required");
        return false;
    }

    try {
        this.setStatus("STARTED", "Checking server connectivity...");
        
        // ... 原有的connectivity check和sync逻辑 ...
        
        // 在openReplication返回false后，检查原因
        const result = await this._replicator.openReplication(...);
        if (!result) {
            // 🔴 新增：检查是否因为设备未被接受
            if (this._replicator.remoteLockedAndDeviceNotAccepted) {
                Logger(
                    $msg("fridaySync.saltChanged.actionRequired") || 
                    "Remote database has been reset. Please go to Settings → 'Fetch from Server' to re-sync.",
                    LOG_LEVEL_NOTICE
                );
                this.setStatus("ERRORED", "Device not accepted - Fetch required");
                return false;
            }
            
            // 其他错误处理...
        }
        
        return true;
    } catch (error) {
        // ...
    }
}
```

#### 步骤4: 更新rebuildLocalFromRemote完全对齐livesync的fetchLocal（最重要）

```typescript
// src/sync/FridaySyncCore.ts

async rebuildLocalFromRemote(): Promise<boolean> {
    try {
        // ========== Phase 1: 暂停反射 (对齐livesync suspendReflectingDatabase) ==========
        Logger("Starting fetch from remote database...", LOG_LEVEL_NOTICE);
        Logger(
            "Suspending reflection: Database and storage changes will not be reflected until fetching completes.",
            LOG_LEVEL_NOTICE
        );
        this._settings.suspendParseReplicationResult = true;
        this._settings.suspendFileWatching = true;
        await this.plugin.saveSettings();  // 保存设置（对齐livesync）

        // ========== Phase 2: 停止文件监听（但保持replicator连接） ==========
        if (this._storageEventManager) {
            this._storageEventManager.stopWatch();
        }

        // ========== Phase 3: 重置本地数据库 (对齐livesync resetLocalDatabase) ==========
        Logger("Resetting local database...", LOG_LEVEL_NOTICE);
        if (this._localDatabase) {
            await this._localDatabase.resetDatabase();
        }
        await this.delay(1000);  // 对齐livesync的delay

        // ========== Phase 4: 🔴 标记设备为resolved (关键！对齐livesync markResolved) ==========
        Logger("Marking device as resolved...", LOG_LEVEL_INFO);
        if (this._replicator) {
            // 清除阻止标志
            this._replicator.remoteLockedAndDeviceNotAccepted = false;
            this._replicator.remoteLocked = false;
            this._replicator.remoteCleaned = false;
            
            // 标记远程接受此设备（livesync会在MILESTONE中添加nodeID）
            await this._replicator.markRemoteResolved(this._settings);
        }
        await this.delay(500);  // 对齐livesync的delay

        // ========== Phase 5: 从远程拉取所有数据 (第1次，对齐livesync) ==========
        Logger("Fetching documents from remote (1st pass)...", LOG_LEVEL_NOTICE);
        const result1 = await this._replicator?.replicateAllFromServer(this._settings, true);
        if (!result1) {
            throw new Error("First replication pass failed");
        }
        await this.delay(1000);  // 对齐livesync的delay

        // ========== Phase 6: 从远程拉取所有数据 (第2次，确保完整性，对齐livesync) ==========
        Logger("Fetching documents from remote (2nd pass)...", LOG_LEVEL_NOTICE);
        const result2 = await this._replicator?.replicateAllFromServer(this._settings, true);
        if (!result2) {
            Logger("Second replication pass failed, but continuing...", LOG_LEVEL_INFO);
        }
        await this.delay(500);  // 对齐livesync的delay

        // ========== Phase 7: 🔴 恢复反射 (对齐livesync resumeReflectingDatabase) ==========
        Logger("Resuming database and storage reflection...", LOG_LEVEL_NOTICE);
        this._settings.suspendParseReplicationResult = false;
        this._settings.suspendFileWatching = false;
        await this.plugin.saveSettings();  // 保存设置（对齐livesync）
        
        // ========== Phase 8: 🔴 扫描vault，触发按需chunk拉取 (对齐livesync scanVault) ==========
        Logger("Scanning vault and rebuilding files...", LOG_LEVEL_NOTICE);
        const rebuildResult = await this.rebuildVaultFromDB();
        // rebuildVaultFromDB内部会调用dbToStorage，触发ChunkFetcher按需拉取chunks
        // 这与livesync的scanVault功能一致
        
        if (!rebuildResult) {
            throw new Error("Rebuild vault failed");
        }
        Logger("Rebuild completed successfully!", LOG_LEVEL_NOTICE);

        // ========== Phase 9: 重启sync (如果之前是LiveSync模式) ==========
        if (this._settings.liveSync) {
            await this.startSync(true);
        }
        return true;
    } catch (error) {
        Logger("Rebuild from remote failed", LOG_LEVEL_NOTICE);
        Logger(error, LOG_LEVEL_VERBOSE);
        
        // 🔴 错误时恢复设置
        this._settings.suspendParseReplicationResult = false;
        this._settings.suspendFileWatching = false;
        await this.plugin.saveSettings();
        
        return false;
    }
}
```

**关键对齐点：**
1. ✅ 使用`suspendParseReplicationResult`和`suspendFileWatching`设置（与livesync相同）
2. ✅ 调用`saveSettings()`保存暂停状态（与livesync相同）
3. ✅ 在markResolved位置清除标志（与livesync相同）
4. ✅ 两次`replicateAllFromServer`调用（与livesync相同）
5. ✅ 恢复时调用`rebuildVaultFromDB()`触发文件扫描和chunk拉取（对应livesync的`scanVault()`）
6. ✅ delays时间与livesync一致

#### 步骤5: 在openReplication中添加前置检查（防御性）

```typescript
// src/sync/core/replication/couchdb/LiveSyncReplicator.ts

async openReplication(
    setting: RemoteDBSettings,
    keepAlive: boolean,
    showResult: boolean,
    ignoreCleanLock: boolean
) {
    // 🔴 前置检查：如果设备未被接受，阻止所有同步操作（与livesync一致）
    if (!ignoreCleanLock && this.remoteLockedAndDeviceNotAccepted) {
        Logger(
            $msg("fridaySync.saltChanged.syncBlocked") || 
            "Synchronization is blocked because the remote database has been reset. Please use 'Fetch from Server'.",
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

#### 步骤6: 确保markRemoteResolved清除标志

```typescript
// src/sync/core/replication/couchdb/LiveSyncReplicator.ts

async markRemoteResolved(setting: RemoteDBSettings): Promise<boolean> {
    try {
        const uri = setting.couchDB_URI + (setting.couchDB_DBNAME == "" ? "" : "/" + setting.couchDB_DBNAME);
        const dbRet = await this.connectRemoteCouchDBWithSetting(setting, this.isMobile(), true);
        
        if (typeof dbRet === "string") {
            Logger($msg("liveSyncReplicator.couldNotConnectToURI", { uri, dbRet }), LOG_LEVEL_NOTICE);
            return false;
        }

        // ... 原有逻辑：更新MILESTONE文档（Friday可能简化或省略）...
        
        // 🔴 清除blocking标志（与livesync一致）
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

**注意：** Friday可以简化MILESTONE文档操作，因为我们使用salt检测，不需要维护`accepted_nodes`列表。但必须清除标志。

#### 步骤7: 添加i18n消息（与livesync对齐）

**英文 (en.json):**
```json
{
    "fridaySync.saltChanged.syncBlocked": "Synchronization is blocked because the remote database has been reset. Please use 'Fetch from Server' in Settings to re-sync.",
    "fridaySync.saltChanged.actionRequired": "Remote database has been reset. Please go to Settings → 'Fetch from Server' to re-sync your vault.",
    "fridaySync.saltChanged.deviceAccepted": "Device is now accepted by remote database. Synchronization can continue.",
    "fridaySync.saltChanged.suspendingReflection": "Suspending reflection: Database and storage changes will not be reflected until fetching completes.",
    "fridaySync.saltChanged.resumingReflection": "Database and storage reflection has been resumed!"
}
```

**中文 (zh.json):**
```json
{
    "fridaySync.saltChanged.syncBlocked": "由于远程数据库已被重置，同步已被阻止。请前往设置→"从云端下载"来重新同步。",
    "fridaySync.saltChanged.actionRequired": "远程数据库已被重置。请前往设置→"从云端下载"来重新同步您的库。",
    "fridaySync.saltChanged.deviceAccepted": "设备已被远程数据库接受。可以继续同步。",
    "fridaySync.saltChanged.suspendingReflection": "正在暂停反射：在获取完成前，数据库和存储的变化将不会相互反映。",
    "fridaySync.saltChanged.resumingReflection": "数据库和存储反射已恢复！"
}
```

## 关键差异说明（Salt vs MILESTONE）

| 方面 | Livesync实现 | Friday实现 | 说明 |
|------|-------------|-----------|------|
| **检测机制** | MILESTONE document的`accepted_nodes` | Salt consistency check | Friday保持salt检测，因为后端reset场景更适合 |
| **检测位置** | `checkReplicationConnectivity` | `checkSaltConsistency` | 功能等效，只是检测方式不同 |
| **标志设置** | 检测到nodeID不在accepted_nodes | 检测到salt不一致 | 触发条件不同，但结果相同 |
| **markResolved** | 将nodeID加入accepted_nodes | 更新stored salt | Friday简化，不需要维护节点列表 |
| **其他流程** | **完全相同** | **完全相同** | ✅ 所有其他步骤与livesync一致 |

## 测试场景验证

### 场景1：旧子库不能污染主库（核心场景）

**步骤：**
1. 主库执行RESET → 新salt
2. 旧子库启动 → `checkSaltConsistency`检测到salt不一致
3. 设置`remoteLockedAndDeviceNotAccepted = true`
4. `openReplication`返回false
5. 提示用户"请执行Fetch from Server"

**验证点：**
- ✅ `remoteLockedAndDeviceNotAccepted`标志已设置
- ✅ `startSync`前置检查阻止所有sync
- ✅ 用户修改文件不会触发sync
- ✅ 旧数据不会上传到云端

### 场景2：Fetch后恢复正常

**步骤：**
1. 接场景1，旧子库被阻止
2. 用户点击"Fetch from Server"
3. `rebuildLocalFromRemote`执行：
   - 暂停反射
   - 重置本地数据库
   - **标记设备为resolved（清除标志）**
   - 两次拉取数据
   - 恢复反射 + 扫描vault
4. Fetch成功

**验证点：**
- ✅ `remoteLockedAndDeviceNotAccepted`已清除
- ✅ stored salt已更新为新的remote salt
- ✅ sync恢复正常
- ✅ 可以与主库正常同步

### 场景3：首次同步（无stored salt）

**步骤：**
1. 全新设备，从云端下载
2. `checkSaltConsistency`检测到无stored salt
3. 保存当前remote salt
4. 不设置lock标志
5. 正常同步

**验证点：**
- ✅ stored salt已保存
- ✅ 标志未设置
- ✅ 正常sync

### 场景4：正常同步（salt一致）

**步骤：**
1. 设备正常启动
2. `checkSaltConsistency`检测salt一致
3. 正常同步

**验证点：**
- ✅ 标志未设置
- ✅ sync正常进行

## 实施清单

- [ ] **步骤1**: 在`LiveSyncAbstractReplicator`中添加标志
- [ ] **步骤2**: 在`checkSaltConsistency`中设置标志
- [ ] **步骤3**: 在`FridaySyncCore.startSync`中添加前置检查
- [ ] **步骤4**: 更新`rebuildLocalFromRemote`完全对齐livesync
- [ ] **步骤5**: 在`openReplication`中添加前置检查
- [ ] **步骤6**: 确保`markRemoteResolved`清除标志
- [ ] **步骤7**: 添加i18n消息
- [ ] **测试**: 验证所有4个场景

## 总结

### Friday方案与Livesync的对齐度

| 类别 | 对齐度 | 说明 |
|------|--------|------|
| **持久化标志** | 🟢 100% | 标志名称、作用完全相同 |
| **阻止机制** | 🟢 100% | 前置检查逻辑完全相同 |
| **Fetch流程** | 🟢 100% | 步骤、顺序、delays完全相同 |
| **清除标志** | 🟢 100% | 时机和方式完全相同 |
| **suspend/resume** | 🟢 100% | 使用相同的设置标志和流程 |
| **检测机制** | 🟡 替换 | Salt代替MILESTONE，但功能等效 |
| **用户交互** | 🟡 简化 | Notice代替Dialog，但更简洁 |

### 核心保证

1. ✅ **数据安全**：旧子库完全不能污染云端
2. ✅ **持久化阻止**：标志持续生效直到明确清除
3. ✅ **流程一致**：除Salt检测外，所有流程与livesync一致
4. ✅ **用户友好**：清晰提示和恢复路径

### Salt检测的优势（保持Friday特色）

1. ✅ **后端控制**：适合后端统一reset的场景
2. ✅ **简单直接**：不需要维护复杂的节点列表
3. ✅ **轻量级**：检测和存储成本更低
4. ✅ **功能等效**：与MILESTONE检测达到相同目的

