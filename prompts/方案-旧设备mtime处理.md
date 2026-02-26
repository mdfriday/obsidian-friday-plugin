# 旧设备 mtime 变化处理方案 - LiveSync 机制分析与实现

## 问题核心

**场景**：旧版本设备长期离线后打开文件，即使没有修改内容，文件的 `mtime` 也会发生变化（例如 Obsidian 的文件索引、预览等操作）。

**后果**：
1. 同步时误认为文件被修改
2. 基于 mtime 的冲突解决策略选择了错误的版本
3. 导致数据回滚

---

## LiveSync 的解决方案

LiveSync 使用了一个**非常巧妙**的机制来解决这个问题：**`sameChangePairs` 持久化缓存**。

### 核心原理

#### 1. mtime 比较逻辑

```typescript
// livesync/src/common/utils.ts lines 299-312

// Why 2000? : ZIP FILE Does not have enough resolution.
const resolution = 2000; // 2秒精度

export function compareMTime(
    baseMTime: number,
    targetMTime: number
): typeof BASE_IS_NEW | typeof TARGET_IS_NEW | typeof EVEN {
    const truncatedBaseMTime = ~~(baseMTime / resolution) * resolution;
    const truncatedTargetMTime = ~~(targetMTime / resolution) * resolution;
    
    if (truncatedBaseMTime == truncatedTargetMTime) return EVEN;
    if (truncatedBaseMTime > truncatedTargetMTime) return BASE_IS_NEW;
    if (truncatedBaseMTime < truncatedTargetMTime) return TARGET_IS_NEW;
    throw new Error("Unexpected error");
}
```

**关键点**：使用 2 秒精度是为了兼容 ZIP 文件的时间戳分辨率。

#### 2. 内容比较 + mtime 标记机制

```typescript
// livesync/src/common/utils.ts lines 341-356

export function compareFileFreshness(
    baseFile: UXFileInfoStub | AnyEntry | undefined,
    checkTarget: UXFileInfo | AnyEntry | undefined
): typeof BASE_IS_NEW | typeof TARGET_IS_NEW | typeof EVEN {
    if (baseFile === undefined && checkTarget == undefined) return EVEN;
    if (baseFile == undefined) return TARGET_IS_NEW;
    if (checkTarget == undefined) return BASE_IS_NEW;

    const modifiedBase = "stat" in baseFile ? (baseFile?.stat?.mtime ?? 0) : (baseFile?.mtime ?? 0);
    const modifiedTarget = "stat" in checkTarget ? (checkTarget?.stat?.mtime ?? 0) : (checkTarget?.mtime ?? 0);

    // ✨ 关键：先检查这两个 mtime 是否被标记为"相同内容"
    if (modifiedBase && modifiedTarget && isMarkedAsSameChanges(baseFile, [modifiedBase, modifiedTarget])) {
        return EVEN;
    }
    
    return compareMTime(modifiedBase, modifiedTarget);
}
```

#### 3. 标记"内容相同"的 mtime 对

```typescript
// livesync/src/common/utils.ts lines 319-328

export function markChangesAreSame(
    file: AnyEntry | string | UXFileInfoStub, 
    mtime1: number, 
    mtime2: number
) {
    if (mtime1 === mtime2) return true;
    
    const key = getKey(file); // 文件路径
    const pairs = sameChangePairs.get(key, []) || [];
    
    // 如果已有 mtime1 或 mtime2 的记录，合并
    if (pairs.some((e) => e == mtime1 || e == mtime2)) {
        sameChangePairs.set(key, [...new Set([...pairs, mtime1, mtime2])]);
    } else {
        // 否则创建新的 mtime 对
        sameChangePairs.set(key, [mtime1, mtime2]);
    }
}
```

#### 4. 检查 mtime 是否已被标记为"相同"

