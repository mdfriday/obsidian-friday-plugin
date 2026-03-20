# Obsidian 接口完整文档

本文档描述了为 Obsidian 插件提供的所有服务接口。

## 概述

Foundry 为 Obsidian 插件提供了完整的服务接口，包括：

- **Workspace 服务**：初始化和管理 workspace
- **Project 服务**：创建和管理项目（支持单文件、文件夹、空项目）
- **Build 服务**：构建静态网站
- **Config 服务**：管理配置（分为全局配置和项目配置）
- **Publish 服务**：发布到托管平台（FTP、Netlify、MDFriday）
- **Serve 服务**：开发服务器（实时预览、自动构建、自动发布）
- **License 服务**：License 管理（试用、激活、使用监控）
- **Auth 服务**：认证状态查询和服务器配置
- **Domain 服务**：域名管理（子域名、自定义域名、HTTPS 证书）

所有服务都通过依赖注入容器自动创建依赖，使用简单方便。

## 安装和导入

```typescript
import {
  // Workspace
  createObsidianWorkspaceService,
  
  // Project
  createObsidianProjectService,
  
  // Build
  createObsidianBuildService,
  
  // Config
  createObsidianGlobalConfigService,
  createObsidianProjectConfigService,
  
  // Publish
  createObsidianPublishService,
  
  // Serve
  createObsidianServeService,
  
  // License
  createObsidianLicenseService,
  
  // Auth
  createObsidianAuthService,
  
  // Domain
  createObsidianDomainService,
  
  // Types - HTTP Clients
  type PublishHttpClient,
  type PublishHttpResponse,
  type IdentityHttpClient,
  type IdentityHttpResponse,
  
  // Types - Config
  type AnyPublishConfig,
  type FTPConfig,
  type NetlifyConfig,
  type MDFridayConfig,
} from '@mdfriday/foundry';
```

## 1. Workspace 服务

管理 workspace 的初始化和信息查询。

### 创建服务

```typescript
const workspaceService = createObsidianWorkspaceService();
```

### API

#### `initWorkspace(path, options?)`

初始化一个新的 workspace。

```typescript
const result = await workspaceService.initWorkspace('/path/to/vault', {
  name: 'My Blog',
  modulesDir: '.mdfriday/modules',
  projectsDir: 'projects',
});

if (result.success) {
  console.log('Workspace created:', result.data?.name);
}
```

#### `getWorkspaceInfo(path)`

获取 workspace 信息。

```typescript
const result = await workspaceService.getWorkspaceInfo('/path/to/vault');

if (result.success) {
  const info = result.data;
  console.log(`Workspace: ${info?.name}`);
  console.log(`Projects: ${info?.projectCount}`);
  info?.projects.forEach(p => console.log(`  - ${p.name}`));
}
```

#### `workspaceExists(path)`

检查 workspace 是否存在。

```typescript
const exists = await workspaceService.workspaceExists('/path/to/vault');
console.log('Workspace exists:', exists);
```

## 2. Project 服务

创建和管理项目，支持三种创建方式。

### 创建服务

```typescript
const projectService = createObsidianProjectService();
```

### API

#### `createProject(options)`

创建项目（自动检测类型）。

**从单个文件创建：**

```typescript
const result = await projectService.createProject({
  name: 'my-note',
  workspacePath: '/path/to/vault',
  sourceFile: '/path/to/vault/notes/article.md',
  language: 'en',
  // theme 默认为 note 主题
});
```

**从文件夹创建：**

```typescript
const result = await projectService.createProject({
  name: 'my-blog',
  workspacePath: '/path/to/vault',
  sourceFolder: '/path/to/vault/blog-content',
  theme: 'https://github.com/quartz/quartz.git',
  language: 'zh',
});
```

**创建空项目：**

```typescript
const result = await projectService.createProject({
  name: 'new-site',
  workspacePath: '/path/to/vault',
  theme: 'https://example.com/theme.zip',
  language: 'en',
  createSampleContent: true,
});
```

#### `listProjects(workspacePath)`

列出所有项目。

```typescript
const result = await projectService.listProjects('/path/to/vault');

if (result.success) {
  result.data?.forEach(project => {
    console.log(`${project.name}: ${project.path}`);
    if (project.fileLink) {
      console.log(`  File: ${project.fileLink.sourcePath}`);
    }
  });
}
```

#### `getProjectInfo(workspacePath, projectName)`

获取特定项目的信息。

```typescript
const result = await projectService.getProjectInfo('/path/to/vault', 'my-blog');

if (result.success) {
  const project = result.data;
  console.log(`Project: ${project?.name}`);
  console.log(`Created: ${project?.createdAt}`);
  console.log(`Languages: ${project?.languages?.join(', ')}`);
}
```

## 3. Build 服务

构建静态网站。

### 创建服务

```typescript
const buildService = createObsidianBuildService();
```

### API

#### `buildProject(options)`

构建项目。

```typescript
const result = await buildService.buildProject({
  workspacePath: '/path/to/vault',
  projectNameOrPath: 'my-blog',
  
  // 可选参数
  destination: 'public',           // 输出目录
  clean: true,                     // 是否清理输出目录
  parallel: true,                  // 是否使用并行构建
  snapshot: true,                  // 是否创建快照
  snapshotName: 'v1.0.0',         // 快照名称
  contentDirs: ['extra-content'], // 额外的内容目录
});

if (result.success) {
  console.log(`Built in ${result.data?.duration}ms`);
  console.log(`Output: ${result.data?.outputDir}`);
}
```

## 4. Config 服务

管理配置，分为全局配置（Workspace 级别）和项目配置（Project 级别）。

### 全局配置服务

管理 workspace 级别的配置。

```typescript
const globalConfig = createObsidianGlobalConfigService();
```

#### `get(workspacePath, key)`

获取全局配置值。

```typescript
const result = await globalConfig.get('/path/to/vault', 'site.baseURL');

if (result.success) {
  console.log(`${result.data?.key} = ${result.data?.value}`);
}
```

#### `set(workspacePath, key, value)`

设置全局配置值。

```typescript
await globalConfig.set('/path/to/vault', 'site.baseURL', 'https://example.com');
await globalConfig.set('/path/to/vault', 'site.title', 'My Blog');
await globalConfig.set('/path/to/vault', 'build.parallel', true);
```

