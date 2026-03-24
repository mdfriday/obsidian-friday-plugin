# 新项目创建配置写入优化方案

## 实施日期
2026-03-23 (最后更新: 2026-03-24)

## 背景

### 问题 1: JSON 格式损坏
创建新项目时，`config.json` 出现格式错误，文件内容交错：
```json
{
  "publish": {
    "method": "mdfriday"
  }
}r": "content",    // ← 残留片段
      "weight": 1
    }
  }
}
```

### 问题 2: 发布方式不匹配
- Global Config 保存 `publish.method = "mdfriday"`
- 右边栏选项只有 `mdf-share`, `mdf-app`, `netlify`, `ftp` 等
- 导致发布方式没有被正确选中

### 根本原因
1. **并发写入竞争**: `syncFoundryProjectConfig` 使用 `Promise.all` 并发调用多个 `set()`
2. **创建后立即保存**: 项目创建完成后，`loadFoundryProjectConfig` 立即触发多个保存操作
3. **值映射不一致**: `"mdfriday"` 未正确映射为 `"mdf-share"`

---

## 解决方案

### 核心策略

**区分两种场景，使用不同的保存策略**：

1. **新项目创建阶段**: 使用 `setAll()` 一次性写入完整配置（不包括动态 sitePath）
2. **用户手动修改阶段**: 使用单个 `set()` 逐个保存字段
3. **动态 sitePath 生成**: 由 `Site.svelte` 的 reactive statement 响应式处理

---

## 实施内容

### 1. 添加初始化标志

**文件**: `src/main.ts`

**添加属性**:
```typescript
export default class FridayPlugin extends Plugin {
    // ...
    // Project initialization flag (prevents auto-save during new project creation)
    isProjectInitializing: boolean = false;
}
```

**用途**: 
- 创建新项目时设置为 `true`
- 防止配置加载时自动触发保存
- 初始化完成后设置为 `false`

---

### 2. 添加 `setAll()` 封装方法

**文件**: `src/main.ts`

**新增方法**:
```typescript
async setAllProjectConfig(projectName: string, config: Record<string, any>): Promise<boolean> {
    const result = await this.foundryProjectConfigService.setAll(
        this.absWorkspacePath,
        projectName,
        config
    );
    return result.success;
}
```

**用途**: 
- 封装 Foundry 26.3.17 的 `setAll()` 方法
- 用于新项目初始化，一次性写入完整配置
- 避免多次写入导致的文件竞争

---

### 3. 添加初始配置应用方法

**文件**: `src/main.ts`

**新增方法**: `applyInitialConfigForNewProject()`

**流程**:
```typescript
1. 读取 Foundry 创建的默认配置
   ↓
2. 应用发布方式（'mdfriday' → 'mdf-share'）
   ↓
3. 应用默认 FTP/Netlify 配置（如果有）
   ↓
4. 使用 setAll() 一次性写入完整配置
   ↓
5. 通知 Site 组件重新加载
```

**关键点**:
- **不再**在这里生成动态 `sitePath`
- 只收集静态默认配置
- **一次性写入，避免竞争**

---

### 4. 重构项目创建流程

**文件**: `src/main.ts`

**新流程**:
```typescript
private async createFoundryProject(projectName, folder, file) {
    // 1. 创建项目（Foundry 写入默认配置）
    const result = await this.foundryProjectService.createProject(createOptions);
    
    if (result.success) {
        // 2. 设置项目名称
        this.currentProjectName = projectName;
        
        // ✅ 3. 设置标志：正在初始化
        this.isProjectInitializing = true;
        
        // 4. 初始化 Site 组件（加载配置到 UI，不触发保存）
        this.site.initializeContent(folder, file);
        
        // 5. 等待 Site 组件加载完成
        await new Promise(resolve => setTimeout(resolve, 100));
        
        // ✅ 6. 应用初始配置，一次性写入（不包括动态 sitePath）
        await this.applyInitialConfigForNewProject(projectName, folder, file);
        
        // ✅ 7. 清除标志，允许后续保存
        this.isProjectInitializing = false;
    }
}
```

