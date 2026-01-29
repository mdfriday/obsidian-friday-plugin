# 移动端同步异常分析报告

## 问题描述

**现象**：
- 两台 PC (A, B) 之间同步正常，A 编辑后 B 能同步，B 编辑后 A 也能同步
- 移动端 C 的异常表现：
  - A 或 B 上编辑后，C 检测到更新时会显示 Notice：文件处于编辑状态，并 BLOCK 了同步
  - 即使重启 C，也不能获取最新内容
  - 但 C 上编辑时，A 和 B 都能正常同步

**用户需求场景**：
- 主要场景是单端编辑，其他端同步（非多端同时编辑同一文件）
- 需要保证移动端 C 和 PC 端 A、B 的表现一致

## 根本原因分析

### 核心问题：移动端的 `workspace.activeLeaf` 行为差异

通过对比 livesync 源码和 Friday 实现，发现关键差异在于 **`isFileActivelyEditing()` 的判断逻辑**：

```typescript:src/sync/FridayServiceHub.ts (317-342 行)
private isFileActivelyEditing(path: string): boolean {
    const workspace = this.core.plugin.app.workspace;
    const leaves = workspace.getLeavesOfType('markdown');
    
    for (const leaf of leaves) {
        const view = leaf.view as any;
        if (view.file?.path === path) {
            // ⚠️ 问题根源：判断文件是否在 activeLeaf
            if (leaf === workspace.activeLeaf) {
                return true;
            }
            
            // 检查文件是否在最近 30 秒内被修改
            const vault = this.core.plugin.app.vault;
            const file = vault.getAbstractFileByPath(path);
            if (file && 'stat' in file) {
                const lastModified = (file as any).stat.mtime;
                const now = Date.now();
                if (now - lastModified < 30000) {
                    return true;
                }
            }
        }
    }
    return false;
}
```

### 移动端特殊行为

在 Obsidian 移动端：
1. **Workspace 状态持久化**：移动端的 `workspace.activeLeaf` 会保持上次打开的文件状态
2. **后台运行特性**：即使 App 进入后台或息屏，`activeLeaf` 不会自动清空
3. **文件视图缓存**：移动端的 markdown leaves 会保留之前打开的文件视图

**具体场景重现**：
```
1. 移动端 C 打开文件 "MDFriday Notes.md" 
   → workspace.activeLeaf.view.file.path = "MDFriday Notes.md"

2. 用户切换到其他 App 或锁屏
   → workspace.activeLeaf 仍然指向 "MDFriday Notes.md"

3. PC 端 A 或 B 编辑 "MDFriday Notes.md" 并同步到 CouchDB

4. 移动端 C 接收到远程更新
   → 调用 smartConflictResolution()
   → isFileActivelyEditing("MDFriday Notes.md") 返回 true
   → 原因：leaf === workspace.activeLeaf 判断为真
   → 结果：BLOCK 远程更新，显示 Notice

5. 用户重启移动端 C
   → workspace 恢复之前的状态
   → activeLeaf 仍然是 "MDFriday Notes.md"
   → 继续 BLOCK 更新
```

### 为什么 PC 端没有这个问题？

PC 端 (Desktop):
- 通常有多个窗口/标签页
- Workspace 管理更复杂，activeLeaf 切换频繁
- 文件关闭时，activeLeaf 会指向其他文件或为空
- 30 秒 mtime 检查通常能正确判断文件未被编辑

移动端 (Mobile):
- 单窗口界面
- activeLeaf 长时间保持不变
- 即使用户已经离开编辑界面，activeLeaf 仍指向最后打开的文件
- **导致 livesync 的逻辑误判：认为文件仍在编辑中**

## LiveSync 的处理方式

查看 livesync 源码，发现它采用了**不同的策略**：

### 1. LiveSync 不检查 activeLeaf