#### `list(workspacePath)`

列出所有全局配置。

```typescript
const result = await globalConfig.list('/path/to/vault');

if (result.success) {
  console.log('Global Configuration:');
  console.log(JSON.stringify(result.data?.config, null, 2));
}
```

#### `unset(workspacePath, key)`

删除全局配置值。

```typescript
await globalConfig.unset('/path/to/vault', 'site.deprecated');
```

#### `getConfigPath(workspacePath)`

获取全局配置文件路径。

```typescript
const result = await globalConfig.getConfigPath('/path/to/vault');
console.log('Config file:', result.data?.path);
```

### 项目配置服务

管理项目级别的配置。

```typescript
const projectConfig = createObsidianProjectConfigService();
```

#### `get(workspacePath, projectName, key)`

获取项目配置值。

```typescript
const result = await projectConfig.get(
  '/path/to/vault',
  'my-blog',
  'contentDir'
);

if (result.success) {
  console.log(`${result.data?.key} = ${result.data?.value}`);
  console.log(`Project: ${result.data?.project}`);
}
```

#### `set(workspacePath, projectName, key, value)`

设置项目配置值。

```typescript
await projectConfig.set(
  '/path/to/vault',
  'my-blog',
  'publishDir',
  'dist'
);

await projectConfig.set(
  '/path/to/vault',
  'my-blog',
  'defaultContentLanguage',
  'zh'
);
```

#### `list(workspacePath, projectName)`

列出所有项目配置。

```typescript
const result = await projectConfig.list('/path/to/vault', 'my-blog');

if (result.success) {
  console.log(`Project: ${result.data?.project}`);
  console.log(JSON.stringify(result.data?.config, null, 2));
}
```

#### `unset(workspacePath, projectName, key)`

删除项目配置值。

```typescript
await projectConfig.unset('/path/to/vault', 'my-blog', 'deprecated');
```

#### `getConfigPath(workspacePath, projectName)`

获取项目配置文件路径。

```typescript
const result = await projectConfig.getConfigPath('/path/to/vault', 'my-blog');
console.log('Config file:', result.data?.path);
console.log('Project:', result.data?.project);
```

## 5. Publish 服务

发布静态网站到托管平台。**特别注意**：Publish 服务需要 Obsidian 插件实现 HttpClient。

### 创建服务

Publish 服务需要特殊的初始化方式，因为它依赖 Obsidian 的 HTTP 功能。

```typescript
import { requestUrl } from 'obsidian';
import type { HttpClient } from '@mdfriday/foundry';

```typescript
import { requestUrl } from 'obsidian';
import type { PublishHttpClient } from '@mdfriday/foundry';

// Obsidian 插件需要自己实现 PublishHttpClient 接口
class ObsidianPublishHttpClient implements PublishHttpClient {
  constructor(private requestUrl: typeof requestUrl) {}

  async postJSON(url: string, data: any, headers?: Record<string, string>) {
    const response = await this.requestUrl({
      url,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...headers,
      },
      body: JSON.stringify(data),
    });
    
    return {
      status: response.status,
      ok: response.status >= 200 && response.status < 300,
      data: response.json,
      async text() { return response.text; },
      async json() { return response.json; },
    };
  }
  
  // ... 实现其他方法：postMultipart, putBinary, get
}

const httpClient = new ObsidianPublishHttpClient(requestUrl);
const publishService = createObsidianPublishService(httpClient);
```

### API

#### `publish(options, onProgress?)`

发布项目到指定平台。

**发布到 FTP：**

```typescript
import type { FTPConfig } from '@mdfriday/foundry';

// 准备 FTP 配置
const ftpConfig: FTPConfig = {
  host: 'ftp.example.com',
  port: 21,              // FTP 端口（通常为 21 或 22）
  username: 'admin',
  password: 'secret',
  remotePath: '/public_html',
  secure: true,          // 是否使用 FTPS/SFTP
};

const result = await publishService.publish(
  {
    workspacePath: '/path/to/vault',
    projectName: 'my-blog',
    method: 'ftp',
    config: ftpConfig,  // 传入完整配置
    force: false,       // 是否强制完整发布（忽略增量）
  },
  (progress) => {
    // 进度回调
    console.log(`${progress.phase}: ${progress.percentage}% - ${progress.message}`);
    if (progress.currentFile) {
      console.log(`  Current: ${progress.currentFile}`);
    }
    if (progress.filesCompleted !== undefined) {
      console.log(`  Progress: ${progress.filesCompleted}/${progress.filesTotal}`);
    }
  }
);

if (result.success) {
  console.log('Published!');
  console.log(`  URL: ${result.data?.url}`);
  console.log(`  Files: ${result.data?.filesUploaded}`);
  console.log(`  Size: ${result.data?.bytesTransferred} bytes`);
  console.log(`  Time: ${result.data?.duration}ms`);
}
```

**发布到 Netlify：**

```typescript
import type { NetlifyConfig } from '@mdfriday/foundry';

const netlifyConfig: NetlifyConfig = {
  siteId: 'your-site-id',
  accessToken: 'your-netlify-token',
};

const result = await publishService.publish({
  workspacePath: '/path/to/vault',
  projectName: 'my-blog',
  method: 'netlify',
  config: netlifyConfig,
});
```

**发布到 MDFriday：**

```typescript
import type { MDFridayConfig } from '@mdfriday/foundry';

const mdfridayConfig: MDFridayConfig = {
  enabled: true,
  type: 'share',     // 'share' | 'sub' | 'custom' | 'enterprise'
  autoPublish: false,
  licenseKey: 'your-license-key',  // 可选
};

const result = await publishService.publish({
  workspacePath: '/path/to/vault',
  projectName: 'my-blog',
  method: 'mdfriday',
  config: mdfridayConfig,
});
```

#### `testConnection(workspacePath, projectName, config)`

测试连接到发布平台。

```typescript
import type { FTPConfig } from '@mdfriday/foundry';

// 准备配置
const ftpConfig: FTPConfig = {
  host: 'ftp.example.com',
  username: 'admin',
  password: 'secret',
  remotePath: '/public_html',
  secure: true,
};

const result = await publishService.testConnection(
  '/path/to/vault',
  'my-blog',
  ftpConfig  // 传入完整配置
);

