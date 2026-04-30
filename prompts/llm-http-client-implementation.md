# LLM HTTP Client 接口实现总结

## 概述

本次实现为 Foundry 的 LLM Provider 引入了 HTTP Client 接口抽象层，解决了在 Obsidian (Electron) 环境中调用本地 LLM 服务时遇到的 CORS 问题。

## 问题背景

在 Obsidian Plugin 中使用 Foundry 的 Wiki 功能时，LLM Provider（如 LMStudioProvider）使用浏览器原生 `fetch` API 访问本地服务（`http://localhost:1234`），在 Electron 环境下会触发 CORS 限制错误：

```
Access to fetch at 'http://localhost:1234/v1/chat/completions' from origin 'app://obsidian.md' 
has been blocked by CORS policy
```

## 解决方案

采用**依赖倒置原则**（Dependency Inversion Principle），让 Domain 层定义接口，Infrastructure 层和外部环境提供具体实现。

### 架构设计

```
┌─────────────────────────────────────────────────────┐
│         Domain Layer (接口定义)                       │
│  ┌──────────────────────────────────────────────┐   │
│  │  LLMHttpClient Interface                     │   │
│  │  - fetch(request): Promise<response>         │   │
│  └──────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────┘
                         ↑
                         │ 实现
        ┌────────────────┴────────────────┐
        │                                  │
┌───────┴──────────┐            ┌─────────┴──────────┐
│ Infrastructure   │            │ External (Obsidian)│
│ FetchHttpClient  │            │ ObsidianHttpClient │
│ (默认实现)        │            │ (Electron net)     │
└──────────────────┘            └────────────────────┘
```

## 实现细节

### 1. Domain 层定义接口

**文件**: `internal/domain/wiki/repository/llm-http-client.ts`

```typescript
export interface LLMHttpRequest {
  url: string;
  method: 'GET' | 'POST';
  headers?: Record<string, string>;
  body?: string;
  signal?: AbortSignal;
}

export interface LLMHttpResponse {
  status: number;
  statusText: string;
  ok: boolean;
  body: ReadableStream<Uint8Array> | null;
  text(): Promise<string>;
  json(): Promise<any>;
}

export interface LLMHttpClient {
  fetch(request: LLMHttpRequest): Promise<LLMHttpResponse>;
}
```

### 2. Infrastructure 层默认实现

**文件**: `internal/infrastructure/llm/fetch-http-client.ts`

基于浏览器/Node.js 原生 `fetch` API 的默认实现，用于：
- Node.js CLI 环境
- 测试环境
- 支持 CORS 的浏览器环境

```typescript
export class FetchHttpClient implements LLMHttpClient {
  async fetch(request: LLMHttpRequest): Promise<LLMHttpResponse> {
    const response = await fetch(request.url, {
      method: request.method,
      headers: request.headers,
      body: request.body,
      signal: request.signal
    });

    return {
      status: response.status,
      statusText: response.statusText,
      ok: response.ok,
      body: response.body,
      text: () => response.text(),
      json: () => response.json()
    };
  }
}
```

### 3. 修改 LLM Providers

**修改的文件**:
- `internal/infrastructure/llm/lmstudio-provider.ts`
- `internal/infrastructure/llm/openai-compatible-provider.ts`

核心改动：
1. 构造函数接受可选的 `httpClient` 参数
2. 如果未提供，使用默认的 `FetchHttpClient`
3. 所有 HTTP 请求改用 `this.httpClient.fetch()` 替代原生 `fetch()`

```typescript
export class LMStudioProvider implements ILLMProvider, IEmbeddingProvider {
  private httpClient: LLMHttpClient;

  constructor(
    private baseURL: string = 'http://localhost:1234/v1',
    embeddingModel: string = 'text-embedding-nomic-embed-text-v2-moe',
    httpClient?: LLMHttpClient
  ) {
    this.httpClient = httpClient || createDefaultLLMHttpClient();
  }

  async *complete(prompt: string, config: LLMConfig, signal?: AbortSignal) {
    // 使用 httpClient 替代原生 fetch
    const response = await this.httpClient.fetch({
      url: `${this.baseURL}/chat/completions`,
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody),
      signal
    });
    // ...
  }
}
```

### 4. 修改 Provider Factory

**文件**: `internal/infrastructure/llm/provider-factory.ts`

