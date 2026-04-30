# /save 命令修复

## 🐛 问题描述

用户报告：当输入 `/save` 命令时，没有保存对话，而是进行了查询。

## 🔍 问题原因

**文件**: `src/chat/ChatRuntime.ts`

**原有代码**:
```typescript
} else if (text.startsWith('/save ')) {  // ❌ 要求后面必须有空格
  yield* this.handleSaveConversation(text.slice(6), conversationHistory);
}
```

**问题**:
- `/save ` (带空格) → ✅ 触发保存
- `/save` (不带空格或标题) → ❌ 被当作查询处理

这导致用户输入 `/save` 时会执行 `handleWikiQuery()` 而不是 `handleSaveConversation()`。

## ✅ 修复方案

### 改进的命令路由逻辑

```typescript
async *query(
  turn: PreparedChatTurn,
  conversationHistory: ChatMessage[] = []
): AsyncGenerator<StreamChunk> {
  const text = turn.request.text.trim();
  
  try {
    // 命令路由
    if (text.startsWith('/wiki ')) {
      yield* this.handleWikiIngest(text.slice(6));
    } else if (text.startsWith('/publish')) {
      yield* this.handlePublish();
    } else if (text.startsWith('/save')) {
      // ✅ 支持 /save 或 /save title
      const title = text.slice(5).trim();
      yield* this.handleSaveConversation(title, conversationHistory);
    } else if (text.startsWith('/ask ')) {
      // ✅ 支持 /ask question 语法
      yield* this.handleWikiQuery(text.slice(5), conversationHistory);
    } else if (text.startsWith('/')) {
      // ✅ 未知命令提示
      yield {
        type: 'text',
        content: `❌ **Unknown command**: \`${text.split(' ')[0]}\`\n\n` +
          `Available commands:\n` +
          `• \`/wiki @folder\` - Ingest folder into wiki\n` +
          `• \`/ask question\` - Query wiki (or just type directly)\n` +
          `• \`/save [title]\` - Save conversation\n` +
          `• \`/publish\` - Publish wiki to MDFriday\n`,
      };
    } else {
      // 默认：查询
      yield* this.handleWikiQuery(text, conversationHistory);
    }
  } catch (error) {
    yield {
      type: 'text',
      content: `\n\n❌ **Error**: ${error.message}`,
    };
  }
}
```

## 🎯 关键改进

### 1. `/save` 命令更灵活

**修改前**:
```typescript
text.startsWith('/save ')  // ❌ 要求空格
```

**修改后**:
```typescript
text.startsWith('/save')   // ✅ 可选空格
const title = text.slice(5).trim();  // ✅ 自动提取标题
```

**支持的用法**:
- ✅ `/save` - 使用默认标题 "Untitled Conversation"
- ✅ `/save My Title` - 使用自定义标题 "My Title"
- ✅ `/save    My Title` - 自动 trim 空格

### 2. 添加 `/ask` 命令支持

虽然直接输入问题就会触发查询，但现在也支持显式的 `/ask` 命令：

```typescript
} else if (text.startsWith('/ask ')) {
  yield* this.handleWikiQuery(text.slice(5), conversationHistory);
}
```

**用法**:
- ✅ `What is DDD?` - 直接查询
- ✅ `/ask What is DDD?` - 显式查询（与上面等效）

### 3. 未知命令提示

当用户输入不存在的命令时，显示帮助信息：

```typescript
} else if (text.startsWith('/')) {
  // 未知命令提示
  yield {
    type: 'text',
    content: `❌ **Unknown command**: \`${text.split(' ')[0]}\`\n\n` +
      `Available commands:\n` +
      `• \`/wiki @folder\` - Ingest folder into wiki\n` +
      `• \`/ask question\` - Query wiki (or just type directly)\n` +
      `• \`/save [title]\` - Save conversation\n` +
      `• \`/publish\` - Publish wiki to MDFriday\n`,
  };
}
```

**示例**:
- 输入 `/unknown` → 显示帮助信息
- 输入 `/help` → 显示帮助信息

## 📋 测试用例

### 1. `/save` 不带标题
```
输入: /save
预期: 保存对话，标题为 "Untitled Conversation"
```

### 2. `/save` 带标题
```
输入: /save DDD Introduction
预期: 保存对话，标题为 "DDD Introduction"
```

### 3. `/save` 带多余空格
```
输入: /save    My Title  
预期: 保存对话，标题为 "My Title"（自动 trim）
```

### 4. `/ask` 显式查询
```
输入: /ask What is Domain-Driven Design?
预期: 执行查询（与直接输入问题效果相同）
```

### 5. 未知命令
```
输入: /unknown
预期: 显示可用命令列表
```

### 6. 直接输入问题
```
输入: What is DDD?
预期: 执行查询（默认行为）
```

## 🔄 命令优先级

命令按以下顺序匹配：

1. `/wiki @folder` - Ingest
2. `/publish` - 发布
3. `/save [title]` - 保存对话
4. `/ask question` - 显式查询
5. `/...` - 未知命令（显示帮助）
6. 其他 - 默认查询

## 🚀 使用步骤

### 1. 重新加载 Obsidian
```
Ctrl/Cmd + P → "Reload app"
```

### 2. 测试 `/save` 命令

#### 场景 1：先 ingest，再对话，再保存
```
1. /wiki @How
2. What is LLM?
3. Explain neural networks
4. /save         ← 不带标题
```

**预期结果**:
```
💾 Saving conversation: "Untitled Conversation"...
✅ Conversation saved!

File: `2026-04-30-untitled-conversation.md`

The conversation has been automatically ingested into the wiki.

Continue asking questions or `/publish` to share your wiki.
```

#### 场景 2：带自定义标题
```
1. /wiki @How
2. What is backpropagation?
3. /save Neural Network Basics   ← 自定义标题
```

**预期结果**:
```
💾 Saving conversation: "Neural Network Basics"...
✅ Conversation saved!

File: `2026-04-30-neural-network-basics.md`
```

### 3. 测试 `/ask` 命令
```
输入: /ask What is Domain-Driven Design?
```

**预期**: 正常查询 Wiki（与直接输入问题相同）

### 4. 测试未知命令
```
输入: /help
```

**预期**: 显示所有可用命令

## 💡 设计原则

### 1. 用户友好
- ✅ 支持可选参数（`/save` 可以不带标题）
- ✅ 自动 trim 空格
- ✅ 提供未知命令提示

### 2. 向后兼容
- ✅ `/save title` 仍然工作
- ✅ 直接输入问题仍然工作
- ✅ 所有原有用法不变

### 3. 渐进增强
- ✅ 添加 `/ask` 显式查询
- ✅ 添加未知命令提示
- ✅ 更好的错误处理

## 🎉 总结

### 修复的问题
- ✅ `/save` 不带标题时不再被当作查询
- ✅ `/save` 命令更灵活，支持可选标题
- ✅ 添加 `/ask` 显式查询支持
- ✅ 添加未知命令提示

### 用户体验改进
- ✅ 更宽松的命令语法
- ✅ 更清晰的错误提示
- ✅ 更一致的命令行为

现在可以重新加载 Obsidian 并测试 `/save` 命令了！
