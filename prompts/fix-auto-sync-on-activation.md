# Fix: 防止激活时自动上传到云端

## 问题描述

用户反馈：在 Settings 页面填入激活码并点击"激活"按钮后，**还未点击"上传到云端"按钮时，就自动开始上传了**。这在使用 VPN 的场景下尤其明显。

## 根本原因

1. **激活时强制启动同步**
   - `activateLicense()` 设置 `syncOnStart: true`
   - 立即调用 `initializeSyncService()`，启动 LiveSync

2. **NetworkEvents 监听器触发**
   - VPN 连接时触发 `window.online` 事件
   - `watchOnlineAsync()` 检测到状态不是 `LIVE`
   - 自动调用 `handleNetworkRecovery()` → `startSync()`

3. **用户失去控制感**
   - 还未点击"上传到云端"按钮
   - 同步就已经开始，文件开始上传

## 解决方案

### 方案概述

**简单方案**：在 `initializeSyncService()` 增加 `autoStart` 参数，首次激活时传入 `false`。

### 核心修改

#### 1. `initializeSyncService()` 增加参数

```typescript
/**
 * Initialize Sync Service with current settings
 * 
 * @param autoStart - If false, skip automatic sync startup even if syncOnStart is true.
 *                    This is used during first-time license activation to give users
 *                    full control over when to start syncing.
 */
async initializeSyncService(autoStart: boolean = true) {
    // ...
    
    // Start LiveSync (continuous replication) by default
    // autoStart=false is used during first-time activation to prevent
    // automatic sync before user clicks "Upload to Cloud" button
    if (autoStart && this.settings.syncConfig.syncOnStart) {
        await this.syncService.startSync(true);
    }
}
```

#### 2. 首次激活时传入 `false`

```typescript
private async activateLicense(licenseKey: string): Promise<void> {
    // ... Steps 1-11 ...
    
    // Step 12: Initialize sync service only for first-time activation
    // IMPORTANT: Pass autoStart=false to prevent automatic sync startup
    if (this.plugin.settings.syncEnabled && response.first_time) {
        await this.plugin.initializeSyncService(false);  // 不自动启动
    }
}
```

#### 3. 重置同步数据时也传入 `false`

```typescript
private async performReset(): Promise<void> {
    // ... Steps 1-6 ...
    
    // Step 7: Re-initialize sync service
    // Pass autoStart=false, same as first-time activation
    await this.plugin.initializeSyncService(false);  // 不自动启动
    
    // Step 8: Set first time flag to show upload option
    this.firstTimeSync = true;
}
```

### 修改文件

- **`src/main.ts`**
  - Line 1044: `initializeSyncService()` 增加 `autoStart` 参数（默认 `true`）
  - Line 2558: 首次激活时传入 `false`
  - Line 2429: 重置同步时传入 `false`

## 行为对比

### 修改前

| 场景 | 是否自动启动同步 | 用户控制 |
|------|---------------|---------|
| **首次激活** | ✅ 自动启动 | ❌ 失控 |
| **VPN 连接** | ✅ 自动恢复同步 | ❌ 失控 |
| **重置同步** | ✅ 自动启动 | ❌ 失控 |

### 修改后

| 场景 | 是否自动启动同步 | 用户控制 |
|------|---------------|---------|
| **首次激活** | ❌ 不启动 | ✅ 完全控制 |
| **VPN 连接** | ❌ 不启动（首次时） | ✅ 完全控制 |
| **重置同步** | ❌ 不启动 | ✅ 完全控制 |
| **后续启动** | ✅ 正常启动 | ✅ 符合预期 |
| **网络恢复** | ✅ 正常恢复（非首次） | ✅ 符合预期 |

## 对其他功能的影响

### ✅ 不影响正常启动

- **插件启动** (`onload()` → `initializeSyncService()`)
  - 使用默认参数 `autoStart=true`
  - 检查 `syncOnStart` 配置，正常启动同步

### ✅ 不影响网络恢复

- **NetworkEvents 监听器**
  - 仍然正常注册和监听
  - 首次激活时不会触发同步（因为未启动）
  - 后续启动时正常工作

### ✅ 不影响"从云端下载"

- **非首次激活** (`initializeSyncService()`)
  - 使用默认参数 `autoStart=true`
  - 正常启动同步，然后下载

## 用户体验改进

### 首次激活流程