if (result.success) {
  console.log('Connection successful!');
} else {
  console.error('Connection failed:', result.error);
}
```

### 进度回调

进度回调提供详细的发布进度信息：

```typescript
interface ObsidianPublishProgress {
  phase: 'scanning' | 'uploading' | 'deploying' | 'complete';
  percentage: number;        // 0-100
  message: string;
  currentFile?: string;      // 当前处理的文件
  filesCompleted?: number;   // 已完成文件数
  filesTotal?: number;       // 总文件数
  bytesTransferred?: number; // 已传输字节数
}
```

### 配置管理

发布配置可以存储在全局或项目配置中，然后在 Obsidian 插件中读取并传递给发布服务：

```typescript
import { 
  createObsidianGlobalConfigService,
  createObsidianProjectConfigService,
  type FTPConfig,
} from '@mdfriday/foundry';

const globalConfig = createObsidianGlobalConfigService();
const projectConfig = createObsidianProjectConfigService();

// 配置 FTP（存储在全局配置中）
await globalConfig.set(vaultPath, 'publish.ftp.host', 'ftp.example.com');
await globalConfig.set(vaultPath, 'publish.ftp.username', 'admin');
await globalConfig.set(vaultPath, 'publish.ftp.password', 'secret');
await globalConfig.set(vaultPath, 'publish.ftp.remotePath', '/public_html');

// 配置 Netlify（存储在项目配置中）
await projectConfig.set(vaultPath, 'my-blog', 'publish.netlify.siteId', 'your-site-id');
await projectConfig.set(vaultPath, 'my-blog', 'publish.netlify.accessToken', 'your-token');

// 从配置中读取并构建 config 对象
const globalConfigResult = await globalConfig.list(vaultPath);
const projectConfigResult = await projectConfig.list(vaultPath, 'my-blog');

// 合并配置（项目配置优先）
const ftpConfig: FTPConfig = {
  host: projectConfigResult.data?.config?.publish?.ftp?.host || globalConfigResult.data?.config?.publish?.ftp?.host,
  port: projectConfigResult.data?.config?.publish?.ftp?.port || globalConfigResult.data?.config?.publish?.ftp?.port || 21,
  username: projectConfigResult.data?.config?.publish?.ftp?.username || globalConfigResult.data?.config?.publish?.ftp?.username,
  password: projectConfigResult.data?.config?.publish?.ftp?.password || globalConfigResult.data?.config?.publish?.ftp?.password,
  remotePath: projectConfigResult.data?.config?.publish?.ftp?.remotePath || globalConfigResult.data?.config?.publish?.ftp?.remotePath,
  secure: true,
};

// 发布时传递构建的 config
const result = await publishService.publish({
  workspacePath: vaultPath,
  projectName: 'my-blog',
  method: 'ftp',
  config: ftpConfig,
});
```

## 完整使用示例

### 示例 1: 基本发布流程

```typescript
import { requestUrl } from 'obsidian';
import {
  createObsidianWorkspaceService,
  createObsidianProjectService,
  createObsidianBuildService,
  createObsidianPublishService,
  type PublishHttpClient,
  type FTPConfig,
} from '@mdfriday/foundry';

// Obsidian 插件实现 PublishHttpClient
class ObsidianPublishHttpClient implements PublishHttpClient {
  constructor(private requestUrl: typeof requestUrl) {}
  
  async postJSON(url: string, data: any, headers?: Record<string, string>) {
    const response = await this.requestUrl({
      url,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(data),
    });
    return {
      status: response.status,
      ok: response.status >= 200 && response.status < 300,
      data: response.json,
      async text() { return response.text; },
      async json() { return response.json; },
    };
  }
  
  // ... 实现其他方法
}

async function publishNote(vaultPath: string, notePath: string) {
  const workspaceService = createObsidianWorkspaceService();
  const projectService = createObsidianProjectService();
  const buildService = createObsidianBuildService();
  
  // 创建 publish 服务（需要 HttpClient）
  const httpClient = new ObsidianPublishHttpClient(requestUrl);
  const publishService = createObsidianPublishService(httpClient);
  
  // 1. 初始化 workspace
  if (!await workspaceService.workspaceExists(vaultPath)) {
    await workspaceService.initWorkspace(vaultPath);
  }
  
  // 2. 创建项目
  await projectService.createProject({
    name: 'my-note',
    workspacePath: vaultPath,
    sourceFile: notePath,
  });
  
  // 3. 构建
  const buildResult = await buildService.buildProject({
    workspacePath: vaultPath,
    projectNameOrPath: 'my-note',
    clean: true,
  });
  
  if (!buildResult.success) {
    console.error('Build failed:', buildResult.error);
    return;
  }
  
  // 4. 发布（需要准备配置）
  const ftpConfig: FTPConfig = {
    host: 'ftp.example.com',
    port: 21,
    username: 'admin',
    password: 'secret',
    remotePath: '/public_html',
    secure: true,
  };
  
  const publishResult = await publishService.publish(
    {
      workspacePath: vaultPath,
      projectName: 'my-note',
      method: 'ftp',
      config: ftpConfig,
    },
    (progress) => {
      console.log(`Publishing: ${progress.percentage}%`);
    }
  );
  
  if (publishResult.success) {
    console.log('✓ Published!');
    console.log(`  URL: ${publishResult.data?.url}`);
  }
}
```

### 示例 2: 带配置的发布

```typescript
import { requestUrl } from 'obsidian';
import {
  createObsidianGlobalConfigService,
  createObsidianPublishService,
  type PublishHttpClient,
  type FTPConfig,
} from '@mdfriday/foundry';

// Obsidian 插件实现 PublishHttpClient
class ObsidianPublishHttpClient implements PublishHttpClient {
  // ... 实现
}

