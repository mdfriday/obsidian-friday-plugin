# SYNC 循环上传问题分析

> 分析日期：2026-01-28  
> 问题：设备 B 下载文件后，莫名其妙地再次上传旧版本，导致设备 A 正在编辑的内容被覆盖

## 问题现象

### 时间线
```
设备 A: 正在快速编辑 note.md
  ↓
设备 A: 保存并上传到 CouchDB (v2, mtime=10:00:10)
  ↓
设备 B: 检测到远程更新
  ↓
设备 B: 下载 note.md (v2) 并写入 vault
  ↓
设备 B: ❌ 触发 vault modify 事件
  ↓
设备 B: ❌ 检测到"文件修改"，上传到 CouchDB (v3, 但内容是 v2)
  ↓
设备 A: 收到远程更新 (v3)
  ↓
设备 A: ❌ 覆盖本地正在编辑的内容
  ↓
结果: 设备 A 的编辑内容丢失（回档）
```

## 核心问题

**设备 B 下载文件后，为什么会触发上传？**

理论上应该有防护机制：
1. `markFileProcessing()` - 标记文件正在处理
2. `touch()` - 标记文件刚被我们写入
3. `recentlyTouched()` - 检查是否是自己写入的

但这些机制**失效了**！

## 当前实现分析

### 1. FridayServiceHub.ts - 下载并写入文件

```typescript
// Line 330: 标记文件正在处理
storageEventManager.markFileProcessing(path);

try {
    // ... 处理删除、获取内容等 ...
    
    // Line 588-602: 写入文件到 vault
    if (existingFile) {
        if (isText) {
            await vault.modify(existingFile as any, content as string);  // ⚠️ 同步触发 vault 事件
        } else {
            await vault.modifyBinary(existingFile as any, content as ArrayBuffer);
        }
    } else {
        // create...
    }
    
    // Line 607-611: AFTER write, 标记为 touched
    const writtenFile = vault.getAbstractFileByPath(path);
    if (writtenFile && storageEventManager && 'stat' in writtenFile) {
        const stat = (writtenFile as any).stat;
        storageEventManager.touch(path, stat.mtime, stat.size);  // ⚠️ 太晚了！
    }
    
} finally {
    // Line 628-630: 1 秒后 unmark
    setTimeout(() => {
        storageEventManager.unmarkFileProcessing(path);
    }, 1000);
}
```

### 2. FridayStorageEventManager.ts - 文件事件处理

```typescript
// Line 337-356: watchVaultChange 事件处理
private watchVaultChange(file: TAbstractFile) {
    if (file instanceof TFolder) return;
    
    // Line 339-342: 检查是否正在处理
    if (this.isFileProcessing(file.path)) {
        Logger(`File change skipped (being processed): ${file.path}`, LOG_LEVEL_VERBOSE);
        return;  // ✅ 这个检查应该有效
    }
    
    // Line 343-347: 检查是否刚被写入
    if (this.recentlyTouched(file as TFile)) {
        Logger(`File change skipped (recently touched): ${file.path}`, LOG_LEVEL_VERBOSE);
        return;  // ❌ 这个检查失败了！
    }
    
    // Line 348-355: 添加到队列（500ms debounce）
    this.debouncedEnqueue({...});  // ⚠️ 延迟处理
}
```

### 3. touch() 和 recentlyTouched() 机制

```typescript
// Line 161-171: touch() - 标记文件为刚写入
touch(path: string, mtime: number, size: number) {
    const key = `${path}-${mtime}-${size}`;  // ⚠️ 精确匹配
    this.touchedFiles.unshift(key);
    // 保留最近 100 个
}

// Line 176-183: recentlyTouched() - 检查是否刚写入
recentlyTouched(file: TFile): boolean {
    const key = `${file.path}-${file.stat.mtime}-${file.stat.size}`;  // ⚠️ 必须完全匹配
    return this.touchedFiles.includes(key);
}
```

### 4. markFileProcessing() 机制

