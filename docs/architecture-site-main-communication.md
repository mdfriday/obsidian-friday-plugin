# Site.svelte 与 Main.ts 通信架构设计

## 文档版本
- **创建日期**: 2026-03-24
- **版本**: 1.0.0

---

## 目录
1. [背景和问题](#背景和问题)
2. [核心架构设计](#核心架构设计)
3. [关键组件](#关键组件)
4. [数据流设计](#数据流设计)
5. [进度管理机制](#进度管理机制)
6. [实施计划](#实施计划)

---

## 背景和问题

### 当前问题

#### 1. 通信方式混乱
现有的通信方式包括：

**Main.ts → Site.svelte**:
- 直接调用方法：`this.site.initializeContent()`
- 注册回调函数：`plugin.reloadFoundryProjectConfig = loadFoundryProjectConfig`
- 设置属性：`plugin.setSitePath = setSitePathExternal`

**Site.svelte → Main.ts**:
- 直接访问服务：`plugin.foundryPublishService.publish()`
- 调用封装方法：`plugin.saveFoundryProjectConfig()`
- 读取全局配置：`plugin.foundryGlobalConfigService.list()`
- 访问状态：`plugin.currentProjectName`, `plugin.absWorkspacePath`

#### 2. 职责边界不清
- Site.svelte 直接调用 Foundry 服务
- Site.svelte 负责配置保存逻辑
- Main.ts 通过注册函数间接控制 Site.svelte
- 进度更新逻辑分散

#### 3. 数据重复维护
- `src/projects/service.ts` 维护项目配置数据
- Foundry 服务也维护项目配置
- 两套数据需要同步，容易不一致

---

## 核心架构设计

### 设计原则

**1. 单向数据流**
```
Main.ts (Controller)
    ↓ [Commands/Data]
Site.svelte (View)
    ↓ [Events]
Main.ts (Controller)
```

**2. 职责分离**
- **Main.ts**: 业务逻辑层，统一协调所有 Foundry 服务
- **Site.svelte**: 表现层，负责 UI 展示和用户交互
- **Services**: 封装服务，提供高层次业务接口

**3. 事件驱动**
- Site.svelte 通过事件通知 Main.ts 用户操作
- Main.ts 通过方法调用更新 Site.svelte 状态

**4. 进度回调**
- Main.ts 创建进度回调函数
- 回调通过 Site.svelte 公开方法更新 UI
- Foundry 服务调用回调报告进度

### 架构图

```
┌──────────────────────────────────────────────────────────────┐
│                         Main.ts                              │
│                    (Business Logic Layer)                    │
│                                                              │
│  ┌────────────────────────────────────────────────────┐    │
│  │          Foundry Services Manager                  │    │
│  │  ┌──────────────┐  ┌──────────────┐               │    │
│  │  │ Project Mgmt │  │ Build/Serve  │               │    │
│  │  └──────────────┘  └──────────────┘               │    │
│  │  ┌──────────────┐  ┌──────────────┐               │    │
│  │  │   Publish    │  │  Config Mgmt │               │    │
│  │  └──────────────┘  └──────────────┘               │    │
│  └────────────────────────────────────────────────────┘    │
│                                                              │
│  ┌────────────────────────────────────────────────────┐    │
│  │    Services Abstraction (src/services/)            │    │
│  │  - LicenseStateManager                             │    │
│  │  - DomainServiceManager                            │    │
│  │  - ProjectServiceManager (New)                     │    │
│  └────────────────────────────────────────────────────┘    │
│                                                              │
│           ↑ Events (dispatch)    ↓ Commands + Progress     │
└──────────────────────────────────────────────────────────────┘
                              │
┌──────────────────────────────────────────────────────────────┐
│                      Site.svelte                             │
│                   (Presentation Layer)                       │
│                                                              │
│  ┌────────────────────────────────────────────────────┐    │
│  │              UI Components                         │    │
│  │  - Project Config Forms                            │    │
│  │  - Progress Bar (buildProgress)                    │    │
│  │  - Publish Buttons                                 │    │
│  │  - Preview Controls                                │    │
│  └────────────────────────────────────────────────────┘    │
│                                                              │
│           ↓ User Actions        ↑ State Updates            │
└──────────────────────────────────────────────────────────────┘
```

---

## 关键组件

### 1. ProjectServiceManager

**位置**: `src/services/project.ts`

**职责**:
- 统一封装所有 Foundry 项目服务
- 提供高层次业务接口
- 隐藏 Foundry 服务实现细节
- 处理错误和边界情况

**核心方法**:

```typescript
class ProjectServiceManager {
    // 项目管理
    async createProject(options): Promise<ProjectResult>
    async listProjects(): Promise<ProjectInfo[]>
    async getProjectInfo(projectName): Promise<ProjectInfo | null>
    
    // 配置管理
    async getConfig(projectName): Promise<Record<string, any>>
    async saveConfig(projectName, key, value): Promise<boolean>
    async saveAllConfig(projectName, config): Promise<boolean>
    
    // 构建和预览
    async build(projectName, onProgress?): Promise<BuildResult>
    async startPreview(projectName, options): Promise<PreviewResult>
    async stopPreview(projectName): Promise<boolean>
    
    // 发布
    async publish(projectName, options): Promise<PublishResult>
    async testConnection(projectName, config): Promise<ConnectionResult>
}
```

### 2. 事件系统

**位置**: `src/types/events.ts`

**事件类型**:
```typescript
type SiteEventType = 
    | 'initialized'          // 组件初始化完成
    | 'configChanged'        // 配置变更
    | 'buildRequested'       // 请求构建
    | 'previewRequested'     // 请求预览
    | 'publishRequested'     // 请求发布
    | 'testConnection'       // 测试连接
    | 'stopPreview';         // 停止预览
```

**进度更新**:
```typescript
interface ProgressUpdate {
    phase: 'initializing' | 'building' | 'watching' | 'publishing' | 'ready';
    percentage: number;
    message?: string;
}
```

### 3. Main.ts 事件处理

**核心接口**:
```typescript
class FridayPlugin {
    // 注册 Site 组件
    registerSiteComponent(component: any): void
    
    // 统一事件处理
    handleSiteEvent<T extends SiteEventType>(
        type: T,
        data: SiteEventData[T]
    ): Promise<void>
    
    // 具体事件处理器
    private onConfigChanged(data): Promise<void>
    private onPreviewRequested(data): Promise<void>
    private onPublishRequested(data): Promise<void>
    // ...
}
```

### 4. Site.svelte 接口

**对外接口（Main.ts 调用）**:
```typescript
// 初始化
export function initialize(state: ProjectState): Promise<void>

// 进度更新
export function updateBuildProgress(progress: ProgressUpdate): void
export function updatePublishProgress(progress: ProgressUpdate): void

// 结果回调
export function onBuildComplete(result): void
export function onBuildError(error): void
export function onPreviewStarted(result): void
export function onPreviewError(error): void
export function onPublishComplete(result): void
export function onPublishError(error): void
```

**事件分发（Site.svelte → Main.ts）**:
```typescript
dispatch('configChanged', { key, value })
dispatch('previewRequested', { projectName, port, renderer })
dispatch('publishRequested', { projectName, method, config })
```

---

## 数据流设计

### 项目创建流程

```
用户操作：右键文件 → 发布
    ↓
Main.ts.createProject()
    ├─ 收集初始配置
    ├─ projectServiceManager.createProject()  [调用 Foundry]
    │    └─ foundryProjectService.createProject()
    │    └─ foundryProjectConfigService.setAll()
    └─ site.initialize(projectState)          [初始化 UI]
         ├─ 加载配置到 UI
         └─ dispatch('initialized')           [通知完成]
```

### 配置变更流程

```
用户修改配置 → UI 更新
    ↓
Site.svelte: handleChange()
    └─ dispatch('configChanged', { key, value })
         ↓
Main.ts.handleSiteEvent('configChanged')
    └─ projectServiceManager.saveConfig()
         └─ foundryProjectConfigService.set()
```

### 预览流程（带进度）

```
用户点击预览按钮
    ↓
Site.svelte: handlePreview()
    └─ dispatch('previewRequested', { projectName, port, renderer })
         ↓
Main.ts.handleSiteEvent('previewRequested')
    ├─ 创建进度回调: onProgress = (progress) => site.updateBuildProgress(progress)
    └─ projectServiceManager.startPreview(projectName, { port, renderer, onProgress })
         └─ foundryServeService.start()
              ├─ 回调: onProgress({ phase: 'initializing', percentage: 5 })
              │    └─ site.updateBuildProgress() → UI 更新
              ├─ 回调: onProgress({ phase: 'building', percentage: 50 })
              │    └─ site.updateBuildProgress() → UI 更新
              └─ 回调: onProgress({ phase: 'ready', percentage: 100 })
                   └─ site.updateBuildProgress() → UI 更新
         ↓
Main.ts: result = ...
    └─ site.onPreviewStarted(result) → UI 显示 URL
```

### 发布流程（带进度）

```
用户点击发布按钮
    ↓
Site.svelte: handlePublish()
    ├─ 收集发布配置（UI 数据）
    └─ dispatch('publishRequested', { projectName, method, config })
         ↓
Main.ts.handleSiteEvent('publishRequested')
    ├─ 创建进度回调: onProgress = (progress) => site.updatePublishProgress(progress)
    └─ projectServiceManager.publish(projectName, { method, config, onProgress })
         └─ foundryPublishService.publish()
              ├─ 回调: onProgress({ phase: 'building', percentage: 30 })
              │    └─ site.updatePublishProgress() → UI 更新
              ├─ 回调: onProgress({ phase: 'publishing', percentage: 80 })
              │    └─ site.updatePublishProgress() → UI 更新
              └─ 回调: onProgress({ phase: 'ready', percentage: 100 })
                   └─ site.updatePublishProgress() → UI 更新
         ↓
Main.ts: result = ...
    └─ site.onPublishComplete(result) → UI 显示结果
```

---

## 进度管理机制

### 进度回调设计

**1. 创建回调**（Main.ts）:
```typescript
private async onPreviewRequested(data: SiteEventData['previewRequested']) {
    // 创建进度回调函数
    const onProgress = (progress: ProgressUpdate) => {
        // 将进度直接传递给 Site 组件
        this.site?.updateBuildProgress?.(progress);
    };
    
    // 调用服务，传入回调
    const result = await this.projectServiceManager.startPreview(
        data.projectName,
        { 
            port: data.port, 
            renderer: data.renderer,
            onProgress  // ← 传递回调
        }
    );
    
    // 处理结果
    if (result.success) {
        this.site?.onPreviewStarted?.(result);
    }
}
```

**2. 更新 UI**（Site.svelte）:
```typescript
export function updateBuildProgress(progress: ProgressUpdate) {
    // 根据 phase 和 percentage 更新进度条
    if (progress.phase === 'initializing') {
        buildProgress = Math.min(10, progress.percentage * 0.1);
    } else if (progress.phase === 'building') {
        buildProgress = 10 + Math.min(80, progress.percentage * 0.8);
    } else if (progress.phase === 'ready') {
        buildProgress = 100;
    }
}
```

**3. Foundry 服务调用回调**:
```typescript
// Foundry 内部会在不同阶段调用回调
foundryServeService.start(workspacePath, projectName, {
    onProgress: (progress) => {
        // progress = { phase: 'building', percentage: 45 }
    }
});
```

### 进度阶段映射

| Foundry Phase | Percentage Range | UI Display |
|---------------|------------------|------------|
| `initializing` | 0-10% | "Initializing..." |
| `building` | 10-90% | "Building..." |
| `watching` | - | "Watching for changes..." |
| `publishing` | 50-100% | "Publishing..." |
| `ready` | 100% | "Ready" |

---

## 实施计划

### Phase 1: 基础设施搭建

**任务 1.1**: 创建类型定义
- [ ] 创建 `src/types/events.ts`
- [ ] 定义 `SiteEventType`
- [ ] 定义 `SiteEventData`
- [ ] 定义 `ProgressUpdate`
- [ ] 定义 `ProjectState`

**任务 1.2**: 创建 ProjectServiceManager
- [ ] 创建 `src/services/project.ts`
- [ ] 实现项目管理方法
- [ ] 实现配置管理方法
- [ ] 实现构建和预览方法
- [ ] 实现发布方法

### Phase 2: Main.ts 重构

**任务 2.1**: 添加事件处理系统
- [ ] 添加 `registerSiteComponent` 方法
- [ ] 添加 `handleSiteEvent` 方法
- [ ] 实现各个事件处理器

**任务 2.2**: 重构项目创建流程
- [ ] 使用 `projectServiceManager.createProject()`
- [ ] 使用 `site.initialize()` 初始化 UI
- [ ] 移除旧的通信方式

**任务 2.3**: 重构预览和发布流程
- [ ] 添加进度回调创建逻辑
- [ ] 使用事件驱动方式触发操作
- [ ] 通过 Site 组件方法更新进度

### Phase 3: Site.svelte 重构

**任务 3.1**: 添加对外接口
- [ ] 实现 `initialize()` 方法
- [ ] 实现进度更新方法
- [ ] 实现结果回调方法

**任务 3.2**: 重构用户交互处理
- [ ] 使用 `dispatch` 替换直接调用
- [ ] 移除直接访问 Foundry 服务
- [ ] 移除配置保存逻辑

**任务 3.3**: 注册到 Main.ts
- [ ] 在 `onMount` 中注册组件
- [ ] 发送 `initialized` 事件

### Phase 4: 清理和优化

**任务 4.1**: 精简 ProjectService
- [ ] 移除项目配置管理（使用 Foundry）
- [ ] 保留 Build History 管理
- [ ] 保留 FTP Manifest 管理

**任务 4.2**: 移除旧代码
- [ ] 移除 `reloadFoundryProjectConfig` 注册方式
- [ ] 移除 `setSitePath` 等直接方法注册
- [ ] 移除 Site.svelte 中的 Foundry 服务直接调用

**任务 4.3**: 测试和验证
- [ ] 测试项目创建流程
- [ ] 测试配置修改流程
- [ ] 测试预览流程和进度显示
- [ ] 测试发布流程和进度显示
- [ ] 测试错误处理

---

## 优势总结

### 1. 职责清晰
- **Main.ts**: 唯一操作 Foundry 服务的地方
- **Site.svelte**: 只负责 UI 和事件分发
- **Services**: 封装复杂业务逻辑

### 2. 易于测试
- Main.ts 可以独立测试业务逻辑
- Site.svelte 可以独立测试 UI 交互
- 进度回调可以独立测试

### 3. 易于维护
- 统一的接口，易于理解
- 数据流向清晰，易于追踪
- 单一数据源，避免不一致

### 4. 解耦合
- Site.svelte 不依赖 Foundry 服务
- Main.ts 不依赖 Site.svelte 内部实现
- 组件之间通过明确接口通信

### 5. 扩展性好
- 新增功能只需添加事件类型
- 不需要修改现有通信机制
- 易于添加新的进度阶段

---

## 相关文档

- `prompts/project-creation-optimization.md` - 项目创建优化方案
- `prompts/data-flow-architecture.md` - 数据流架构
- `prompts/license-state-refactor.md` - License 状态重构

---

## 附录

### 代码示例

详见方案设计中的各个代码片段。完整实现请参考：
- `src/services/project.ts` - ProjectServiceManager
- `src/types/events.ts` - 事件类型定义
- `src/main.ts` - Main.ts 事件处理
- `src/svelte/Site.svelte` - Site 组件重构