async function setupAndPublish(vaultPath: string, projectName: string) {
  const globalConfig = createObsidianGlobalConfigService();
  const httpClient = new ObsidianPublishHttpClient(requestUrl);
  const publishService = createObsidianPublishService(httpClient);
  
  // 设置全局发布配置
  await globalConfig.set(vaultPath, 'publish.ftp.host', 'ftp.example.com');
  await globalConfig.set(vaultPath, 'publish.ftp.username', 'admin');
  await globalConfig.set(vaultPath, 'publish.ftp.password', 'secret');
  
  // 从配置中读取并构建 config 对象
  const configResult = await globalConfig.list(vaultPath);
  const ftpConfig: FTPConfig = {
    host: configResult.data?.config?.publish?.ftp?.host || '',
    username: configResult.data?.config?.publish?.ftp?.username || '',
    password: configResult.data?.config?.publish?.ftp?.password || '',
    remotePath: '/',
    secure: true,
  };
  
  // 发布时传入配置
  const result = await publishService.publish({
    workspacePath: vaultPath,
    projectName,
    method: 'ftp',
    config: ftpConfig,
  });
  
  return result;
}
```

## 完整工作流示例

```typescript
import {
  createObsidianWorkspaceService,
  createObsidianProjectService,
  createObsidianBuildService,
  createObsidianGlobalConfigService,
  createObsidianProjectConfigService,
} from '@mdfriday/foundry';

async function publishNote(vaultPath: string, notePath: string) {
  const workspaceService = createObsidianWorkspaceService();
  const projectService = createObsidianProjectService();
  const buildService = createObsidianBuildService();
  const globalConfig = createObsidianGlobalConfigService();
  
  // 1. 检查并初始化 workspace
  if (!await workspaceService.workspaceExists(vaultPath)) {
    await workspaceService.initWorkspace(vaultPath, {
      name: 'My Vault',
    });
  }
  
  // 2. 设置全局配置
  await globalConfig.set(vaultPath, 'site.baseURL', 'https://myblog.com');
  
  // 3. 创建项目（从单个文件）
  const projectResult = await projectService.createProject({
    name: 'my-note',
    workspacePath: vaultPath,
    sourceFile: notePath,
    language: 'en',
  });
  
  if (!projectResult.success) {
    console.error('Failed to create project:', projectResult.error);
    return;
  }
  
  // 4. 构建项目
  const buildResult = await buildService.buildProject({
    workspacePath: vaultPath,
    projectNameOrPath: 'my-note',
    clean: true,
    parallel: true,
  });
  
  if (buildResult.success) {
    console.log(`✓ Published in ${buildResult.data?.duration}ms`);
    console.log(`  Output: ${buildResult.data?.outputDir}`);
  } else {
    console.error('Build failed:', buildResult.error);
  }
}
```

## 错误处理

所有服务方法都返回统一的结果格式：

```typescript
interface Result<T> {
  success: boolean;
  message?: string;
  data?: T;
  error?: string;
}
```

始终检查 `success` 字段：

```typescript
const result = await service.someMethod(...);

if (result.success) {
  // 使用 result.data
  console.log(result.data);
} else {
  // 处理错误
  console.error('Error:', result.error);
}
```

## TypeScript 类型

所有接口都提供完整的 TypeScript 类型定义：

```typescript
import type {
  // 结果类型
  ObsidianWorkspaceInfo,
  ObsidianProjectInfo,
  ObsidianBuildResult,
  ObsidianConfigResult,
  ObsidianPublishResult,
  ObsidianPublishProgress,
  ConfigGetResult,
  ConfigListResult,
  
  // HTTP Client 类型
  PublishHttpClient,
  PublishHttpResponse,
  IdentityHttpClient,
  IdentityHttpResponse,
  
  // 配置类型
  AnyPublishConfig,
  FTPConfig,
  NetlifyConfig,
  MDFridayConfig,
} from '@mdfriday/foundry';
```

## 注意事项

1. **路径要求**：所有路径参数都应该是绝对路径
2. **异步操作**：所有方法都是异步的，需要使用 `await`
3. **依赖管理**：每个 `create*Service()` 都会创建独立的服务实例，包含完整的依赖链
4. **配置分离**：全局配置和项目配置是分离的，使用不同的服务管理
5. **错误处理**：始终检查返回结果的 `success` 字段
6. **Publish 服务特殊要求**：
   - Publish 服务需要 Obsidian 提供 HttpClient 实现
   - 使用 `createObsidianHttpClient(requestUrl)` 创建适配器
   - 或者自己实现 `HttpClient` 接口

## HttpClient 接口

如果需要自定义 HttpClient 实现，需要实现以下接口：

```typescript
interface HttpClient {
  postJSON(url: string, data: any, headers?: Record<string, string>): Promise<HttpResponse>;
  postMultipart(url: string, formData: Record<string, any>, headers?: Record<string, string>): Promise<HttpResponse>;
  putBinary(url: string, data: Buffer | Uint8Array, headers?: Record<string, string>): Promise<HttpResponse>;
  get(url: string, headers?: Record<string, string>): Promise<HttpResponse>;
}

interface HttpResponse {
  status: number;
  ok: boolean;
  statusText?: string;
  data: any;
  text(): Promise<string>;
  json(): Promise<any>;
}
```

### 实现建议

参考 Friday 插件的真实实现（`friday/src/hugoverse.ts`），特别是：

1. **FormData 处理**：`formDataToArrayBuffer` 方法用于处理文件上传
2. **Boundary 生成**：使用随机字符串生成 multipart boundary
3. **二进制数据**：正确处理 ArrayBuffer 和 Uint8Array

完整的参考实现请查看 Friday 插件源码。

## 配置类型定义

### FTPConfig

FTP 发布配置：

```typescript
interface FTPConfig {
  host: string;        // FTP 服务器地址
  port: number;        // FTP 端口（通常为 21 或 22）
  username: string;    // 用户名
  password: string;    // 密码
  remotePath: string;  // 远程路径
  secure: boolean;     // 是否使用 FTPS/SFTP
}
```

### NetlifyConfig

Netlify 发布配置：

```typescript
interface NetlifyConfig {
  accessToken: string;  // Netlify Access Token
  siteId: string;       // Netlify Site ID
}
```

### MDFridayConfig

MDFriday 发布配置：

```typescript
interface MDFridayConfig {
  enabled: boolean;    // 是否启用
  type: 'share' | 'sub' | 'custom' | 'enterprise';  // 部署类型
  autoPublish: boolean;  // 是否自动发布
  licenseKey?: string;   // License Key（可选）
}
```

### AnyPublishConfig

联合类型，可以是以上任意一种配置：

```typescript
type AnyPublishConfig = FTPConfig | NetlifyConfig | MDFridayConfig;
```

## 6. Serve 服务

启动开发服务器，支持实时预览、自动构建、自动发布。

### 创建服务

```typescript
// 不启用自动发布
const serveService = createObsidianServeService();

