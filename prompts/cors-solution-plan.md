# CORS 问题分析与解决方案

## 问题确认

### 错误信息
```
Access to fetch at 'http://localhost:1234/v1/chat/completions' from origin 'app://obsidian.md' 
has been blocked by CORS policy: Response to preflight request doesn't pass access control check: 
No 'Access-Control-Allow-Origin' header is present on the requested resource.
```

### 根本原因

**是的，这个 fetch 请求是在 foundry 里发出的。**

具体位置：
- `foundry/internal/infrastructure/llm/lmstudio-provider.ts` (第 92-99 行)
- `foundry/internal/infrastructure/llm/openai-compatible-provider.ts` (第 142-147 行)

```typescript
// LMStudioProvider.ts
response = await fetch(url, {
	method: 'POST',
	headers: {
		'Content-Type': 'application/json',
	},
	body: JSON.stringify(requestBody),
	...(signal ? { signal } : {})
});
```

### CORS 问题的本质

1. **Obsidian 环境**: `app://obsidian.md` (Electron)
2. **LM Studio**: `http://localhost:1234` (本地 HTTP 服务)
3. **浏览器安全策略**: Electron 中的 fetch 仍然受 CORS 限制
4. **LM Studio 默认不支持 CORS**: 本地服务通常不设置 CORS 头

### 为什么会失败

- Obsidian (Electron) 使用的 `fetch` API 遵循浏览器的 CORS 策略
- LM Studio 的 HTTP 服务器默认不返回 `Access-Control-Allow-Origin` 头
- 预检请求 (OPTIONS) 被拒绝，导致实际请求无法发送

## 解决方案

### 方案 1: HTTP Adapter 模式（推荐）✅

**设计思路**：
- Foundry 定义 HTTP Client 接口
- Obsidian Plugin 提供 Electron-safe 的实现
- 使用 Electron 的 `net` 模块（不受 CORS 限制）

### 方案 2: 修改 LM Studio 配置（临时方案）

配置 LM Studio 支持 CORS，但这不是长期解决方案，因为：
- 用户体验差（需要用户手动配置）
- 不是所有 LLM 服务都支持 CORS 配置
- 无法覆盖所有使用场景

## 推荐方案详细设计

### 架构概览

```
┌─────────────────────────────────────────────────┐
│         Obsidian Friday Plugin                  │
│                                                 │
│  ┌──────────────────────────────────────────┐  │
│  │  ObsidianHttpClient (Electron net)       │  │
│  │  - 使用 Electron net 模块                 │  │
│  │  - 不受 CORS 限制                         │  │
│  │  - 实现 IHttpClient 接口                  │  │
│  └──────────────────────────────────────────┘  │
│                      ↓ 传入                     │
│  ┌──────────────────────────────────────────┐  │
│  │  Foundry Wiki Service                    │  │
│  │  - 接收 IHttpClient 实例                 │  │
│  │  - 使用注入的 HttpClient 发请求           │  │
│  └──────────────────────────────────────────┘  │
└─────────────────────────────────────────────────┘
```

### 1. Foundry 端修改

#### 1.1 定义 IHttpClient 接口

**新文件**: `foundry/internal/infrastructure/http/http-client.interface.ts`

```typescript
/**
 * HTTP Client 接口
 * 
 * 由宿主环境（Obsidian/CLI/Web）提供具体实现
 */

export interface HttpRequest {
  url: string;
  method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  headers?: Record<string, string>;
  body?: string;
  signal?: AbortSignal;
}

export interface HttpResponse {
  status: number;
  statusText: string;
  headers: Record<string, string>;
  body: ReadableStream<Uint8Array> | null;
  text(): Promise<string>;
  json(): Promise<any>;
}

export interface IHttpClient {
  /**
   * 发送 HTTP 请求
   */
  request(request: HttpRequest): Promise<HttpResponse>;
  
  /**
   * 流式请求（用于 SSE）
   */
  requestStream(request: HttpRequest): Promise<HttpResponse>;
}
```

#### 1.2 修改 LLM Provider 接受 HttpClient

**修改**: `foundry/internal/infrastructure/llm/lmstudio-provider.ts`

```typescript
export class LMStudioProvider implements ILLMProvider, IEmbeddingProvider {
  readonly name = 'LMStudio';
  private embeddingModel: string;
  private httpClient: IHttpClient; // ← 新增

  constructor(
    private baseURL: string = 'http://localhost:1234/v1',
    embeddingModel: string = 'text-embedding-nomic-embed-text-v2-moe',
    httpClient?: IHttpClient // ← 可选注入
  ) {
    this.embeddingModel = embeddingModel;
    // 如果没有提供 httpClient，使用浏览器原生 fetch（向后兼容）
    this.httpClient = httpClient || createDefaultHttpClient();
  }

  async *complete(
    prompt: string,
    config: LLMConfig,
    signal?: AbortSignal
  ): AsyncIterable<LLMStreamChunk> {
    const url = `${this.baseURL}/chat/completions`;

    const messages: OpenAICompatibleMessage[] = [/* ... */];
    const requestBody: OpenAICompatibleRequest = {/* ... */};

    let response: HttpResponse;
    try {
      // ✅ 使用注入的 httpClient
      response = await this.httpClient.requestStream({
        url,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestBody),
        signal
      });
    } catch (error: any) {
      if (error.name === 'AbortError') {
        throw new LLMAbortError(this.name);
      }
      throw new LLMConnectError(this.name, error);
    }

    if (response.status !== 200) {
      throw new LLMHttpError(this.name, response.status, response.statusText);
    }

    if (!response.body) {
      throw new LLMConnectError(this.name, new Error('No response body'));
    }

    // 流式处理逻辑保持不变
    const reader = response.body.getReader();
    // ...
  }
  
  // completeSync 和 embed 方法类似修改
}
```