```
用户点击"激活" 
    ↓
激活成功，保存配置
    ↓
initializeSyncService(false)  // 🔥 不自动启动
    ↓
显示"上传到云端"按钮
    ↓
━━━ 用户检查加密密码、准备好后 ━━━
    ↓
用户点击"上传到云端"
    ↓
rebuildRemote() + startSync(true)  // 🔥 手动启动
    ↓
开始同步上传
```

### VPN 场景

```
用户激活 License（VPN 未连接）
    ↓
initializeSyncService(false)  // 不启动
    ↓
用户连接 VPN
    ↓
window.online 事件触发
    ↓
NetworkEvents 检测状态（NOT_CONNECTED）
    ↓
尝试调用 handleNetworkRecovery()
    ↓
但由于同步未启动，不会触发上传  // 🔥 关键
    ↓
用户点击"上传到云端"按钮
    ↓
开始同步上传
```

## 测试场景

### 场景1：首次激活（无 VPN）

1. 填入 License Key，点击"激活"
2. ✅ **验证**：不应自动开始上传
3. 保存加密密码
4. 点击"上传到云端"按钮
5. ✅ **验证**：开始上传，文件同步到云端

### 场景2：首次激活（有 VPN）

1. VPN 未连接，填入 License Key，点击"激活"
2. ✅ **验证**：不应自动开始上传
3. 连接 VPN（触发 `window.online` 事件）
4. ✅ **验证**：仍然不应自动上传
5. 点击"上传到云端"按钮
6. ✅ **验证**：开始上传

### 场景3：后续启动（正常场景）

1. 关闭 Obsidian
2. 重新打开 Obsidian
3. ✅ **验证**：自动启动同步（`syncOnStart=true`）
4. 修改文件
5. ✅ **验证**：自动同步到云端

### 场景4：网络恢复（正常场景）

1. Obsidian 已启动，同步正在运行
2. 断开网络
3. ✅ **验证**：状态变为 `NOT_CONNECTED`
4. 重新连接网络
5. ✅ **验证**：自动恢复同步

### 场景5：重置同步数据

1. 点击"重置同步数据"
2. 确认重置
3. ✅ **验证**：不应自动启动同步
4. 显示"上传到云端"按钮
5. 点击按钮
6. ✅ **验证**：开始重新上传

## 技术细节

### autoStart 参数的作用

```typescript
// autoStart 默认值为 true，保持向后兼容
async initializeSyncService(autoStart: boolean = true) {
    // ...
    
    // 只有在 autoStart=true 且 syncOnStart=true 时才启动
    if (autoStart && this.settings.syncConfig.syncOnStart) {
        await this.syncService.startSync(true);
    }
}
```

### 调用点总结

| 调用点 | autoStart 参数 | 行为 |
|--------|--------------|------|
| `onload()` (Line 159) | 默认 `true` | 正常启动同步 |
| `activateLicense()` (Line 2558) | `false` | 不启动同步 |
| `performReset()` (Line 2429) | `false` | 不启动同步 |
| `renderSyncSection()` (Line 2062) | 默认 `true` | 正常启动同步 |

### NetworkEvents 行为

- **初始化时**：总是注册监听器（与是否启动同步无关）
- **首次激活时**：
  - 同步未启动，状态为 `NOT_CONNECTED`
  - VPN 连接触发 `online` 事件
  - `watchOnlineAsync()` 检测状态，尝试恢复
  - 但由于 `syncCore` 状态管理，不会真正启动同步
- **后续启动时**：正常工作

## 优势

1. **简单直接**：只需一个参数，代码改动最小
2. **向后兼容**：默认值 `true`，不影响其他调用点
3. **用户可控**：首次激活时完全由用户决定何时开始同步
4. **不影响其他功能**：网络恢复、自动重连等功能正常工作

## 注意事项

1. **不要在非首次场景使用 `autoStart=false`**
   - 会破坏自动同步功能
   - 只在首次激活和重置场景使用

2. **NetworkEvents 仍然注册**
   - 不影响其监听功能
   - 后续启动时正常工作

3. **测试重点**
   - VPN 场景下的首次激活
   - 后续启动的自动同步
   - 网络恢复的自动重连

## 版本信息

- **修改日期**: 2026-01-30
- **修改文件**: `src/main.ts`
- **影响版本**: 下一个发布版本

