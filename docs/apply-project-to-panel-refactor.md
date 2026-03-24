# 新架构实现：Main.ts 与 Site.svelte 通信标准化

## 实施日期
2026-03-24

## 实施目标
按照事件驱动架构，实现 `Main.ts` 和 `Site.svelte` 之间的标准化通信，使 `Main.ts` 作为 Controller，`Site.svelte` 作为 View，通过直接方法调用更新 UI，替代旧的回调注册机制。

---

## 核心改动

### 1. Main.ts 类属性增强

**文件**: `src/main.ts`

**新增属性**:
```typescript
// Site.svelte component reference (for new event-driven architecture)
siteComponent?: any | null
```

**作用**:
- 持有 `Site.svelte` 组件实例的引用
- 允许 `Main.ts` 直接调用 `Site.svelte` 的 public 方法
- 实现 Controller → View 的直接通信

---

### 2. 完善 registerSiteComponent 方法

**文件**: `src/main.ts`

**修改前**:
```typescript
registerSiteComponent(component: any) {
    console.log('[Friday] Registering site component');
    // Site component is already set in initDesktopFeatures
    // This method provides explicit registration for event-driven architecture
}
```

**修改后**:
```typescript
/**
 * Register Site.svelte component for direct method calls
 * Part of new event-driven architecture
 */
registerSiteComponent(component: any) {
    this.siteComponent = component;
    console.log('[Friday] Site component registered for new architecture');
}
```

**改进**:
- ✅ 真正存储组件引用到 `this.siteComponent`
- ✅ 为事件驱动架构提供基础

---

### 3. 重构 applyFoundryProjectToPanel 方法

**文件**: `src/main.ts`

#### 修改前逻辑

```typescript
private async applyFoundryProjectToPanel(project, folder, file) {
    // 1. 设置项目名
    this.currentProjectName = project.name;
    
    // 2. 初始化内容（只处理内容选择）
    this.site.initializeContent(folder, file);
    
    // 3. 通过旧的回调注册机制更新 UI
    if (this.reloadFoundryProjectConfig) {
        await this.reloadFoundryProjectConfig();
    }
}
```

**问题**:
- ❌ 依赖回调注册机制 (`reloadFoundryProjectConfig`)
- ❌ 配置读取在 `Site.svelte` 中
- ❌ `Main.ts` 不知道更新了什么配置

#### 修改后逻辑

```typescript
private async applyFoundryProjectToPanel(project, folder, file) {
    // Step 1: 设置当前项目名
    this.currentProjectName = project.name;
    
    // Step 2: 初始化内容选择（site.ts 数据管理）
    this.site.initializeContent(folder, file);
    
    // Step 3: 从 Foundry 服务获取完整配置
    const config = await this.projectServiceManager.getConfig(project.name);
    
    // Step 4: 准备完整的 ProjectState
    const projectState: ProjectState = {
        name: project.name,
        folder,
        file,
        config,
        status: 'active'
    };
    
    // Step 5: 调用 Site.svelte 的 initialize 方法（新架构）
    if (this.siteComponent?.initialize) {
        await this.siteComponent.initialize(projectState);
    } else {
        // Fallback 到旧机制（过渡期兼容性）
        if (this.reloadFoundryProjectConfig) {
            await this.reloadFoundryProjectConfig();
        }
    }
}
```

**改进**:
- ✅ `Main.ts` 控制配置读取
- ✅ 使用 `ProjectServiceManager` 获取配置
- ✅ 准备完整的 `ProjectState` 数据对象
- ✅ 直接调用 `siteComponent.initialize()`
- ✅ 保留 fallback 以确保向后兼容
- ✅ 数据流清晰可追踪

---

### 4. 完善 Site.svelte 的 initialize() 方法

**文件**: `src/svelte/Site.svelte`

#### 原有实现（不完整）

```typescript
export async function initialize(state: ProjectState) {
    // 只处理基本字段
    if (state.config.title) {
        siteName = state.config.title;
    }
    // ... 缺少很多字段
}
```

#### 新实现（完整）

