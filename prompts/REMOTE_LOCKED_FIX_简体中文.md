# 远程数据库锁定问题修复 - 简体中文

## 🐛 问题

设备 B 从云端下载数据后，虽然数据已成功获取，但持续提示：
- ⚠️ **"远端数据库已被重置"**
- 🔴 状态栏显示**感叹号**
- ❌ 无法正常同步

## 🔍 根本原因

```
设备 A 重置上传：
1. markRemoteLocked(true, true) → MILESTONE.locked=true ✅
2. 生成新 salt ✅
3. 上传数据 ✅

设备 B 下载数据：
4. markRemoteResolved() → 添加到 accepted_nodes ✅
5. ❌ 但没有解锁！MILESTONE.locked 仍然是 true
6. startSync() → ensureDatabaseIsCompatible() 检测到 locked=true
7. 重新设置 remoteLockedAndDeviceNotAccepted=true
8. ❌ 持续报错！
```

## ✅ 解决方案

在 `rebuildLocalFromRemote()` 的 **Phase 4** 添加显式解锁：

```typescript
// Phase 4.1: 先解锁远程数据库
await this._replicator.markRemoteLocked(this._settings, false, false);
// → MILESTONE.locked=false ✅

// Phase 4.2: 添加设备到已接受列表
await this._replicator.markRemoteResolved(this._settings);
// → MILESTONE.accepted_nodes 包含当前设备 ✅

// Phase 4.3: 同步 Salt
await this._replicator.updateStoredSalt(this._settings);
// → 本地 salt 匹配远程 salt ✅
```

## 🎯 关键点

**顺序很重要！**

1. **先解锁**：确保 `MILESTONE.locked=false`
2. **再接受**：添加到 `accepted_nodes`
3. **最后同步**：更新本地 salt

这样 Phase 8 启动同步时，`ensureDatabaseIsCompatible()` 检查发现：
- ✅ `MILESTONE.locked=false`
- ✅ 设备在 `accepted_nodes` 中
- ✅ 不会重新锁定！

## 📊 验证结果

### 成功日志
```
[Fetch] Phase 4: ✅ Remote unlocked (MILESTONE.locked=false)
[Fetch] Phase 4: ✅ Device accepted (added to MILESTONE.accepted_nodes)
[Fetch] Phase 4: ✅ Salt synchronized (local matches remote)

[Fetch] Phase 8: Before startSync - remoteLockedAndDeviceNotAccepted=false
[startSync] ✅ Device accepted, proceeding with sync...
[Fetch] Phase 8: After startSync - remoteLockedAndDeviceNotAccepted=false
[Fetch] Phase 8: ✅ SUCCESS: All flags remain FALSE
[getSyncIssues] ✅ No issues found
```

### 关键指标
- ✅ Phase 4 三步都成功
- ✅ Phase 8 启动同步前后标志都是 `false`
- ✅ 没有 "远端数据库已重置" 警告
- ✅ 状态栏正常，可以同步

## 🔧 修改文件

**只修改了外层代码，没有修改 `sync/core`：**

- ✅ `src/sync/FridaySyncCore.ts` - 添加 Phase 4.1 解锁步骤
- ✅ `src/sync/FridayStorageEventManager.ts` - 添加 `startWatch()` 方法
- ✅ `src/sync/core/` - **保持不变** ✅

## 🚀 测试流程

1. **设备 A**：设置 → "重置云端数据并上传"
2. **设备 B**：设置 → "从云端下载数据"
3. **结果**：✅ 正常同步，无警告

## 💡 为什么之前失败？

`sync/core` 的 `markRemoteResolved()` 方法：
- ✅ 会更新 `accepted_nodes`
- ❌ **不会**设置 `locked=false`

所以需要在外层（`FridaySyncCore.ts`）显式调用 `markRemoteLocked(false, false)` 来解锁。

## 📝 技术细节

### 双层检测机制

**主要检测（SALT）：**
```
checkSaltConsistency()
→ 比较本地和远程 PBKDF2 salt
→ 不匹配 = 数据库被重置
```

**备用检测（MILESTONE）：**
```
ensureDatabaseIsCompatible()
→ 检查 MILESTONE.locked 和 accepted_nodes
→ locked=true 且设备不在列表 = 被锁定
```

**我们的修复解决了 MILESTONE 层的问题！**

---

**修复日期**：2026-02-27  
**状态**：✅ 已验证成功  
**核心方法**：在 Phase 4 中添加显式解锁步骤
