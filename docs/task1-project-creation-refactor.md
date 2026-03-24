# 任务1实施记录：重构项目新建流程

## 实施日期
2026-03-24

## 任务目标
使用新的事件驱动架构重构项目创建流程，通过 `ProjectServiceManager` 统一管理 Foundry 服务。

---

## 实施步骤

### Step 1: 创建类型定义 ✅
**文件**: `src/types/events.ts`

创建了以下类型：
- `SiteEventType`: 事件类型枚举
- `SiteEventData`: 各事件对应的数据结构
- `ProgressUpdate`: 进度更新接口
- `ProjectState`: 项目状态接口

### Step 2: 创建 ProjectServiceManager ✅
**文件**: `src/services/project.ts`

实现了以下功能模块：

**项目管理**:
- `createProject()`: 创建新项目并应用初始配置
- `listProjects()`: 获取所有项目
- `getProjectInfo()`: 获取项目信息

**配置管理**:
- `getConfig()`: 获取项目配置
- `saveConfig()`: 保存单个配置项
- `saveAllConfig()`: 保存完整配置

**构建和预览**:
- `build()`: 构建项目（带进度回调）
- `startPreview()`: 启动预览服务器（带进度回调）
- `stopPreview()`: 停止预览服务器

**发布**:
- `publish()`: 发布项目（带进度回调）
- `testConnection()`: 测试连接

### Step 3: Main.ts 集成 ✅
**文件**: `src/main.ts`

**添加的内容**:

1. **导入新模块**:
```typescript
import { ProjectServiceManager } from './services/project';
import type { SiteEventType, SiteEventData, ProjectState } from './types/events';
```

2. **添加 ProjectServiceManager 属性**:
```typescript
projectServiceManager?: ProjectServiceManager | null
```

3. **初始化 ProjectServiceManager**:
```typescript
if (this.foundryProjectService && this.foundryProjectConfigService) {
    this.projectServiceManager = new ProjectServiceManager(this);
    console.log('[Friday] Project Service Manager initialized');
}
```

4. **添加事件处理系统**:
- `registerSiteComponent()`: 注册 Site 组件
- `handleSiteEvent()`: 统一事件处理入口
- 各个具体事件处理器：
  - `onSiteInitialized()`
  - `onConfigChanged()`
  - `onBuildRequested()`
  - `onPreviewRequested()`
  - `onPublishRequested()`
  - `onTestConnection()`
  - `onStopPreview()`

5. **重构项目创建流程**:

**旧流程**:
```typescript
createFoundryProject() {
    // 1. 直接调用 foundryProjectService
    // 2. 设置 isProjectInitializing 标志
    // 3. 直接调用 site.initializeContent()
    // 4. 等待 100ms（硬编码）
    // 5. 调用 applyInitialConfigForNewProject()
    // 6. 清除标志
}
```

**新流程**:
```typescript
createFoundryProject() {
    // 1. 收集初始配置
    const initialConfig = this.collectInitialConfig();
    
    // 2. 通过 ProjectServiceManager 创建项目
    const result = await this.projectServiceManager.createProject({
        name, folder, file, initialConfig
    });
    
    // 3. 设置当前项目名称
    this.currentProjectName = projectName;
    
    // 4. 获取配置
    const config = await this.projectServiceManager.getConfig(projectName);
    
    // 5. 构建项目状态
    const projectState: ProjectState = {
        name, folder, file, config,
        status: 'active'
    };
    
    // 6. 初始化 Site 组件
    await this.site.initialize(projectState);
}
```

6. **添加配置收集方法**:
```typescript
collectInitialConfig(): Record<string, any> {
    // 收集发布方式、FTP、Netlify 默认配置
}
```

7. **删除的内容**:
- 删除了旧的 `applyInitialConfigForNewProject()` 方法
- 删除了 `isProjectInitializing` 标志的使用
- 删除了硬编码的 `setTimeout(100)` 等待

---

## 关键改进

### 1. 职责清晰
- **Main.ts**: 统一协调 Foundry 服务
- **ProjectServiceManager**: 封装所有项目相关服务
- **Site.svelte**: 只负责 UI（下一步实现）

### 2. 移除硬编码等待
- 旧方案：`await new Promise(resolve => setTimeout(resolve, 100))`
- 新方案：通过明确的方法调用和状态传递

### 3. 统一配置管理
- 初始配置在 `collectInitialConfig()` 中收集
- 通过 `ProjectServiceManager.createProject()` 一次性应用
- 避免多次写入和竞争问题

### 4. 进度回调准备
- 所有服务方法都支持 `onProgress` 回调
- Main.ts 创建回调并传递给 Site 组件
- 为后续进度显示做好准备

### 5. 向后兼容
- 保留了对旧方法的 fallback
- 如果 `site.initialize` 不可用，使用 `site.initializeContent`
- 平滑过渡，不影响现有功能

---

## 数据流对比

### 旧流程

```
用户右键 → 发布
    ↓
Main.ts.createFoundryProject()
    ├─ foundryProjectService.createProject()
    ├─ this.isProjectInitializing = true
    ├─ site.initializeContent()
    ├─ setTimeout(100)  ← 硬编码等待
    ├─ applyInitialConfigForNewProject()
    │    ├─ getFoundryProjectConfigMap()
    │    ├─ 构建配置
    │    └─ setAllProjectConfig()
    └─ this.isProjectInitializing = false
```

### 新流程

```
用户右键 → 发布
    ↓
Main.ts.createFoundryProject()
    ├─ collectInitialConfig()
    ├─ projectServiceManager.createProject()
    │    ├─ foundryProjectService.createProject()
    │    └─ foundryProjectConfigService.setAll()
    ├─ projectServiceManager.getConfig()
    ├─ 构建 ProjectState
    └─ site.initialize(projectState)  ← 明确的状态传递
```

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

### 待实现
1. **Site.svelte 重构**（任务2）
   - 添加 `initialize()` 方法
   - 实现进度更新方法
   - 使用 `dispatch` 发送事件
   - 移除直接调用 Foundry 服务

2. **测试验证**
   - 测试项目创建流程
   - 验证配置正确应用
   - 确认向后兼容性

3. **清理旧代码**
   - 移除 `isProjectInitializing` 标志（如不再需要）
   - 移除其他旧的通信方式

---

## 相关文档

- `docs/architecture-site-main-communication.md` - 架构设计文档
- `prompts/project-creation-optimization.md` - 项目创建优化方案（之前的）

---

## 总结

任务1已成功完成，实现了：
- ✅ 创建了类型定义系统
- ✅ 实现了 ProjectServiceManager
- ✅ 集成到 Main.ts 并重构项目创建流程
- ✅ 添加了完整的事件处理系统
- ✅ 代码编译通过

新架构更清晰、更易维护，为后续的 Site.svelte 重构和 src/projects 重写打下了良好基础。
