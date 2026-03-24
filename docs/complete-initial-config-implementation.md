# 完善项目初始配置实现文档

## 实施日期
2026-03-24

## 实施目标

完善 Foundry 项目创建时的初始配置，将原本分散在 `Site.svelte` 的配置逻辑迁移到 `Main.ts`，实现业务逻辑和 UI 的完全分离。

---

## 创建的新文件

### 1. `src/utils/common.ts` - 通用工具函数

```typescript
/**
 * 生成随机 ID（6位字符）
 */
export function generateRandomId(): string {
    return Math.random().toString(36).substring(2, 8);
}

/**
 * 安全地获取字符串的 trim 值
 */
export function safeTrim(value: string | null | undefined): string | undefined

/**
 * 检查对象是否为空
 */
export function isEmptyObject(obj: any): boolean
```

**作用**:
- 提取可复用的工具函数
- `generateRandomId` 用于生成 previewId、projectId 等
- 被 `Main.ts` 和 `Site.svelte` 共享使用

---

### 2. `src/utils/theme.ts` - 主题相关工具

```typescript
/**
 * 默认主题配置
 */
export const DEFAULT_THEMES = {
    NOTE: {
        id: 16,
        name: 'Note',
        downloadUrl: 'https://gohugo.net/note.zip?version=1.2',
        tags: ['obsidian']
    },
    QUARTZ: {
        id: 17,
        name: 'Quartz',
        downloadUrl: 'https://gohugo.net/quartz-theme.zip?version=1.2',
        tags: ['obsidian']
    },
    BOOK: {
        id: 18,
        name: 'Book',
        downloadUrl: 'https://gohugo.net/book-theme.zip?version=1.2',
        tags: []
    }
} as const;

/**
 * 检查主题是否支持 Obsidian 内部渲染器
 */
export function shouldUseInternalRenderer(themeTags: string[]): boolean

/**
 * 根据项目类型获取默认主题
 */
export function getDefaultTheme(isFolder: boolean)
```

**作用**:
- 集中管理主题配置
- 单文件项目默认使用 `Note` 主题
- 文件夹项目默认使用 `Quartz` 主题
- 自动判断是否使用内部渲染器（基于主题 tags）

---

## 修改的文件

### 1. `src/main.ts`

#### 新增导入

```typescript
import { generateRandomId } from './utils/common';
import { getDefaultTheme, shouldUseInternalRenderer } from './utils/theme';
```

#### 完全重写 `collectInitialConfig` 方法

**旧实现**（仅包含发布配置）:
```typescript
private collectInitialConfig(): Record<string, any> {
    const publishMethod = normalizePublishMethod(this.settings.publishMethod);
    
    const config = {
        publish: {
            method: publishMethod
        }
    };
    
    // FTP 和 Netlify 配置...
    
    return config;
}
```

**新实现**（完整项目配置）:
```typescript
private collectInitialConfig(
    projectName: string, 
    folder: TFolder | null, 
    file: TFile | null
): Record<string, any> {
    const publishMethod = normalizePublishMethod(this.settings.publishMethod);
    const isFolder = folder !== null;
    const defaultTheme = getDefaultTheme(isFolder);
    
    // 计算 baseURL
    let baseURL = '/';
    if (publishMethod === 'mdf-share') {
        const userDir = this.settings.licenseUser?.userDir || '';
        if (userDir) {
            const previewId = generateRandomId();
            baseURL = `/s/${userDir}/${previewId}`;
        }
    }
    
    // 检查发布权限（影响 branding）
    const hasPublishPermission = this.licenseState?.hasPublishEnabled() || false;
    
    // 构建完整配置
    const config = {
        // 基础设置
        baseURL,
        title: projectName,
        contentDir: 'content',
        publishDir: 'public',
        defaultContentLanguage: 'en',
        
        // 分类法（Hugo 默认）
        taxonomies: {
            tag: 'tags',
            category: 'categories'
        },
        
        // 主题配置
        module: {
            imports: [{
                path: defaultTheme.downloadUrl
            }]
        },
        
        // Markdown 渲染器
        markdown: {
            useInternalRenderer: shouldUseInternalRenderer(defaultTheme.tags)
        },
        
        // 站点参数
        params: {
            branding: !hasPublishPermission
        },
        
        // 发布配置
        publish: {
            method: publishMethod
        }
    };
    
    // FTP 和 Netlify 默认配置...
    
    return config;
}
```

**新增配置项**:

| 配置项 | 默认值 | 说明 |
|--------|--------|------|
| `baseURL` | `/` | mdf-share 时为 `/s/{userDir}/{previewId}` |
| `title` | 项目名 | 用户可通过 UI 修改 |
| `contentDir` | `'content'` | Hugo 内容目录 |
| `publishDir` | `'public'` | Hugo 发布目录 |
| `defaultContentLanguage` | `'en'` | 默认语言，用户可修改 |
| `taxonomies` | `{tag, category}` | Hugo 分类法 |
| `module.imports` | 主题 URL | 根据项目类型选择 |
| `markdown.useInternalRenderer` | 基于主题 | 是否使用 Obsidian 渲染器 |
| `params.branding` | `true` | 激活 license 后为 `false` |

