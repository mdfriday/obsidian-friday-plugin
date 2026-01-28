# LiveSync 三层防护完整实施方案

## 问题分析

### 当前错误理解
我们之前错误地使用了 `suspendFileWatching` 在日常同步中。这会导致：
- 用户 A 修改 file1.md
- 用户 B 修改 file2.md  
- 如果在同步 B 的 file2.md 时暂停所有监控
- **A 对 file1.md 的修改事件可能丢失** ❌

### LiveSync 的正确设计

`suspendFileWatching` **只用于大规模操作**（rebuild、batch operations），不用于日常同步。

日常同步依赖另外两层防护。

---

## LiveSync 三层防护

### 第 1 层：suspendFileWatching（仅大规模操作）⚠️

**用途：** 
- Rebuild database
- Batch operations  
- Settings changes that require restart

**实现位置：**
- `StorageEventManager.appendQueue()` - line 245
- `ModuleObsidianEvents.watchWorkspaceOpen()` - line 143

**检查方式：**
```typescript
if (this.settings.suspendFileWatching) return;
```

**我们的实现：**
- ✅ 已有 `suspend()` / `resume()` 方法
- ❌ 错误地用在了日常同步中（需要移除）
- ✅ 保留方法供将来大规模操作使用

---

### 第 2 层：touched + recentlyTouched（核心防护）⭐️

**用途：** 
- 日常同步的主要防护
- 标记"我们自己写入的文件"
- 防止自触发的上传循环

#### 2.1 写入时标记 (ModuleFileHandler.ts:314-315)

```typescript
// 1. 写入文件
await this.storage.writeFileAuto(path, docData, {...});

// 2. 立即标记（关键！）
await this.storage.touched(path);

// 3. 触发事件（如果需要）
this.storage.triggerFileEvent(mode, path);
```

**关键：** `touched()` 必须在 `writeFile()` **之后立即调用**

#### 2.2 touched 实现 (SerializedFileAccess.ts:206-227)

```typescript
touchedFiles: string[] = [];  // 最多保留 100 个

async touch(file: TFile | FilePath) {
    const key = `${path}-${stat.mtime}-${stat.size}`;  // 三元组
    this.touchedFiles.unshift(key);
    this.touchedFiles = this.touchedFiles.slice(0, 100);
}

recentlyTouched(file: TFile | UXFileInfoStub) {
    const key = `${file.path}-${file.stat.mtime}-${file.stat.size}`;
    return this.touchedFiles.indexOf(key) !== -1;
}
```

**关键点：**
- 使用 `path + mtime + size` 三元组精确匹配
- 最多保留 100 个，避免内存泄漏

#### 2.3 事件处理时检查 (StorageEventManager.ts:278-282)

```typescript
async appendQueue(params: FileEvent[], ctx?: any) {
    if (this.core.settings.suspendFileWatching) return;
    
    for (const param of params) {
        // ... 其他检查 ...
        
        if (file instanceof TFile || !file.isFolder) {
            if (type == "CREATE" || type == "CHANGED") {
                // ⏱️ 关键：等待 10ms 让 writer 完成 touched 标记
                await delay(10);
                
                // 🔍 检查是否是自己刚写入的
                if (this.core.storageAccess.recentlyTouched(file.path)) {
                    continue;  // 跳过，不处理！
                }
            }
        }
        
        // ... 继续处理 ...
    }
}
```

**为什么有效：**
1. ✅ 写入顺序：`writeFile` → `touched()` → `vault events 触发`
2. ✅ `await delay(10)`：确保 `touched()` 调用完成
3. ✅ 精确匹配：`path + mtime + size` 避免误判
4. ✅ 100 个缓存足够应对并发

---

### 第 3 层：内容比较（避免不必要写入）

**用途：**
- 远程内容与本地相同时，跳过写入
- 减少不必要的 disk I/O
- 进一步降低触发事件的概率

#### 3.1 实现 (ModuleFileHandler.ts:276-305)