```typescript
// livesync/src/common/utils.ts lines 334-340

export function isMarkedAsSameChanges(
    file: UXFileInfoStub | AnyEntry | string, 
    mtimes: number[]
) {
    const key = getKey(file);
    const pairs = sameChangePairs.get(key, []) || [];
    
    // 如果所有 mtime 都在 pairs 中，说明它们是"相同内容"
    if (mtimes.every((e) => pairs.indexOf(e) !== -1)) {
        return EVEN;
    }
}
```

#### 5. 持久化存储

```typescript
// livesync/src/common/stores.ts

import { PersistentMap } from "octagonal-wheels/dataobject/PersistentMap";

export let sameChangePairs: PersistentMap<number[]>;

export function initializeStores(vaultName: string) {
    // 每个 vault 独立存储
    sameChangePairs = new PersistentMap<number[]>(`ls-persist-same-changes-${vaultName}`);
}
```

**关键**：`sameChangePairs` 是**持久化存储**的，即使插件重启也不会丢失。

---

### 完整工作流程

#### 场景1：Storage → DB（本地文件变化）

```typescript
// livesync/src/modules/core/ModuleFileHandler.ts lines 51-130

async storeFileToDB(info: UXFileInfoStub | UXFileInfo, force: boolean = false): Promise<boolean> {
    const file = /* ... */;
    const entry = await this.db.fetchEntry(file, undefined, true, true);

    if (!entry || entry.deleted) {
        // 新文件，直接存储
        return await this.db.store(readFile);
    }

    // entry 存在，检查是否需要更新
    let shouldApplied = false;
    
    // ========== Step 1: 比较 mtime ==========
    if (compareFileFreshness(file, entry) !== EVEN) {
        shouldApplied = true;
    }
    
    // ========== Step 2: mtime 相同 或 被标记为相同，比较内容 ==========
    if (!shouldApplied) {
        readFile = await this.readFileFromStub(file);
        
        if (await isDocContentSame(getDocDataAsArray(entry.data), readFile.body)) {
            // 内容相同！
            // ✨ 标记 storage mtime 和 db mtime 为"相同内容"
            markChangesAreSame(readFile, readFile.stat.mtime, entry.mtime);
            
            // 不需要更新
            return true;
        } else {
            // 内容不同，需要更新
            shouldApplied = true;
        }
    }

    if (!shouldApplied) {
        this._log(`File ${file.path} is not changed`, LOG_LEVEL_VERBOSE);
        return true;
    }
    
    // 需要更新，写入数据库
    return await this.db.store(readFile, false, true);
}
```

#### 场景2：DB → Storage（同步的文件写入本地）

```typescript
// livesync/src/modules/core/ModuleFileHandler.ts lines 205-318

async dbToStorage(entryInfo: MetaEntry, info: UXFileInfoStub | null, force?: boolean): Promise<boolean> {
    const docEntry = /* 从数据库获取文档 */;
    const existDoc = this.storage.getStub(path); // 本地文件

    if (existDoc && !force) {
        let shouldApplied = false;
        
        // ========== Step 1: 比较 mtime ==========
        if (compareFileFreshness(existDoc, docEntry) !== EVEN) {
            shouldApplied = true;
        }
        
        // ========== Step 2: mtime 相同 或 被标记为相同，比较内容 ==========
        if (!shouldApplied) {
            const readFile = await this.readFileFromStub(existDoc);
            
            if (await isDocContentSame(docData, readFile.body)) {
                // 内容相同！
                shouldApplied = false;
                
                // ✨ 标记 db mtime 和 storage mtime 为"相同内容"
                markChangesAreSame(docRead, docRead.mtime, existDoc.stat.mtime);
            } else {
                // 内容不同，需要写入
                shouldApplied = true;
            }
        }
        
        if (!shouldApplied) {
            this._log(`File ${docRead.path} is not changed`, LOG_LEVEL_VERBOSE);
            return true;
        }
    }
    
    // 需要写入本地文件
    await this.storage.writeFileAuto(path, docData, { ctime: docRead.ctime, mtime: docRead.mtime });
    return true;
}
```

---

### 为什么这个机制能解决"旧设备打开文件 mtime 变化"的问题？

#### 示例场景

