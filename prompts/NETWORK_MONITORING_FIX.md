# 网络监控启动时机优化

## 问题背景

之前的实现中，`initializeSyncService()` 接受 `autoStart` 参数来控制是否自动启动同步。这导致了问题：

1. **VPN 网络不稳定场景**: RESET 后设置 `autoStart=false`，但网络监控仍会启动
2. **网络恢复自动同步**: 用户在 VPN 环境下，网络恢复时 `handleNetworkRecovery()` 会自动触发同步
3. **用户失去控制**: 用户还没点击"上传到云端"按钮，系统就自动开始上传

**根本原因**: 问题不在于 `autoStart` 参数，而在于**网络监控启动时机不合理**。

---

## 解决方案

### 核心思路

**网络监控应该在合适的时机启动，而不是在初始化时就启动**

启动时机规则：
1. ✅ **首次上传后**: 母库第一次激活，点击"上传数据"，成功后启动网络监控
2. ✅ **首次下载后**: 子库第一次激活，点击"下载数据"，成功后启动网络监控
3. ✅ **非首次场景**: 正常启动同步时，自动启动网络监控

---

## 代码修改

### 1. 删除 `autoStart` 参数 (main.ts)

**修改前:**
```typescript
async initializeSyncService(autoStart: boolean = true) {
    // ...
    if (autoStart && this.settings.syncConfig.syncOnStart) {
        await this.syncService.startSync(true);
    }
}
```

**修改后:**
```typescript
async initializeSyncService() {
    // ...
    if (this.settings.syncConfig.syncOnStart) {
        await this.syncService.startSync(true);
    }
}
```

**理由**: 
- 简化接口，去除冗余参数
- 网络监控的控制不应该通过这个参数

---

### 2. 延迟网络监控启动 (FridaySyncCore.ts)

#### 2.1 添加标志位跟踪状态

```typescript
// Track if network monitoring has been started (to avoid duplicate starts)
private _networkMonitoringStarted: boolean = false;
```

#### 2.2 在 `initialize()` 中不启动网络监控

**修改前:**
```typescript
// Register network event listeners
this._networkEvents.registerEvents();

// Start connection monitoring
this._connectionMonitor.startMonitoring();
```

**修改后:**
```typescript
// NOTE: Network event listeners and connection monitoring are NOT started here
// They will be started by startNetworkMonitoring() after:
// - First-time upload completes (rebuildRemote)
// - First-time download completes (fetchFromServer)
// - Or automatically if not first-time scenario

Logger("Network error handling modules initialized (monitoring not started yet)", LOG_LEVEL_INFO);
```

#### 2.3 添加网络监控控制方法

```typescript
/**
 * Start network monitoring (event listeners and connection monitoring)
 * 
 * This should be called:
 * - After first-time upload completes (rebuildRemote)
 * - After first-time download completes (fetchFromServer)
 * - Automatically during normal sync startup (if not first-time)
 */
startNetworkMonitoring(): void {
    if (this._networkMonitoringStarted) {
        Logger("Network monitoring already started", LOG_LEVEL_VERBOSE);
        return;
    }
    
    // Register network event listeners
    if (this._networkEvents) {
        this._networkEvents.registerEvents();
    }
    
    // Start connection monitoring
    if (this._connectionMonitor) {
        this._connectionMonitor.startMonitoring();
    }
    
    this._networkMonitoringStarted = true;
    Logger("Network monitoring started (auto-reconnect enabled)", LOG_LEVEL_INFO);
}

/**
 * Stop network monitoring
 */
stopNetworkMonitoring(): void {
    if (!this._networkMonitoringStarted) {
        return;
    }
    
    // Stop connection monitoring
    if (this._connectionMonitor) {
        this._connectionMonitor.stopMonitoring();
    }
    
    // Unload network events
    if (this._networkEvents) {
        this._networkEvents.unload();
    }
    
    this._networkMonitoringStarted = false;
    Logger("Network monitoring stopped", LOG_LEVEL_VERBOSE);
}
```

---

### 3. 在合适的时机启动网络监控

#### 3.1 非首次场景: `startSync()` 自动启动

```typescript
async startSync(...): Promise<boolean> {
    // ... 现有逻辑
    
    // Start network monitoring if not already started
    // This is for non-first-time scenarios (normal sync startup)
    // First-time scenarios will call startNetworkMonitoring() explicitly after upload/download
    this.startNetworkMonitoring();
    
    return true;
}
```

#### 3.2 首次上传: `rebuildRemote()` 成功后启动

```typescript
async rebuildRemote(): Promise<boolean> {
    return this._executeManualOperation("RESET", async () => {
        try {
            // ... 扫描、上传逻辑
            
            if (result) {
                this.setStatus("COMPLETED", "Remote database rebuilt successfully");
                Logger($msg("fridaySync.rebuildRemote.success"), LOG_LEVEL_NOTICE);
                
                // Start network monitoring after successful first-time upload
                // This enables auto-reconnect for future network changes
                this.startNetworkMonitoring();
            }
            
            return result;
        }
    });
}
```

#### 3.3 首次下载: `fetchFromServer()` 成功后启动

```typescript
async rebuildLocalFromRemote(): Promise<boolean> {
    try {
        // ... 下载逻辑
        
        // ===== Phase 8: Complete =====
        Logger($msg("fridaySync.fetch.downloadComplete") || "Download complete!", LOG_LEVEL_NOTICE);
        
        // Start network monitoring after successful first-time download
        // This enables auto-reconnect for future network changes
        this.startNetworkMonitoring();
        
        // Restart sync if it was running
        if (this._settings.liveSync) {
            await this.startSync(true);
        }
        
        return true;
    }
}
```

#### 3.4 清理: `close()` 停止网络监控

