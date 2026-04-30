# Wiki Progress Callback 使用指南

## 概述

Progress Callback 功能让你能够实时监控 Wiki 操作的进度，包括文件 ingest、知识查询和页面生成。这对于构建用户界面、显示进度条或提供实时反馈非常有用。

## 安装和导入

```typescript
import {
  createObsidianWikiService,
  type ProgressEvent,
  type ProgressCallback,
} from '@mdfriday/foundry';
```

## 核心概念

### ProgressEvent 结构

```typescript
interface ProgressEvent {
  type: ProgressEventType;      // 事件类型
  message: string;               // 用户友好的消息
  progress?: {
    current: number;             // 当前进度（如第 3 个文件）
    total: number;               // 总数（如共 5 个文件）
    percentage: number;          // 百分比 (0-100)
  };
  metadata?: Record<string, any>; // 额外数据
  timestamp: number;             // 事件时间戳
}
```

### 事件类型

#### Ingest 操作事件
- `ingest:start` - 开始 ingest
- `ingest:file:start` - 开始处理单个文件
- `ingest:file:reading` - 读取文件内容
- `ingest:file:extracting` - 提取知识（entities/concepts）
- `ingest:file:complete` - 文件处理完成
- `ingest:embedding:start` - 开始构建 embedding（如果配置）
- `ingest:embedding:progress` - Embedding 构建进度
- `ingest:embedding:complete` - Embedding 构建完成
- `ingest:pages:generating` - 生成 wiki 页面
- `ingest:pages:complete` - 页面生成完成
- `ingest:complete` - 整个 ingest 完成

#### Query 操作事件
- `query:start` - 开始查询
- `query:embedding:searching` - 使用 embedding 检索
- `query:llm:generating` - LLM 生成答案
- `query:complete` - 查询完成

#### Generate Pages 操作事件
- `generate:start` - 开始生成页面
- `generate:progress` - 页面生成进度
- `generate:complete` - 页面生成完成

## 基本使用

### 1. Ingest 单个文件

```typescript
const wikiService = createObsidianWikiService(wikiAdapter);

const result = await wikiService.ingest({
  workspacePath: '/path/to/workspace',
  projectName: 'my-wiki',
  filePath: '/path/to/file.md',
  onProgress: (event) => {
    console.log(`[${event.type}] ${event.message}`);
  }
});
```

**输出示例：**
```
[ingest:start] Starting ingest for file: /path/to/file.md
[ingest:file:start] Processing file: file.md
[ingest:file:reading] Reading file content
[ingest:file:complete] File processed: 5 entities, 10 concepts
[ingest:pages:generating] Generating wiki pages
[ingest:pages:complete] Generated 15 pages
[ingest:complete] Ingest completed successfully
```

### 2. Ingest 整个文件夹

```typescript
const result = await wikiService.ingest({
  workspacePath: '/path/to/workspace',
  projectName: 'my-wiki',
  // 不指定 filePath，默认处理整个项目文件夹
  onProgress: (event) => {
    console.log(`[${event.type}] ${event.message}`);
    
    // 显示进度百分比
    if (event.progress) {
      const { current, total, percentage } = event.progress;
      console.log(`  Progress: ${current}/${total} (${percentage}%)`);
    }
  }
});
```

**输出示例：**
```
[ingest:start] Starting folder ingest
[ingest:file:start] Processing file 1/5: chapter1.md
  Progress: 1/5 (20%)
[ingest:file:complete] Completed file 1/5: 3 entities, 7 concepts
  Progress: 1/5 (20%)
[ingest:file:start] Processing file 2/5: chapter2.md
  Progress: 2/5 (40%)
[ingest:file:complete] Completed file 2/5: 5 entities, 12 concepts
  Progress: 2/5 (40%)
...
[ingest:complete] Ingest completed successfully
```

### 3. Query 查询

```typescript
let answer = '';
for await (const chunk of wikiService.queryStream({
  workspacePath: '/path/to/workspace',
  projectName: 'my-wiki',
  question: 'What is Domain-Driven Design?',
  onProgress: (event) => {
    console.log(`[${event.type}] ${event.message}`);
  }
})) {
  answer += chunk;
  process.stdout.write(chunk); // 实时显示答案
}
```

**输出示例：**
```
[query:start] Starting query: What is Domain-Driven Design?
[query:embedding:searching] Searching knowledge base with embeddings
[query:llm:generating] Generating answer
Domain-Driven Design (DDD) is a software development approach...
[query:complete] Query completed
```

## 高级用例

### 1. 在 UI 中显示进度条