```typescript
// 写入前检查
if (existOnStorage && !force) {
    let shouldApplied = false;
    
    // 1️⃣ 检查 mtime 差异（2秒精度）
    if (compareFileFreshness(existDoc, docEntry) !== EVEN) {
        shouldApplied = true;
    }
    
    // 2️⃣ mtime 相近，检查内容
    if (!shouldApplied) {
        const readFile = await this.readFileFromStub(existDoc);
        if (await isDocContentSame(docData, readFile.body)) {
            // 内容相同，不写入
            shouldApplied = false;
            markChangesAreSame(docRead, docRead.mtime, existDoc.stat.mtime);
        } else {
            shouldApplied = true;
        }
    }
    
    if (!shouldApplied) {
        return true;  // 不写入，直接返回
    }
}

// 只有 shouldApplied = true 才写入
await this.storage.ensureDir(path);
await this.storage.writeFileAuto(path, docData, {...});
await this.storage.touched(path);  // 立即标记
```

---

## 实施步骤

### Step 1: FridayStorageEventManager.ts

#### 1.1 从事件处理器中移除 recentlyTouched 检查

```typescript
// ❌ 错误：在这里检查太早，delay(10) 还没执行
private watchVaultCreate(file: TAbstractFile) {
    // 移除这行
    // if (this.recentlyTouched(file as TFile)) return;
}

private watchVaultChange(file: TAbstractFile) {
    // 移除这行
    // if (this.recentlyTouched(file as TFile)) return;
}
```

#### 1.2 在 processEvent 中添加 delay + 检查

```typescript
private async processEvent(event: FileEvent): Promise<boolean> {
    try {
        // ========== LiveSync Layer 2: touched + recentlyTouched ==========
        // For CREATE/CHANGED events, wait for writer to mark as touched
        if (event.type === "CREATE" || event.type === "CHANGED") {
            if (event.file) {
                // Wait 10ms to let the writer mark the file as touched
                await new Promise(resolve => setTimeout(resolve, 10));
                
                // Check if this file was recently touched by us
                if (this.recentlyTouched(event.file)) {
                    Logger(`File recently touched, skipping: ${event.path}`, LOG_LEVEL_VERBOSE);
                    return true;
                }
            }
        }
        
        // ... 继续原有逻辑 ...
    }
}
```

### Step 2: FridayServiceHub.ts

#### 2.1 移除 suspend/resume（不用于日常同步）

```typescript
private async defaultProcessSynchroniseResult(doc: MetaEntry): Promise<boolean> {
    // ❌ 移除这些
    // if (storageEventManager) {
    //     storageEventManager.suspend();
    // }
    
    // try {
    //     ...
    // } finally {
    //     if (storageEventManager) {
    //         setTimeout(() => storageEventManager.resume(), 100);
    //     }
    // }
}
```

#### 2.2 添加内容比较（Layer 3）

```typescript
private async defaultProcessSynchroniseResult(doc: MetaEntry): Promise<boolean> {
    // ... 前置检查 ...
    
    const vault = this.core.plugin.app.vault;
    const existingFile = vault.getAbstractFileByPath(path);
    
    // ========== LiveSync Layer 3: Content Comparison ==========
    if (existingFile && !isDeleted) {
        // 1. Check mtime freshness
        const localMtime = (existingFile as any).stat.mtime;
        const remoteMtime = doc.mtime || 0;
        const mtimeComparison = compareMtime(localMtime, remoteMtime);
        
        if (mtimeComparison === "EVEN") {
            // 2. Mtime is similar, check content
            let localContent: string | ArrayBuffer;
            if (isText) {
                localContent = await vault.read(existingFile as TFile);
            } else {
                localContent = await vault.readBinary(existingFile as TFile);
            }
            
            // 3. Compare content
            if (await isDocContentSame(content, localContent)) {
                // Content is same, mark and skip write
                storageEventManager?.markChangesAreSame(path, localMtime, remoteMtime);
                Logger(`Content same, skip write: ${path}`, LOG_LEVEL_VERBOSE);
                return true;
            }
        }
    }
    
    // Write file
    if (existingFile) {
        if (isText) {
            await vault.modify(existingFile as any, content as string);
        } else {
            await vault.modifyBinary(existingFile as any, content as ArrayBuffer);
        }
    } else {
        if (isText) {
            await vault.create(path, content as string);
        } else {
            await vault.createBinary(path, content as ArrayBuffer);
        }
    }
    
    // ========== LiveSync Layer 2: Mark as touched ==========
    // CRITICAL: Must be immediately after write
    const writtenFile = vault.getAbstractFileByPath(path);
    if (writtenFile && storageEventManager && 'stat' in writtenFile) {
        const stat = (writtenFile as any).stat;
        storageEventManager.touch(path, stat.mtime, stat.size);
    }
    
    return true;
}
```