**ModuleFileHandler.ts (205-318 行)**：
```typescript
async dbToStorage(
    entryInfo: MetaEntry | FilePathWithPrefix,
    info: UXFileInfoStub | UXFileInfo | FilePath | null,
    force?: boolean
): Promise<boolean> {
    // ... 省略前面的代码 ...
    
    if (existOnStorage && !force) {
        // 1. 先检查 mtime 是否有差异（2 秒分辨率）
        if (compareFileFreshness(existDoc, docEntry) !== EVEN) {
            shouldApplied = true;
        }
        
        // 2. 如果 mtime 相同，检查内容是否相同
        if (!shouldApplied) {
            const readFile = await this.readFileFromStub(existDoc);
            if (await isDocContentSame(docData, readFile.body)) {
                shouldApplied = false;  // 内容相同，不需要更新
                markChangesAreSame(docRead, docRead.mtime, existDoc.stat.mtime);
            } else {
                shouldApplied = true;   // 内容不同，需要更新
            }
        }
        
        if (!shouldApplied) {
            return true;  // 不需要更新
        }
    }
    
    // 直接写入文件，不检查是否在编辑
    await this.storage.writeFileAuto(path, docData, { 
        ctime: docRead.ctime, 
        mtime: docRead.mtime 
    });
    return ret;
}
```

**关键差异**：
- ❌ LiveSync **不检查** `activeLeaf`
- ❌ LiveSync **不检查**文件是否打开
- ✅ LiveSync **只检查** mtime 和 content
- ✅ 如果远程更新更新，**直接覆盖本地文件**

### 2. LiveSync 的冲突处理策略

**ModuleConflictChecker.ts (9-19 行)**：
```typescript
async _queueConflictCheckIfOpen(file: FilePathWithPrefix): Promise<void> {
    const path = file;
    if (this.settings.checkConflictOnlyOnOpen) {
        const af = this.services.vault.getActiveFilePath();
        if (af && af != path) {
            this._log(`${file} is conflicted, merging process has been postponed.`, LOG_LEVEL_NOTICE);
            return;  // 只在文件打开时才处理冲突
        }
    }
    await this.services.conflict.queueCheckFor(path);
}
```

**LiveSync 的冲突处理逻辑**：
1. **文档有冲突**（CouchDB 检测到多个 revision）→ 进入冲突队列
2. 如果设置 `checkConflictOnlyOnOpen` = true：
   - 只有当前打开的文件才会弹出合并对话框
   - 其他冲突文件会被延迟处理
3. 如果没有冲突 → **直接覆盖本地文件**

### 3. Friday 的额外"智能冲突解决"导致的问题

Friday 在 livesync 的基础上添加了 `smartConflictResolution()`：

```typescript
// Friday 的处理流程
async defaultProcessSynchroniseResult(doc: MetaEntry): Promise<boolean> {
    // ...
    
    // ⚠️ Friday 额外添加的逻辑
    const resolution = await this.smartConflictResolution(path, remoteMtime, content);
    
    if (resolution === "BLOCK") {
        Logger(`🛡️ Blocked remote update for: ${path}`, LOG_LEVEL_INFO);
        return true;  // 阻止更新
    } else if (resolution === "DEFER") {
        this.deferProcessingForOpenFile(path, doc);
        return true;  // 延迟更新
    }
    
    // ...继续 livesync 的标准流程
}
```

**问题**：
- Friday 的 `smartConflictResolution` 在**所有文档同步**时都会运行
- 即使文档没有冲突（只是普通的远程更新），也会检查 `activeLeaf`
- 在移动端，这导致**正常的远程更新也被 BLOCK**

## 核心差异总结

| 方面 | LiveSync | Friday (当前实现) |
|------|----------|-------------------|
| 文件打开检查 | ❌ 不检查 | ✅ 检查 `activeLeaf` |
| 主动编辑检查 | ❌ 不检查 | ✅ 检查 30 秒 mtime + `activeLeaf` |
| 冲突处理 | 只在有 CouchDB conflicts 时处理 | 每个文档都运行智能冲突解决 |
| 远程更新策略 | mtime 更新 → 直接覆盖 | 检查编辑状态 → 可能 BLOCK/DEFER |
| 移动端兼容性 | ✅ 良好 | ❌ activeLeaf 误判导致阻塞 |