// 启用自动发布（需要 HttpClient）
const httpClient = new ObsidianPublishHttpClient(requestUrl);
const serveService = createObsidianServeService(httpClient);
```

### API

#### `startServer(options, onProgress?)`

启动开发服务器。

**基本使用：**

```typescript
const result = await serveService.startServer(
  {
    workspacePath: '/path/to/vault',
    projectName: 'my-blog',
    port: 8080,              // 可选，默认 8080
    host: 'localhost',        // 可选，默认 localhost
    livereload: true,         // 可选，默认 true
    livereloadPort: 35729,    // 可选，默认 35729
  },
  (progress) => {
    console.log(`${progress.phase}: ${progress.percentage}%`);
    console.log(progress.message);
  }
);

if (result.success) {
  console.log('Server started!');
  console.log(`  URL: ${result.data?.url}`);
  console.log(`  Port: ${result.data?.port}`);
}
```

**启用自动发布：**

```typescript
import type { NetlifyConfig } from '@mdfriday/foundry';

// 需要先创建带 HttpClient 的服务
const httpClient = new ObsidianPublishHttpClient(requestUrl);
const serveService = createObsidianServeService(httpClient);

// 准备发布配置
const netlifyConfig: NetlifyConfig = {
  siteId: 'your-site-id',
  accessToken: 'your-netlify-token',
};

const result = await serveService.startServer({
  workspacePath: '/path/to/vault',
  projectName: 'my-blog',
  port: 8080,
  publishConfig: {         // 自动发布配置
    method: 'netlify',
    config: netlifyConfig, // 传入完整配置
    delay: 2000,           // 发布防抖延迟（毫秒）
  },
  markdown: customRenderer, // 可选的自定义 Markdown 渲染器
});
```

**参数说明：**
- `workspacePath`: Workspace 路径
- `projectName`: 项目名称
- `port`: 服务器端口（可选，默认 8080）
- `host`: 服务器主机（可选，默认 'localhost'）
- `livereload`: 是否启用 LiveReload（可选，默认 true）
- `livereloadPort`: LiveReload 端口（可选，默认 35729）
- `publishConfig`: 自动发布配置（可选）
  - `method`: 发布方法（'ftp' | 'netlify' | 'mdfriday'）
  - `config`: 发布配置对象（`AnyPublishConfig` 类型）
  - `delay`: 发布延迟（毫秒，可选，默认 2000）
- `markdown`: 自定义 Markdown 渲染器（可选）
  - 允许 Obsidian 插件提供自定义的 Markdown 渲染实现
  - 可以覆盖默认的渲染行为，支持自定义语法等

#### `stopServer()`

停止开发服务器。

```typescript
const stopped = await serveService.stopServer();
console.log('Server stopped:', stopped);
```

#### `isRunning()`

检查服务器是否正在运行。

```typescript
const running = serveService.isRunning();
console.log('Server running:', running);
```

### 使用自定义 Markdown 渲染器

Serve 服务支持自定义 Markdown 渲染器，这对于 Obsidian 插件非常有用：

```typescript
import { requestUrl } from 'obsidian';
import {
  createObsidianServeService,
  MarkdownRenderer,
  type PublishHttpClient,
} from '@mdfriday/foundry';

// 创建自定义 Markdown 渲染器
class ObsidianMarkdownRenderer implements MarkdownRenderer {
  render(content: string, options?: any): string {
    // 使用 Obsidian 的 Markdown 处理逻辑
    // 可以添加 Obsidian 特有的语法支持（如 [[wikilinks]]、#tags 等）
    return processedContent;
  }
  
  // 实现其他必需的方法...
}

const customRenderer = new ObsidianMarkdownRenderer();
const httpClient = new ObsidianPublishHttpClient(requestUrl);
const serveService = createObsidianServeService(httpClient);

const result = await serveService.startServer({
  workspacePath: vaultPath,
  projectName: 'my-blog',
  port: 8080,
  markdown: customRenderer, // 传入自定义渲染器
});

if (result.success) {
  console.log('Server started with custom Markdown renderer!');
}
```

### 进度回调

进度回调提供详细的服务器状态信息：

```typescript
interface ObsidianServeProgress {
  phase: 'initializing' | 'building' | 'watching' | 'publishing' | 'ready';
  percentage: number;        // 0-100
  message: string;
  currentFile?: string;      // 当前处理的文件（可选）
}
```

### 完整示例

```typescript
import { requestUrl } from 'obsidian';
import {
  createObsidianServeService,
  type PublishHttpClient,
  type NetlifyConfig,
} from '@mdfriday/foundry';

class ObsidianPublishHttpClient implements PublishHttpClient {
  // ... 实现
}

async function startDevServer(vaultPath: string, projectName: string) {
  // 创建服务（启用自动发布）
  const httpClient = new ObsidianPublishHttpClient(requestUrl);
  const serveService = createObsidianServeService(httpClient);
  
  // 准备发布配置
  const netlifyConfig: NetlifyConfig = {
    siteId: 'your-site-id',
    accessToken: 'your-netlify-token',
  };
  
  // 启动服务器
  const result = await serveService.startServer(
    {
      workspacePath: vaultPath,
      projectName,
      port: 8080,
      livereload: true,
      publishConfig: {      // 自动发布配置
        method: 'netlify',
        config: netlifyConfig,
        delay: 3000,        // 3 秒防抖
      },
    },
    (progress) => {
      // 更新 UI 显示进度
      updateProgressBar(progress.percentage, progress.message);
      
      if (progress.phase === 'ready') {
        showNotification('Server is ready!');
      }
      
      if (progress.phase === 'publishing') {
        showNotification('Publishing changes...');
      }
    }
  );
  
  if (result.success) {
    console.log(`Server running at ${result.data?.url}`);
    
    // 保存服务实例，以便后续停止
    return serveService;
  } else {
    console.error('Failed to start server:', result.error);
  }
}

async function stopDevServer(serveService) {
  const stopped = await serveService.stopServer();
  if (stopped) {
    console.log('Server stopped successfully');
  }
}
```

## 7. License 服务

管理 License 的激活、查询、使用监控。

### 创建服务

```typescript
const httpClient = new ObsidianIdentityHttpClient(requestUrl);
const licenseService = await createObsidianLicenseService(vaultPath, httpClient);
```

### API

#### `requestTrial(email)`

请求试用 License。

```typescript
const result = await licenseService.requestTrial('user@example.com');

