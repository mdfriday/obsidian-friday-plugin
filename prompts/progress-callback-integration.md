# Progress Callback 集成 + 命令过滤 + 英语默认输出

## ✅ 完成的任务

### 1. 集成 Foundry Progress Callback
- ✅ WikiService 支持 `onProgress` 参数
- ✅ ChatRuntime 在 ingest 和 query 时传递 progress callback
- ✅ 在控制台输出进度信息

### 2. 过滤命令消息
- ✅ `/save` 时不保存 `/wiki`, `/publish`, `/save` 命令
- ✅ 只保存真正的对话内容

### 3. 设置英语为默认输出语言
- ✅ `wiki.outputLanguage` 从 `'Chinese'` 改为 `'English'`

## 📝 代码修改

### 1. WikiService.ts

#### 添加 Progress Callback 支持

**文件**: `src/services/wiki/WikiService.ts`

```typescript
/**
 * Ingest 文件夹到 Wiki
 */
async ingest(
  projectName: string,
  onProgress?: (event: any) => void  // ✅ 新增
): Promise<IngestResult> {
  const result = await this.wikiService.ingest({
    workspacePath: this.workspacePath,
    projectName,
    temperature: 0.3,
    onProgress, // ✅ 传递给 Foundry
  });
  
  // ...
}

/**
 * 查询 Wiki（流式）
 */
async *queryStream(
  projectName: string,
  question: string,
  onProgress?: (event: any) => void  // ✅ 新增
): AsyncGenerator<string> {
  for await (const chunk of this.wikiService.queryStream({
    workspacePath: this.workspacePath,
    projectName,
    question,
    onProgress, // ✅ 传递给 Foundry
  })) {
    yield chunk;
  }
}
```

### 2. ChatRuntime.ts

#### 2.1 使用 Progress Callback (Ingest)

```typescript
private async *handleWikiIngest(args: string): AsyncGenerator<StreamChunk> {
  // ...
  
  // ✅ Ingest with progress callback
  const result = await this.wikiService.ingest(projectName, (event) => {
    // 显示进度
    const progressText = event.progress 
      ? ` (${event.progress.current}/${event.progress.total} - ${event.progress.percentage}%)`
      : '';
    console.log(`[${event.type}] ${event.message}${progressText}`);
  });
  
  // ...
}
```

**输出示例**:
```
[ingest:start] Starting folder ingest
[ingest:file:start] Processing file 1/3: chapter1.md (1/3 - 33%)
[ingest:file:reading] Reading file content
[ingest:file:extracting] Extracting knowledge
[ingest:file:complete] Completed file 1/3: 5 entities, 8 concepts (1/3 - 33%)
[ingest:file:start] Processing file 2/3: chapter2.md (2/3 - 67%)
...
[ingest:pages:generating] Generating wiki pages
[ingest:pages:complete] Generated 23 pages
[ingest:complete] Ingest completed successfully
```

#### 2.2 使用 Progress Callback (Query)

```typescript
private async *handleWikiQuery(
  question: string,
  history: ChatMessage[]
): AsyncGenerator<StreamChunk> {
  // ...
  
  // ✅ Query with progress callback
  for await (const chunk of this.wikiService.queryStream(projectName, question, (event) => {
    // 显示查询进度
    console.log(`[${event.type}] ${event.message}`);
  })) {
    yield {
      type: 'text',
      content: chunk,
    };
  }
}
```

**输出示例**:
```
[query:start] Starting query: What is Domain-Driven Design?
[query:embedding:searching] Searching knowledge base with embeddings
[query:llm:generating] Generating answer
[query:complete] Query completed
```

#### 2.3 过滤命令消息

```typescript
/**
 * 辅助方法：转换对话格式
 * ✅ 过滤掉命令消息（/wiki, /publish, /save 等）
 */
private convertToWikiFormat(history: ChatMessage[]): Array<{ question: string; answer: string }> {
  const result: Array<{ question: string; answer: string }> = [];
  
  for (let i = 0; i < history.length; i += 2) {
    const user = history[i];
    const assistant = history[i + 1];
    
    if (user?.role === 'user' && assistant?.role === 'assistant') {
      // ✅ 过滤掉命令消息
      const userText = user.content.trim();
      if (userText.startsWith('/wiki') || 
          userText.startsWith('/publish') || 
          userText.startsWith('/save')) {
        continue; // 跳过命令消息
      }
      
      result.push({
        question: user.content,
        answer: assistant.content,
      });
    }
  }
  
  return result;
}
```

**效果**:
```
对话历史：
1. User: /wiki @How             → ❌ 不保存
2. Assistant: ✅ Ingest completed!
3. User: What is LLM?            → ✅ 保存
4. Assistant: LLM stands for...
5. User: Explain neural networks → ✅ 保存
6. Assistant: Neural networks...
7. User: /publish                → ❌ 不保存
8. Assistant: ✅ Published!
9. User: /save My Conversation   → ❌ 不保存 (这条命令本身)

最终保存的对话：
- Q: What is LLM?
  A: LLM stands for...
- Q: Explain neural networks
  A: Neural networks...
```

#### 2.4 设置英语为默认输出语言

```typescript
private async configureLLM(): Promise<void> {
  // ...
  
  // ✅ 默认输出语言设置为英语
  await this.plugin.foundryGlobalConfigService.set(
    this.plugin.absWorkspacePath,
    'wiki.outputLanguage',
    'English'  // 从 'Chinese' 改为 'English'
  );
}
```

## 📊 Progress Event 类型