## 为什么 Friday 添加了这个逻辑？

从代码注释看，这是为了实现"智能冲突解决"：

```typescript
// Strategy 1: File is actively being edited - BLOCK remote update
if (isActivelyEditing) {
    Logger(`🛡️ BLOCK: File is actively being edited: ${path}`, LOG_LEVEL_NOTICE);
    return "BLOCK";
}
```

**设计意图**：
- 防止用户正在编辑时被远程更新覆盖
- 保护用户当前的编辑内容

**实际效果**：
- PC 端：基本符合预期（activeLeaf 管理较好）
- 移动端：**过度保护**，导致正常更新也被阻塞

## 解决方案

### 方案 1：完全移除 activeLeaf 检查（推荐，与 LiveSync 对齐）

**理由**：
- 用户场景是"单端编辑，其他端同步"
- 不需要"多端同时编辑同一文件"的保护
- LiveSync 的经验证明这种方式是可行的
- 移动端的 activeLeaf 不可靠

**修改**：
```typescript
private isFileActivelyEditing(path: string): boolean {
    const workspace = this.core.plugin.app.workspace;
    const leaves = workspace.getLeavesOfType('markdown');
    
    for (const leaf of leaves) {
        const view = leaf.view as any;
        if (view.file?.path === path) {
            // ❌ 移除 activeLeaf 检查
            // if (leaf === workspace.activeLeaf) {
            //     return true;
            // }
            
            // ✅ 只检查最近 30 秒是否修改
            const vault = this.core.plugin.app.vault;
            const file = vault.getAbstractFileByPath(path);
            if (file && 'stat' in file) {
                const lastModified = (file as any).stat.mtime;
                const now = Date.now();
                if (now - lastModified < 30000) {
                    return true;
                }
            }
        }
    }
    return false;
}
```

**效果**：
- ✅ 只有在文件最近 30 秒内被修改时，才认为"正在编辑"
- ✅ 移动端不会因为 activeLeaf 长时间保持而误判
- ✅ 符合用户场景：单端编辑，其他端同步

### 方案 2：平台差异化处理（更保守）

**理由**：
- 保留 PC 端的"保护"逻辑
- 只针对移动端放宽限制

**修改**：
```typescript
private isFileActivelyEditing(path: string): boolean {
    const workspace = this.core.plugin.app.workspace;
    const leaves = workspace.getLeavesOfType('markdown');
    const isMobile = Platform.isMobile;
    
    for (const leaf of leaves) {
        const view = leaf.view as any;
        if (view.file?.path === path) {
            // PC 端：检查 activeLeaf
            // 移动端：只检查 mtime
            if (!isMobile && leaf === workspace.activeLeaf) {
                return true;
            }
            
            const vault = this.core.plugin.app.vault;
            const file = vault.getAbstractFileByPath(path);
            if (file && 'stat' in file) {
                const lastModified = (file as any).stat.mtime;
                const now = Date.now();
                // 移动端：放宽到 10 秒
                // PC 端：保持 30 秒
                const threshold = isMobile ? 10000 : 30000;
                if (now - lastModified < threshold) {
                    return true;
                }
            }
        }
    }
    return false;
}
```

### 方案 3：完全移除 smartConflictResolution（最激进，完全对齐 LiveSync）

**理由**：
- LiveSync 已经有完善的冲突处理机制
- Friday 的"智能冲突解决"可能是过度设计
- 用户场景不需要这么复杂的逻辑

**修改**：
```typescript
async defaultProcessSynchroniseResult(doc: MetaEntry): Promise<boolean> {
    // ...
    
    if (!isDeleted) {
        // ❌ 移除整个 smartConflictResolution 调用
        // const resolution = await this.smartConflictResolution(path, remoteMtime, content);
        // if (resolution === "BLOCK") { ... }
        // if (resolution === "DEFER") { ... }
    }
    
    // 直接使用 livesync 的标准流程
    // ...
}
```

## 推荐方案

