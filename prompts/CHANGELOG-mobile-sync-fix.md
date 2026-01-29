# 修复移动端同步问题 - 变更总结

## 问题
移动端 C 无法接收 PC 端 A/B 的更新，显示"文件处于编辑状态"并 BLOCK 同步，即使重启也无法同步。

## 根本原因
Friday 使用 `workspace.activeLeaf` 检查文件是否正在编辑，但移动端的 `activeLeaf` 会长时间保持不变（即使用户已离开编辑界面），导致误判。

## 解决方案
**完全对齐 LiveSync 的实现**：移除所有自定义冲突解决逻辑，不检查 `activeLeaf`，只依赖 mtime 和内容比较。

## 修改文件

### 1. src/sync/FridayServiceHub.ts
- ❌ 移除 `isFileOpen()` 方法
- ❌ 移除 `isFileActivelyEditing()` 方法  
- ❌ 移除 `smartConflictResolution()` 方法
- ❌ 移除 `deferProcessingForOpenFile()` 方法
- ❌ 移除 `deferredDocs` Map
- ✅ 修改 `defaultProcessSynchroniseResult()` - 直接处理远程更新

### 2. src/sync/FridayStorageEventManager.ts
- ❌ 移除 `isFileOpen()` 方法
- ❌ 移除 `isFileActivelyEditing()` 方法
- ❌ 移除 `MTIME_RESOLUTION_PRECISE` 常量
- ✅ 统一使用 2 秒 mtime 分辨率（对齐 LiveSync）

## LiveSync 的处理方式

```typescript
// livesync/src/modules/core/ModuleFileHandler.ts:350-387
async _anyProcessReplicatedDoc(entry: MetaEntry): Promise<boolean> {
    // 1. 检查文件是否为目标文件
    // 2. 检查文件大小是否超限
    // 3. 检查是否应该忽略
    // 4. 直接调用 dbToStorage() 写入
    //    - 不检查文件是否打开
    //    - 不检查 activeLeaf
    //    - 只比较 mtime 和 content
    return await this.dbToStorage(entry, targetFile);
}
```

## 行为变化

### 修改前
```
远程更新 → 检查 activeLeaf → 移动端误判"正在编辑" → BLOCK ❌
```

### 修改后  
```
远程更新 → 比较 mtime & content → 直接写入（如果更新） ✅
```

## 测试验证

✅ PC A ↔ PC B 同步正常  
✅ 移动端 C ← PC A/B 同步正常  
✅ 移动端 C → PC A/B 同步正常  
✅ 与 LiveSync 行为完全一致

## 代码统计

- **删除**：约 200 行自定义逻辑
- **简化**：同步流程更清晰
- **对齐**：与 LiveSync 100% 一致

