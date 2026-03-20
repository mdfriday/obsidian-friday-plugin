# Foundry 服务集成指南

本指南说明如何在 Site.svelte 组件中集成 Foundry 服务。

## 1. 配置同步

### 当用户修改配置时自动保存

在 Site.svelte 中，当用户修改任何配置时，调用 `saveFoundryProjectConfig` 或 `syncFoundryProjectConfig`：

```typescript
// 单个配置项保存
async function onSiteNameChange(newName: string) {
  siteName = newName;
  
  // 保存到 Foundry 项目配置
  if (plugin.currentProjectName) {
    await plugin.saveFoundryProjectConfig(
      plugin.currentProjectName,
      'site.title',
      newName
    );
  }
}

// 主题选择
async function onThemeChange(themeUrl: string, themeName: string) {
  selectedThemeDownloadUrl = themeUrl;
  selectedThemeName = themeName;
  
  if (plugin.currentProjectName) {
    await plugin.saveFoundryProjectConfig(
      plugin.currentProjectName,
      'theme',
      themeUrl
    );
  }
}

// 高级设置
async function onAdvancedSettingsChange() {
  if (!plugin.currentProjectName) return;
  
  // 批量保存多个配置
  await plugin.syncFoundryProjectConfig(plugin.currentProjectName, {
    'params.googleAnalytics': googleAnalyticsId,
    'params.disqusShortname': disqusShortname,
    'params.password': sitePassword,
    'publishDir': 'public',
    'defaultContentLanguage': defaultContentLanguage,
  });
}
```

## 2. 配置加载

### 当项目加载时恢复配置

在 `onMount` 或项目加载时，从 Foundry 加载配置：

```typescript
async function loadProjectConfig() {
  if (!plugin.currentProjectName) return;
  
  const config = await plugin.getFoundryProjectConfigMap(plugin.currentProjectName);
  
  // 应用配置到 UI
  if (config['site.title']) {
    siteName = config['site.title'];
  }
  if (config['theme']) {
    selectedThemeDownloadUrl = config['theme'];
  }
  if (config['defaultContentLanguage']) {
    defaultContentLanguage = config['defaultContentLanguage'];
  }
  if (config['params.googleAnalytics']) {
    googleAnalyticsId = config['params.googleAnalytics'];
  }
  // ... 其他配置
}

onMount(() => {
  // 加载项目配置
  loadProjectConfig();
});
```

## 3. 预览服务器集成

### 替换现有的 build 和 preview 逻辑

```typescript
// 旧的预览逻辑（使用本地构建）
async function startPreview() {
  isBuilding = true;
  buildProgress = 0;
  
  try {
    // ... 复杂的本地构建逻辑
  } finally {
    isBuilding = false;
  }
}

// 新的预览逻辑（使用 Foundry Serve 服务）
async function startFoundryPreview() {
  if (!plugin.currentProjectName) {
    new Notice('No project selected');
    return;
  }
  
  isBuilding = true;
  buildProgress = 0;
  
  try {
    // 使用 Foundry 的 Serve 服务
    const previewUrl = await plugin.startFoundryPreviewServer(
      plugin.currentProjectName,
      8080
    );
    
    if (previewUrl) {
      hasPreview = true;
      previewUrl = previewUrl;
      buildProgress = 100;
    }
  } catch (error) {
    console.error('Preview failed:', error);
    new Notice(`Preview failed: ${error}`);
  } finally {
    isBuilding = false;
  }
}

// 停止预览
async function stopPreview() {
  await plugin.stopFoundryPreviewServer();
  hasPreview = false;
  previewUrl = '';
}
```

## 4. 构建集成

### 仅构建（不启动服务器）

```typescript
async function buildProject() {
  if (!plugin.currentProjectName) {
    new Notice('No project selected');
    return;
  }
  
  isBuilding = true;
  buildProgress = 0;
  
  try {
    const outputDir = await plugin.buildFoundryProject(plugin.currentProjectName);
    
    if (outputDir) {
      new Notice(`Build completed! Output: ${outputDir}`);
      buildProgress = 100;
      return outputDir;
    }
  } catch (error) {
    console.error('Build failed:', error);
    new Notice(`Build failed: ${error}`);
  } finally {
    isBuilding = false;
  }
  
  return null;
}
```

## 5. 完整的工作流程

### 用户操作流程

#### 第一次发布文件夹：

```typescript
// 1. 用户右键点击文件夹 -> "Publish to Web"
//    触发: plugin.openPublishPanel(folder, null)
//    
// 2. openPublishPanel 内部：
//    - 创建项目: createFoundryProject(folderName, folder, null)
//    - 设置 currentProjectName
//    - 初始化 Site 组件
//
// 3. Site 组件 mounted：
//    - 尝试加载项目配置（首次为空）
//    - 显示默认 UI
//
// 4. 用户配置设置（主题、站点名等）：
//    - 每次修改自动保存到 Foundry
//    - saveFoundryProjectConfig('my-folder', 'site.title', 'My Blog')
//
// 5. 用户点击预览：
//    - startFoundryPreviewServer('my-folder')
//    - Foundry 自动构建并启动服务器
//    - 浏览器打开预览 URL
```

#### 第二次发布相同文件夹：

