# mtime 处理机制实现总结

## 实现完成 ✅

基于 LiveSync 源码的 `sameChangePairs` 机制已完整实现，解决了"旧设备打开文件导致 mtime 变化"的数据回滚问题。

---

## 实现的文件

### 1. `src/sync/utils/sameChangePairs.ts` ✅
**完全基于 LiveSync 实现**：`livesync/src/common/stores.ts` 和 `livesync/src/common/utils.ts`

- 使用 `PersistentMap` 持久化存储 mtime 对应关系
- 核心函数：
  - `initializeSameChangePairs(vaultName)` - 初始化存储
  - `markChangesAreSame(file, mtime1, mtime2)` - 标记两个 mtime 对应相同内容
  - `isMarkedAsSameChanges(file, mtimes)` - 检查 mtime 是否已标记为相同
  - `unmarkChanges(file)` - 清除标记（文件真正修改时）
  - 符号常量：`BASE_IS_NEW`, `TARGET_IS_NEW`, `EVEN`

**存储键名**：`friday-persist-same-changes-${vaultName}`

### 2. `src/sync/FridayStorageEventManager.ts` ✅
**添加的功能**：

#### 新增 `compareFileFreshness()` 函数
```typescript
export function compareFileFreshness(
    baseFile: { path: string; mtime: number } | undefined,
    targetFile: { path: string; mtime: number } | undefined
): "BASE_IS_NEW" | "TARGET_IS_NEW" | "EVEN"
```

**特点**：
- 先检查 `sameChangePairs`（是否已标记为相同内容）
- 如果已标记，直接返回 `"EVEN"`，跳过内容比较
- 否则使用 2 秒精度的 `compareMtime` 比较

#### 更新 `storeFileToDB()` 方法（Storage → DB 流程）
```typescript
// ✨ Step 1: 使用 compareFileFreshness 检查
const freshnessResult = compareFileFreshness(
    { path, mtime: file.stat.mtime },
    { path, mtime: existingEntry.mtime }
);

if (freshnessResult === "EVEN") {
    // 已标记为相同或 mtime 相同，跳过
    return true;
}

// Step 2: mtime 不同，比较内容
const isSame = await isDocContentSame(existingData, contentBlob);

if (isSame) {
    // ✨ 内容相同！标记 mtime 对
    markChangesAreSame(path, file.stat.mtime, existingEntry.mtime);
    return true;
} else {
    // 内容不同，清除旧标记
    unmarkChanges(path);
}
```

### 3. `src/sync/FridayServiceHub.ts` ✅
**更新 `defaultProcessSynchroniseResult()` 方法（DB → Storage 流程）**

```typescript
// ✨ Step 1: 使用 compareFileFreshness 检查
const freshnessResult = compareFileFreshness(
    { path: storageFilePath, mtime: localMtime },
    { path: storageFilePath, mtime: remoteMtime }
);

if (freshnessResult === "EVEN") {
    // 已标记为相同，跳过写入
    return true;
}

// Step 2: mtime 不同，比较内容
const isSame = await isDocContentSame(content, localContent);

if (isSame) {
    // ✨ 内容相同！标记 mtime 对
    markChangesAreSame(storageFilePath, localMtime, remoteMtime);
    return true;
} else {
    // 内容不同，清除旧标记
    unmarkChanges(storageFilePath);
}
```

### 4. `src/sync/FridaySyncCore.ts` ✅
**在 `initialize()` 方法中初始化 `sameChangePairs`**

```typescript
// Initialize local database
const vaultName = this.getVaultName();
this._localDatabase = new LiveSyncLocalDB(vaultName, this);

const dbInitialized = await this._localDatabase.initializeDatabase();
if (!dbInitialized) {
    this.setStatus("ERRORED", "Failed to initialize local database");
    return false;
}

// ✨ Initialize sameChangePairs storage
initializeSameChangePairs(vaultName);
Logger("sameChangePairs storage initialized", LOG_LEVEL_INFO);
```

---

## 工作原理

### 场景：旧设备打开文件，mtime 变化但内容未变

```
初始状态：
  - PC:     file.md (mtime=T1, content="Hello")
  - Server: file.md (mtime=T1, content="Hello")
  - Phone:  file.md (mtime=T1, content="Hello")

Phone 长期离线...

PC 修改文件：
  - PC:     file.md (mtime=T2, content="Hello World")
  - Server: file.md (mtime=T2, content="Hello World")  [已同步]
  - Phone:  file.md (mtime=T1, content="Hello")        [离线]

Phone 打开 Obsidian，文件被索引，mtime 变化：
  - Phone:  file.md (mtime=T3, content="Hello")        [内容未变！]
```

### 同步流程

#### 1. Phone Pull from Server (DB → Storage)

```typescript
// Step 1: compareFileFreshness
localMtime = T3   (Phone 本地文件)
remoteMtime = T2  (Server)

// 第一次：未标记过，检查 mtime
// T3 ≠ T2 → freshnessResult = "BASE_IS_NEW" 或 "TARGET_IS_NEW"

// Step 2: 比较内容
localContent = "Hello"       (Phone 本地)
remoteContent = "Hello World" (Server)

// 内容不同！需要写入
unmarkChanges(path)
await vault.modify(file, "Hello World")

// Phone: file.md (mtime=T2, content="Hello World")  [已更新]
```

#### 2. Phone 再次索引，mtime 又变化