**推荐采用方案 1**：移除 `activeLeaf` 检查，只保留 30 秒 mtime 检查

**原因**：
1. ✅ 符合用户场景（单端编辑，其他端同步）
2. ✅ 解决移动端 activeLeaf 误判问题
3. ✅ 保持一定的编辑保护（30 秒内修改）
4. ✅ PC 和移动端行为一致
5. ✅ 代码改动最小，风险最低

**如果用户反馈需要更强的编辑保护**，可以考虑：
- 添加一个设置选项：`protectActiveFile`（默认关闭）
- 只在用户明确开启时，才使用 activeLeaf 检查
- 移动端始终不使用 activeLeaf 检查

## 其他发现

### 1. FridayStorageEventManager 也有相同的问题

```typescript:src/sync/FridayStorageEventManager.ts (138-149 行)
private isFileActivelyEditing(path: string): boolean {
    const workspace = this.plugin.app.workspace;
    const leaves = workspace.getLeavesOfType('markdown');
    
    for (const leaf of leaves) {
        const view = leaf.view as any;
        if (view.file?.path === path) {
            // ⚠️ 同样的 activeLeaf 检查
            if (leaf === workspace.activeLeaf) {
                return true;
            }
            // ...
        }
    }
}
```

**需要同步修改**：`FridayStorageEventManager.ts` 中的 `isFileActivelyEditing()` 也需要应用相同的修复。

### 2. 30 秒的时间窗口是否合理？

当前逻辑：文件在 30 秒内被修改 → 认为"正在编辑"

**可能的问题**：
- 用户快速打字并保存（< 30 秒）→ 在此期间远程更新会被 BLOCK
- 但这符合预期：正在编辑的文件应该保护本地更改

**建议**：
- 保持 30 秒不变（合理的保护期）
- 如果用户有特殊需求，可以作为配置选项

### 3. DEFER 逻辑的有效性

```typescript
private deferProcessingForOpenFile(path: string, doc: MetaEntry) {
    // 每 3 秒检查一次，最多重试 20 次（60 秒）
    const checkInterval = 3000;
    const maxRetries = 20;
    // ...
}
```

**问题**：
- 在移动端，如果 activeLeaf 长时间不变，DEFER 会一直重试
- 60 秒后会强制处理，但用户体验不好

**建议**：
- 修复 `isFileOpen()` 和 `isFileActivelyEditing()` 后，DEFER 逻辑会正常工作

## 测试建议

修复后需要验证的场景：

### 场景 1：移动端接收 PC 端更新
1. PC A 编辑文件 X，保存并同步
2. 移动端 C 在后台或息屏状态
3. **预期**：C 收到更新后，自动应用（不 BLOCK）

### 场景 2：移动端正在编辑
1. 移动端 C 打开文件 X，正在输入（不到 30 秒）
2. PC A 编辑同一文件并同步
3. **预期**：C 的更新被 BLOCK（保护当前编辑）

### 场景 3：移动端编辑完成
1. 移动端 C 编辑文件 X，保存，切换到其他文件
2. 等待 30 秒后，PC A 编辑文件 X 并同步
3. **预期**：C 自动接收更新（不 BLOCK）

### 场景 4：PC 端行为不变
1. PC A 和 B 之间的同步不受影响
2. **预期**：与修改前行为一致

## 总结

**问题根源**：
- Friday 添加的 `smartConflictResolution` 使用 `workspace.activeLeaf` 判断文件是否正在编辑
- 移动端的 `activeLeaf` 会长时间保持不变，导致误判
- LiveSync 不使用这个逻辑，只依赖 mtime 和 content 比较

**解决方案**：
- 移除 `isFileActivelyEditing()` 中的 `activeLeaf` 检查
- 只保留 30 秒 mtime 检查
- 同时修复 `FridayServiceHub.ts` 和 `FridayStorageEventManager.ts`

**预期效果**：
- 移动端 C 和 PC 端 A、B 行为一致
- 正常的远程更新不会被 BLOCK
- 仍然保护最近 30 秒内正在编辑的文件