---

## 测试场景

### 场景 1：单用户编辑
- ✅ Layer 2 防护：touch + recentlyTouched
- ✅ Layer 3 防护：内容比较

### 场景 2：双用户不同文件
- 用户 A 编辑 file1.md
- 用户 B 编辑 file2.md
- ✅ 不使用 suspendFileWatching，不会丢失 A 的编辑
- ✅ Layer 2 防护各自的同步

### 场景 3：双用户同一文件
- 用户 A 编辑 file1.md
- 用户 B 也编辑 file1.md  
- ✅ Layer 2 防护：A 的更新不会上传 B 刚下载的版本
- ✅ Layer 3 防护：内容相同时不写入
- ⚠️ 真正冲突时需要冲突解决（后续处理）

### 场景 4：大规模操作
- Rebuild database
- ✅ 使用 suspendFileWatching 全局暂停
- ✅ 操作完成后恢复

---

## 总结

| 层级 | 用途 | 适用场景 | 实施状态 |
|------|------|----------|----------|
| Layer 1: suspendFileWatching | 全局暂停 | 大规模操作 | ✅ 已实施（保留供大规模操作） |
| Layer 2: touched + recentlyTouched | 文件级标记 | 日常同步 | ✅ 已完整实施（含 delay(10)） |
| Layer 3: Content Comparison | 内容比较 | 避免不必要写入 | ✅ 已完整实施 |

**核心原则：**
1. ✅ 不在日常同步中使用 suspendFileWatching
2. ✅ 依赖 touched + delay(10) + recentlyTouched
3. ✅ 写入前比较内容（mtime + content）
4. ✅ 写入后立即 touch()

---

## 实施完成 ✅

### FridayStorageEventManager.ts

#### ✅ Layer 2 实施
1. 从 `watchVaultCreate` 和 `watchVaultChange` 移除 `recentlyTouched` 检查
2. 在 `processEvent` 添加 `await delay(10)` + `recentlyTouched` 检查

```typescript
private async processEvent(event: FileEvent): Promise<boolean> {
    try {
        // ========== LiveSync Layer 2: touched + recentlyTouched ==========
        if (event.type === "CREATE" || event.type === "CHANGED") {
            if (event.file) {
                // Wait 10ms to let the writer complete the touch() call
                await new Promise(resolve => setTimeout(resolve, 10));
                
                // Check if this file was recently touched by us
                if (this.recentlyTouched(event.file)) {
                    Logger(`File recently touched by us, skipping: ${event.path}`, LOG_LEVEL_VERBOSE);
                    return true;
                }
            }
        }
        // ... continue processing ...
    }
}
```

#### ✅ 导出 compareMtime
```typescript
export function compareMtime(baseMTime: number, targetMTime: number): "BASE_IS_NEW" | "TARGET_IS_NEW" | "EVEN" {
    // ... 2-second resolution comparison ...
}
```

### FridayServiceHub.ts

#### ✅ 移除日常同步中的 suspend/resume
```typescript
private async defaultProcessSynchroniseResult(doc: MetaEntry): Promise<boolean> {
    try {
        // ... internal file check ...
        
        // Note: We do NOT use suspendFileWatching here (that's only for bulk operations)
        // Instead, we rely on LiveSync's Layer 2: touched + recentlyTouched
        const storageEventManager = this.core.storageEventManager;
        
        // ... processing logic ...
    } catch (error) {
        // ... error handling ...
        return false;
    }
    // No finally block with resume() - not needed for daily sync
}
```