```typescript
// Line 226-232: markFileProcessing()
markFileProcessing(path: string) {
    this.processingFiles.add(path);
    // Auto-clear after 5 seconds
    setTimeout(() => {
        this.processingFiles.delete(path);
    }, 5000);  // ⚠️ 5 秒自动清除
}
```

## 问题分析：为什么防护失效？

### 问题 1：touch() 的时序问题 ⭐⭐⭐⭐⭐

**关键发现**：

```typescript
// 当前代码流程：
await vault.modify(file, content);  // 1. 写入文件
  ↓ (Obsidian 可能同步触发 vault.on('modify') 事件)
  ↓
watchVaultChange(file) 被调用  // 2. 事件处理器立即执行
  ↓
recentlyTouched(file) 检查  // 3. 检查 touchedFiles
  ↓ 
返回 false ❌  // 4. 文件还没被 touch！
  ↓
继续处理，添加到队列  // 5. 导致上传

// 然后才执行：
storageEventManager.touch(path, stat.mtime, stat.size);  // 6. 太晚了！
```

**根本原因**：
- Obsidian 的 vault 事件是**同步触发**的（在 vault.modify() 内部）
- touch() 在 vault.modify() **之后**调用
- 当事件处理器执行时，文件还没被标记为 touched
- 导致 recentlyTouched() 检查失败

### 问题 2：mtime 精度和系统差异

```typescript
// touch() 使用写入后的实际 mtime
const stat = (writtenFile as any).stat;
storageEventManager.touch(path, stat.mtime, stat.size);

// recentlyTouched() 使用事件中的 mtime
const key = `${file.path}-${file.stat.mtime}-${file.stat.size}`;
```

**潜在问题**：
- 系统可能四舍五入 mtime（特别是某些文件系统）
- vault.modify() 后获取的 stat.mtime 可能与事件中的 file.stat.mtime 不一致
- 即使相差 1ms，key 也会不匹配
- 导致 recentlyTouched() 返回 false

### 问题 3：debounce 的延迟

```typescript
// watchVaultChange 使用 500ms debounce
this.debouncedEnqueue({...});
```

**影响**：
- 事件被延迟 500ms 处理
- 但 markFileProcessing() 在 1 秒后就 unmark 了
- touch() 的 key 可能已经从 touchedFiles 中被挤出（只保留 100 个）
- 当 debounce 的事件finally 处理时，保护已经失效

### 问题 4：markFileProcessing 的重复逻辑

```typescript
// FridayServiceHub.ts
storageEventManager.markFileProcessing(path);  // 调用
setTimeout(() => {
    storageEventManager.unmarkFileProcessing(path);  // 1 秒后 unmark
}, 1000);

// FridayStorageEventManager.ts
markFileProcessing(path: string) {
    this.processingFiles.add(path);
    setTimeout(() => {
        this.processingFiles.delete(path);  // 5 秒后自动删除
    }, 5000);
}
```

**混乱**：
- 有两个定时器：1 秒和 5 秒
- 如果 1 秒的定时器先执行，会删除 path
- 但 5 秒的定时器还在，可能会尝试再次删除（虽然无害）
- 逻辑不清晰

## LiveSync 的实现对比

### LiveSync 的关键机制

#### 1. suspendFileWatching 安全阀 ⭐⭐⭐⭐⭐

```typescript
// src/sync/core/common/types.ts
interface SafetyValveSettings {
    suspendFileWatching: boolean;  // ⚠️ 关键！
    suspendParseReplicationResult: boolean;
}
```

**工作原理**（推测）：
```typescript
// 处理远程更新前
settings.suspendFileWatching = true;  // 暂停监视

// 写入文件
await vault.modify(file, content);  // 此时 vault 事件会被忽略

// 处理完成后
settings.suspendFileWatching = false;  // 恢复监视
```

**优势**：
- ✅ 完全避免事件触发
- ✅ 不依赖 touch() 的时序
- ✅ 不依赖 mtime 的精确匹配
- ✅ 简单可靠