#### 1.3 提供默认 Fetch 实现（向后兼容）

**新文件**: `foundry/internal/infrastructure/http/fetch-http-client.ts`

```typescript
import { IHttpClient, HttpRequest, HttpResponse } from './http-client.interface';

/**
 * 基于浏览器原生 fetch 的 HttpClient 实现
 * 用于 CLI、Node.js 环境，或支持 CORS 的场景
 */
export class FetchHttpClient implements IHttpClient {
  async request(request: HttpRequest): Promise<HttpResponse> {
    const response = await fetch(request.url, {
      method: request.method,
      headers: request.headers,
      body: request.body,
      signal: request.signal
    });

    return {
      status: response.status,
      statusText: response.statusText,
      headers: Object.fromEntries(response.headers.entries()),
      body: response.body,
      text: () => response.text(),
      json: () => response.json()
    };
  }

  async requestStream(request: HttpRequest): Promise<HttpResponse> {
    return this.request(request);
  }
}

export function createDefaultHttpClient(): IHttpClient {
  return new FetchHttpClient();
}
```

#### 1.4 修改 WikiService 接受 HttpClient

**修改**: `foundry/internal/application/wiki-service.ts`

```typescript
export class WikiService {
  private llmProvider: ILLMProvider;
  
  constructor(
    // ... 其他参数
    httpClient?: IHttpClient // ← 新增可选参数
  ) {
    // 创建 LLM Provider 时传入 httpClient
    this.llmProvider = new LMStudioProvider(
      llmConfig.baseUrl,
      embeddingModel,
      httpClient // ← 传递
    );
  }
}
```

#### 1.5 修改 ObsidianWikiService 工厂函数

**修改**: `foundry/internal/interfaces/obsidian/desktop/index.ts`

```typescript
import { IHttpClient } from '../../../infrastructure/http/http-client.interface';

export function createObsidianWikiService(
  httpClient?: IHttpClient // ← 新增可选参数
): ObsidianWikiService {
  const adapter = new DesktopWikiAdapter(httpClient); // 传递给 adapter
  return new ObsidianWikiService(adapter);
}
```

### 2. Obsidian Plugin 端实现

#### 2.1 实现 ObsidianHttpClient（使用 Electron net）

**新文件**: `obsidian-friday-plugin/src/http/ObsidianHttpClient.ts`

```typescript
import { requestUrl } from 'obsidian';
import type { IHttpClient, HttpRequest, HttpResponse } from '@mdfriday/foundry';

/**
 * Obsidian HTTP Client 实现
 * 
 * 使用 Obsidian 的 requestUrl API（基于 Electron net 模块）
 * 不受 CORS 限制
 */
export class ObsidianHttpClient implements IHttpClient {
  async request(request: HttpRequest): Promise<HttpResponse> {
    try {
      const response = await requestUrl({
        url: request.url,
        method: request.method,
        headers: request.headers,
        body: request.body,
        throw: false // 不自动抛出错误
      });

      return {
        status: response.status,
        statusText: '',
        headers: response.headers,
        body: null, // requestUrl 不提供 stream
        text: async () => response.text,
        json: async () => response.json
      };
    } catch (error: any) {
      throw new Error(`HTTP request failed: ${error.message}`);
    }
  }

  async requestStream(request: HttpRequest): Promise<HttpResponse> {
    // Obsidian requestUrl 不支持流式响应
    // 需要使用 Electron net 模块或 Node.js http
    return this.requestStreamWithElectron(request);
  }

  private async requestStreamWithElectron(request: HttpRequest): Promise<HttpResponse> {
    // 使用 Node.js http 模块（Electron 环境可用）
    const { request: httpRequest } = await import('http');
    const { URL } = await import('url');

    return new Promise((resolve, reject) => {
      const url = new URL(request.url);
      
      const options = {
        hostname: url.hostname,
        port: url.port || 80,
        path: url.pathname + url.search,
        method: request.method,
        headers: request.headers || {}
      };

      const req = httpRequest(options, (res) => {
        // 将 Node.js IncomingMessage 转换为 ReadableStream
        const stream = new ReadableStream({
          start(controller) {
            res.on('data', (chunk) => {
              controller.enqueue(new Uint8Array(chunk));
            });
            res.on('end', () => {
              controller.close();
            });
            res.on('error', (err) => {
              controller.error(err);
            });
          },
          cancel() {
            req.destroy();
          }
        });

        resolve({
          status: res.statusCode || 200,
          statusText: res.statusMessage || '',
          headers: res.headers as Record<string, string>,
          body: stream,
          text: async () => {
            let text = '';
            for await (const chunk of res) {
              text += chunk;
            }
            return text;
          },
          json: async () => {
            const text = await this.text();
            return JSON.parse(text);
          }
        });
      });

      if (request.body) {
        req.write(request.body);
      }

      req.on('error', reject);
      
      if (request.signal) {
        request.signal.addEventListener('abort', () => {
          req.destroy();
          reject(new Error('Request aborted'));
        });
      }

      req.end();
    });
  }
}
```

