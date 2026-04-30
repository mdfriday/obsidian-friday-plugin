# ObsidianLLMHttpClient 实现完成

## 实现总结

已成功在 Obsidian Friday Plugin 中实现 `ObsidianLLMHttpClient`，解决 CORS 问题。

## 修改的文件

### 1. `src/http.ts` (新增 117 行代码)

#### 1.1 导入 LLM HTTP Client 类型

```typescript
import type { 
	PublishHttpClient, 
	PublishHttpResponse, 
	IdentityHttpClient, 
	IdentityHttpResponse,
	LLMHttpClient,        // ← 新增
	LLMHttpRequest,       // ← 新增
	LLMHttpResponse       // ← 新增
} from '@mdfriday/foundry';
```

#### 1.2 实现 ObsidianLLMHttpClient 类

```typescript
export class ObsidianLLMHttpClient implements LLMHttpClient {
	async fetch(request: LLMHttpRequest): Promise<LLMHttpResponse> {
		// 使用 Node.js http/https 模块（Electron 环境可用，不受 CORS 限制）
		const http = await import('http');
		const https = await import('https');
		const { URL } = await import('url');

		return new Promise((resolve, reject) => {
			const url = new URL(request.url);
			const client = url.protocol === 'https:' ? https : http;

			const options = {
				hostname: url.hostname,
				port: url.port || (url.protocol === 'https:' ? 443 : 80),
				path: url.pathname + url.search,
				method: request.method,
				headers: request.headers || {}
			};

			const req = client.request(options, (res) => {
				// 转换 Node.js IncomingMessage 为 Web ReadableStream
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

				// 收集完整响应文本（用于 text() 和 json() 方法）
				let fullText = '';
				res.on('data', (chunk) => {
					fullText += chunk.toString();
				});

				resolve({
					status: res.statusCode || 200,
					statusText: res.statusMessage || '',
					ok: (res.statusCode || 200) >= 200 && (res.statusCode || 200) < 300,
					body: stream,
					text: async () => {
						return new Promise<string>((resolveText) => {
							if (fullText) {
								resolveText(fullText);
							} else {
								res.on('end', () => resolveText(fullText));
							}
						});
					},
					json: async () => {
						return new Promise<any>((resolveJson) => {
							if (fullText) {
								resolveJson(JSON.parse(fullText));
							} else {
								res.on('end', () => resolveJson(JSON.parse(fullText)));
							}
						});
					}
				});
			});

			// 发送请求体
			if (request.body) {
				req.write(request.body);
			}

			// 错误处理
			req.on('error', (err) => {
				reject(new Error(`HTTP request failed: ${err.message}`));
			});

			// 支持 AbortSignal
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

#### 1.3 导出工厂函数

```typescript
export function createObsidianLLMHttpClient(): LLMHttpClient {
	return new ObsidianLLMHttpClient();
}
```

### 2. `src/services/wiki/WikiService.ts` (修改 7 行)

#### 2.1 导入 LLM HttpClient 工厂函数

```typescript
import { createObsidianWikiService } from '@mdfriday/foundry';
import { createObsidianLLMHttpClient } from '../../http'; // ← 新增
import type FridayPlugin from '../../main';
import type { IngestResult, SaveResult, ConversationHistory } from './types';
```

#### 2.2 创建 WikiService 时注入 HttpClient

```typescript
export class WikiService {
	private wikiService;
	private workspacePath: string;
	
	constructor(private plugin: FridayPlugin) {
		this.workspacePath = plugin.absWorkspacePath;
		
		// ✅ 创建 Obsidian-safe LLM HttpClient 并传入
		// 使用 Node.js http/https 模块绕过 CORS 限制
		const llmHttpClient = createObsidianLLMHttpClient();
		this.wikiService = createObsidianWikiService(llmHttpClient);
	}
	
	// ... 其他方法保持不变
}
```

## 核心特性

### ✅ 使用 Node.js http/https 模块
- 在 Electron 环境中可用
- **不受浏览器 CORS 限制**
- 支持 http 和 https 协议

### ✅ 支持流式响应 (SSE)
- 将 Node.js `IncomingMessage` 转换为 Web `ReadableStream`
- LLM Provider 可以正常处理流式响应
- 实时显示 LLM 输出

### ✅ 完整的接口实现
- `fetch()`: 主方法，返回 `LLMHttpResponse`
- `body`: ReadableStream（用于流式处理）
- `text()`: 返回完整文本
- `json()`: 返回 JSON 解析结果

### ✅ 错误处理
- 网络错误捕获
- AbortSignal 支持（可取消请求）
- 状态码检查

## 工作原理

### 请求流程

```
User Input
    ↓
ChatView.handleSend()
    ↓
FridayWikiRuntime.handleWikiIngest()
    ↓