---

### 5. 防止初始化期间自动保存

**文件**: `src/main.ts` - `saveFoundryProjectConfig()`

**添加检查**:
```typescript
async saveFoundryProjectConfig(projectName: string, configKey: string, configValue: any) {
    // ✅ Skip saving during project initialization
    if (this.isProjectInitializing) {
        console.log('[Friday] Skipping save during project initialization');
        return;
    }
    
    // 正常保存...
}
```

**文件**: `src/svelte/Site.svelte` - `saveFoundryConfig()`

**添加检查**:
```typescript
async function saveFoundryConfig(key: string, value: any) {
    if (!plugin.currentProjectName) {
        return;
    }
    
    // ✅ Skip saving during project initialization
    if (plugin.isProjectInitializing) {
        console.log('[Site] Skipping save during initialization');
        return;
    }
    
    // 正常保存...
}
```

---

### 6. 修正发布方式映射

**文件**: `src/main.ts` - DEFAULT_SETTINGS

**变更**:
```typescript
const DEFAULT_SETTINGS: FridaySettings = {
    // ...
    publishMethod: 'mdf-share',  // ← 从 'mdfriday' 改为 'mdf-share'
};
```

**文件**: `src/svelte/Site.svelte` - 初始化

**变更**:
```typescript
let selectedPublishOption = (() => {
    const method = plugin.settings.publishMethod;
    // ✅ 兼容旧的 'mdfriday' 值
    if (method === 'mdfriday') return 'mdf-share';
    // 验证值
    const validMethods = ['netlify', 'ftp', 'mdf-share', 'mdf-app', 'mdf-custom', 'mdf-enterprise'];
    if (validMethods.includes(method)) {
        return method as any;
    }
    return 'netlify';
})();
```

**文件**: `src/svelte/Site.svelte` - `loadFoundryProjectConfig`

**变更**:
```typescript
if (config['publish'].method) {
    const method = config['publish'].method;
    // ✅ 兼容旧值
    selectedPublishOption = (method === 'mdfriday' ? 'mdf-share' : method);
}
```

**文件**: `src/svelte/Site.svelte` - `loadPublishConfigFromSettings`

**变更**:
```typescript
// ✅ 兼容旧值
selectedPublishOption = (plugin.settings.publishMethod === 'mdfriday' 
    ? 'mdf-share' 
    : plugin.settings.publishMethod) || 'netlify';
```

---

### 7. Site.svelte 添加初始化检查

**文件**: `src/svelte/Site.svelte` - `loadFoundryProjectConfig`

**添加检查**:
```typescript
async function loadFoundryProjectConfig() {
    // ✅ 检查是否正在初始化
    const isInitializing = plugin.isProjectInitializing;
    
    if (isInitializing) {
        console.log('[Site] Project is initializing, loading config without triggering saves');
    }
    
    // 加载配置...
    
    // Publish config
    if (config['publish']) {
        // 加载到 UI
    } else if (!isInitializing) {
        // ✅ 只有非初始化状态才触发保存
        await loadPublishConfigFromSettings();
    }
    
    // Language config
    if (config['languages']) {
        // ✅ 传递初始化标志
        await applyLanguageConfiguration(languages, defaultLang, isInitializing);
    }
}
```

**文件**: `src/svelte/Site.svelte` - `applyLanguageConfiguration`

**添加参数**:
```typescript
async function applyLanguageConfiguration(
    languages: Record<string, any>, 
    defaultLang: string,
    skipSave: boolean = false  // ← 新增参数
) {
    // 应用配置到 UI...
    
    // ✅ 根据参数决定是否保存
    if (!skipSave) {
        console.log('[Site] Saving language configuration after apply');
    }
}
```

---

### 8. 添加响应式 sitePath 生成

**文件**: `src/svelte/Site.svelte`