```
初始状态：
  - 服务器: file.md (mtime=T1, content="Hello World")
  - 旧设备: file.md (mtime=T1, content="Hello World")

旧设备长期离线...

电脑修改：
  - 服务器: file.md (mtime=T2, content="Hello Friday")

旧设备打开 Obsidian，触发文件索引：
  - 旧设备: file.md (mtime=T3, content="Hello World")  <- mtime 变了！
```

#### 同步流程

**1. 旧设备同步（Pull from Server）**

```typescript
// DB → Storage (服务器的新内容写入本地)

// Step 1: 比较 mtime
existDoc.mtime = T3  (本地文件，刚被 Obsidian 更新)
docEntry.mtime = T2  (服务器)

compareFileFreshness(existDoc, docEntry)
  => compareMTime(T3, T2)
  => BASE_IS_NEW (本地 mtime 更新！)

shouldApplied = true

// Step 2: 比较内容
existDoc.content = "Hello World"  (本地内容未变)
docEntry.content = "Hello Friday" (服务器新内容)

isDocContentSame() => false

shouldApplied = true

// Step 3: 写入本地文件
writeFileAuto("file.md", "Hello Friday", { mtime: T2 })

// 本地文件现在是：
// file.md (mtime=T2, content="Hello Friday")
```

**2. Obsidian 检测到文件变化（mtime 从 T3 → T2）**

触发 `Storage → DB` 流程：

```typescript
// Storage → DB (本地文件变化检测)

// Step 1: 比较 mtime
file.mtime = T2       (本地文件，刚被同步写入)
entry.mtime = T2      (数据库中也是 T2，来自同步)

compareFileFreshness(file, entry)
  => compareMTime(T2, T2)
  => EVEN

shouldApplied = false

// ✅ 跳过！不会再次同步
```

**3. 如果本地又被 Obsidian 索引，mtime 变成 T4？**

```typescript
// Storage → DB

// Step 1: 比较 mtime
file.mtime = T4       (Obsidian 又更新了 mtime)
entry.mtime = T2      (数据库中还是 T2)

// ❌ 检查 sameChangePairs
isMarkedAsSameChanges(file, [T4, T2]) => false (没有标记过)

compareFileFreshness(file, entry)
  => compareMTime(T4, T2)
  => BASE_IS_NEW (本地更新？)

shouldApplied = true

// Step 2: 比较内容
file.content = "Hello Friday"  (本地，来自同步)
entry.content = "Hello Friday" (数据库，相同)

isDocContentSame() => true

// ✨ 内容相同！标记 T4 和 T2 为"相同内容"
markChangesAreSame(file, T4, T2)
sameChangePairs.set("file.md", [T4, T2])

shouldApplied = false

// ✅ 跳过！不会误判为修改
```

**4. 下次再检测时**

```typescript
// Step 1: 比较 mtime
file.mtime = T4
entry.mtime = T2

// ✨ 先检查 sameChangePairs
isMarkedAsSameChanges(file, [T4, T2])
  => pairs = [T4, T2]
  => [T4, T2].every(e => pairs.indexOf(e) !== -1)
  => true

compareFileFreshness() => EVEN

// ✅ 直接返回 EVEN，不需要读取文件内容比较！
```

---

## Friday Plugin 的实现差异与问题

### 当前实现

```typescript
// src/sync/FridayStorageEventManager.ts lines 52-65

const MTIME_RESOLUTION = 2000; // 2 seconds

export function compareMtime(baseMTime: number, targetMTime: number): "BASE_IS_NEW" | "TARGET_IS_NEW" | "EVEN" {
    const truncatedBaseMTime = Math.floor(baseMTime / MTIME_RESOLUTION) * MTIME_RESOLUTION;
    const truncatedTargetMTime = Math.floor(targetMTime / MTIME_RESOLUTION) * MTIME_RESOLUTION;
    
    if (truncatedBaseMTime === truncatedTargetMTime) return "EVEN";
    if (truncatedBaseMTime > truncatedTargetMTime) return "BASE_IS_NEW";
    return "TARGET_IS_NEW";
}
```

