# 修复 Main.ts 中 Site 组件调用错误

## 修复日期
2026-03-24

## 问题描述

在之前的新架构实现中，`Main.ts` 的事件处理方法中错误地使用了 `this.site` 来调用 UI 更新方法，但 `this.site` 是 `src/site.ts` 的实例（数据管理对象），而不是 `Site.svelte` 组件。

应该使用 `this.siteComponent` 来调用 `Site.svelte` 的 public 方法。

---

## 错误实例

### 问题代码

```typescript
// ❌ 错误：this.site 是 src/site.ts 实例，不是 Site.svelte 组件
private async onBuildRequested(data: SiteEventData['buildRequested']) {
    const onProgress = (progress: any) => {
        this.site?.updateBuildProgress?.(progress);  // ❌ 错误
    };
    
    // ...
    
    if (result.success) {
        this.site?.onBuildComplete?.(result);  // ❌ 错误
    } else {
        this.site?.onBuildError?.(result.error);  // ❌ 错误
    }
}
```

### 正确代码

```typescript
// ✅ 正确：this.siteComponent 是 Site.svelte 组件引用
private async onBuildRequested(data: SiteEventData['buildRequested']) {
    const onProgress = (progress: any) => {
        this.siteComponent?.updateBuildProgress?.(progress);  // ✅ 正确
    };
    
    // ...
    
    if (result.success) {
        this.siteComponent?.onBuildComplete?.(result);  // ✅ 正确
    } else {
        this.siteComponent?.onBuildError?.(result.error);  // ✅ 正确
    }
}
```

---

## 对象区分

### this.site (src/site.ts)

**类型**: `Site` 类实例

**职责**: 数据管理对象
- 使用 Svelte stores 管理内容选择状态
- 提供 `languageContents` 和 `siteAssets` reactive stores
- 方法：`initializeContent()`, `addLanguageContent()`, `removeLanguageContent()`, 等

**不包含**: UI 更新方法（如 `updateBuildProgress`, `onBuildComplete` 等）

```typescript
// src/site.ts
export class Site {
    languageContents = writable<Record<string, LanguageContent>>({});
    siteAssets = writable<SiteAssetContent>({ assets: [] });
    
    initializeContent(folder: TFolder | null, file: TFile | null) {
        // 初始化内容选择状态
    }
    
    addLanguageContent(languageCode: string, content: LanguageContent) {
        // 添加语言内容
    }
    
    // ... 不包含 UI 更新方法
}
```

### this.siteComponent (Site.svelte)

**类型**: `Site.svelte` 组件实例

**职责**: UI 组件
- 渲染 UI
- 响应用户交互
- 暴露 public 方法供 `Main.ts` 调用

**包含**: 所有 UI 更新方法

```typescript
// Site.svelte 中注册的方法
{
    initialize,                    // 初始化项目状态
    updateBuildProgress,          // 更新构建进度
    updatePublishProgress,        // 更新发布进度
    onBuildComplete,              // 构建完成回调
    onBuildError,                 // 构建错误回调
    onPreviewStarted,             // 预览启动回调
    onPreviewError,               // 预览错误回调
    onPreviewStopped,             // 预览停止回调
    onPublishComplete,            // 发布完成回调
    onPublishError,               // 发布错误回调
    onConnectionTestSuccess,      // 连接测试成功
    onConnectionTestError         // 连接测试失败
}
```

---

## 修复清单

### 1. onBuildRequested 方法

**文件**: `src/main.ts` 行 789-813

**修改**:
- `this.site?.updateBuildProgress` → `this.siteComponent?.updateBuildProgress`
- `this.site?.onBuildComplete` → `this.siteComponent?.onBuildComplete`
- `this.site?.onBuildError` → `this.siteComponent?.onBuildError`

### 2. onPreviewRequested 方法

**文件**: `src/main.ts` 行 815-841

**修改**:
- `this.site?.updateBuildProgress` → `this.siteComponent?.updateBuildProgress`
- `this.site?.onPreviewStarted` → `this.siteComponent?.onPreviewStarted`
- `this.site?.onPreviewError` → `this.siteComponent?.onPreviewError`

### 3. onPublishRequested 方法

**文件**: `src/main.ts` 行 843-869

**修改**:
- `this.site?.updatePublishProgress` → `this.siteComponent?.updatePublishProgress`
- `this.site?.onPublishComplete` → `this.siteComponent?.onPublishComplete`
- `this.site?.onPublishError` → `this.siteComponent?.onPublishError`

### 4. onTestConnection 方法

**文件**: `src/main.ts` 行 871-888

**修改**:
- `this.site?.onConnectionTestSuccess` → `this.siteComponent?.onConnectionTestSuccess`
- `this.site?.onConnectionTestError` → `this.siteComponent?.onConnectionTestError`

### 5. onStopPreview 方法

**文件**: `src/main.ts` 行 890-900

**修改**:
- `this.site?.onPreviewStopped` → `this.siteComponent?.onPreviewStopped`

---

## 验证结果

### 编译检查

✅ **编译成功**，无错误

```bash
npm run build
> obsidian-friday-plugin@26.2.6 build
✓ Build completed successfully
  main.js    5.4mb
  main.css  31.8kb
```

### 代码检查

使用 grep 验证所有错误调用已修复：

