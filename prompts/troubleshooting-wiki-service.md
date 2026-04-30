# 问题定位与解决：createObsidianWikiService is not a function

## 问题现象

点击 Site.svelte 右上角的 "🤖 AI" 按钮时，出现以下错误：

```
TypeError: (0 , import_foundry2.createObsidianWikiService) is not a function
    at new WikiService (plugin:mdfriday:130867:74)
    at new FridayWikiRuntime (plugin:mdfriday:130969:28)
    at ChatView.onOpen (plugin:mdfriday:131387:24)
```

## 根本原因

1. **Foundry 版本问题**: `obsidian-friday-plugin` 使用的是旧版本的 foundry (`26.4.17`)，该版本没有导出 `createObsidianWikiService`
2. **npm link 依赖冲突**: 使用 `npm link` 会导致 80 个包被移除，包括必需的 `chokidar` 等依赖
3. **esbuild 配置缺失**: `events` 模块没有在 externals 列表中，导致构建时尝试打包 Node.js 内置模块

## 解决方案

### 1. Foundry 修改（已完成）

**文件**: `/Users/weisun/github/mdfriday/foundry/index.ts`
- 添加 `createObsidianWikiService` 导出

**文件**: `/Users/weisun/github/mdfriday/foundry/internal/domain/wiki/value-object/retrieval.ts`
- 修改 `rankByEmbedding` 支持 `ReadonlyMap<string, number[]> | EmbeddingIndex`
- 修改 `cosineSimilarity` 支持 `readonly number[]`

**构建**: 
```bash
cd /Users/weisun/github/mdfriday/foundry
npm run build
```
✅ 构建成功，版本 `26.4.20`

### 2. obsidian-friday-plugin 修改

#### 2.1 使用本地 foundry 路径而非 npm link

**文件**: `package.json`

**修改前**:
```json
"dependencies": {
  "@mdfriday/foundry": "^26.4.17",
}
```

**修改后**:
```json
"dependencies": {
  "@mdfriday/foundry": "file:../foundry",
}
```

**原因**: `npm link` 会导致依赖冲突，使用 `file:` 协议可以避免这个问题

#### 2.2 添加 events 到 externals

**文件**: `esbuild.config.mjs`

**修改位置**: 第 104 行（在 externals 数组中）

**修改内容**:
```javascript
// Node.js builtins used by desktop-only features (publish/ftp/foundry)
// These are available in Obsidian Desktop (Electron) but not on mobile
// The code using these is only executed on desktop (guarded by Platform.isDesktop)
'events',  // ← 新增这一行
'fs',
'fs/promises',
// ... 其他模块
```

**原因**: `chokidar` (foundry 的依赖) 使用了 Node.js 的 `events` 模块，需要标记为 external 而不是打包进来

#### 2.3 恢复 WikiService 导入

**文件**: `src/services/wiki/WikiService.ts`

**最终代码**:
```typescript
import { createObsidianWikiService } from '@mdfriday/foundry';
```

已从临时的内部路径导入改为正常的包导入

### 3. 执行步骤

```bash
# 1. 安装依赖（使用 file: 路径）
cd /Users/weisun/github/mdfriday/obsidian-friday-plugin
npm install

# 2. 验证 foundry 版本
npm ls @mdfriday/foundry
# 输出: @mdfriday/foundry@26.4.20 -> ./../foundry

# 3. 构建
npm run dev
```

## 验证结果

✅ **Foundry**: 版本 26.4.20，已导出 `createObsidianWikiService`

```bash
node -e "const f = require('/Users/weisun/github/mdfriday/foundry/dist/cjs/index.js'); console.log('createObsidianWikiService:', typeof f.createObsidianWikiService);"
# 输出: createObsidianWikiService: function
```

✅ **Friday Plugin**: 构建成功

```
Found CSS outputs: ../../../Desktop/mdf-661/.obsidian/plugins/mdfriday/main.css
✓ Renamed CSS to /Users/weisun/Desktop/mdf-661/.obsidian/plugins/mdfriday/styles.css
[watch] build finished, watching for changes...
```

✅ **依赖**: 正确链接到本地 foundry

```bash
npm ls @mdfriday/foundry
# 输出: @mdfriday/foundry@26.4.20 -> ./../foundry
```

## 技术要点总结

### 为什么不用 npm link？

`npm link` 在本项目中会导致问题：

1. **依赖扁平化冲突**: npm link 会改变依赖树结构，导致 80+ 个包被移除
2. **版本锁定**: 必须先 `npm link` 再 `npm install`，容易在后续的 `npm install` 中丢失链接
3. **构建问题**: foundry 的依赖（如 chokidar）可能与 friday-plugin 的依赖冲突

### file: 协议的优势

1. **依赖隔离**: foundry 的依赖保持在 foundry/node_modules 中
2. **实时更新**: 直接读取本地文件，foundry 重新构建后立即生效
3. **稳定性**: `npm install` 不会破坏这个引用关系

### externals 的作用

在 Obsidian Desktop 环境中：
- Node.js 内置模块（`fs`, `events`, `path` 等）由 Electron 提供
- 这些模块不应该被打包进插件代码
- 标记为 external 可以减小包体积，避免运行时冲突

## 下一步

现在可以：
1. **重新加载 Obsidian** 或热重载插件
2. **点击 Site.svelte 右上角的 "🤖 AI" 按钮**
3. **开始测试 Chat View 功能**

预期行为：
- Chat View 成功打开
- WikiService 正确初始化
- FridayWikiRuntime 创建成功
- 显示欢迎消息和命令提示