if (result.success && result.data) {
  console.log('Trial activated!');
  console.log(`  Plan: ${result.data.plan}`);
  console.log(`  Expires: ${result.data.expires}`);
  console.log(`  Days Remaining: ${result.data.daysRemaining}`);
}
```

#### `loginWithLicense(licenseKey)`

使用 License Key 登录（获取 token 并激活）。

```typescript
const result = await licenseService.loginWithLicense('MDF-XXXX-XXXX-XXXX');

if (result.success && result.data) {
  console.log('Logged in successfully!');
  console.log(`  Key: ${result.data.key}`);
  console.log(`  Plan: ${result.data.plan}`);
  console.log(`  Status: ${result.data.isExpired ? 'Expired' : 'Active'}`);
}
```

#### `activateLicense(licenseKey)`

激活 License（为当前用户）。

```typescript
const result = await licenseService.activateLicense('MDF-XXXX-XXXX-XXXX');

if (result.success && result.data) {
  console.log('License activated!');
  console.log(`  Features:`, result.data.features);
}
```

#### `getLicenseInfo()`

获取当前 License 信息。

```typescript
const result = await licenseService.getLicenseInfo();

if (result.success && result.data) {
  const license = result.data;
  console.log(`Key: ${license.key}`);
  console.log(`Plan: ${license.plan}`);
  console.log(`Status: ${license.isExpired ? 'Expired' : 'Active'}`);
  console.log(`Expires: ${license.expires}`);
  console.log(`Days Remaining: ${license.daysRemaining}`);
  console.log(`Trial: ${license.isTrial ? 'Yes' : 'No'}`);
  
  // 功能列表
  console.log('Features:');
  console.log(`  Max Devices: ${license.features.maxDevices}`);
  console.log(`  Max IPs: ${license.features.maxIps}`);
  console.log(`  Sync: ${license.features.syncEnabled ? 'Enabled' : 'Disabled'}`);
  console.log(`  Publish: ${license.features.publishEnabled ? 'Enabled' : 'Disabled'}`);
  console.log(`  Max Sites: ${license.features.maxSites}`);
  console.log(`  Max Storage: ${license.features.maxStorage} MB`);
} else if (result.success && !result.data) {
  console.log('No active license');
}
```

#### `getLicenseUsage()`

获取 License 使用情况（设备、IP、磁盘）。

```typescript
const result = await licenseService.getLicenseUsage();

if (result.success && result.data) {
  const usage = result.data;
  
  // 设备使用情况
  console.log(`Devices: ${usage.devices.count}/${usage.devices.max}`);
  usage.devices.list.forEach(device => {
    console.log(`  - ${device.name} (${device.type})`);
    console.log(`    Status: ${device.status}`);
    console.log(`    Last seen: ${new Date(device.lastSeenAt).toLocaleDateString()}`);
  });
  
  // IP 使用情况
  console.log(`IPs: ${usage.ips.count}/${usage.ips.max}`);
  usage.ips.list.forEach(ip => {
    console.log(`  - ${ip.ip}`);
    console.log(`    Location: ${ip.city}, ${ip.region}, ${ip.country}`);
    console.log(`    Last seen: ${new Date(ip.lastSeenAt).toLocaleDateString()}`);
  });
  
  // 磁盘使用情况
  console.log('Disk Usage:');
  console.log(`  Sync: ${usage.disk.syncUsage} ${usage.disk.unit}`);
  console.log(`  Publish: ${usage.disk.publishUsage} ${usage.disk.unit}`);
  console.log(`  Total: ${usage.disk.totalUsage} ${usage.disk.unit}`);
  console.log(`  Max: ${usage.disk.maxStorage} MB`);
}
```

#### `resetUsage(force)`

重置 License 使用数据（清理 sync 和 publish 数据）。

```typescript
// 需要 force 参数确认
const result = await licenseService.resetUsage(true);

if (result.success) {
  console.log('Usage data reset successfully!');
}
```

⚠️ **警告**：此操作会删除所有 sync 和 publish 数据，不可恢复！

#### `hasActiveLicense()`

检查是否有活跃的 License。

```typescript
const hasLicense = await licenseService.hasActiveLicense();

if (hasLicense) {
  console.log('Active license found!');
} else {
  console.log('No active license or license expired');
}
```

### 完整示例

```typescript
import { requestUrl } from 'obsidian';
import { 
  createObsidianLicenseService,
  type IdentityHttpClient,
} from '@mdfriday/foundry';

// 实现 IdentityHttpClient
class ObsidianIdentityHttpClient implements IdentityHttpClient {
  constructor(private requestUrl: typeof requestUrl) {}
  
  async postJSON(url: string, data: any, headers?: Record<string, string>) {
    const response = await this.requestUrl({
      url,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(data),
    });
    return {
      status: response.status,
      ok: response.status >= 200 && response.status < 300,
      data: response.json,
      async text() { return response.text; },
      async json() { return response.json; },
    };
  }
  
  async get(url: string, headers?: Record<string, string>) {
    const response = await this.requestUrl({
      url,
      method: 'GET',
      headers,
    });
    return {
      status: response.status,
      ok: response.status >= 200 && response.status < 300,
      data: response.json,
      async text() { return response.text; },
      async json() { return response.json; },
    };
  }
}