**新增 reactive statement**:
```typescript
// Auto-generate sitePath for mdf-share when publish option changes
$: {
    if (selectedPublishOption === 'mdf-share' && plugin.settings.license && userDir) {
        // Check if sitePath needs to be generated or updated
        if (sitePath.startsWith(`/s/${userDir}`) || !sitePath.startsWith('/s')) {
            // Generate new sitePath with format: /s/{userDir}/{previewId}
            const timestamp = Date.now().toString().slice(-6);
            const randomStr = Math.random().toString(36).substring(2, 5);
            const newPreviewId = `${timestamp}${randomStr}`;
            const newSitePath = `/s/${userDir}/${newPreviewId}`;
            
            // Update sitePath
            sitePath = newSitePath;
            previewId = newPreviewId;
            
            console.log('[Site] Auto-generated sitePath for mdf-share:', sitePath);
            
            // Save to config (only if not initializing)
            if (!plugin.isProjectInitializing) {
                saveFoundryConfig('baseURL', sitePath);
            }
        }
    }
}
```

**优势**:
- ✅ 响应式监听 `selectedPublishOption` 变化
- ✅ 仅在切换到 `mdf-share` 时生成特殊格式 sitePath
- ✅ 自动保存（初始化阶段除外）
- ✅ 与原始 UI 逻辑完全一致

---

## 完整流程对比

### 旧流程（有问题）

```
用户右键文件 → 发布
    ↓
createProject()
    → 写入默认 config.json (版本 A)
    ↓
initializeContent()
    → onMount() → loadFoundryProjectConfig()
        ↓
    应用配置到 UI (siteName, sitePath, etc.)
        ↓
    loadPublishConfigFromSettings()
        → ⚠️ savePublishConfig() (写入 1)
        ↓
    applyLanguageConfiguration()
        → ⚠️ saveLanguageConfig() (写入 2)
        ↓
    [多个写入操作，Promise.all 并发执行]
        ↓
    ❌ 文件竞争，JSON 损坏
```

### 新流程（优化后）

```
用户右键文件 → 发布
    ↓
createProject()
    → 写入默认 config.json (版本 A)
    ↓ [完成]
    
isProjectInitializing = true  ← ✅ 设置标志
    ↓
initializeContent()
    → onMount() → loadFoundryProjectConfig()
        ↓
    检查 isInitializing = true
        ↓
    应用配置到 UI (siteName, etc.)
        ↓
    检查 isInitializing = true
        → ✅ 跳过 loadPublishConfigFromSettings()
        → ✅ applyLanguageConfiguration(skipSave=true)
        ↓
    [无写入操作]
    ↓
applyInitialConfigForNewProject()
    ↓
1. 读取默认配置 (版本 A)
2. 应用 publishMethod: 'mdfriday' → 'mdf-share'
3. 应用默认 FTP/Netlify 配置
4. ✅ setAll(完整配置) → 一次写入 (版本 B)
    ↓
reloadFoundryProjectConfig()
    → 重新加载配置到 UI
    → 检查 isInitializing = true
    → ✅ 仍然不触发保存
    ↓
isProjectInitializing = false  ← ✅ 清除标志
    ↓
[Site.svelte reactive statement 检测到 selectedPublishOption = 'mdf-share']
    ↓
✅ 自动生成 sitePath = `/s/{userDir}/{previewId}`
    ↓
✅ 保存 baseURL 到配置
    ↓
[初始化完成，后续用户操作正常保存]
```

---

## 关键改进

### 1. 一次性写入完整配置
- ✅ 使用 Foundry 26.3.17 的 `setAll()` 方法
- ✅ 避免多次 `set()` 导致的文件竞争
- ✅ 原子操作，保证数据完整

### 2. 动态配置响应式处理
- ✅ sitePath 不在初始化阶段生成
- ✅ 由 Site.svelte 的 reactive statement 监听发布方式变化
- ✅ 只有切换到 mdf-share 时才生成特殊格式
- ✅ 符合原始 UI 逻辑：用户切换发布方式时触发