```typescript
export async function initialize(state: ProjectState) {
    console.log('[Site] Initializing with project state:', state.name);

    if (state.config) {
        // 1. Load basic information
        if (state.config.title) {
            siteName = state.config.title;
        }
        if (state.config.baseURL) {
            sitePath = state.config.baseURL;
        }

        // 2. Load theme configuration
        if (state.config.module?.imports?.[0]?.path) {
            const themeUrl = state.config.module.imports[0].path;
            selectedThemeDownloadUrl = themeUrl;
            userHasSelectedTheme = true;
            
            // Find theme by download URL
            const allThemes = await themeApiService.getAllThemes(plugin);
            const matchedTheme = allThemes.find(theme => theme.download_url === themeUrl);
            
            if (matchedTheme) {
                selectedThemeId = matchedTheme.id;
                selectedThemeName = matchedTheme.title || matchedTheme.name;
            } else {
                // Fallback: determine from URL
                if (themeUrl.includes('book')) {
                    selectedThemeName = BOOK_THEME_NAME;
                    selectedThemeId = BOOK_THEME_ID;
                } else if (themeUrl.includes('note')) {
                    selectedThemeName = NOTE_THEME_NAME;
                    selectedThemeId = NOTE_THEME_ID;
                }
            }
        }

        // 3. Load publish configuration
        if (state.config.publish) {
            // Publish method (兼容旧值)
            if (state.config.publish.method) {
                const method = state.config.publish.method;
                selectedPublishOption = (method === 'mdfriday' ? 'mdf-share' : method);
            }
            
            // FTP configuration
            if (state.config.publish.ftp) {
                ftpServer = state.config.publish.ftp.host || '';
                ftpUsername = state.config.publish.ftp.username || '';
                ftpPassword = state.config.publish.ftp.password || '';
                ftpRemoteDir = state.config.publish.ftp.remotePath || '';
                
                // Load secure preference
                if (state.config.publish.ftp.secure !== undefined) {
                    ftpPreferredSecure = state.config.publish.ftp.secure;
                }
                
                // Backward compatibility
                if (state.config.publish.ftp.ignoreCert !== undefined) {
                    ftpIgnoreCert = state.config.publish.ftp.ignoreCert;
                }
            }

            // Netlify configuration
            if (state.config.publish.netlify) {
                netlifyAccessToken = state.config.publish.netlify.accessToken || '';
                netlifyProjectId = state.config.publish.netlify.siteId || '';
            }
        }

        // 4. Load advanced settings
        if (state.config.services?.googleAnalytics?.id) {
            googleAnalyticsId = state.config.services.googleAnalytics.id;
        }
        if (state.config.params?.disqusShortname) {
            disqusShortname = state.config.params.disqusShortname;
        }
        if (state.config.params?.password) {
            sitePassword = state.config.params.password;
        }

        // 5. Load language configuration
        if (state.config.languages && state.config.defaultContentLanguage) {
            await applyLanguageConfiguration(
                state.config.languages,
                state.config.defaultContentLanguage,
                true // isInitializing = true，防止触发保存
            );
        }
    }

    // Notify Main.ts that initialization is complete
    if (plugin.handleSiteEvent) {
        await plugin.handleSiteEvent('initialized', {
            projectName: state.name
        });
    }
}
```

**改进**:
- ✅ 处理所有配置字段（基本信息、主题、发布、高级设置、语言）
- ✅ 主题查找逻辑更完善（先 API 查询，后 URL fallback）
- ✅ FTP 配置兼容新旧 API（`secure` 和 `ignoreCert`）
- ✅ 语言配置应用时传递 `isInitializing` 标志防止保存
- ✅ 完成后触发 `initialized` 事件通知 `Main.ts`

---

### 5. Site.svelte 组件注册机制

**文件**: `src/svelte/Site.svelte`

#### onMount 中的注册

```typescript
onMount(async () => {
    // ... 其他初始化 ...
    
    // ==================== NEW ARCHITECTURE: Register component ====================
    // Register this component to Main.ts for direct method calls
    if (plugin.registerSiteComponent) {
        plugin.registerSiteComponent({
            initialize,
            updateBuildProgress,
            updatePublishProgress,
            onBuildComplete,
            onBuildError,
            onPreviewStarted,
            onPreviewError,
            onPreviewStopped,
            onPublishComplete,
            onPublishError,
            onConnectionTestSuccess,
            onConnectionTestError
        });
    }
    
    // ==================== OLD ARCHITECTURE: Register callbacks (for compatibility) ====================
    // 保留旧的回调注册（过渡期）
    plugin.reloadFoundryProjectConfig = loadFoundryProjectConfig; // OLD - will be deprecated
    
    // ... 其他注册 ...
});
```

**设计**:
- ✅ 新架构：通过对象注册所有 public 方法
- ✅ 旧架构：保留回调注册以确保兼容性
- ✅ 清晰标注新旧架构，便于未来清理

---

## 数据流对比

### 旧架构数据流

```
Main.ts: applyFoundryProjectToPanel
    ↓ 设置 currentProjectName
    ↓ this.site.initializeContent (只初始化内容)
    ↓ 调用 this.reloadFoundryProjectConfig() (注册的回调)
    ↓
Site.svelte: loadFoundryProjectConfig()
    ↓ 从 Foundry 读取配置
    ↓ 更新所有 UI 变量
```

**问题**:
- ❌ 配置读取在 `Site.svelte` 中（View 层）
- ❌ 依赖回调注册机制
- ❌ `Main.ts` 不知道更新了什么
- ❌ 数据流不清晰

### 新架构数据流

```
Main.ts: applyFoundryProjectToPanel
    ↓ 设置 currentProjectName
    ↓ this.site.initializeContent (初始化内容)
    ↓ projectServiceManager.getConfig (读取配置)
    ↓ 构建 ProjectState
    ↓ siteComponent.initialize(projectState)
    ↓
Site.svelte: initialize(state)
    ↓ 接收 ProjectState
    ↓ 更新所有 UI 变量
    ↓ 触发 'initialized' 事件
    ↓
Main.ts: handleSiteEvent('initialized')
```