---

### 2. `src/svelte/Site.svelte`

#### 新增导入

```typescript
import { generateRandomId } from "../utils/common";
```

#### 移除本地定义

**删除**:
```typescript
function generateRandomId(): string {
    return Math.random().toString(36).substring(2, 8);
}
```

**替换为**:
```typescript
// Note: generateRandomId is now imported from utils/common.ts
```

**优势**:
- ✅ 避免代码重复
- ✅ 保持单一真相源
- ✅ `Main.ts` 和 `Site.svelte` 使用相同的实现

---

## 配置项详细说明

### 1. baseURL 计算逻辑

```typescript
let baseURL = '/';
if (publishMethod === 'mdf-share') {
    const userDir = this.settings.licenseUser?.userDir || '';
    if (userDir) {
        const previewId = generateRandomId();
        baseURL = `/s/${userDir}/${previewId}`;
    }
}
```

**规则**:
- 默认: `/`
- mdf-share 且有 userDir: `/s/{userDir}/{previewId}`
- previewId 是 6 位随机字符串

**示例**:
```
userDir = "abc123"
previewId = "x7k9m2"
baseURL = "/s/abc123/x7k9m2"
```

---

### 2. 主题选择逻辑

```typescript
const isFolder = folder !== null;
const defaultTheme = getDefaultTheme(isFolder);
```

**规则**:
- 单文件项目 → `Note` 主题
- 文件夹项目 → `Quartz` 主题

**主题配置**:
```typescript
NOTE: {
    id: 16,
    name: 'Note',
    downloadUrl: 'https://gohugo.net/note.zip?version=1.2',
    tags: ['obsidian']  // 支持 Obsidian 渲染器
}

QUARTZ: {
    id: 17,
    name: 'Quartz',
    downloadUrl: 'https://gohugo.net/quartz-theme.zip?version=1.2',
    tags: ['obsidian']  // 支持 Obsidian 渲染器
}
```

---

### 3. Markdown 渲染器设置

```typescript
markdown: {
    useInternalRenderer: shouldUseInternalRenderer(defaultTheme.tags)
}
```

**逻辑**:
```typescript
export function shouldUseInternalRenderer(themeTags: string[] = []): boolean {
    return themeTags.includes('obsidian');
}
```

**规则**:
- 主题 tags 包含 `'obsidian'` → `useInternalRenderer: true`
- 否则 → `useInternalRenderer: false`

**当前默认主题**:
- `Note`: `useInternalRenderer: true`
- `Quartz`: `useInternalRenderer: true`
- `Book`: `useInternalRenderer: false`

---

### 4. Branding 设置

```typescript
params: {
    branding: !hasPublishPermission
}
```

**逻辑**:
```typescript
const hasPublishPermission = this.licenseState?.hasPublishEnabled() || false;
```

**规则**:
- 无 license 或无发布权限 → `branding: true` (显示品牌)
- 有发布权限 → `branding: false` (隐藏品牌)

**权限检查**:
- 通过 `LicenseStateManager` 获取
- 检查 license 中的 `publishEnabled` 特性

---

### 5. 分类法配置

```typescript
taxonomies: {
    tag: 'tags',
    category: 'categories'
}
```

**说明**:
- Hugo 的默认分类法配置
- 用户暂时不可通过 UI 修改（未来可扩展）

---

### 6. 可选配置（用户后续可添加）

#### Services（服务配置）

**Google Analytics**:
```typescript
services: {
    googleAnalytics: {
        id: 'G-XXXXXXXXXX'
    }
}
```

**Disqus**:
```typescript
services: {
    disqus: {
        shortname: 'your-disqus-shortname'
    }
}
```

**说明**: 这些配置用户可以通过 UI 的"Advanced Settings"添加。

#### Password（站点密码）

```typescript
params: {
    branding: false,
    password: 'your-password'
}
```

**说明**: 用户可以通过 UI 设置站点密码保护。

#### Languages（多语言）

```typescript
languages: {
    en: {
        contentDir: 'content',
        weight: 1
    },
    zh: {
        contentDir: 'content.zh',
        weight: 2
    }
}
```

**说明**: 用户可以通过 UI 的"Content"部分添加多语言。

---

## 数据流对比

### 旧流程（分散逻辑）

```
用户右键 → 发布
    ↓
Main.ts: 创建项目
    ↓ 仅设置发布配置
Site.svelte: onMount
    ↓ 初始化时创建完整配置
    ↓ createConfigFile()
    ↓ 设置 title, baseURL, theme 等
```

**问题**:
- ❌ 配置逻辑分散在两个地方
- ❌ UI 层包含业务逻辑
- ❌ 难以测试和维护

---

### 新流程（集中逻辑）