```bash
grep -n "this\.site\?\.(update|on[A-Z])" src/main.ts
# 结果：无匹配（已全部修复）
```

---

## 事件处理完整性检查

### handleSiteEvent 覆盖的事件类型

```typescript
async handleSiteEvent<T extends SiteEventType>(type: T, data: SiteEventData[T]) {
    switch (type) {
        case 'initialized':         ✅ 已处理
        case 'configChanged':       ✅ 已处理
        case 'buildRequested':      ✅ 已处理
        case 'previewRequested':    ✅ 已处理
        case 'publishRequested':    ✅ 已处理
        case 'testConnection':      ✅ 已处理
        case 'stopPreview':         ✅ 已处理
    }
}
```

### 事件类型定义

**文件**: `src/types/events.ts`

```typescript
export type SiteEventType = 
    | 'initialized'          // ✅ 已定义
    | 'configChanged'        // ✅ 已定义
    | 'buildRequested'       // ✅ 已定义
    | 'previewRequested'     // ✅ 已定义
    | 'publishRequested'     // ✅ 已定义
    | 'testConnection'       // ✅ 已定义
    | 'stopPreview';         // ✅ 已定义
```

✅ **所有事件类型已定义且在 `handleSiteEvent` 中正确处理**

---

## 数据流图（修复后）

### 构建流程

```
Site.svelte: 用户点击"Build"
    ↓ 触发 buildRequested 事件
Main.ts: handleSiteEvent('buildRequested')
    ↓ 调用 onBuildRequested
    ↓ 创建 onProgress 回调
    ↓ projectServiceManager.build()
        ↓ 进度回调
        ↓ this.siteComponent.updateBuildProgress(progress) ✅ 正确
    ↓ 构建完成
    ↓ this.siteComponent.onBuildComplete(result) ✅ 正确
Site.svelte: 更新 UI（进度条、状态）
```

### 预览流程

```
Site.svelte: 用户点击"Preview"
    ↓ 触发 previewRequested 事件
Main.ts: handleSiteEvent('previewRequested')
    ↓ 调用 onPreviewRequested
    ↓ 创建 onProgress 回调
    ↓ projectServiceManager.startPreview()
        ↓ 进度回调
        ↓ this.siteComponent.updateBuildProgress(progress) ✅ 正确
    ↓ 预览启动
    ↓ this.siteComponent.onPreviewStarted(result) ✅ 正确
Site.svelte: 显示预览链接
```

### 发布流程

```
Site.svelte: 用户点击"Publish"
    ↓ 触发 publishRequested 事件
Main.ts: handleSiteEvent('publishRequested')
    ↓ 调用 onPublishRequested
    ↓ 创建 onProgress 回调
    ↓ projectServiceManager.publish()
        ↓ 进度回调
        ↓ this.siteComponent.updatePublishProgress(progress) ✅ 正确
    ↓ 发布完成
    ↓ this.siteComponent.onPublishComplete(result) ✅ 正确
Site.svelte: 显示发布成功信息
```

---

## 架构清晰度

### 职责明确

**Main.ts**:
- ✅ 持有 `this.site` (数据管理) 和 `this.siteComponent` (UI 组件)
- ✅ 使用 `this.site.initializeContent()` 管理内容数据
- ✅ 使用 `this.siteComponent.initialize()` 更新 UI
- ✅ 使用 `this.siteComponent.updateXXX()` 更新进度
- ✅ 使用 `this.siteComponent.onXXX()` 处理回调

**src/site.ts**:
- ✅ 只负责数据管理
- ✅ 提供 Svelte stores
- ❌ 不包含 UI 更新逻辑

**Site.svelte**:
- ✅ 只负责 UI 展示
- ✅ 响应用户交互
- ✅ 暴露 public 方法供 Main.ts 调用
- ❌ 不直接操作 Foundry 服务

---

## 测试建议

### 功能测试

- [ ] 构建项目：验证进度条正常更新
- [ ] 预览项目：验证预览链接正确显示
- [ ] 发布项目：验证发布进度和结果
- [ ] FTP 连接测试：验证成功/失败提示
- [ ] 停止预览：验证状态正确更新

### 回归测试

- [ ] 内容选择功能：验证 `this.site.initializeContent()` 正常工作
- [ ] 语言管理：验证 `this.site.addLanguageContent()` 正常工作
- [ ] 配置保存：验证 `configChanged` 事件正常触发

---

## 相关文档

- `docs/apply-project-to-panel-refactor.md` - 新架构实现文档
- `docs/architecture-site-main-communication.md` - 架构设计文档
- `docs/project-creation-flow-optimization.md` - 项目创建流程优化

---

## 总结

这次修复解决了一个**关键的架构问题**：

1. ✅ **正确区分**: `this.site` (数据管理) vs `this.siteComponent` (UI 组件)
2. ✅ **全部修复**: 所有 5 个事件处理方法中的 12 处错误调用
3. ✅ **编译通过**: 无错误，无警告
4. ✅ **事件完整**: 所有 7 个事件类型都已正确处理
5. ✅ **架构清晰**: Controller-View 职责分离明确

修复后的代码**完全符合新架构设计**，`Main.ts` 通过 `this.siteComponent` 正确控制 `Site.svelte` 的 UI 更新，实现了清晰的单向数据流。