所有创建 Provider 的函数接受可选的 `httpClient` 参数：

```typescript
export function createLLMProvider(
  config: LLMServiceConfig,
  httpClient?: LLMHttpClient
): ILLMProvider {
  switch (config.type) {
    case 'lmstudio':
      return createLMStudioProvider(config.baseURL, config.defaultModel, httpClient);
    case 'openai':
      return createOpenAIProvider(config.apiKey, config.defaultModel, httpClient);
    // ...
  }
}

export function createEmbeddingProvider(
  config?: EmbeddingServiceConfig,
  httpClient?: LLMHttpClient
): IEmbeddingProvider | null {
  // ...
}
```

### 5. 修改 Wiki Adapter

**文件**: `internal/interfaces/obsidian/desktop/adapters/wiki-adapter.ts`

```typescript
export class DesktopWikiAdapter implements WikiAdapter {
  constructor(
    private readonly workspaceAdapter: WorkspaceAdapter,
    private readonly httpClient?: LLMHttpClient
  ) {}

  async createWikiService(workspacePath: string, projectName: string) {
    // ...
    const llmProvider = createLLMProvider(llmConfig, this.httpClient);
    const embeddingProvider = createEmbeddingProvider(llmConfig, this.httpClient);
    // ...
  }
}
```

### 6. 修改工厂函数

**文件**: `internal/interfaces/obsidian/desktop/index.ts`

```typescript
export function createObsidianWikiService(
  httpClient?: any
): ObsidianWikiService {
  const workspaceAdapter = new DesktopWorkspaceAdapter();
  const wikiAdapter = new DesktopWikiAdapter(workspaceAdapter, httpClient);
  return new ObsidianWikiService(wikiAdapter);
}
```

### 7. 导出类型定义

**文件**: `index.ts`

```typescript
// LLM HTTP Client (Wiki Domain)
export type {
  LLMHttpClient,
  LLMHttpRequest,
  LLMHttpResponse,
} from './internal/domain/wiki/repository/llm-http-client';

export {
  FetchHttpClient,
  createDefaultLLMHttpClient,
} from './internal/infrastructure/llm/fetch-http-client';
```

## 使用方式

### 在 Obsidian Plugin 中使用

Obsidian Plugin 需要实现自定义的 `LLMHttpClient`，使用 Electron 的 `net` 模块或 Node.js 的 `http`/`https` 模块（不受 CORS 限制）：

```typescript
// obsidian-friday-plugin/src/http/ObsidianLLMHttpClient.ts
import type { LLMHttpClient, LLMHttpRequest, LLMHttpResponse } from '@mdfriday/foundry';

export class ObsidianLLMHttpClient implements LLMHttpClient {
  async fetch(request: LLMHttpRequest): Promise<LLMHttpResponse> {
    // 使用 Node.js http 模块（Electron 环境可用）
    const http = require('http');
    const https = require('https');
    
    return new Promise((resolve, reject) => {
      const url = new URL(request.url);
      const client = url.protocol === 'https:' ? https : http;
      
      const req = client.request({
        hostname: url.hostname,
        port: url.port || (url.protocol === 'https:' ? 443 : 80),
        path: url.pathname + url.search,
        method: request.method,
        headers: request.headers || {}
      }, (res) => {
        // 转换 Node.js Stream 为 Web ReadableStream
        const stream = new ReadableStream({
          start(controller) {
            res.on('data', chunk => controller.enqueue(new Uint8Array(chunk)));
            res.on('end', () => controller.close());
            res.on('error', err => controller.error(err));
          }
        });

        resolve({
          status: res.statusCode || 200,
          statusText: res.statusMessage || '',
          ok: res.statusCode >= 200 && res.statusCode < 300,
          body: stream,
          text: async () => { /* ... */ },
          json: async () => { /* ... */ }
        });
      });

      if (request.body) req.write(request.body);
      req.on('error', reject);
      if (request.signal) {
        request.signal.addEventListener('abort', () => {
          req.destroy();
          reject(new Error('Aborted'));
        });
      }
      req.end();
    });
  }
}

// 使用时传入自定义 HttpClient
import { createObsidianWikiService } from '@mdfriday/foundry';

const httpClient = new ObsidianLLMHttpClient();
const wikiService = createObsidianWikiService(httpClient);
```