```
用户右键 → 发布
    ↓
Main.ts: collectInitialConfig()
    ↓ 计算所有初始配置
    ↓ - baseURL (根据发布方式)
    ↓ - title (项目名)
    ↓ - 主题 (根据项目类型)
    ↓ - branding (根据 license)
    ↓ - 所有默认值
    ↓
ProjectServiceManager.createProject()
    ↓ 使用完整配置创建项目
    ↓
Site.svelte: initialize()
    ↓ 仅加载配置到 UI
    ↓ 不包含业务逻辑
```

**优势**:
- ✅ 业务逻辑集中在 `Main.ts`
- ✅ `Site.svelte` 只负责显示
- ✅ 配置完整、一次性写入
- ✅ 易于测试和维护

---

## 架构优势

### 1. 职责清晰

**Main.ts (Controller)**:
```typescript
// 负责所有业务逻辑
- 计算 baseURL
- 选择默认主题
- 检查用户权限
- 生成随机 ID
- 准备完整配置
```

**Site.svelte (View)**:
```typescript
// 只负责 UI 显示
- 加载配置到 UI
- 响应用户输入
- 更新 UI 状态
```

---

### 2. 单一真相源

**配置来源**:
```
Foundry 项目配置 (config.json)
    ↑
Main.ts 创建时写入完整配置
    ↑
collectInitialConfig() 计算所有默认值
    ↑
从多个来源收集:
- Settings (用户设置)
- LicenseState (权限信息)
- 常量 (默认值)
- 工具函数 (计算值)
```

---

### 3. 易于测试

```typescript
// 测试 collectInitialConfig
describe('collectInitialConfig', () => {
    it('should generate correct baseURL for mdf-share', () => {
        const config = plugin.collectInitialConfig('test', null, mockFile);
        expect(config.baseURL).toMatch(/^\/s\/[^/]+\/[a-z0-9]{6}$/);
    });
    
    it('should use Note theme for file project', () => {
        const config = plugin.collectInitialConfig('test', null, mockFile);
        expect(config.module.imports[0].path).toContain('note.zip');
    });
    
    it('should use Quartz theme for folder project', () => {
        const config = plugin.collectInitialConfig('test', mockFolder, null);
        expect(config.module.imports[0].path).toContain('quartz-theme.zip');
    });
});
```

---

### 4. 易于扩展

**添加新配置项**:

只需修改 `collectInitialConfig()` 一处：

```typescript
const config = {
    // ... existing config
    
    // 新增配置项
    newFeature: {
        enabled: this.settings.newFeatureEnabled || false,
        value: calculateNewFeatureValue()
    }
};
```

**添加新主题**:

只需修改 `src/utils/theme.ts`:

```typescript
export const DEFAULT_THEMES = {
    NOTE: { ... },
    QUARTZ: { ... },
    NEW_THEME: {  // ← 新增
        id: 19,
        name: 'New Theme',
        downloadUrl: 'https://...',
        tags: ['obsidian']
    }
};
```

---

## 完整配置示例

### 单文件项目（Note 主题）

```json
{
    "baseURL": "/s/abc123/x7k9m2",
    "title": "My Note",
    "contentDir": "content",
    "publishDir": "public",
    "defaultContentLanguage": "en",
    "taxonomies": {
        "tag": "tags",
        "category": "categories"
    },
    "module": {
        "imports": [{
            "path": "https://gohugo.net/note.zip?version=1.2"
        }]
    },
    "markdown": {
        "useInternalRenderer": true
    },
    "params": {
        "branding": true
    },
    "publish": {
        "method": "mdf-share"
    }
}
```

### 文件夹项目（Quartz 主题）

```json
{
    "baseURL": "/",
    "title": "My Project",
    "contentDir": "content",
    "publishDir": "public",
    "defaultContentLanguage": "en",
    "taxonomies": {
        "tag": "tags",
        "category": "categories"
    },
    "module": {
        "imports": [{
            "path": "https://gohugo.net/quartz-theme.zip?version=1.2"
        }]
    },
    "markdown": {
        "useInternalRenderer": true
    },
    "params": {
        "branding": false
    },
    "publish": {
        "method": "netlify",
        "netlify": {
            "accessToken": "...",
            "siteId": "..."
        }
    }
}
```

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

- `docs/publish-type-refactor.md` - 发布类型重构文档
- `docs/architecture-site-main-communication.md` - 架构设计文档
- `src/utils/common.ts` - 通用工具函数
- `src/utils/theme.ts` - 主题工具函数

---

## 总结

这次实施成功实现了：

1. ✅ **完整配置**: 创建项目时提供所有必要的配置项
2. ✅ **逻辑集中**: 业务逻辑从 UI 层迁移到 Controller 层
3. ✅ **职责清晰**: Main.ts 负责逻辑，Site.svelte 负责显示
4. ✅ **代码复用**: 提取工具函数供多处使用
5. ✅ **易于测试**: 纯函数，易于单元测试
6. ✅ **易于扩展**: 新增配置只需修改一处
7. ✅ **智能默认**: 根据项目类型和用户权限自动选择
8. ✅ **编译通过**: 无错误，无警告

这是**架构优化的又一重要里程碑**，进一步强化了 Controller-View 分离的设计原则！