#### ✅ Layer 3 内容比较实施
```typescript
// ========== LiveSync Layer 3: Content Comparison ==========
if (existingFile && existingFile instanceof TFile) {
    let shouldWrite = false;
    
    // 1. Check mtime freshness (2 second resolution)
    const localMtime = existingFile.stat.mtime;
    const remoteMtime = fullEntry.mtime || 0;
    const mtimeComparison = compareMtime(localMtime, remoteMtime);
    
    if (mtimeComparison !== "EVEN") {
        shouldWrite = true;
    } else {
        // 2. Mtime is similar, check content
        try {
            let localContent: string | ArrayBuffer;
            if (isText) {
                localContent = await vault.read(existingFile);
            } else {
                localContent = await vault.readBinary(existingFile);
            }
            
            // 3. Compare content
            const isSame = await isDocContentSame(content, localContent);
            
            if (isSame) {
                // Content is identical, no need to write
                if (storageEventManager) {
                    storageEventManager.markChangesAreSame(path, localMtime, remoteMtime);
                }
                Logger(`Content same, skip write: ${path}`, LOG_LEVEL_VERBOSE);
                return true;
            } else {
                shouldWrite = true;
            }
        } catch (error) {
            Logger(`Content comparison failed for ${path}, will write: ${error}`, LOG_LEVEL_VERBOSE);
            shouldWrite = true;
        }
    }
    
    if (!shouldWrite) {
        return true;
    }
}

// ... write file ...

// ========== LiveSync Layer 2: Mark as touched ==========
// CRITICAL: Must be immediately after write
const writtenFile = vault.getAbstractFileByPath(path);
if (writtenFile && storageEventManager && 'stat' in writtenFile) {
    const stat = (writtenFile as any).stat;
    storageEventManager.touch(path, stat.mtime, stat.size);
}
```

---

## 工作流程验证

### 场景：用户 A 编辑，用户 B 同步下载

1. **用户 B 收到远程更新**
   - PouchDB 检测到变化
   - `defaultProcessSynchroniseResult(doc)` 被调用

2. **Layer 3: 内容比较**
   - 比较本地 vs 远程 mtime（2秒精度）
   - 如果 mtime 相近，比较内容
   - ✅ 如果内容相同，跳过写入，不触发事件

3. **如果需要写入**
   - `vault.modify(file, content)` 写入文件
   - Obsidian 触发 vault event

4. **Layer 2: touch() 立即标记**
   - `storageEventManager.touch(path, mtime, size)` 立即调用
   - 标记为 "我们自己写的"

5. **Vault event → processEvent**
   - `await delay(10)` - 等待 touch() 完成
   - `recentlyTouched()` 检查
   - ✅ 返回 true，**跳过处理，不上传！**

6. **用户 A 的编辑不受影响**
   - 用户 A 对其他文件的编辑独立处理
   - ✅ 不会丢失事件（因为没用 suspendFileWatching）

---

## 测试建议

### 测试 1：单用户自触发防护
1. 在设备 A 修改 file1.md
2. 等待同步完成
3. ✅ 验证：file1.md 只上传一次，不会循环上传

### 测试 2：双用户不同文件
1. 设备 A 修改 file1.md
2. 设备 B 修改 file2.md
3. 等待双向同步
4. ✅ 验证：两个设备都有 file1.md 和 file2.md 的最新版本
5. ✅ 验证：没有丢失任何编辑

### 测试 3：内容相同跳过写入
1. 设备 A 和 B 都有 file1.md（内容相同）
2. 触发同步
3. ✅ 验证：console 显示 "Content same, skip write"
4. ✅ 验证：没有磁盘写入，没有事件触发

### 测试 4：快速连续编辑
1. 在设备 A 快速连续编辑 file1.md
2. 每次保存间隔 < 1秒
3. ✅ 验证：debounce 生效，不会重复上传
4. ✅ 验证：最终版本正确同步