async function manageLicense(vaultPath: string) {
  const httpClient = new ObsidianIdentityHttpClient(requestUrl);
  const licenseService = await createObsidianLicenseService(vaultPath, httpClient);
  
  // 1. 检查是否有 License
  const hasLicense = await licenseService.hasActiveLicense();
  
  if (!hasLicense) {
    // 2. 请求试用
    const trialResult = await licenseService.requestTrial('user@example.com');
    
    if (trialResult.success) {
      console.log('Trial activated!');
    } else {
      console.error('Trial failed:', trialResult.error);
      return;
    }
  }
  
  // 3. 获取 License 信息
  const infoResult = await licenseService.getLicenseInfo();
  
  if (infoResult.success && infoResult.data) {
    const license = infoResult.data;
    
    // 显示 License 信息
    console.log(`Plan: ${license.plan}`);
    console.log(`Expires in ${license.daysRemaining} days`);
    
    // 检查是否快过期
    if (license.daysRemaining < 7 && !license.isExpired) {
      console.warn('License expiring soon!');
    }
    
    // 检查功能限制
    if (license.features.publishEnabled) {
      console.log(`Can create up to ${license.features.maxSites} sites`);
    }
  }
  
  // 4. 监控使用情况
  const usageResult = await licenseService.getLicenseUsage();
  
  if (usageResult.success && usageResult.data) {
    const usage = usageResult.data;
    
    // 检查是否接近限制
    const deviceUsagePercent = (usage.devices.count / usage.devices.max) * 100;
    if (deviceUsagePercent > 80) {
      console.warn(`Device usage at ${deviceUsagePercent.toFixed(0)}%`);
    }
    
    const ipUsagePercent = (usage.ips.count / usage.ips.max) * 100;
    if (ipUsagePercent > 80) {
      console.warn(`IP usage at ${ipUsagePercent.toFixed(0)}%`);
    }
  }
}
```

## 8. Auth 服务

管理认证状态和服务器配置。

### 创建服务

```typescript
const httpClient = new ObsidianIdentityHttpClient(requestUrl);
const authService = await createObsidianAuthService(vaultPath, httpClient);
```

### API

#### `getStatus()`

获取当前认证状态。

```typescript
const result = await authService.getStatus();

if (result.success && result.data) {
  const status = result.data;
  
  if (status.isAuthenticated) {
    console.log(`Logged in as: ${status.email}`);
    console.log(`Token: ${status.token?.substring(0, 20)}...`);
    console.log(`Server: ${status.serverUrl}`);
  } else {
    console.log('Not authenticated');
  }
}
```

**返回数据：**
- `isAuthenticated`: 是否已认证
- `email`: 用户邮箱（如果已认证）
- `serverUrl`: 服务器 URL
- `token`: 认证 Token（如果已认证）

#### `getConfig()`

获取服务器配置（API URL 和 Website URL）。

```typescript
const result = await authService.getConfig();

if (result.success && result.data) {
  console.log(`API URL: ${result.data.apiUrl}`);
  console.log(`Website URL: ${result.data.websiteUrl || 'Not set'}`);
}
```

**返回数据：**
- `apiUrl`: API 服务器 URL
- `websiteUrl`: 网站 URL（可选）

#### `updateConfig(config)`

更新服务器配置（用于自建服务）。

```typescript
const result = await authService.updateConfig({
  apiUrl: 'https://api.example.com',
  websiteUrl: 'https://example.com'
});

if (result.success && result.data) {
  console.log('Server configuration updated');
  console.log(`New API URL: ${result.data.apiUrl}`);
  console.log(`New Website URL: ${result.data.websiteUrl}`);
}
```

**参数：**
- `config.apiUrl`: 新的 API URL
- `config.websiteUrl`: 新的 Website URL（可选）

### 完整示例

```typescript
import { requestUrl } from 'obsidian';
import { 
  createObsidianAuthService,
  type IdentityHttpClient,
} from '@mdfriday/foundry';

// 实现 IdentityHttpClient（与 License 服务相同）
class ObsidianIdentityHttpClient implements IdentityHttpClient {
  constructor(private requestUrl: typeof requestUrl) {}
  
  async postJSON(url: string, data: any, headers?: Record<string, string>) {
    const response = await this.requestUrl({
      url,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(data),
    });
    return {
      status: response.status,
      ok: response.status >= 200 && response.status < 300,
      data: response.json,
      async text() { return response.text; },
      async json() { return response.json; },
    };
  }
  
  async get(url: string, headers?: Record<string, string>) {
    const response = await this.requestUrl({
      url,
      method: 'GET',
      headers,
    });
    return {
      status: response.status,
      ok: response.status >= 200 && response.status < 300,
      data: response.json,
      async text() { return response.text; },
      async json() { return response.json; },
    };
  }
}

async function checkAuth(vaultPath: string) {
  const httpClient = new ObsidianIdentityHttpClient(requestUrl);
  const authService = await createObsidianAuthService(vaultPath, httpClient);
  
  // 1. 检查认证状态
  const statusResult = await authService.getStatus();
  
  if (!statusResult.success) {
    console.error('Failed to get auth status:', statusResult.error);
    return;
  }
  
  if (!statusResult.data?.isAuthenticated) {
    console.log('Not logged in. Please login first.');
    return;
  }
  
  // 2. 显示用户信息
  const status = statusResult.data;
  console.log(`Welcome back, ${status.email}!`);
  
  // 3. 获取服务器配置
  const configResult = await authService.getConfig();
  
  if (configResult.success && configResult.data) {
    console.log(`Connected to: ${configResult.data.apiUrl}`);
  }
  
  // 4. 如果需要，更新服务器配置（自建服务）
  if (needCustomServer) {
    const updateResult = await authService.updateConfig({
      apiUrl: 'https://your-server.com/api',
      websiteUrl: 'https://your-server.com'
    });
    
    if (updateResult.success) {
      console.log('Server configuration updated to custom server');
    }
  }
}
```

### 注意事项

⚠️ **重要**：Auth 服务需要 workspace 已经初始化。如果 workspace 不存在，会返回错误。

```typescript
const result = await authService.getStatus();

if (!result.success && result.error?.includes('No workspace found')) {
  // 需要先初始化 workspace
  const workspaceService = createObsidianWorkspaceService();
  await workspaceService.initWorkspace(vaultPath);
}
```

## 9. Domain 服务

管理域名配置，包括子域名、自定义域名和 HTTPS 证书。

### 创建服务

```typescript
const httpClient = new ObsidianIdentityHttpClient(requestUrl);
const domainService = await createObsidianDomainService(vaultPath, httpClient);
```

### API

#### `getDomainInfo()`

获取域名信息（子域名、自定义域名、文件夹等）。

```typescript
const result = await domainService.getDomainInfo();

if (result.success && result.data) {
  const info = result.data;
  console.log(`Subdomain: ${info.subdomain}`);
  console.log(`Full Domain: ${info.fullDomain}`);
  
  if (info.customDomain) {
    console.log(`Custom Domain: ${info.customDomain}`);
  }
  
  console.log(`Folder: ${info.folder}`);
  console.log(`Created: ${info.createdAt}`);
}
```

**返回数据：**
- `subdomain`: 子域名
- `fullDomain`: 完整域名
- `customDomain`: 自定义域名（可选）
- `folder`: 文件夹路径
- `createdAt`: 创建时间

#### `checkSubdomain(subdomain)`

检查子域名是否可用。

```typescript
const result = await domainService.checkSubdomain('myblog');