**问题**：
1. ✅ 有 mtime 比较（2秒精度）
2. ❌ **缺少内容比较后的 mtime 标记机制**
3. ❌ **没有持久化的 `sameChangePairs` 缓存**

结果：
- 每次文件 mtime 变化都要读取内容比较
- 重启后丢失"相同内容"的标记
- **旧设备打开文件后 mtime 变化，会触发不必要的同步**

---

## 实现方案

### 方案1：完整复制 LiveSync 的机制（推荐）

#### Step 1: 创建持久化存储

```typescript
// src/sync/utils/sameChangePairs.ts

import { PersistentMap } from "octagonal-wheels/dataobject/PersistentMap";

let sameChangePairs: PersistentMap<number[]> | null = null;

export function initializeSameChangePairs(vaultName: string): void {
    sameChangePairs = new PersistentMap<number[]>(`friday-same-changes-${vaultName}`);
}

export function getSameChangePairs(): PersistentMap<number[]> {
    if (!sameChangePairs) {
        throw new Error("sameChangePairs not initialized. Call initializeSameChangePairs first.");
    }
    return sameChangePairs;
}

/**
 * 标记两个 mtime 对应的是相同内容
 */
export function markChangesAreSame(
    filePath: string,
    mtime1: number,
    mtime2: number
): void {
    if (mtime1 === mtime2) return;
    
    const store = getSameChangePairs();
    const pairs = store.get(filePath, []) || [];
    
    // 如果已有 mtime1 或 mtime2 的记录，合并
    if (pairs.some((e) => e === mtime1 || e === mtime2)) {
        store.set(filePath, [...new Set([...pairs, mtime1, mtime2])]);
    } else {
        // 否则创建新的 mtime 对
        store.set(filePath, [mtime1, mtime2]);
    }
}

/**
 * 检查指定的 mtimes 是否都被标记为"相同内容"
 */
export function isMarkedAsSameChanges(
    filePath: string,
    mtimes: number[]
): boolean {
    const store = getSameChangePairs();
    const pairs = store.get(filePath, []) || [];
    
    // 如果所有 mtime 都在 pairs 中，说明它们是"相同内容"
    return mtimes.every((mtime) => pairs.indexOf(mtime) !== -1);
}

/**
 * 清除指定文件的标记（用于文件被真正修改时）
 */
export function unmarkChanges(filePath: string): void {
    const store = getSameChangePairs();
    store.delete(filePath);
}
```

#### Step 2: 更新 mtime 比较逻辑

```typescript
// src/sync/FridayStorageEventManager.ts

import { isMarkedAsSameChanges } from "./utils/sameChangePairs";

/**
 * 比较文件新鲜度（完整版，类似 LiveSync）
 * @returns "BASE_IS_NEW" | "TARGET_IS_NEW" | "EVEN"
 */
export function compareFileFreshness(
    baseFile: { path: string; mtime: number } | undefined,
    targetFile: { path: string; mtime: number } | undefined
): "BASE_IS_NEW" | "TARGET_IS_NEW" | "EVEN" {
    if (baseFile === undefined && targetFile === undefined) return "EVEN";
    if (baseFile === undefined) return "TARGET_IS_NEW";
    if (targetFile === undefined) return "BASE_IS_NEW";

    const baseMtime = baseFile.mtime;
    const targetMtime = targetFile.mtime;

    // ✨ 关键：先检查这两个 mtime 是否被标记为"相同内容"
    if (baseMtime && targetMtime && isMarkedAsSameChanges(baseFile.path, [baseMtime, targetMtime])) {
        return "EVEN";
    }

    // 如果没有标记，使用 2 秒精度比较
    return compareMtime(baseMtime, targetMtime);
}
```

#### Step 3: 在 Storage → DB 时标记