#### 2. LiveSync 可能的 touch() 实现

**推测**（基于最佳实践）：

```typescript
// 方案 A: 预测 mtime（在写入前 touch）
const predictedMtime = Date.now();
storageEventManager.touch(path, predictedMtime, file.size);
await vault.modify(file, content);

// 方案 B: 使用模糊匹配
recentlyTouched(file: TFile): boolean {
    // 检查路径匹配，忽略 mtime 的微小差异
    return this.touchedFiles.some(key => {
        const [touchedPath, touchedMtime, touchedSize] = key.split('-');
        if (touchedPath !== file.path) return false;
        
        const mtimeDiff = Math.abs(parseInt(touchedMtime) - file.stat.mtime);
        const sizeDiff = Math.abs(parseInt(touchedSize) - file.stat.size);
        
        return mtimeDiff < 1000 && sizeDiff === 0;  // 容忍 1 秒的 mtime 差异
    });
}
```

## 解决方案

### 方案 1：实现 suspendFileWatching 机制（推荐）⭐⭐⭐⭐⭐

**原理**：在处理远程更新期间，完全暂停文件监视

**实现步骤**：

1. **在 FridayStorageEventManager 中添加暂停标志**：

```typescript
export class FridayStorageEventManager {
    private _isWatching = false;
    private _isSuspended = false;  // 新增：暂停标志
    
    /**
     * 暂停文件监视（处理远程更新时使用）
     */
    suspend() {
        this._isSuspended = true;
        Logger("File watching suspended", LOG_LEVEL_VERBOSE);
    }
    
    /**
     * 恢复文件监视
     */
    resume() {
        this._isSuspended = false;
        Logger("File watching resumed", LOG_LEVEL_VERBOSE);
    }
    
    /**
     * 检查是否应该处理事件
     */
    private shouldProcessEvent(): boolean {
        if (!this._isWatching) return false;
        if (this._isSuspended) return false;  // ⭐ 关键检查
        return true;
    }
}
```

2. **在所有事件处理器中添加检查**：

```typescript
private watchVaultChange(file: TAbstractFile) {
    if (!this.shouldProcessEvent()) {
        Logger(`Event skipped (suspended): ${file.path}`, LOG_LEVEL_DEBUG);
        return;  // ⭐ 直接返回，不处理
    }
    
    if (file instanceof TFolder) return;
    // ... 其他检查 ...
}
```

3. **在 FridayServiceHub 中使用**：

```typescript
private async defaultProcessSynchroniseResult(doc: MetaEntry): Promise<boolean> {
    try {
        const path = doc.path;
        if (!path) return false;
        
        // ⭐ 暂停文件监视
        const storageEventManager = this.core.storageEventManager;
        if (storageEventManager) {
            storageEventManager.suspend();
        }
        
        try {
            // 处理文件（删除/修改/创建）
            const vault = this.core.plugin.app.vault;
            
            if (isDeleted) {
                await vault.delete(existingFile);
            } else if (existingFile) {
                await vault.modify(existingFile, content);
            } else {
                await vault.create(path, content);
            }
            
            // ⚠️ 注意：此时 vault 事件会触发，但被 suspend 拦截了
            
            return true;
        } finally {
            // ⭐ 恢复文件监视
            if (storageEventManager) {
                // 小延迟确保所有事件都被拦截
                setTimeout(() => {
                    storageEventManager.resume();
                }, 100);
            }
        }
    } catch (error) {
        // 错误处理...
    }
}
```

**优势**：
- ✅ 完全阻止事件触发
- ✅ 不依赖 touch() 的时序
- ✅ 不依赖 mtime 的精确匹配
- ✅ 简单可靠，符合 LiveSync 模式

**风险**：
- ⚠️ 如果 resume() 失败（例如异常），文件监视可能永久暂停
- 解决：使用 try-finally 确保 resume() 总是被调用

### 方案 2：改进 touch() 时序（备选）⭐⭐⭐

**原理**：在写入文件**之前** touch，使用预测的 mtime