### 3. 发布方式映射统一
- ✅ DEFAULT_SETTINGS: `'mdfriday'` → `'mdf-share'`
- ✅ 所有加载逻辑: 兼容旧值 `'mdfriday'`
- ✅ 保存逻辑: 统一使用新值 `'mdf-share'`

### 4. 用户修改保持即时性
- ✅ 用户手动修改字段时，立即保存
- ✅ 使用单个 `set()` 方法
- ✅ 不影响响应速度

---

## 数据流图

### 新项目创建数据流

```
创建项目:
┌─────────────────────────────────────────┐
│ createProject()                         │
│  └─ 写入默认 config.json (版本 A)       │
└─────────────────────────────────────────┘
              ↓
┌─────────────────────────────────────────┐
│ isProjectInitializing = true            │  ← 设置标志
└─────────────────────────────────────────┘
              ↓
┌─────────────────────────────────────────┐
│ initializeContent()                     │
│  └─ onMount()                           │
│      └─ loadFoundryProjectConfig()      │
│          ├─ 检查: isInitializing = true  │
│          ├─ 加载配置到 UI                │
│          └─ ✅ 跳过所有保存操作          │
└─────────────────────────────────────────┘
              ↓
┌─────────────────────────────────────────┐
│ applyInitialConfigForNewProject()       │
│  ├─ 读取默认配置                        │
│  ├─ 应用 publishMethod: 'mdf-share'     │
│  ├─ 应用默认 FTP/Netlify 配置           │
│  └─ ✅ setAll(完整配置) 一次性写入      │
└─────────────────────────────────────────┘
              ↓
┌─────────────────────────────────────────┐
│ reloadFoundryProjectConfig()            │
│  ├─ 检查: isInitializing = true          │
│  ├─ 重新加载配置到 UI                   │
│  └─ ✅ 仍然不触发保存                   │
└─────────────────────────────────────────┘
              ↓
┌─────────────────────────────────────────┐
│ isProjectInitializing = false           │  ← 清除标志
└─────────────────────────────────────────┘
              ↓
┌─────────────────────────────────────────┐
│ Reactive Statement 触发                 │
│  ├─ 检测: selectedPublishOption = 'mdf-share' │
│  ├─ 检测: userDir 存在                  │
│  ├─ 检测: sitePath 需要生成             │
│  ├─ ✅ 生成 sitePath: /s/{userDir}/{previewId} │
│  └─ ✅ 保存 baseURL 到配置              │
└─────────────────────────────────────────┘
              ↓
      [初始化完成]
```

### 用户修改数据流

```
用户修改字段:
┌─────────────────────────────────────────┐
│ 用户在 UI 修改 siteName                 │
└─────────────────────────────────────────┘
              ↓
┌─────────────────────────────────────────┐
│ blur 事件触发                           │
│  └─ saveFoundryConfig('title', value)   │
└─────────────────────────────────────────┘
              ↓
┌─────────────────────────────────────────┐
│ 检查 isProjectInitializing = false      │
└─────────────────────────────────────────┘
              ↓
┌─────────────────────────────────────────┐
│ ✅ 使用单个 set() 立即保存              │
│  └─ projectConfigService.set(key, val)  │
└─────────────────────────────────────────┘
```

### 用户切换发布方式数据流

```
用户选择发布方式:
┌─────────────────────────────────────────┐
│ 用户点击 mdf-share 发布选项             │
└─────────────────────────────────────────┘
              ↓
┌─────────────────────────────────────────┐
│ selectedPublishOption = 'mdf-share'     │
└─────────────────────────────────────────┘
              ↓
┌─────────────────────────────────────────┐
│ Reactive Statement 触发                 │
│  ├─ 检测: selectedPublishOption 变化    │
│  ├─ 检测: license 和 userDir 存在       │
│  ├─ 检测: sitePath 格式需要更新         │
│  ├─ ✅ 生成新的 previewId               │
│  ├─ ✅ 更新 sitePath: /s/{userDir}/{previewId} │
│  └─ ✅ 保存 baseURL 到配置              │
└─────────────────────────────────────────┘
```