#### 2.2 修改 WikiService 创建（传入 HttpClient）

**修改**: `obsidian-friday-plugin/src/services/wiki/WikiService.ts`

```typescript
import { createObsidianWikiService } from '@mdfriday/foundry';
import { ObsidianHttpClient } from '../../http/ObsidianHttpClient';
import type FridayPlugin from '../../main';
import type { IngestResult, SaveResult, ConversationHistory } from './types';

export class WikiService {
	private wikiService;
	private workspacePath: string;
	
	constructor(private plugin: FridayPlugin) {
		this.workspacePath = plugin.absWorkspacePath;
		
		// ✅ 创建 Obsidian-safe HttpClient 并传入
		const httpClient = new ObsidianHttpClient();
		this.wikiService = createObsidianWikiService(httpClient);
	}
	
	// ... 其他方法保持不变
}
```

### 3. 导出类型定义

**修改**: `foundry/index.ts`

```typescript
// HTTP Client
export type {
  IHttpClient,
  HttpRequest,
  HttpResponse
} from './internal/infrastructure/http/http-client.interface';

export { 
  FetchHttpClient,
  createDefaultHttpClient 
} from './internal/infrastructure/http/fetch-http-client';

// Wiki Service (更新签名)
export { createObsidianWikiService } from './internal/interfaces/obsidian/desktop';
```

## 方案优势

### ✅ 解决 CORS 问题
- Electron `net` 模块不受浏览器 CORS 限制
- 可以访问任何本地或远程 HTTP 服务

### ✅ 架构清晰
- 依赖倒置：Foundry 依赖抽象接口，不依赖具体实现
- Obsidian Plugin 提供具体实现
- 符合 DDD 和 Clean Architecture 原则

### ✅ 灵活扩展
- 不同环境可以提供不同实现：
  - Obsidian Desktop: Electron `net`
  - Obsidian Mobile: 使用 Capacitor HTTP
  - CLI: Node.js `http`/`https`
  - Web: 浏览器 `fetch`

### ✅ 向后兼容
- 如果不提供 `httpClient`，使用默认的 `fetch` 实现
- 不影响现有 CLI 和测试环境

## 实现步骤

### Phase 1: Foundry 端（约 3 个文件）
1. ✅ 创建 `IHttpClient` 接口
2. ✅ 创建 `FetchHttpClient` 默认实现
3. ✅ 修改 `LMStudioProvider` 接受 `httpClient`
4. ✅ 修改 `createObsidianWikiService` 接受 `httpClient`
5. ✅ 导出类型定义

### Phase 2: Obsidian Plugin 端（约 2 个文件）
1. ✅ 实现 `ObsidianHttpClient`（使用 Electron `net`）
2. ✅ 修改 `WikiService` 构造函数传入 `httpClient`

### Phase 3: 测试验证
1. ✅ 测试 `/wiki @What` ingest 流程
2. ✅ 验证 LLM 调用不再有 CORS 错误
3. ✅ 验证流式响应正常工作

## 关键代码变更位置

### Foundry
```
foundry/
├── internal/
│   └── infrastructure/
│       ├── http/
│       │   ├── http-client.interface.ts        # ← 新增
│       │   └── fetch-http-client.ts            # ← 新增
│       └── llm/
│           ├── lmstudio-provider.ts            # ← 修改（接受 httpClient）
│           └── openai-compatible-provider.ts   # ← 修改（接受 httpClient）
├── internal/interfaces/obsidian/desktop/
│   └── index.ts                                # ← 修改（createObsidianWikiService 签名）
└── index.ts                                    # ← 修改（导出类型）
```

### Obsidian Plugin
```
obsidian-friday-plugin/
└── src/
    ├── http/
    │   └── ObsidianHttpClient.ts               # ← 新增
    └── services/wiki/
        └── WikiService.ts                      # ← 修改（传入 httpClient）
```

## 总结

**核心思路**：
- Foundry 定义 `IHttpClient` 接口（抽象）
- Obsidian Plugin 提供 `ObsidianHttpClient` 实现（具体）
- 使用 Electron `net` 模块绕过 CORS 限制
- 符合依赖倒置原则，架构清晰可扩展

**关键优势**：
- ✅ 完全解决 CORS 问题
- ✅ 架构清晰，职责分离
- ✅ 向后兼容，不影响其他环境
- ✅ 易于测试和维护

**实现难度**: 中等
**预计工作量**: 约 5 个文件修改 + 2 个新文件