```typescript
// src/sync/FridayStorageEventManager.ts - storeFileToDB 方法

private async storeFileToDB(event: FileEvent, force: boolean = false): Promise<boolean> {
    // ... 现有逻辑 ...

    // 获取数据库中的文档
    const existingEntry = await this.core.localDatabase?.entryManager.getDBEntryMeta(path);
    
    if (existingEntry && !existingEntry._deleted) {
        let shouldUpdate = false;
        
        // Step 1: 比较 mtime（使用新的 compareFileFreshness）
        const mtimeComparison = compareFileFreshness(
            { path, mtime: file.stat.mtime },
            { path, mtime: existingEntry.mtime }
        );
        
        if (mtimeComparison !== "EVEN") {
            shouldUpdate = true;
        }
        
        // Step 2: mtime 不同但可能内容相同，需要读取内容比较
        if (shouldUpdate) {
            const existingData = getDocDataAsArray(existingEntry.data);
            const isSame = await isDocContentSame(existingData, contentBlob);
            
            if (isSame) {
                // ✨ 内容相同！标记 storage mtime 和 db mtime 为"相同内容"
                markChangesAreSame(path, file.stat.mtime, existingEntry.mtime);
                
                Logger(`File content unchanged, mtime marked as same: ${path}`, LOG_LEVEL_VERBOSE);
                
                // 更新 mtime 缓存
                const cacheKey = `${event.type}-${path}`;
                this.lastProcessedMtime.set(cacheKey, file.stat.mtime);
                
                // 不需要更新
                return true;
            } else {
                // 内容不同，清除旧标记
                unmarkChanges(path);
                shouldUpdate = true;
            }
        }
        
        if (!shouldUpdate) {
            Logger(`File not changed, skip: ${path}`, LOG_LEVEL_VERBOSE);
            return true;
        }
    }
    
    // 需要更新，写入数据库
    // ... 现有的写入逻辑 ...
}
```

#### Step 4: 在 DB → Storage 时标记

```typescript
// src/sync/FridayServiceHub.ts - defaultProcessSynchroniseResult 方法

private async defaultProcessSynchroniseResult(doc: MetaEntry): Promise<boolean> {
    // ... 现有逻辑 ...
    
    if (existingFile && existingFile instanceof TFile) {
        let shouldWrite = false;
        
        // Step 1: 比较 mtime（使用新的 compareFileFreshness）
        const localMtime = existingFile.stat.mtime;
        const remoteMtime = fullEntry.mtime || 0;
        
        const mtimeComparison = compareFileFreshness(
            { path: storageFilePath, mtime: localMtime },
            { path: storageFilePath, mtime: remoteMtime }
        );
        
        if (mtimeComparison !== "EVEN") {
            shouldWrite = true;
        }
        
        // Step 2: mtime 不同但可能内容相同，读取内容比较
        if (shouldWrite) {
            try {
                const localContent = await vault.readBinary(existingFile);
                const remoteContent = getDocDataAsArray(fullEntry.data);
                
                if (await isDocContentSame(remoteContent, new Uint8Array(localContent))) {
                    // ✨ 内容相同！标记 local mtime 和 remote mtime 为"相同内容"
                    markChangesAreSame(storageFilePath, localMtime, remoteMtime);
                    
                    Logger(`File content same, mtime marked: ${storageFilePath}`, LOG_LEVEL_VERBOSE);
                    
                    // 不需要写入
                    return true;
                } else {
                    // 内容不同，清除旧标记
                    unmarkChanges(storageFilePath);
                    shouldWrite = true;
                }
            } catch (error) {
                Logger(`Error comparing content: ${error}`, LOG_LEVEL_VERBOSE);
                shouldWrite = true;
            }
        }
        
        if (!shouldWrite) {
            Logger(`File not changed, skip write: ${storageFilePath}`, LOG_LEVEL_VERBOSE);
            return true;
        }
    }
    
    // 需要写入本地文件
    // ... 现有的写入逻辑 ...
}
```

#### Step 5: 在 FridaySyncCore 初始化时初始化存储