```typescript
private async defaultProcessSynchroniseResult(doc: MetaEntry): Promise<boolean> {
    try {
        const path = doc.path;
        
        // 1. ⭐ 提前 touch（使用当前时间作为预测）
        const storageEventManager = this.core.storageEventManager;
        const vault = this.core.plugin.app.vault;
        
        if (storageEventManager) {
            // 预测写入后的 mtime（使用当前时间）
            const predictedMtime = Date.now();
            const predictedSize = content.length || (content as ArrayBuffer).byteLength;
            
            // ⭐ 提前 touch
            storageEventManager.touch(path, predictedMtime, predictedSize);
            
            // 同时标记正在处理
            storageEventManager.markFileProcessing(path);
        }
        
        // 2. 写入文件
        if (isDeleted) {
            await vault.delete(existingFile);
        } else if (existingFile) {
            await vault.modify(existingFile, content);
        } else {
            await vault.create(path, content);
        }
        
        // 3. ⭐ 再次 touch（使用实际 mtime）
        const writtenFile = vault.getAbstractFileByPath(path);
        if (writtenFile && storageEventManager && 'stat' in writtenFile) {
            const stat = (writtenFile as any).stat;
            storageEventManager.touch(path, stat.mtime, stat.size);
        }
        
        // 4. 延迟 unmark
        if (storageEventManager) {
            setTimeout(() => {
                storageEventManager.unmarkFileProcessing(path);
            }, 2000);  // 增加到 2 秒
        }
        
        return true;
    } catch (error) {
        // ...
    }
}
```

**优势**：
- ✅ 提前 touch 可以拦截同步触发的事件
- ✅ 两次 touch 提供双重保护

**劣势**：
- ⚠️ 预测的 mtime 可能不准确
- ⚠️ 仍然依赖精确匹配
- ⚠️ 复杂度更高

### 方案 3：改进 recentlyTouched() 匹配逻辑（辅助）⭐⭐

**原理**：使用模糊匹配，容忍 mtime 的微小差异

```typescript
recentlyTouched(file: TFile): boolean {
    const targetPath = file.path;
    const targetMtime = file.stat.mtime;
    const targetSize = file.stat.size;
    
    // 模糊匹配：路径相同 + size 相同 + mtime 差异 < 2 秒
    const isMatched = this.touchedFiles.some(key => {
        const [path, mtimeStr, sizeStr] = key.split('-');
        
        if (path !== targetPath) return false;
        if (parseInt(sizeStr) !== targetSize) return false;
        
        const mtimeDiff = Math.abs(parseInt(mtimeStr) - targetMtime);
        return mtimeDiff < 2000;  // 容忍 2 秒差异
    });
    
    if (isMatched) {
        Logger(`Recently touched (fuzzy match), skipping: ${file.path}`, LOG_LEVEL_DEBUG);
    }
    
    return isMatched;
}
```

**优势**：
- ✅ 容忍 mtime 的系统差异
- ✅ 提高匹配成功率

**劣势**：
- ⚠️ 可能匹配到不相关的文件（如果 2 秒内多次修改）
- ⚠️ 不能解决时序问题

## ✅ 实施完成

### 已实施：suspendFileWatching 机制（2026-01-28）

#### 1. FridayStorageEventManager.ts - 添加暂停机制

**新增属性**：
```typescript
private _isSuspended = false;  // LiveSync's suspendFileWatching mechanism

get isSuspended(): boolean {
    return this._isSuspended;
}
```

**新增方法**：
```typescript
// 暂停文件监视
suspend() {
    this._isSuspended = true;
    Logger("📛 File watching suspended (processing remote updates)", LOG_LEVEL_VERBOSE);
}

// 恢复文件监视
resume() {
    this._isSuspended = false;
    Logger("✅ File watching resumed", LOG_LEVEL_VERBOSE);
}

// 检查是否应该处理事件
private shouldProcessEvent(): boolean {
    if (!this._isWatching) return false;
    if (this._isSuspended) return false;  // ⭐ 关键检查
    return true;
}
```