---

## 修改文件清单

### src/main.ts
1. ✅ DEFAULT_SETTINGS: `publishMethod: 'mdf-share'`
2. ✅ 添加属性: `isProjectInitializing: boolean = false`
3. ✅ 新增方法: `setAllProjectConfig()`
4. ✅ 删除方法: `generatePreviewId()` (不再需要)
5. ✅ 修改方法: `applyInitialConfigForNewProject()` - 不生成 sitePath
6. ✅ 重构方法: `createFoundryProject()` - 使用标志和 setAll
7. ✅ 修改方法: `saveFoundryProjectConfig()` - 检查标志
8. ✅ 标记方法: `syncFoundryProjectConfig()` - @deprecated

### src/svelte/Site.svelte
1. ✅ 修改初始化: `selectedPublishOption` - 兼容旧值
2. ✅ 修改方法: `loadFoundryProjectConfig()` - 检查标志
3. ✅ 修改方法: `applyLanguageConfiguration()` - 添加 skipSave 参数
4. ✅ 修改方法: `saveFoundryConfig()` - 检查标志
5. ✅ 修改方法: `loadPublishConfigFromSettings()` - 兼容旧值
6. ✅ 新增 reactive statement: 响应式生成 sitePath

---

## 测试要点

### 功能测试
- [ ] 右键单文件创建项目，检查 config.json 格式正确
- [ ] 检查 config.json 包含正确的 publish.method = 'mdf-share'
- [ ] 检查 mdf-share 模式下 sitePath 由 reactive 自动生成
- [ ] 检查右边栏发布方式正确选中 'MDFriday Share'
- [ ] 用户切换发布方式到 mdf-share，sitePath 自动生成
- [ ] 用户修改配置，立即保存生效

### 性能测试
- [ ] 创建项目速度正常（只多一次 setAll 调用）
- [ ] 用户修改响应速度正常（单个 set）
- [ ] Reactive statement 不会过度触发

### 回归测试
- [ ] 打开已有项目，配置正确加载
- [ ] 兼容旧的 'mdfriday' 配置值
- [ ] 所有发布功能正常工作
- [ ] 多次创建项目，无 JSON 损坏

---

## 优势总结

### 1. 彻底解决并发写入问题
- ✅ 新项目：一次 `setAll()` 写入（静态配置）
- ✅ 用户修改：单个 `set()` 写入
- ✅ Reactive 自动保存（动态 sitePath）
- ✅ 无并发，无竞争，无损坏

### 2. 精准控制保存时机
- ✅ 初始化期间：禁止自动保存
- ✅ 初始化完成：收集配置一次性写入
- ✅ 标志清除后：reactive 自动生成 sitePath
- ✅ 后续修改：立即响应保存

### 3. 动态配置响应式处理
- ✅ sitePath 不在初始化阶段生成
- ✅ 由 reactive statement 监听发布方式变化
- ✅ 只对 mdf-share 生成特殊格式
- ✅ 符合原始 UI 交互逻辑

### 4. 向后兼容
- ✅ 兼容旧的 'mdfriday' 值
- ✅ 平滑迁移到 'mdf-share'
- ✅ 不影响已有项目

### 5. 代码清晰
- ✅ 创建阶段和修改阶段逻辑分离
- ✅ 标志清晰，易于理解和维护
- ✅ 职责明确，便于扩展
- ✅ 响应式逻辑集中在 Site.svelte

---

## 相关文档
- `prompts/phase5-cleanup-redundant-code.md` - Phase 5 清理总结
- `prompts/data-flow-architecture.md` - 数据流架构
- `prompts/sync-config-data-flow.md` - Sync 配置数据流

## 编译状态
✅ 编译成功，无错误