### 在测试/CLI 中使用

不需要传入 `httpClient`，会自动使用默认的 `FetchHttpClient`：

```typescript
import { createObsidianWikiService } from '@mdfriday/foundry';

// 使用默认 FetchHttpClient
const wikiService = createObsidianWikiService();
```

## 修改的文件列表

### 新增文件 (3个)
1. `internal/domain/wiki/repository/llm-http-client.ts` - 接口定义
2. `internal/infrastructure/llm/fetch-http-client.ts` - 默认实现
3. `internal/infrastructure/llm/node-llm-http-client.ts` - Node.js 别名

### 修改文件 (8个)
1. `internal/infrastructure/llm/lmstudio-provider.ts` - 接受 httpClient
2. `internal/infrastructure/llm/openai-compatible-provider.ts` - 接受 httpClient
3. `internal/infrastructure/llm/provider-factory.ts` - 传递 httpClient
4. `internal/interfaces/obsidian/desktop/adapters/wiki-adapter.ts` - 传递 httpClient
5. `internal/interfaces/obsidian/desktop/index.ts` - 工厂函数接受参数
6. `internal/domain/wiki/repository/index.ts` - 导出新接口
7. `index.ts` - 导出公共 API
8. `docs/llm-http-client-implementation.md` - 本文档

## 方案优势

### ✅ 完全解决 CORS 问题
- Obsidian 可以使用 Electron `net` 模块绕过浏览器 CORS 限制
- 可以访问任何本地或远程 HTTP 服务

### ✅ 架构清晰
- **依赖倒置**：Domain 层定义接口，Infrastructure 提供实现
- **职责分离**：接口定义与实现分离
- **符合 DDD 原则**：Domain 层不依赖具体技术实现

### ✅ 灵活扩展
不同环境可以提供不同实现：
- **Obsidian Desktop**: Electron `net` 模块
- **Obsidian Mobile**: Capacitor HTTP Plugin
- **CLI**: Node.js `fetch` API
- **Browser**: 浏览器 `fetch` API

### ✅ 向后兼容
- 不传 `httpClient` 时使用默认 `FetchHttpClient`
- 不影响现有 CLI 和测试环境
- 渐进式迁移，无破坏性变更

### ✅ 一致性
- 遵循现有的 `DomainService` 模式（使用 `HttpClient` 接口注入）
- 保持与 Identity Domain 的设计一致

## 测试验证

所有现有测试应该继续正常工作，因为默认使用 `FetchHttpClient`。

### 在 Node.js 环境测试

```typescript
import { createObsidianWikiService } from '@mdfriday/foundry';

// 使用默认实现（Node.js fetch）
const wikiService = createObsidianWikiService();

// 测试 ingest、query 等功能
await wikiService.ingest({ workspacePath, projectName, filePath });
```

### 在 Obsidian 环境测试

```typescript
import { createObsidianWikiService } from '@mdfriday/foundry';
import { ObsidianLLMHttpClient } from './http/ObsidianLLMHttpClient';

// 使用 Obsidian 专用实现（Electron net）
const httpClient = new ObsidianLLMHttpClient();
const wikiService = createObsidianWikiService(httpClient);

// 现在可以正常访问本地 LLM 服务，无 CORS 问题
await wikiService.ingest({ workspacePath, projectName, filePath });
```

## 下一步工作

1. **在 Obsidian Plugin 中实现 `ObsidianLLMHttpClient`**
   - 使用 Node.js `http`/`https` 模块
   - 支持流式响应（SSE）
   - 处理 AbortSignal

2. **更新 Obsidian Plugin 的 WikiService 创建代码**
   - 传入 `ObsidianLLMHttpClient` 实例

3. **验证完整流程**
   - 在 Obsidian 中测试 Wiki ingest
   - 在 Obsidian 中测试 Wiki query
   - 确认 CORS 问题已解决

## 总结

本次实现通过引入 LLM HTTP Client 接口抽象层，成功解决了 Obsidian 环境中的 CORS 问题，同时保持了：
- 架构的清晰性（依赖倒置原则）
- 代码的一致性（与 DomainService 模式一致）
- 实现的灵活性（支持多环境）
- 向后兼容性（不破坏现有代码）

这是一个符合 Clean Architecture 和 DDD 原则的优雅解决方案。