if (result.success && result.data) {
  if (result.data.available) {
    console.log('Subdomain is available!');
  } else {
    console.log('Subdomain is taken');
    console.log(`Reason: ${result.data.message}`);
  }
}
```

**参数：**
- `subdomain`: 要检查的子域名

**返回数据：**
- `available`: 是否可用
- `message`: 说明信息（可选）

#### `updateSubdomain(newSubdomain)`

更新子域名。

```typescript
const result = await domainService.updateSubdomain('newblog');

if (result.success && result.data) {
  console.log(`Old: ${result.data.oldSubdomain}`);
  console.log(`New: ${result.data.newSubdomain}`);
  console.log(`Full Domain: ${result.data.fullDomain}`);
}
```

**参数：**
- `newSubdomain`: 新的子域名

**返回数据：**
- `oldSubdomain`: 旧子域名
- `newSubdomain`: 新子域名
- `fullDomain`: 完整域名
- `message`: 说明信息

#### `checkCustomDomain(domain)`

检查自定义域名的 DNS 配置。

```typescript
const result = await domainService.checkCustomDomain('example.com');

if (result.success && result.data) {
  console.log(`DNS Valid: ${result.data.dnsValid}`);
  console.log(`Ready: ${result.data.ready}`);
  
  if (result.data.resolvedIps) {
    console.log(`Resolved IPs: ${result.data.resolvedIps.join(', ')}`);
  }
  
  console.log(`Message: ${result.data.message}`);
}
```

**参数：**
- `domain`: 自定义域名

**返回数据：**
- `ready`: 是否就绪
- `dnsValid`: DNS 是否有效
- `resolvedIps`: 解析的 IP 地址列表（可选）
- `message`: 说明信息

#### `addCustomDomain(domain)`

添加自定义域名。

```typescript
const result = await domainService.addCustomDomain('example.com');

if (result.success && result.data) {
  console.log(`Domain: ${result.data.domain}`);
  console.log(`Status: ${result.data.status}`);
  console.log(`Message: ${result.data.message}`);
}
```

**参数：**
- `domain`: 要添加的自定义域名

**返回数据：**
- `domain`: 域名
- `status`: 状态
- `message`: 说明信息

#### `checkHttpsStatus(domain)`

检查自定义域名的 HTTPS 证书状态。

```typescript
const result = await domainService.checkHttpsStatus('example.com');

if (result.success && result.data) {
  console.log(`TLS Ready: ${result.data.tlsReady}`);
  console.log(`DNS Valid: ${result.data.dnsValid}`);
  console.log(`Status: ${result.data.status}`);
  
  if (result.data.certificate) {
    const cert = result.data.certificate;
    console.log('Certificate Info:');
    console.log(`  Issuer: ${cert.issuer}`);
    console.log(`  Valid From: ${cert.validFrom}`);
    console.log(`  Valid To: ${cert.validTo}`);
  }
}
```

**参数：**
- `domain`: 自定义域名

**返回数据：**
- `tlsReady`: TLS 是否就绪
- `dnsValid`: DNS 是否有效
- `status`: 状态
- `message`: 说明信息
- `certificate`: 证书信息（可选）
  - `issuer`: 签发者
  - `validFrom`: 有效起始时间
  - `validTo`: 有效截止时间

### 完整示例

```typescript
import { requestUrl } from 'obsidian';
import { 
  createObsidianDomainService,
  type IdentityHttpClient,
} from '@mdfriday/foundry';

// 实现 IdentityHttpClient（与 License/Auth 服务相同）
class ObsidianIdentityHttpClient implements IdentityHttpClient {
  // ... 实现（参考 License 服务的完整示例）
}

async function setupCustomDomain(vaultPath: string) {
  const httpClient = new ObsidianIdentityHttpClient(requestUrl);
  const domainService = await createObsidianDomainService(vaultPath, httpClient);
  
  // 1. 获取当前域名信息
  const infoResult = await domainService.getDomainInfo();
  
  if (infoResult.success && infoResult.data) {
    console.log(`Current subdomain: ${infoResult.data.subdomain}`);
  }
  
  // 2. 检查新子域名是否可用
  const checkResult = await domainService.checkSubdomain('newblog');
  
  if (checkResult.success && checkResult.data?.available) {
    // 3. 更新子域名
    const updateResult = await domainService.updateSubdomain('newblog');
    
    if (updateResult.success) {
      console.log('Subdomain updated successfully!');
    }
  }
  
  // 4. 添加自定义域名
  const customDomain = 'blog.example.com';
  const addResult = await domainService.addCustomDomain(customDomain);
  
  if (addResult.success) {
    console.log('Custom domain added. Now check DNS...');
    
    // 5. 检查 DNS 配置
    let dnsReady = false;
    let attempts = 0;
    
    while (!dnsReady && attempts < 10) {
      await new Promise(resolve => setTimeout(resolve, 5000)); // 等待 5 秒
      
      const dnsResult = await domainService.checkCustomDomain(customDomain);
      
      if (dnsResult.success && dnsResult.data?.ready) {
        dnsReady = true;
        console.log('DNS is configured correctly!');
        
        // 6. 检查 HTTPS 证书
        const httpsResult = await domainService.checkHttpsStatus(customDomain);
        
        if (httpsResult.success && httpsResult.data?.tlsReady) {
          console.log('HTTPS certificate is ready!');
        } else {
          console.log('Waiting for HTTPS certificate...');
        }
      } else {
        console.log(`DNS not ready yet (attempt ${attempts + 1}/10)`);
      }
      
      attempts++;
    }
  }
}
```

### 注意事项

⚠️ **重要**：Domain 服务需要 workspace 已经初始化。如果 workspace 不存在，会返回错误。

⚠️ **DNS 传播时间**：DNS 更改可能需要几分钟到几小时才能传播完成。

⚠️ **HTTPS 证书**：HTTPS 证书的签发通常需要几分钟，需要等待 DNS 验证完成后才能签发。

## 更多资源

- [Workspace 接口详细文档](./obsidian-workspace-interface.md)
- [单文件项目功能说明](./single-file-project.md)
- [快速开始指南](./obsidian-quickstart.md)