根据 `wiki-progress-callback-guide.md`，支持的事件类型：

### Ingest 操作
- `ingest:start` - 开始 ingest
- `ingest:file:start` - 开始处理单个文件
- `ingest:file:reading` - 读取文件内容
- `ingest:file:extracting` - 提取知识
- `ingest:file:complete` - 文件处理完成
- `ingest:embedding:start` - 开始构建 embedding
- `ingest:embedding:progress` - Embedding 构建进度
- `ingest:embedding:complete` - Embedding 完成
- `ingest:pages:generating` - 生成 wiki 页面
- `ingest:pages:complete` - 页面生成完成
- `ingest:complete` - 整个 ingest 完成

### Query 操作
- `query:start` - 开始查询
- `query:embedding:searching` - 使用 embedding 检索
- `query:llm:generating` - LLM 生成答案
- `query:complete` - 查询完成

## 🧪 测试验证

### 1. 测试 Progress Callback

```
1. 打开 Obsidian DevTools Console (Ctrl/Cmd + Shift + I)
2. 输入 /wiki @How
3. 观察 Console 输出
```

**预期输出**:
```
[ingest:start] Starting folder ingest
[ingest:file:start] Processing file 1/1: llm-wiki-karpathy.md (1/1 - 100%)
[ingest:file:reading] Reading file content
[ingest:file:extracting] Extracting knowledge (entities, concepts, connections)
[ingest:file:complete] Completed file 1/1: 15 entities, 8 concepts (1/1 - 100%)
[ingest:pages:generating] Generating wiki pages
[ingest:pages:complete] Generated 23 pages
[ingest:complete] Ingest completed successfully
```

### 2. 测试命令过滤

```
1. /wiki @How
2. What is LLM?
3. Explain backpropagation
4. /publish
5. /save Neural Networks
```

**检查保存的文件**:
- 打开 `How wiki/conversations/2026-04-30-neural-networks.md`
- 应该**只包含**：
  - Q: What is LLM?
  - Q: Explain backpropagation
- 应该**不包含**：
  - /wiki @How
  - /publish
  - /save Neural Networks

### 3. 测试英语输出

```
1. /wiki @How
2. 检查生成的页面
```

**预期**:
- `How wiki/entities/*.md` - 英文内容
- `How wiki/concepts/*.md` - 英文内容
- `How wiki/index.md` - 英文内容
- `How wiki/GLOSSARY.md` - 英文内容

## 🎯 用户体验改进

### 1. 更好的进度可见性

**之前**:
```
📥 Ingesting files...
[等待 30 秒]
✅ Ingest completed!
```
用户不知道发生了什么，可能以为卡住了。

**现在**:
```
📥 Ingesting files...
[ingest:file:start] Processing file 1/3: chapter1.md (33%)
[ingest:file:extracting] Extracting knowledge
[ingest:file:complete] Completed file 1/3 (33%)
[ingest:file:start] Processing file 2/3: chapter2.md (67%)
[ingest:file:extracting] Extracting knowledge
[ingest:file:complete] Completed file 2/3 (67%)
[ingest:pages:generating] Generating wiki pages
✅ Ingest completed!
```
用户可以清楚看到进度和当前状态。

### 2. 更干净的对话记录

**之前**:
```markdown
# Conversation

Q: /wiki @How
A: ✅ Ingest completed!

Q: What is LLM?
A: LLM stands for...

Q: /publish
A: ✅ Published!

Q: /save My Conversation
A: ✅ Conversation saved!
```

**现在**:
```markdown
# Conversation

Q: What is LLM?
A: LLM stands for...
```
只保存真正的知识对话，更适合作为 Wiki 素材。

### 3. 一致的输出语言

**之前**: 根据配置，可能是中文或英文，不一致

**现在**: 默认英语，保证输出一致性

## 🔧 构建结果

### Foundry
- ✅ CJS 主包: 637.25 KB
- ✅ ESM 主包: 631.18 KB
- ✅ 支持 `onProgress` callback

### Friday Plugin
- ✅ main.js: 5.5mb
- ✅ 集成 progress callback
- ✅ 命令过滤
- ✅ 英语默认输出

## 📚 相关文档

- `docs/ai/wiki-progress-callback-guide.md` - Progress Callback 完整指南
- `docs/ai/obsidian-wiki-interface.integration.test.ts` - 集成测试示例

## 🚀 下一步

1. **重新加载 Obsidian**
   ```
   Ctrl/Cmd + P → "Reload app"
   ```

2. **测试完整流程**
   ```
   1. /wiki @How
   2. 观察 Console 进度输出
   3. What is LLM?
   4. Explain neural networks
   5. /save Neural Networks Basics
   6. 检查保存的文件
   ```

3. **验证输出语言**
   ```
   查看 How wiki/ 中生成的页面
   确认都是英文内容
   ```

## 🎉 总结

### 完成的改进
1. ✅ **Progress Callback** - 用户可以看到实时进度
2. ✅ **命令过滤** - 保存的对话更干净
3. ✅ **英语输出** - 默认使用英语，保证一致性

### 技术实现
- ✅ WikiService 传递 `onProgress` 参数
- ✅ ChatRuntime 在 Console 输出进度
- ✅ `convertToWikiFormat()` 过滤命令
- ✅ `configureLLM()` 设置 `'English'`

### 用户体验
- ✅ 更好的进度可见性
- ✅ 更干净的对话记录
- ✅ 一致的输出语言

现在可以重新加载 Obsidian 并享受这些改进了！🚀
