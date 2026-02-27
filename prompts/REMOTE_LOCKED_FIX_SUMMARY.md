# 远程数据库锁定问题修复总结

## 📋 问题描述

### 症状
在第二台设备上执行"从云端下载数据"（`rebuildLocalFromRemote`）后，虽然数据已成功获取，但系统持续显示：
- ⚠️ **"Remote database has been reset"** 警告
- 🔴 状态栏显示**感叹号**图标
- ❌ 无法正常同步

### 根本原因

当设备 A 执行"重置并上传"（`rebuildRemote`）时：
1. 调用 `markRemoteLocked(true, true)` 设置 `MILESTONE.locked=true`
2. 生成新的 PBKDF2 salt

当设备 B 执行"从云端下载"（`rebuildLocalFromRemote`）时：
3. **Phase 4** 调用 `markRemoteResolved()` 只更新了 `MILESTONE.accepted_nodes`
4. **但没有解锁** `MILESTONE.locked`（仍然是 `true`）
5. **Phase 8** 启动同步时，`ensureDatabaseIsCompatible()` 检测到 `MILESTONE.locked=true`
6. 重新设置 `remoteLockedAndDeviceNotAccepted=true`
7. 导致持续报错

## 🔧 解决方案

### 核心修复
在 `rebuildLocalFromRemote()` 的 **Phase 4** 中，添加了三步操作：

#### Phase 4.1: 解锁远程数据库
```typescript
await this._replicator.markRemoteLocked(this._settings, false, false);
// 设置 MILESTONE.locked=false, MILESTONE.cleaned=false
```

#### Phase 4.2: 添加设备到已接受列表
```typescript
await this._replicator.markRemoteResolved(this._settings);
// 添加当前设备到 MILESTONE.accepted_nodes
```

#### Phase 4.3: 同步 Salt
```typescript
await this._replicator.updateStoredSalt(this._settings);
// 存储远程 salt 到本地，防止未来的 salt 不匹配
```

### 为什么这个顺序很重要？

1. **先解锁**：确保 `MILESTONE.locked=false`，这样后续的 `ensureDatabaseIsCompatible()` 检查不会重新锁定
2. **再接受**：将设备添加到 `accepted_nodes`，表明设备被远程数据库接受
3. **最后同步**：更新本地 salt，避免 salt 不匹配检测

## ✅ 验证结果

### 成功日志

```
[Fetch] Phase 4: COMPLETE - Summary:
[Fetch] Phase 4: ✅ Remote unlocked (MILESTONE.locked=false)
[Fetch] Phase 4: ✅ Device accepted (added to MILESTONE.accepted_nodes)
[Fetch] Phase 4: ✅ Salt synchronized (local matches remote)
[Fetch] Phase 4: Final flag: remoteLockedAndDeviceNotAccepted=false
```

```
[Fetch] Phase 8: FINAL CHECK - Starting sync
[Fetch] Phase 8: Before starting sync, flag check:
[Fetch] Phase 8: - remoteLockedAndDeviceNotAccepted=false
[Fetch] Phase 8: - remoteLocked=false
[Fetch] Phase 8: - remoteCleaned=false

[startSync] ✅ Device accepted, proceeding with sync...
[getSyncIssues] ✅ No issues found

[Fetch] Phase 8: After startSync, flag check:
[Fetch] Phase 8: - remoteLockedAndDeviceNotAccepted=false
[Fetch] Phase 8: ✅ SUCCESS: All flags remain FALSE
[Fetch] Phase 8: Device is fully accepted and sync is operational
```

### 关键验证点

✅ **Phase 4** 三步都成功完成  
✅ **Phase 8 启动同步前**：所有标志为 `false`  
✅ **Phase 8 启动同步后**：所有标志仍为 `false`（关键！）  
✅ **getSyncIssues**：没有发现问题  
✅ **状态栏**：显示正常同步图标（不是感叹号）

## 🎯 技术细节

### 双层检测机制

Friday Sync 使用两层检测机制来发现远程数据库重置：