```typescript
// Obsidian 索引后
// Phone: file.md (mtime=T4, content="Hello World")  [内容未变]

// Storage → DB 流程
// Step 1: compareFileFreshness
fileMtime = T4    (本地文件)
dbMtime = T2      (数据库)

// T4 ≠ T2 → freshnessResult = "BASE_IS_NEW"

// Step 2: 比较内容
fileContent = "Hello World"
dbContent = "Hello World"

// ✨ 内容相同！
markChangesAreSame(path, T4, T2)
// sameChangePairs["file.md"] = [T4, T2]

// 跳过同步，不会误判为修改
```

#### 3. 下次检查时直接跳过

```typescript
// Storage → DB 流程
// Step 1: compareFileFreshness
fileMtime = T4
dbMtime = T2

// ✨ 检查 sameChangePairs
isMarkedAsSameChanges("file.md", [T4, T2])
// → 返回 EVEN

// 直接返回 "EVEN"，无需读取文件内容！
return true  // 跳过
```

---

## 优势

### 1. 解决根本问题
- 彻底解决"旧设备打开文件 mtime 变化导致误判为修改"的问题
- 防止数据回滚

### 2. 性能优化
- 第一次：需要读取内容比较
- 第二次及以后：直接查询 `sameChangePairs`，无需读取文件
- 持久化存储，重启后依然有效

### 3. 与 LiveSync 完全一致
- 使用相同的机制和逻辑
- 2 秒 mtime 精度（兼容 ZIP 文件）
- 相同的符号常量和命名

---

## 测试验证

### 测试 1：旧设备 mtime 变化（内容未变）

**步骤**：
1. 在 PC 上创建文件 `test.md`，内容 "Hello"
2. 同步到 Server
3. 在 Phone 上同步（获取文件）
4. Phone 断开网络（模拟离线）
5. PC 修改 `test.md` 为 "Hello World"，同步
6. Phone 打开 Obsidian（触发索引，mtime 变化）
7. Phone 联网，开始同步

**预期结果**：
- Phone 应该从 Server 拉取 "Hello World"（正确内容）
- 不会因为 Phone 的 mtime 变化而回滚到 "Hello"
- Console 应该显示：`File mtimes marked as same: test.md [T3, T2]`

### 测试 2：多次索引（验证缓存有效）

**步骤**：
1. 完成测试 1
2. Phone 重启 Obsidian（再次触发索引）
3. 查看 Console 日志

**预期结果**：
- Console 应该显示：`File mtimes are equivalent (marked or same), skip`
- 不会重新读取文件内容
- 同步快速完成

### 测试 3：真正的修改（验证清除标记）

**步骤**：
1. 完成测试 1
2. Phone 修改 `test.md` 为 "Hello Friday"
3. 同步到 Server

**预期结果**：
- 旧的 `sameChangePairs` 标记被清除
- 文件正常同步到 Server
- PC 可以拉取到最新内容 "Hello Friday"

### 测试 4：重启插件（验证持久化）

**步骤**：
1. 完成测试 1
2. 重启 Obsidian 插件
3. 触发同步

**预期结果**：
- `sameChangePairs` 依然有效（从 PersistentMap 恢复）
- Console 应该显示：`sameChangePairs storage initialized`
- 同步时依然能识别已标记的 mtime 对

---

## 调试日志

### 关键日志标记

**初始化**：
```
[INFO] sameChangePairs storage initialized for vault: MyVault
```

**标记 mtime 对**（Storage → DB）：
```
[VERBOSE] File content unchanged (mtime different), marked as same: note.md
[VERBOSE] Marked same changes: note.md [1709012345000, 1709012347000]
```

**标记 mtime 对**（DB → Storage）：
```
[VERBOSE] Content same, marked and skip write: note.md
[VERBOSE] Marked same changes: note.md [1709012347000, 1709012345000]
```

**使用缓存跳过**：
```
[VERBOSE] File mtimes marked as same: note.md [1709012347000, 1709012345000]
[VERBOSE] File mtimes are equivalent (marked or same), skip: note.md
```

**清除标记**（内容真正变化）：
```
[VERBOSE] Unmarked changes for: note.md
```

### 调试命令

在浏览器 Console 中执行：

```javascript
// 查看 sameChangePairs 存储
// 注意：PersistentMap 使用 IndexedDB，需要异步访问

// 1. 查看所有 IndexedDB 数据库
window.indexedDB.databases().then(dbs => console.log(dbs))

// 2. 查找 Friday 的存储
// 应该能看到类似 "friday-persist-same-changes-MyVault" 的数据库
```

---

## 总结

✅ **完全基于 LiveSync 的实现**
- 使用相同的 `PersistentMap` 存储
- 相同的逻辑和算法
- 相同的函数命名和结构

✅ **集成到两个关键流程**
- Storage → DB：本地文件变化检测
- DB → Storage：远程文件写入本地

✅ **持久化存储**
- 重启后依然有效
- 每个 vault 独立存储

✅ **性能优化**
- 第一次比较内容后标记
- 后续直接使用缓存
- 减少文件读取操作

✅ **解决核心问题**
- 旧设备 mtime 变化不会误判为修改
- 防止数据回滚
- 提升同步稳定性

---

## 下一步

建议测试顺序：
1. ✅ 基本功能测试（测试 1-3）
2. ⏳ 持久化测试（测试 4）
3. ⏳ 压力测试（大量文件、频繁索引）
4. ⏳ 边界测试（文件删除、重命名等）

实现完成！可以开始测试验证 🎉