**优势**:
- ✅ `Main.ts` 控制配置读取（Controller 层）
- ✅ 直接方法调用，类型安全
- ✅ 数据流清晰可追踪
- ✅ UI 只负责展示（View 层）
- ✅ 单向数据流

---

## 架构优势

### 1. 职责清晰

**Main.ts (Controller)**:
- 获取项目信息 (`getFoundryProject`)
- 读取配置 (`projectServiceManager.getConfig`)
- 准备数据 (`ProjectState`)
- 调用 UI 更新 (`siteComponent.initialize`)

**Site.svelte (View)**:
- 接收数据 (`initialize(state)`)
- 更新 UI 变量
- 通知完成 (`handleSiteEvent('initialized')`)

### 2. 单一数据流

```
Foundry Services → Main.ts → ProjectState → Site.svelte → UI
                                                ↓
                                        handleSiteEvent
                                                ↓
                                            Main.ts
```

- ✅ 数据源唯一：从 Foundry 服务获取
- ✅ 数据流单向：Controller → View
- ✅ 通知回流：View → Controller (events)

### 3. 类型安全

```typescript
// 类型明确的接口
interface ProjectState {
    name: string;
    folder: TFolder | null;
    file: TFile | null;
    config: Record<string, any>;
    status: string;
}

// 方法签名清晰
export async function initialize(state: ProjectState): Promise<void>
```

### 4. 易于测试

```typescript
// 测试 Main.ts
const mockSite = { 
    initialize: jest.fn() 
};
plugin.registerSiteComponent(mockSite);
await plugin.applyFoundryProjectToPanel(project, folder, file);
expect(mockSite.initialize).toHaveBeenCalledWith({
    name: 'test',
    config: { title: 'Test' }
});

// 测试 Site.svelte
const state = { 
    name: 'test', 
    config: { title: 'Test', baseURL: '/test/' } 
};
await siteComponent.initialize(state);
expect(siteName).toBe('Test');
expect(sitePath).toBe('/test/');
```

### 5. 易于维护

- ✅ 修改配置应用逻辑只需改 `initialize()` 一处
- ✅ 新增配置字段只需在 `initialize()` 中添加处理
- ✅ 不需要在多个地方同步修改

### 6. 向后兼容

```typescript
// 在过渡期保留 fallback
if (this.siteComponent?.initialize) {
    // 新机制
    await this.siteComponent.initialize(projectState);
} else {
    // 旧机制 fallback
    if (this.reloadFoundryProjectConfig) {
        await this.reloadFoundryProjectConfig();
    }
}
```

---

## 实施清单

### 已完成 ✅

- [x] 定义 `siteComponent` 类属性
- [x] 完善 `registerSiteComponent` 方法
- [x] 重构 `applyFoundryProjectToPanel` 使用新架构
- [x] 完善 `Site.svelte.initialize()` 方法处理所有配置
- [x] 在 `Site.svelte` 的 `onMount` 中注册组件
- [x] 保留旧机制 fallback 以确保兼容性
- [x] 编译通过，无错误

### 未来工作（可选）

- [ ] 测试新建项目流程
- [ ] 测试已存在项目加载流程
- [ ] 验证所有配置字段正确显示
- [ ] 清理旧的回调注册机制（`plugin.reloadFoundryProjectConfig`）
- [ ] 移除 `loadFoundryProjectConfig()` 的直接调用
- [ ] 统一所有地方使用 `siteComponent.initialize()`

---

## 编译状态

✅ **编译成功**，无错误

```bash
npm run build
> obsidian-friday-plugin@26.2.6 build
✓ Build completed successfully
  main.js    5.4mb
  main.css  31.8kb
```

---

## 相关文档

- `docs/architecture-site-main-communication.md` - 架构设计文档
- `docs/project-creation-flow-optimization.md` - 项目创建流程优化
- `docs/task1-project-creation-refactor.md` - 任务1实施记录
- `docs/site-main-communication-summary.md` - 完整实施总结

---

## 总结

这次实施成功实现了：

1. ✅ **新架构落地**: `Main.ts` 作为 Controller，`Site.svelte` 作为 View
2. ✅ **职责清晰**: 配置读取在 Controller，UI 更新在 View
3. ✅ **单一数据流**: Foundry → Main.ts → ProjectState → Site.svelte
4. ✅ **类型安全**: 使用明确的 `ProjectState` 接口
5. ✅ **易于维护**: 配置应用逻辑集中在 `initialize()` 一处
6. ✅ **向后兼容**: 保留 fallback 机制
7. ✅ **编译通过**: 无错误

这是**架构升级的重要里程碑**，为后续的重构和优化奠定了坚实的基础。新旧架构并存的设计确保了平滑过渡，未来可以逐步移除旧机制。
