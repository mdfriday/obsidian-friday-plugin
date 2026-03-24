# Site.svelte 事件驱动架构实施记录

## 实施日期
2026-03-24

## 任务目标
在 Site.svelte 中实现所有 Main.ts 需要调用的公开方法，以及使用现代方式（直接调用 plugin 方法）替代过时的 `createEventDispatcher`。

---

## 实施内容

### 1. 导入类型定义 ✅

```typescript
import type { ProjectState, ProgressUpdate } from "../types/events";
```

### 2. 实现公开接口方法 ✅

在 `onMount` 之前添加了完整的公开接口方法：

#### 初始化方法
```typescript
export async function initialize(state: ProjectState)
```
- 接收项目状态
- 加载配置到 UI（title, baseURL, theme, publish config, etc.）
- 通知 Main.ts 初始化完成

#### 进度更新方法
```typescript
export function updateBuildProgress(progress: ProgressUpdate)
export function updatePublishProgress(progress: ProgressUpdate)
```
- 根据 `phase` 和 `percentage` 更新进度条
- 支持不同阶段：initializing, building, publishing, ready

#### 结果回调方法
```typescript
export function onBuildComplete(result: any)
export function onBuildError(error: string)
export function onPreviewStarted(result: any)
export function onPreviewError(error: string)
export function onPreviewStopped()
export function onPublishComplete(result: any)
export function onPublishError(error: string)
export function onConnectionTestSuccess(message?: string)
export function onConnectionTestError(error: string)
```
- 处理各种操作的完成或错误状态
- 更新 UI 状态变量
- 显示通知

### 3. 事件通知机制 ✅

使用**直接调用 plugin 方法**替代过时的 `createEventDispatcher`：

```typescript
// 通知 Main.ts
if (plugin.handleSiteEvent) {
    await plugin.handleSiteEvent('configChanged', {
        key: actualKey,
        value: actualValue
    });
}
```

#### 为什么不用 createEventDispatcher？
- Svelte 5 中已标记为 `@deprecated`
- 推荐使用 callback props 或 `$host()` rune
- 我们采用了直接调用 `plugin.handleSiteEvent()` 的方式，更简洁直接

### 4. 重构配置保存 ✅

**旧方式**:
```typescript
await plugin.saveFoundryProjectConfig(
    plugin.currentProjectName,
    key,
    value
);
```

**新方式**:
```typescript
if (plugin.handleSiteEvent) {
    await plugin.handleSiteEvent('configChanged', {
        key: actualKey,
        value: actualValue
    });
} else {
    // Fallback to old method
    await plugin.saveFoundryProjectConfig(...);
}
```

### 5. onMount 增强 ✅

在 `onMount` 末尾添加初始化通知：

```typescript
// Notify Main.ts that component is ready
if (plugin.handleSiteEvent && plugin.currentProjectName) {
    await plugin.handleSiteEvent('initialized', {
        projectName: plugin.currentProjectName
    });
}
```

---

## 方法映射表

| Main.ts 调用 | Site.svelte 方法 | 功能 |
|-------------|------------------|------|
| `site.initialize(state)` | `export function initialize()` | 初始化组件 |
| `site.updateBuildProgress(progress)` | `export function updateBuildProgress()` | 更新构建进度 |
| `site.updatePublishProgress(progress)` | `export function updatePublishProgress()` | 更新发布进度 |
| `site.onBuildComplete(result)` | `export function onBuildComplete()` | 构建完成 |
| `site.onBuildError(error)` | `export function onBuildError()` | 构建错误 |
| `site.onPreviewStarted(result)` | `export function onPreviewStarted()` | 预览启动 |
| `site.onPreviewError(error)` | `export function onPreviewError()` | 预览错误 |
| `site.onPreviewStopped()` | `export function onPreviewStopped()` | 预览停止 |
| `site.onPublishComplete(result)` | `export function onPublishComplete()` | 发布完成 |
| `site.onPublishError(error)` | `export function onPublishError()` | 发布错误 |
| `site.onConnectionTestSuccess(msg)` | `export function onConnectionTestSuccess()` | 连接测试成功 |
| `site.onConnectionTestError(error)` | `export function onConnectionTestError()` | 连接测试错误 |

---

## 事件通知映射表

| Site.svelte 操作 | 事件类型 | 数据 | Main.ts 处理器 |
|-----------------|---------|------|---------------|
| 组件初始化完成 | `initialized` | `{ projectName }` | `onSiteInitialized()` |
| 配置变更 | `configChanged` | `{ key, value }` | `onConfigChanged()` |
| 构建请求 | `buildRequested` | `{ projectName }` | `onBuildRequested()` |
| 预览请求 | `previewRequested` | `{ projectName, port, renderer }` | `onPreviewRequested()` |
| 发布请求 | `publishRequested` | `{ projectName, method, config }` | `onPublishRequested()` |
| 测试连接 | `testConnection` | `{ projectName, config }` | `onTestConnection()` |
| 停止预览 | `stopPreview` | `{ projectName }` | `onStopPreview()` |

---

## 向后兼容