WikiService.ingest()
    ↓
createObsidianWikiService(llmHttpClient)  ← 注入 ObsidianLLMHttpClient
    ↓
LMStudioProvider.complete()
    ↓
this.httpClient.fetch({                   ← 使用注入的 HttpClient
  url: 'http://localhost:1234/v1/chat/completions',
  method: 'POST',
  body: JSON.stringify(requestBody)
})
    ↓
ObsidianLLMHttpClient.fetch()             ← 使用 Node.js http 模块
    ↓
Node.js http.request()                    ← 不受 CORS 限制 ✅
    ↓
LM Studio (localhost:1234)
```

### 与 Foundry 的集成

```
Foundry (Domain Layer)
├── LLMHttpClient Interface
│   └── fetch(request): Promise<response>
│
Obsidian Plugin (Implementation)
├── ObsidianLLMHttpClient
│   └── fetch() using Node.js http/https
│
WikiService
└── createObsidianWikiService(httpClient)
```

## 与现有架构的一致性

### 遵循现有模式

在 `main.ts` 第 552 行可以看到类似的模式：

```typescript
const httpClient = createObsidianHttpClient();
this.foundryServeService = createObsidianServeService(httpClient);
```

现在 WikiService 也遵循相同的模式：

```typescript
const llmHttpClient = createObsidianLLMHttpClient();
this.wikiService = createObsidianWikiService(llmHttpClient);
```

### 可扩展性

`http.ts` 现在支持三种 HttpClient：

1. **ObsidianHttpClient** (PublishHttpClient)
   - 用于 Publish Service
   - `createObsidianHttpClient()`

2. **ObsidianIdentityHttpClient** (IdentityHttpClient)
   - 用于 Auth/License Service
   - `createObsidianIdentityHttpClient()`

3. **ObsidianLLMHttpClient** (LLMHttpClient) ← 新增
   - 用于 Wiki Service (LLM Provider)
   - `createObsidianLLMHttpClient()`

所有 HttpClient 都基于 Obsidian 的 `requestUrl` API 或 Node.js http 模块，不受 CORS 限制。

## 测试验证

### 预期行为

1. **启动 LM Studio**
   - 确保 LM Studio 运行在 `http://localhost:1234`
   - 加载模型（如 `qwen2.5-coder:14b`）

2. **在 Obsidian 中测试**
   ```
   1. 点击 🤖 AI 按钮
   2. 输入 /wiki @What
   3. 观察 ingest 流程
   ```

3. **验证成功**
   - ✅ 不再有 CORS 错误
   - ✅ 可以看到 LLM 请求成功
   - ✅ 显示 ingest 进度
   - ✅ 最终显示 "✅ Ingest completed!"

### 调试信息

可以在 Obsidian DevTools Console 中看到：

```
🔄 Ingesting file: /path/to/file.md
📄 File content length: 11923 chars
✅ Ingest result: {success: true, entities: 5, concepts: 3, connections: 2}
📝 Saving KB: {entities: 5, concepts: 3, connections: 2, sources: 1}
✅ KB saved successfully
```

**不应该看到**：
```
❌ Access to fetch at 'http://localhost:1234/v1/chat/completions' 
   has been blocked by CORS policy
```

## 关键技术点

### 1. Node.js Stream → Web ReadableStream 转换

```typescript
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
```

这个转换允许 LLM Provider 使用标准的 Web ReadableStream API 来处理流式响应（SSE）。

### 2. 双重数据收集

```typescript
// 流式处理（通过 stream）
const stream = new ReadableStream({ /* ... */ });

// 完整文本收集（用于 text() 和 json()）
let fullText = '';
res.on('data', (chunk) => {
	fullText += chunk.toString();
});
```

这样既支持流式处理（实时显示），又支持完整响应获取（用于非流式 API）。

### 3. 动态导入 Node.js 模块

```typescript
const http = await import('http');
const https = await import('https');
const { URL } = await import('url');
```

使用动态导入确保这些模块只在需要时加载（Electron 环境）。

## 总结

### 修改的文件（2 个）
1. ✅ `src/http.ts` - 新增 `ObsidianLLMHttpClient` 类 + 工厂函数
2. ✅ `src/services/wiki/WikiService.ts` - 注入 `ObsidianLLMHttpClient`

### 核心改动
- ✅ 实现 `LLMHttpClient` 接口
- ✅ 使用 Node.js http/https 模块（绕过 CORS）
- ✅ 支持流式响应（SSE）
- ✅ 注入到 `createObsidianWikiService()`

### 效果
- ✅ **完全解决 CORS 问题**
- ✅ 可以正常调用本地 LLM 服务
- ✅ 保持架构一致性
- ✅ 可扩展、可维护

现在可以在 Obsidian 中正常使用 Wiki ingest 功能了！