#### 1. 主要机制：SALT 检测
- `checkSaltConsistency()` 比较本地和远程 PBKDF2 salt
- 如果不匹配 → 设置 `remoteLockedAndDeviceNotAccepted=true`

#### 2. 备用机制：MILESTONE 检测
- `ensureDatabaseIsCompatible()` 检查 `MILESTONE.locked` 标志
- 如果 `locked=true` 且设备不在 `accepted_nodes` → 设置 `remoteLockedAndDeviceNotAccepted=true`

### 为什么需要显式解锁？

`sync/core` 中的 `markRemoteResolved()` 方法：
- ✅ 更新 `MILESTONE.accepted_nodes`（添加当前设备）
- ❌ **不会**设置 `MILESTONE.locked=false`

因此需要在 `FridaySyncCore.ts` 中显式调用 `markRemoteLocked(false, false)` 来解锁。

## 📝 修改文件

### 修改的文件
- ✅ `src/sync/FridaySyncCore.ts` （添加 Phase 4.1 解锁步骤 + 详细日志）
- ✅ `src/sync/FridayStorageEventManager.ts` （添加 `startWatch()` 方法）

### 未修改的文件
- ✅ `src/sync/core/` （所有文件保持原样，遵守"不修改 sync/core"的原则）

## 🔄 完整流程

### 设备 A：重置并上传
```
1. markRemoteLocked(true, true) → MILESTONE.locked=true
2. tryResetRemoteDatabase() → 生成新 salt
3. markRemoteLocked(true, true) → 再次确认 locked
4. 上传所有数据
```

### 设备 B：从云端下载
```
Phase 4.1: markRemoteLocked(false, false) → MILESTONE.locked=false ✅
Phase 4.2: markRemoteResolved() → 添加到 accepted_nodes ✅
Phase 4.3: updateStoredSalt() → 同步 salt ✅
Phase 5-7: 下载数据并写入 vault
Phase 8: startSync() → ensureDatabaseIsCompatible() → 检查 MILESTONE
        → locked=false ✅ → 不重新锁定 → 同步正常 ✅
```

## 🚀 测试步骤

1. **设备 A**：设置 → "Reset cloud data and upload"
2. **设备 B**：设置 → "Fetch from Server"
3. **预期结果**：
   - ✅ 数据成功下载
   - ✅ 无 "Remote database has been reset" 警告
   - ✅ 状态栏显示正常同步图标
   - ✅ 可以正常同步

## 📊 日志分析要点

### 关键日志标记

成功的标志：
```
[Fetch] Phase 4.1: ✅ Remote database unlocked successfully
[Fetch] Phase 4.2: ✅ Device marked as resolved
[Fetch] Phase 4.3: ✅ Stored salt updated successfully
[Fetch] Phase 8: ✅ SUCCESS: All flags remain FALSE
[startSync] ✅ Device accepted, proceeding with sync...
[getSyncIssues] ✅ No issues found
```

如果失败会看到：
```
[Fetch] Phase 8: ❌ ERROR: remoteLockedAndDeviceNotAccepted is still TRUE!
[startSync] ❌ Device not accepted! Blocking sync.
[getSyncIssues] ❌ Reporting issue: Remote database has been reset
```

## 🎓 经验教训

1. **遵守模块边界**：不修改 `sync/core` 的代码，在外层包装器中调整逻辑
2. **理解状态机**：标志在多个阶段被检查和重置，需要追踪完整生命周期
3. **详细日志**：添加结构化的 `console.log` 帮助追踪状态变化
4. **验证假设**：通过对比 livesync 源码验证我们的实现

## 🔗 相关文档

- `DATABASE_RESET_DETECTION.md` - 数据库重置检测机制详解
- `FETCH_FROM_SERVER_IMPLEMENTATION.md` - "从服务器获取"实现细节

---

**修复完成时间**：2026-02-27  
**修复方法**：在 `rebuildLocalFromRemote` Phase 4 中添加显式解锁步骤  
**状态**：✅ 已验证成功