```typescript
// React 示例
function WikiIngestProgress({ workspacePath, projectName }) {
  const [progress, setProgress] = useState(0);
  const [status, setStatus] = useState('');
  const [isComplete, setIsComplete] = useState(false);

  const handleIngest = async () => {
    const wikiService = createObsidianWikiService(wikiAdapter);
    
    const result = await wikiService.ingest({
      workspacePath,
      projectName,
      onProgress: (event) => {
        setStatus(event.message);
        
        if (event.progress) {
          setProgress(event.progress.percentage);
        }
        
        if (event.type === 'ingest:complete') {
          setIsComplete(true);
        }
      }
    });
  };

  return (
    <div>
      <ProgressBar value={progress} />
      <p>{status}</p>
      {isComplete && <p>✅ Ingest completed!</p>}
    </div>
  );
}
```

### 2. 收集和分析进度事件

```typescript
interface ProgressStats {
  totalEvents: number;
  filesProcessed: number;
  entitiesExtracted: number;
  conceptsExtracted: number;
  duration: number;
}

const progressEvents: ProgressEvent[] = [];
const startTime = Date.now();

const result = await wikiService.ingest({
  workspacePath,
  projectName,
  onProgress: (event) => {
    progressEvents.push(event);
  }
});

// 分析事件
const stats: ProgressStats = {
  totalEvents: progressEvents.length,
  filesProcessed: progressEvents.filter(e => e.type === 'ingest:file:complete').length,
  entitiesExtracted: 0, // 从 result 获取
  conceptsExtracted: 0, // 从 result 获取
  duration: Date.now() - startTime
};

console.log('Ingest Statistics:', stats);
```

### 3. 实现自定义日志记录

```typescript
const logger = {
  info: (message: string) => console.log(`ℹ️  ${message}`),
  success: (message: string) => console.log(`✅ ${message}`),
  warning: (message: string) => console.log(`⚠️  ${message}`),
  error: (message: string) => console.log(`❌ ${message}`)
};

const result = await wikiService.ingest({
  workspacePath,
  projectName,
  onProgress: (event) => {
    switch (event.type) {
      case 'ingest:start':
        logger.info(event.message);
        break;
      case 'ingest:file:complete':
      case 'ingest:complete':
        logger.success(event.message);
        break;
      case 'ingest:file:reading':
      case 'ingest:file:extracting':
        logger.info(event.message);
        break;
    }
  }
});
```

### 4. 在 CLI 中显示进度条

```typescript
import ora from 'ora';

const spinner = ora('Starting ingest...').start();

const result = await wikiService.ingest({
  workspacePath,
  projectName,
  onProgress: (event) => {
    spinner.text = event.message;
    
    if (event.progress) {
      spinner.text = `${event.message} (${event.progress.percentage}%)`;
    }
    
    if (event.type === 'ingest:complete') {
      spinner.succeed('Ingest completed successfully!');
    }
  }
});
```

### 5. 实现超时和取消机制

```typescript
const TIMEOUT_MS = 5 * 60 * 1000; // 5 分钟超时
let lastProgressTime = Date.now();
let timeoutTimer: NodeJS.Timeout;

const resetTimeout = () => {
  lastProgressTime = Date.now();
  clearTimeout(timeoutTimer);
  timeoutTimer = setTimeout(() => {
    console.error('❌ Ingest timeout: No progress for 5 minutes');
    // 实现取消逻辑
  }, TIMEOUT_MS);
};

resetTimeout();

const result = await wikiService.ingest({
  workspacePath,
  projectName,
  onProgress: (event) => {
    resetTimeout(); // 每次收到进度事件重置超时
    console.log(event.message);
  }
});

clearTimeout(timeoutTimer);
```

## 最佳实践

### 1. 避免在回调中执行耗时操作

```typescript
// ❌ 不好的做法
onProgress: async (event) => {
  await saveToDatabase(event); // 会阻塞进度报告
}

// ✅ 好的做法
const eventQueue: ProgressEvent[] = [];

onProgress: (event) => {
  eventQueue.push(event); // 快速入队
  console.log(event.message);
}

// 异步处理队列
processEventQueue(eventQueue);
```

### 2. 处理错误和边界情况

```typescript
onProgress: (event) => {
  try {
    // 你的进度处理逻辑
    updateUI(event);
  } catch (error) {
    console.error('Progress callback error:', error);
    // 不要让回调错误影响主流程
  }
}
```

### 3. 记录关键进度点

```typescript
const milestones: ProgressEvent[] = [];

onProgress: (event) => {
  // 只记录重要的里程碑事件
  const importantEvents = [
    'ingest:start',
    'ingest:file:complete',
    'ingest:pages:complete',
    'ingest:complete'
  ];
  
  if (importantEvents.includes(event.type)) {
    milestones.push(event);
  }
}
```

### 4. 提供用户友好的消息

