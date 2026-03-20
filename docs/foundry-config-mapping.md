# Foundry 配置文件映射

本文档描述 Site.svelte UI 变量与 Foundry 项目配置文件的映射关系。

## 配置文件格式

Foundry 项目配置文件（`hugo.json`）采用标准的 Hugo 配置格式：

```json
{
  "baseURL": "/s/d66e65ad75/book-mmlooq2g/",
  "title": "book",
  "contentDir": "content",
  "publishDir": "public",
  "defaultContentLanguage": "en",
  "module": {
    "imports": [
      {
        "path": "https://gohugo.net/quartz-theme.zip?version=1.2"
      }
    ]
  },
  "languages": {
    "en": {
      "contentDir": "content",
      "weight": 1
    }
  },
  "services": {
    "googleAnalytics": {
      "id": "G-9MFZLCQBM2"
    }
  },
  "params": {
    "disqusShortname": "your-disqus-name",
    "password": "site-password"
  }
}
```

## 配置映射表

### 基本配置

| Site.svelte 变量 | Foundry 配置键 | 类型 | 说明 |
|-----------------|---------------|------|------|
| `siteName` | `title` | string | 站点标题 |
| `sitePath` | `baseURL` | string | 站点基础路径 |
| `selectedThemeDownloadUrl` | `module.imports.0.path` | string | 主题 URL |
| `defaultContentLanguage` | `defaultContentLanguage` | string | 默认语言 |

### 服务配置

| Site.svelte 变量 | Foundry 配置键 | 类型 | 说明 |
|-----------------|---------------|------|------|
| `googleAnalyticsId` | `services.googleAnalytics.id` | string | Google Analytics ID |

### 自定义参数

| Site.svelte 变量 | Foundry 配置键 | 类型 | 说明 |
|-----------------|---------------|------|------|
| `disqusShortname` | `params.disqusShortname` | string | Disqus 短名称 |
| `sitePassword` | `params.password` | string | 站点访问密码 |

### 固定配置（不可修改）

| Foundry 配置键 | 默认值 | 说明 |
|---------------|--------|------|
| `contentDir` | `"content"` | 内容目录 |
| `publishDir` | `"public"` | 发布目录 |

## 使用点号表示法

Foundry 配置服务支持使用点号表示法访问嵌套配置：

### 读取配置

```typescript
const config = await plugin.getFoundryProjectConfigMap(projectName);

// 读取顶层配置
const title = config['title'];

// 读取嵌套配置
const themeUrl = config['module']?.imports?.[0]?.path;
const gaId = config['services']?.googleAnalytics?.id;
```

### 保存配置

```typescript
// 顶层配置
await plugin.saveFoundryConfig(projectName, 'title', 'My Site');
await plugin.saveFoundryConfig(projectName, 'baseURL', '/blog/');

// 嵌套配置使用点号表示法
await plugin.saveFoundryConfig(
  projectName,
  'module.imports.0.path',
  'https://example.com/theme.zip'
);

await plugin.saveFoundryConfig(
  projectName,
  'services.googleAnalytics.id',
  'G-XXXXXXXXXX'
);
```

## 实现细节

### 加载配置（loadFoundryProjectConfig）

```typescript
async function loadFoundryProjectConfig() {
  const config = await plugin.getFoundryProjectConfigMap(plugin.currentProjectName);
  
  // 基本配置
  if (config['title']) {
    siteName = config['title'];
  }
  if (config['baseURL']) {
    sitePath = config['baseURL'];
  }
  
  // 主题配置（嵌套对象）
  if (config['module']?.imports?.[0]?.path) {
    selectedThemeDownloadUrl = config['module'].imports[0].path;
  }
  
  // 服务配置（嵌套对象）
  if (config['services']?.googleAnalytics?.id) {
    googleAnalyticsId = config['services'].googleAnalytics.id;
  }
  
  // 自定义参数
  if (config['params']?.disqusShortname) {
    disqusShortname = config['params'].disqusShortname;
  }
}
```

### 保存配置（saveCurrentConfiguration）

```typescript
async function saveCurrentConfiguration() {
  const configMap = {
    'title': siteName,
    'baseURL': sitePath,
    'module.imports.0.path': selectedThemeDownloadUrl,
    'services.googleAnalytics.id': googleAnalyticsId,
    'params.disqusShortname': disqusShortname,
    'params.password': sitePassword,
  };
  
  await saveFoundryConfigBatch(configMap);
}
```

### 单个配置保存（on:blur 事件）

```svelte
<!-- 站点名称 -->
<input
  bind:value={siteName}
  on:blur={() => saveFoundryConfig('title', siteName)}
/>

<!-- Google Analytics -->
<input
  bind:value={googleAnalyticsId}
  on:blur={() => saveFoundryConfig('services.googleAnalytics.id', googleAnalyticsId)}
/>

<!-- 主题选择 -->
<button on:click={openThemeModal}>
  <!-- 在 callback 中保存 -->
  await saveFoundryConfig('module.imports.0.path', themeUrl)
</button>
```

## 配置文件位置

项目配置文件存储在：

```
<workspace>/projects/<project-name>/hugo.json
```

例如：
```
~/.obsidian/plugins/mdfriday/workspace/projects/my-blog/hugo.json
```

## 注意事项

### 1. 嵌套配置的访问

读取时需要使用可选链操作符（`?.`）防止访问不存在的属性：

```typescript
// ✓ 正确
const themeUrl = config['module']?.imports?.[0]?.path;

// ✗ 错误（可能抛出异常）
const themeUrl = config['module'].imports[0].path;
```

### 2. 数组索引配置

主题配置使用数组，需要指定索引：

```typescript
// 保存主题（第一个导入）
'module.imports.0.path'

// 如果有多个主题
'module.imports.1.path'
```

### 3. 配置键命名

- 使用点号分隔嵌套层级
- 数组使用数字索引
- 保持与 Hugo 配置格式一致

### 4. 默认值处理

如果配置不存在，使用合理的默认值：

```typescript
const title = config['title'] || 'Untitled';
const baseURL = config['baseURL'] || '/';
const lang = config['defaultContentLanguage'] || 'en';
```

## 完整示例

### 创建项目时的默认配置

```json
{
  "title": "My Blog",
  "baseURL": "/",
  "contentDir": "content",
  "publishDir": "public",
  "defaultContentLanguage": "en",
  "module": {
    "imports": [
      {
        "path": "https://gohugo.net/book-ob.zip?version=1.1"
      }
    ]
  },
  "languages": {
    "en": {
      "contentDir": "content",
      "weight": 1
    }
  }
}
```

### 用户配置后的完整配置

```json
{
  "title": "My Tech Blog",
  "baseURL": "/blog/",
  "contentDir": "content",
  "publishDir": "public",
  "defaultContentLanguage": "en",
  "module": {
    "imports": [
      {
        "path": "https://gohugo.net/quartz-theme.zip?version=1.2"
      }
    ]
  },
  "languages": {
    "en": {
      "contentDir": "content",
      "weight": 1
    }
  },
  "services": {
    "googleAnalytics": {
      "id": "G-XXXXXXXXXX"
    }
  },
  "params": {
    "disqusShortname": "my-tech-blog",
    "password": "secret123"
  }
}
```

## 总结

- **配置格式**：标准 Hugo JSON 格式
- **嵌套访问**：使用点号表示法或对象访问
- **保存方式**：支持点号表示法的配置键
- **数据持久化**：自动保存到 workspace 配置文件
- **CLI 兼容**：可通过 Foundry CLI 访问相同配置