**更新所有事件处理器**：
- ✅ `watchVaultCreate()` - 添加 `shouldProcessEvent()` 检查
- ✅ `watchVaultChange()` - 添加 `shouldProcessEvent()` 检查
- ✅ `watchVaultDelete()` - 添加 `shouldProcessEvent()` 检查
- ✅ `watchVaultRename()` - 添加 `shouldProcessEvent()` 检查

#### 2. FridayServiceHub.ts - 使用暂停机制

**在 defaultProcessSynchroniseResult() 中**：

```typescript
// 处理远程更新开始时 - SUSPEND
const storageEventManager = this.core.storageEventManager;
if (storageEventManager) {
    storageEventManager.suspend();  // ⭐ 暂停文件监视
}

try {
    // 处理删除、修改、创建文件
    await vault.modify(file, content);  // vault 事件会被拦截
    // ...
    
} finally {
    // 处理完成后 - RESUME
    if (storageEventManager) {
        setTimeout(() => {
            storageEventManager.resume();  // ⭐ 恢复文件监视
        }, 100);
    }
}
```

#### 3. 关键改进点

**完全防止循环上传**：
```
远程更新到达 → suspend() → vault.modify() → vault 触发 modify 事件
                                              ↓
                                    shouldProcessEvent() 返回 false
                                              ↓
                                    事件被忽略，不会上传 ✅
                                              ↓
处理完成 → resume() → 恢复正常文件监视
```

**错误安全**：
- 使用 finally 块确保 resume() 总是被调用
- 即使处理出错，也不会永久暂停文件监视
- 100ms 延迟确保所有 vault 事件都被拦截

#### 4. 日志标识

新增日志用于调试：
- `📛 File watching suspended (processing remote updates)` - 开始处理远程更新
- `File create/change/delete/rename skipped (watching suspended)` - 事件被拦截
- `✅ File watching resumed` - 恢复文件监视

### 推荐实施方案

### ✅ 第一阶段：实施 suspendFileWatching（核心）- 已完成

1. ✅ 在 FridayStorageEventManager 添加 suspend/resume 机制
2. ✅ 在所有事件处理器添加 shouldProcessEvent() 检查
3. ✅ 在 FridayServiceHub 处理远程更新时使用 suspend/resume
4. ✅ 添加详细日志便于调试

### 第二阶段：改进 touch() 逻辑（辅助）

1. ✅ 在写入前提前 touch（使用预测 mtime）
2. ✅ 在写入后再次 touch（使用实际 mtime）
3. ✅ 改进 recentlyTouched() 使用模糊匹配

### 第三阶段：清理和优化

1. ✅ 移除 FridayServiceHub 中的 setTimeout unmark 逻辑
2. ✅ 统一 markFileProcessing 的自动清除时间
3. ✅ 添加更多日志和监控

## 测试验证

### 测试场景 1：基本防护

```
设备 B:
1. 开启 DEBUG 日志
2. 接收远程更新
3. 观察日志：
   - "File watching suspended"
   - "Event skipped (suspended): note.md"
   - "File watching resumed"
4. ✅ 不应该看到 "STORAGE -> DB" 日志
```

### 测试场景 2：连续更新

```
设备 A: 快速编辑并保存 3 次
设备 B: 接收 3 个远程更新
结果: 设备 B 不应该触发任何上传
```

### 测试场景 3：真实编辑

```
设备 B: 实际编辑文件
结果: 编辑后应该正常上传（不被 suspend 影响）
```

## 总结

**核心问题**：touch() 的时序问题 - 在 vault.modify() 之后才 touch，导致同步触发的事件检查失败。

**根本解决方案**：实施 suspendFileWatching 机制，在处理远程更新期间完全暂停文件监视，这是 LiveSync 原生使用的可靠方案。

**预期效果**：
- ✅ 设备 B 下载文件后不会触发上传
- ✅ 设备 A 的编辑内容不会被覆盖
- ✅ 彻底解决回档问题