```typescript
// src/sync/FridaySyncCore.ts

import { initializeSameChangePairs } from "./utils/sameChangePairs";

export class FridaySyncCore implements LiveSyncLocalDBEnv, LiveSyncCouchDBReplicatorEnv {
    async initialize(config: SyncConfig): Promise<boolean> {
        // ... 现有初始化逻辑 ...
        
        // 初始化 sameChangePairs 存储
        const vaultName = this._app.vault.getName();
        initializeSameChangePairs(vaultName);
        
        Logger("sameChangePairs storage initialized", LOG_LEVEL_INFO);
        
        // ... 继续初始化 ...
    }
}
```

---

### 方案2：简化版（如果不想依赖 octagonal-wheels）

如果不想使用 LiveSync 的 `PersistentMap`，可以使用 Friday 现有的 SimpleStore：

```typescript
// src/sync/utils/sameChangePairs.ts (简化版)

import type { SimpleStore } from "../core/common/types";

let sameChangePairsStore: SimpleStore<number[]> | null = null;

export function initializeSameChangePairs(store: SimpleStore<number[]>): void {
    sameChangePairsStore = store;
}

export async function markChangesAreSame(
    filePath: string,
    mtime1: number,
    mtime2: number
): Promise<void> {
    if (mtime1 === mtime2) return;
    if (!sameChangePairsStore) return;
    
    const key = `same-changes:${filePath}`;
    const pairs = (await sameChangePairsStore.get(key)) || [];
    
    if (pairs.some((e) => e === mtime1 || e === mtime2)) {
        await sameChangePairsStore.set(key, [...new Set([...pairs, mtime1, mtime2])]);
    } else {
        await sameChangePairsStore.set(key, [mtime1, mtime2]);
    }
}

export async function isMarkedAsSameChanges(
    filePath: string,
    mtimes: number[]
): Promise<boolean> {
    if (!sameChangePairsStore) return false;
    
    const key = `same-changes:${filePath}`;
    const pairs = (await sameChangePairsStore.get(key)) || [];
    
    return mtimes.every((mtime) => pairs.indexOf(mtime) !== -1);
}

export async function unmarkChanges(filePath: string): Promise<void> {
    if (!sameChangePairsStore) return;
    
    const key = `same-changes:${filePath}`;
    await sameChangePairsStore.delete(key);
}
```

然后在初始化时：

```typescript
// src/sync/FridaySyncCore.ts

async initialize(config: SyncConfig): Promise<boolean> {
    // ... 现有初始化逻辑 ...
    
    // 初始化 sameChangePairs 存储
    const store = this._services.database.openSimpleStore<number[]>("friday-same-changes");
    initializeSameChangePairs(store);
    
    // ... 继续初始化 ...
}
```

---

## 性能优化

### 1. 缓存机制

LiveSync 的 `sameChangePairs` 是**持久化**的，但每次查询都需要访问存储。可以添加内存缓存：

```typescript
// src/sync/utils/sameChangePairs.ts

// 内存缓存
const memoryCache = new Map<string, number[]>();
const CACHE_SIZE_LIMIT = 1000; // 限制缓存大小

export async function isMarkedAsSameChanges(
    filePath: string,
    mtimes: number[]
): Promise<boolean> {
    // 先查内存缓存
    if (memoryCache.has(filePath)) {
        const pairs = memoryCache.get(filePath)!;
        return mtimes.every((mtime) => pairs.indexOf(mtime) !== -1);
    }
    
    // 查持久化存储
    if (!sameChangePairsStore) return false;
    
    const key = `same-changes:${filePath}`;
    const pairs = (await sameChangePairsStore.get(key)) || [];
    
    // 更新内存缓存
    if (memoryCache.size < CACHE_SIZE_LIMIT) {
        memoryCache.set(filePath, pairs);
    }
    
    return mtimes.every((mtime) => pairs.indexOf(mtime) !== -1);
}

export async function markChangesAreSame(
    filePath: string,
    mtime1: number,
    mtime2: number
): Promise<void> {
    // ... 更新持久化存储 ...
    
    // 同时更新内存缓存
    const pairs = (await sameChangePairsStore.get(key)) || [];
    memoryCache.set(filePath, pairs);
}
```