```typescript
const userFriendlyMessages: Record<string, string> = {
  'ingest:start': '正在开始处理...',
  'ingest:file:reading': '正在读取文件...',
  'ingest:file:extracting': '正在提取知识...',
  'ingest:pages:generating': '正在生成页面...',
  'ingest:complete': '处理完成！'
};

onProgress: (event) => {
  const message = userFriendlyMessages[event.type] || event.message;
  showToast(message);
}
```

## 测试

### 单元测试示例

```typescript
import { describe, it, expect } from 'vitest';

describe('Wiki Progress Callback', () => {
  it('should report progress for ingest operation', async () => {
    const progressEvents: ProgressEvent[] = [];
    
    const result = await wikiService.ingest({
      workspacePath,
      projectName,
      filePath: 'test.md',
      onProgress: (event) => {
        progressEvents.push(event);
      }
    });
    
    expect(progressEvents.length).toBeGreaterThan(0);
    expect(progressEvents[0].type).toBe('ingest:start');
    expect(progressEvents[progressEvents.length - 1].type).toBe('ingest:complete');
  });
  
  it('should include progress percentage for folder ingest', async () => {
    const progressEvents: ProgressEvent[] = [];
    
    const result = await wikiService.ingest({
      workspacePath,
      projectName,
      onProgress: (event) => {
        progressEvents.push(event);
      }
    });
    
    const fileStartEvents = progressEvents.filter(e => e.type === 'ingest:file:start');
    expect(fileStartEvents.length).toBeGreaterThan(0);
    
    fileStartEvents.forEach(event => {
      expect(event.progress).toBeDefined();
      expect(event.progress!.percentage).toBeGreaterThanOrEqual(0);
      expect(event.progress!.percentage).toBeLessThanOrEqual(100);
    });
  });
});
```

## 常见问题

### Q: onProgress 参数是必需的吗？
A: 不是，`onProgress` 是可选参数。如果不提供，功能照常运行，只是不会收到进度通知。

### Q: 进度回调会影响性能吗？
A: 影响非常小。回调是同步调用的，只要避免在回调中执行耗时操作即可。

### Q: 如何知道操作失败了？
A: 查看最终的 `result.success` 字段。进度回调只报告进度，不报告错误。如果操作失败，会在最终结果中反映。

### Q: 可以在回调中取消操作吗？
A: 当前版本不支持从回调中取消。这是一个单向的通知机制。

### Q: 文件夹 ingest 时，如何知道总共有多少文件？
A: 第一个 `ingest:file:start` 事件的 `progress.total` 字段会告诉你总文件数。

## 完整示例

完整的 Obsidian 插件集成示例：

```typescript
import { 
  createObsidianWikiService,
  type ProgressEvent 
} from '@mdfriday/foundry';

class WikiPlugin extends Plugin {
  async ingestWithProgress(projectName: string) {
    const wikiService = createObsidianWikiService(this.wikiAdapter);
    
    // 创建进度通知
    const notice = new Notice('Starting ingest...', 0);
    
    try {
      const result = await wikiService.ingest({
        workspacePath: this.app.vault.adapter.basePath,
        projectName,
        onProgress: (event) => {
          // 更新通知内容
          notice.setMessage(event.message);
          
          // 在状态栏显示进度
          if (event.progress) {
            this.statusBar.setText(
              `Processing: ${event.progress.percentage}%`
            );
          }
          
          // 记录到控制台
          console.log(`[Wiki] ${event.message}`);
        }
      });
      
      // 完成
      notice.hide();
      new Notice(`✅ Ingest completed! Generated ${result.data?.pagesGenerated} pages`);
      this.statusBar.setText('');
      
    } catch (error) {
      notice.hide();
      new Notice(`❌ Ingest failed: ${error.message}`);
    }
  }
  
  async queryWithProgress(question: string) {
    const wikiService = createObsidianWikiService(this.wikiAdapter);
    const notice = new Notice('Searching...', 0);
    
    try {
      let answer = '';
      for await (const chunk of wikiService.queryStream({
        workspacePath: this.app.vault.adapter.basePath,
        projectName: this.currentProject,
        question,
        onProgress: (event) => {
          notice.setMessage(event.message);
        }
      })) {
        answer += chunk;
      }
      
      notice.hide();
      // 显示答案
      this.showAnswer(answer);
      
    } catch (error) {
      notice.hide();
      new Notice(`❌ Query failed: ${error.message}`);
    }
  }
}
```

## 相关文档

- [LLM HTTP Client 实现](./llm-http-client-implementation.md)
- [LLM Wiki 概念](./llm-wiki-concept.md)
- [Obsidian Wiki Interface API](../internal/interfaces/obsidian/services/wiki.service.ts)

## 更新日志

- **2026-04-30**: 初始版本，支持 Ingest 和 Query 操作的进度回调