```typescript
async close(): Promise<void> {
    // Stop network monitoring (will check if it's started)
    this.stopNetworkMonitoring();

    await this.stopSync();
    if (this._localDatabase) {
        await this._localDatabase.close();
    }
}
```

---

### 4. 更新 License 激活流程 (main.ts)

**RESET 场景:**
```typescript
// Step 7: Re-initialize sync service
// Network monitoring will be started after user clicks "Upload to Cloud"
await this.plugin.initializeSyncService();
```

**首次激活场景:**
```typescript
// Step 12: Initialize sync service only for first-time activation
// Network monitoring will be started after successful upload/download
if (this.plugin.settings.syncEnabled && response.first_time) {
    await this.plugin.initializeSyncService();
}
```

---

## 工作流程对比

### 修改前（有问题）

```
用户点击 RESET
    ↓
initializeSyncService(false)  ← autoStart=false
    ↓
initialize()
    ↓
❌ _networkEvents.registerEvents()      ← 网络监控启动了！
❌ _connectionMonitor.startMonitoring()  ← 网络监控启动了！
    ↓
用户看到 "上传到云端" 按钮
    ↓
[网络从断开→连接] 
    ↓
❌ handleNetworkRecovery() 触发
❌ startSync() 自动调用
❌ 用户还没点按钮就开始上传了！
```

### 修改后（正确）

```
用户点击 RESET
    ↓
initializeSyncService()
    ↓
initialize()
    ↓
✅ 网络监控组件初始化，但不启动
    ↓
用户看到 "上传到云端" 按钮
    ↓
[网络从断开→连接]
    ↓
✅ handleNetworkRecovery() 不会触发（监控未启动）
✅ 用户保持完全控制权
    ↓
用户点击 "上传到云端" 按钮
    ↓
rebuildRemote()
    ↓
扫描、上传文件
    ↓
✅ startNetworkMonitoring()  ← 上传成功后才启动！
    ↓
现在可以自动重连了
```

---

## 测试场景

### 场景 1: 首次激活 - 母库上传

1. 激活 License（首次）
2. 断开 VPN
3. 点击"上传到云端"按钮
4. 在上传过程中连接 VPN
5. **预期**: 
   - ✅ 上传正常进行，不受网络变化影响
   - ✅ 上传成功后，网络监控启动
   - ✅ 后续网络变化会触发自动重连

### 场景 2: 首次激活 - 子库下载

1. 激活 License（非首次，需要下载）
2. 输入加密密码
3. 断开 VPN
4. 点击"从云端下载"按钮
5. 在下载过程中连接 VPN
6. **预期**:
   - ✅ 下载正常进行
   - ✅ 下载成功后，网络监控启动

### 场景 3: RESET 后上传

1. 已有同步数据
2. 断开 VPN
3. 点击 RESET，输入"RESET"确认
4. 等待 RESET 完成
5. 连接 VPN（网络恢复）
6. **预期**:
   - ✅ 不会自动开始上传
   - ✅ 用户仍看到"上传到云端"按钮可点击
7. 点击"上传到云端"
8. **预期**:
   - ✅ 正常扫描并上传
   - ✅ 上传成功后网络监控启动

### 场景 4: 正常启动（非首次）

1. 已有同步数据且完成过首次上传/下载
2. 重新打开 Obsidian
3. **预期**:
   - ✅ 自动启动同步（`syncOnStart=true`）
   - ✅ `startSync()` 自动启动网络监控
   - ✅ 网络变化时自动重连

---

## 优势

### 1. 用户控制权
- ✅ 首次上传/下载时，用户完全控制何时开始
- ✅ 网络变化不会"偷走"同步权
- ✅ 符合用户预期：点按钮才开始操作

### 2. 代码清晰
- ✅ 删除了 `autoStart` 参数，接口更简洁
- ✅ 网络监控启动逻辑集中管理
- ✅ 责任明确：谁负责启动网络监控一目了然

### 3. 避免竞态条件
- ✅ 首次操作期间网络监控不活跃
- ✅ 避免 `handleNetworkRecovery()` 在不该触发时触发
- ✅ 避免 HKDB 错误和文件扫描失败

### 4. 灵活性
- ✅ 非首次场景自动启动，用户体验好
- ✅ 首次场景延迟启动，避免干扰
- ✅ 可以独立控制网络监控的启停

---

## 代码修改清单

### FridaySyncCore.ts
1. ✅ 添加 `_networkMonitoringStarted` 标志位
2. ✅ 添加 `startNetworkMonitoring()` 方法
3. ✅ 添加 `stopNetworkMonitoring()` 方法
4. ✅ 修改 `initialize()` - 不启动网络监控
5. ✅ 修改 `startSync()` - 自动启动网络监控（非首次场景）
6. ✅ 修改 `rebuildRemote()` - 成功后启动网络监控（首次上传）
7. ✅ 修改 `rebuildLocalFromRemote()` - 成功后启动网络监控（首次下载）
8. ✅ 修改 `close()` - 停止网络监控

### main.ts
1. ✅ 修改 `initializeSyncService()` - 删除 `autoStart` 参数
2. ✅ 修改 `performReset()` - 移除 `autoStart` 参数调用
3. ✅ 修改 `activateLicense()` - 移除 `autoStart` 参数调用

---

## 总结

这次优化通过**精确控制网络监控的启动时机**，从根本上解决了 VPN 网络不稳定导致的自动上传问题：

- **问题本质**: 不是 `autoStart` 的问题，而是网络监控启动时机不对
- **解决方案**: 延迟网络监控启动，在合适的时机（首次操作成功后）才启动
- **效果**: 用户在首次上传/下载时拥有完全控制权，网络变化不会干扰

同时保持了非首次场景的自动重连功能，提供良好的用户体验。