### 2. 清理策略

避免 `sameChangePairs` 无限增长：

```typescript
/**
 * 清理过期的 sameChangePairs 记录
 * 建议在 vault 打开时运行一次
 */
export async function cleanupOldSameChangePairs(vault: Vault): Promise<void> {
    if (!sameChangePairsStore) return;
    
    Logger("Cleaning up old sameChangePairs records...", LOG_LEVEL_INFO);
    
    // 获取所有文件路径
    const allFiles = vault.getMarkdownFiles().map(f => f.path);
    const allFilesSet = new Set(allFiles);
    
    // 扫描所有 sameChangePairs 记录
    const allKeys = await sameChangePairsStore.keys();
    let cleaned = 0;
    
    for (const key of allKeys) {
        if (!key.startsWith("same-changes:")) continue;
        
        const filePath = key.replace("same-changes:", "");
        
        // 如果文件不存在，删除记录
        if (!allFilesSet.has(filePath)) {
            await sameChangePairsStore.delete(key);
            memoryCache.delete(filePath);
            cleaned++;
        }
    }
    
    Logger(`Cleaned up ${cleaned} obsolete sameChangePairs records`, LOG_LEVEL_INFO);
}
```

---

## 测试用例

```typescript
describe('sameChangePairs mechanism', () => {
    it('should mark mtimes as same when content is identical', async () => {
        const file = "test.md";
        const mtime1 = 1000000000000;
        const mtime2 = 1000000001000;
        
        // 初始状态：未标记
        expect(await isMarkedAsSameChanges(file, [mtime1, mtime2])).toBe(false);
        
        // 标记为相同
        await markChangesAreSame(file, mtime1, mtime2);
        
        // 验证标记成功
        expect(await isMarkedAsSameChanges(file, [mtime1, mtime2])).toBe(true);
    });
    
    it('should handle multiple mtime pairs', async () => {
        const file = "test.md";
        const mtime1 = 1000000000000;
        const mtime2 = 1000000001000;
        const mtime3 = 1000000002000;
        
        // 标记 mtime1 和 mtime2
        await markChangesAreSame(file, mtime1, mtime2);
        
        // 标记 mtime2 和 mtime3（会合并）
        await markChangesAreSame(file, mtime2, mtime3);
        
        // 验证所有三个 mtime 都被标记为相同
        expect(await isMarkedAsSameChanges(file, [mtime1, mtime2, mtime3])).toBe(true);
    });
    
    it('should skip unnecessary content comparison', async () => {
        const file = { path: "test.md", mtime: 1000000001000 };
        const entry = { path: "test.md", mtime: 1000000000000 };
        
        // 标记为相同
        await markChangesAreSame(file.path, file.mtime, entry.mtime);
        
        // 比较时应该直接返回 EVEN
        const result = compareFileFreshness(file, entry);
        expect(result).toBe("EVEN");
        
        // 不需要读取文件内容！
    });
});
```

---

## 总结

### LiveSync 的核心优势

1. **内容为王**：mtime 不同但内容相同时，标记为"相同"
2. **持久化缓存**：标记信息在重启后依然有效
3. **性能优化**：第二次检查相同 mtime 对时，无需读取文件内容
4. **解决根本问题**：彻底解决"旧设备打开文件 mtime 变化"的误判

### Friday Plugin 需要做的

1. ✅ **添加 `sameChangePairs` 持久化存储**
2. ✅ **在 Storage → DB 时标记"内容相同的 mtime 对"**
3. ✅ **在 DB → Storage 时标记"内容相同的 mtime 对"**
4. ✅ **在 mtime 比较前先检查是否已标记**
5. ✅ **添加清理机制避免无限增长**

### 预期效果

- 旧设备打开文件后，即使 mtime 变化，也不会误判为修改
- 减少不必要的文件内容读取和比较
- 提升同步性能
- 彻底解决数据回滚问题的一个重要根源