所有方法都保留了 fallback 机制：

```typescript
if (plugin.handleSiteEvent) {
    // Use new event system
    await plugin.handleSiteEvent('configChanged', { key, value });
} else {
    // Fallback to old method
    await plugin.saveFoundryProjectConfig(projectName, key, value);
}
```

这确保了：
- ✅ 新架构可以正常工作
- ✅ 如果事件系统未初始化，自动降级到旧方法
- ✅ 平滑过渡，不影响现有功能

---

## 数据流示例

### 配置保存流程

```
用户修改 siteName
    ↓
UI blur 事件
    ↓
saveFoundryConfig('title', siteName)
    ├─ 处理复杂结构（module, services, params）
    ├─ 准备 actualKey, actualValue
    └─ plugin.handleSiteEvent('configChanged', { key, value })
         ↓
Main.ts.handleSiteEvent('configChanged')
    └─ onConfigChanged()
         └─ projectServiceManager.saveConfig(projectName, key, value)
              └─ foundryProjectConfigService.set()
```

### 预览流程（带进度）

```
用户点击预览按钮
    ↓
startPreview()
    └─ plugin.handleSiteEvent('previewRequested', { projectName, port, renderer })
         ↓
Main.ts.onPreviewRequested()
    ├─ 创建进度回调: onProgress = (progress) => site.updateBuildProgress(progress)
    └─ projectServiceManager.startPreview({ port, renderer, onProgress })
         └─ foundryServeService.start()
              ├─ 回调: onProgress({ phase: 'initializing', percentage: 5 })
              │    └─ Site.updateBuildProgress() → buildProgress = 5%
              ├─ 回调: onProgress({ phase: 'building', percentage: 50 })
              │    └─ Site.updateBuildProgress() → buildProgress = 50%
              └─ 回调: onProgress({ phase: 'ready', percentage: 100 })
                   └─ Site.updateBuildProgress() → buildProgress = 100%
         ↓
Main.ts: result = { success: true, url: '...' }
    └─ site.onPreviewStarted(result)
         └─ Site.onPreviewStarted()
              ├─ serverRunning = true
              ├─ hasPreview = true
              ├─ previewUrl = result.url
              └─ console.log('Preview started')
```

---

## 状态变量更新

以下 UI 状态变量通过公开方法更新：

| 变量 | 更新方法 | 说明 |
|------|---------|------|
| `buildProgress` | `updateBuildProgress()` | 构建进度 0-100 |
| `publishProgress` | `updatePublishProgress()` | 发布进度 0-100 |
| `isBuilding` | `onBuildComplete()` / `onBuildError()` | 是否正在构建 |
| `isPublishing` | `onPublishComplete()` / `onPublishError()` | 是否正在发布 |
| `serverRunning` | `onPreviewStarted()` / `onPreviewStopped()` | 预览服务器状态 |
| `hasPreview` | `onPreviewStarted()` / `onPreviewError()` | 是否有预览 |
| `previewUrl` | `onPreviewStarted()` | 预览 URL |
| `publishSuccess` | `onPublishComplete()` | 发布是否成功 |

---

## 编译状态

✅ **编译成功**，无错误

```bash
npm run build
> obsidian-friday-plugin@26.2.6 build
✓ Build completed successfully
```

---

## 下一步

现在 Site.svelte 已经完成基础接口实现，但还需要：

### 待完成的集成点

1. **预览按钮事件** - 需要找到预览按钮的 click 事件处理，改为发送 `previewRequested` 事件
2. **发布按钮事件** - 需要找到发布按钮的 click 事件处理，改为发送 `publishRequested` 事件
3. **测试连接按钮** - 需要找到测试连接按钮，改为发送 `testConnection` 事件
4. **停止预览** - 需要找到停止预览的处理，改为发送 `stopPreview` 事件

这些都是 UI 按钮触发的操作，需要在下一步中逐个处理。

---

## 关键改进

1. **现代化通信方式**
   - 不使用过时的 `createEventDispatcher`
   - 直接调用 `plugin.handleSiteEvent()`
   - 更清晰、更直接

2. **完整的进度支持**
   - 所有方法都准备好接收进度回调
   - 可以实时更新 UI 进度条

3. **向后兼容**
   - 所有方法都有 fallback
   - 确保平滑过渡

4. **职责清晰**
   - Site.svelte 只负责 UI 更新
   - Main.ts 负责业务逻辑和 Foundry 服务调用
   - 通过明确的接口通信

---

## 相关文档

- `docs/architecture-site-main-communication.md` - 架构设计文档
- `docs/task1-project-creation-refactor.md` - 任务1实施记录

---

## 总结

Site.svelte 的基础接口已经完成：
- ✅ 实现了所有 Main.ts 需要调用的公开方法
- ✅ 使用现代方式（直接调用）替代过时的事件分发器
- ✅ 重构了配置保存逻辑
- ✅ 添加了初始化通知
- ✅ 保留了向后兼容性
- ✅ 代码编译通过

下一步需要找到 UI 按钮的事件处理器，将它们改为发送事件到 Main.ts。