```typescript
// 1. 用户右键点击相同文件夹 -> "Publish to Web"
//    触发: plugin.openPublishPanel(folder, null)
//
// 2. openPublishPanel 内部：
//    - 检测到项目已存在
//    - applyFoundryProjectToPanel(existingProject, folder, null)
//    - 设置 currentProjectName
//    - 加载项目配置
//
// 3. Site 组件 mounted：
//    - loadProjectConfig()
//    - 恢复所有之前的设置
//    - UI 显示之前的配置
//
// 4. 用户点击预览：
//    - 直接使用已有配置
//    - startFoundryPreviewServer('my-folder')
```

## 6. 配置映射表

### Foundry Config Key -> Site.svelte Variable

| Foundry 配置键 | Site.svelte 变量 | 说明 |
|---------------|------------------|------|
| `site.title` | `siteName` | 站点标题 |
| `site.baseURL` | `sitePath` | 站点路径 |
| `theme` | `selectedThemeDownloadUrl` | 主题 URL |
| `defaultContentLanguage` | `defaultContentLanguage` | 默认语言 |
| `publishDir` | - | 发布目录（固定 public） |
| `params.googleAnalytics` | `googleAnalyticsId` | GA ID |
| `params.disqusShortname` | `disqusShortname` | Disqus 短名 |
| `params.password` | `sitePassword` | 站点密码 |

## 7. 实现示例

### 完整的 Site.svelte 集成示例

```svelte
<script lang="ts">
  import { onMount } from 'svelte';
  
  export let plugin: FridayPlugin;
  
  let siteName = '';
  let selectedThemeDownloadUrl = '';
  let defaultContentLanguage = 'en';
  let googleAnalyticsId = '';
  let isBuilding = false;
  let previewUrl = '';
  
  // 加载项目配置
  async function loadProjectConfig() {
    if (!plugin.currentProjectName) return;
    
    const config = await plugin.getFoundryProjectConfigMap(plugin.currentProjectName);
    
    siteName = config['site.title'] || '';
    selectedThemeDownloadUrl = config['theme'] || '';
    defaultContentLanguage = config['defaultContentLanguage'] || 'en';
    googleAnalyticsId = config['params.googleAnalytics'] || '';
  }
  
  // 保存单个配置
  async function saveConfig(key: string, value: any) {
    if (!plugin.currentProjectName) return;
    await plugin.saveFoundryProjectConfig(plugin.currentProjectName, key, value);
  }
  
  // 站点名称变更
  function handleSiteNameChange() {
    saveConfig('site.title', siteName);
  }
  
  // 主题变更
  function handleThemeChange() {
    saveConfig('theme', selectedThemeDownloadUrl);
  }
  
  // 启动预览
  async function handleStartPreview() {
    if (!plugin.currentProjectName) {
      new Notice('No project selected');
      return;
    }
    
    isBuilding = true;
    
    try {
      const url = await plugin.startFoundryPreviewServer(plugin.currentProjectName);
      if (url) {
        previewUrl = url;
      }
    } finally {
      isBuilding = false;
    }
  }
  
  // 停止预览
  async function handleStopPreview() {
    await plugin.stopFoundryPreviewServer();
    previewUrl = '';
  }
  
  onMount(() => {
    loadProjectConfig();
  });
</script>

<div class="site-panel">
  <input 
    bind:value={siteName} 
    on:change={handleSiteNameChange}
    placeholder="Site Name"
  />
  
  <select 
    bind:value={selectedThemeDownloadUrl}
    on:change={handleThemeChange}
  >
    <option value="theme1.zip">Theme 1</option>
    <option value="theme2.zip">Theme 2</option>
  </select>
  
  <button on:click={handleStartPreview} disabled={isBuilding}>
    {isBuilding ? 'Building...' : 'Start Preview'}
  </button>
  
  {#if previewUrl}
    <button on:click={handleStopPreview}>Stop Preview</button>
    <a href={previewUrl} target="_blank">Open Preview</a>
  {/if}
</div>
```

## 8. 迁移清单

### 需要修改的现有代码

- [ ] Site.svelte 的 `startPreview()` 改为 `startFoundryPreviewServer()`
- [ ] Site.svelte 的配置变更事件添加 `saveFoundryProjectConfig()` 调用
- [ ] Site.svelte 的 `onMount()` 添加 `loadProjectConfig()` 调用
- [ ] 移除本地构建逻辑（Hugo、主题下载等）
- [ ] 更新 UI 以反映 Foundry 服务状态
- [ ] 添加服务器运行状态显示
- [ ] 处理服务器错误和重启逻辑

### 保留的现有功能

- ✓ UI 布局和样式
- ✓ 多语言内容选择
- ✓ 站点资源管理
- ✓ 发布配置（FTP、Netlify、MDFriday）

## 9. 优势总结

### 使用 Foundry 服务的优势

1. **统一管理**：所有项目通过 Foundry 统一管理
2. **CLI 兼容**：可以通过 CLI 操作同一个 workspace
3. **配置持久化**：项目配置自动保存
4. **实时预览**：Livereload 自动刷新
5. **自动构建**：文件变更自动重新构建
6. **性能优化**：并行构建、增量构建
7. **简化代码**：移除复杂的本地构建逻辑

### 用户体验提升

1. **更快的预览**：不需要每次都重新构建
2. **配置记忆**：自动记住用户的设置
3. **智能识别**：通过文件夹名自动识别项目
4. **实时更新**：修改内容后自动刷新预览
5. **跨设备同步**：通过 workspace 实现配置同步
