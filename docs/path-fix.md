# 跨平台路径拼接修复

## 问题描述

在 Windows 环境下，由于使用字符串模板直接拼接路径（使用 `/`），导致路径混合使用 `\` 和 `/`，在实际文件操作时出现错误。

### 错误示例
```typescript
// 原始代码
const sourceFolderPath = `${basePath}/${folder.path}`;
const workspacePath = `${pluginDir}/workspace`;
```

在 Windows 下产生的路径：
```
D:\英语火箭计划/MDFriday/note/content/index.md
D:\英语火箭计划/.obsidian/plugins/mdfriday/workspace
```

## 解决方案

创建了两个跨平台路径拼接工具，并**使用 Obsidian 官方 API** 来规范化 vault 路径：

### 1. `joinPath()` - 文件系统绝对路径拼接

用于文件系统的绝对路径拼接，能够：

- **自动检测平台**：根据基础路径中是否包含 `\` 来判断是否为 Windows 路径
- **统一分隔符**：自动使用正确的路径分隔符（Windows 使用 `\`，Unix/Mac 使用 `/`）
- **规范化路径段**：移除多余的前后分隔符，统一内部分隔符
- **跨环境兼容**：无需依赖 Node.js 的 `path` 模块，可在浏览器和 Node.js 环境下使用

### 2. `joinVaultPath()` - Obsidian Vault 相对路径拼接

专门用于 Obsidian vault.adapter 的相对路径拼接，特点：

- **使用 Obsidian 官方 API**：内部使用 `normalizePath` from 'obsidian' 来规范化路径
- **强制使用 `/`**：Obsidian API 在所有平台都使用 `/` 作为路径分隔符
- **统一格式**：确保所有 vault 相对路径格式一致
- **官方维护**：由 Obsidian 团队维护，无需我们自己处理边界情况

```typescript
import { normalizePath } from 'obsidian';

export function joinVaultPath(basePath: string, ...segments: string[]): string {
	const allParts = [basePath, ...segments].filter(Boolean);
	const joined = allParts.join('/');
	
	// 使用 Obsidian 官方 API 规范化路径
	return normalizePath(joined);
}
```

## 修改文件

### 1. **src/utils/path.ts** ⭐ 新文件
使用 Obsidian 官方 API 的路径工具：
- `joinPath(basePath, ...segments)` - 跨平台文件系统路径拼接
- `joinVaultPath(basePath, ...segments)` - 使用 Obsidian `normalizePath` 的 vault 路径拼接

### 2. **src/utils/common.ts**
重新导出路径工具函数，保持向后兼容：
```typescript
export { joinPath, joinVaultPath } from './path';
```

### 3. **src/services/project.ts**
修复创建项目时的路径拼接（第 46, 50 行）
```typescript
// 修复前
const sourceFolderPath = `${basePath}/${folder.path}`;

// 修复后
const sourceFolderPath = joinPath(basePath, folder.path);
```

### 4. **src/main.ts**
修复三处路径拼接：
- **第 202 行**：Desktop 环境绝对路径
  ```typescript
  this.absWorkspacePath = joinPath(basePath, this.pluginDir, 'workspace');
  ```
- **第 208 行**：Mobile 环境相对路径（使用 Obsidian API）
  ```typescript
  this.absWorkspacePath = joinVaultPath(this.pluginDir, 'workspace');
  ```
- **第 483 行**：Desktop 环境的 vault 相对路径
  ```typescript
  const relativeWorkspacePath = joinVaultPath(this.pluginDir, 'workspace');
  ```

### 5. **src/services/obsidian-mobile-repositories.ts**
修复 Mobile Repository 中的所有路径拼接：
- **getWorkspacePath()** 方法（第 82 行）
- **normalizePath()** 方法（第 159, 176, 184, 189 行）

## 使用示例

### 文件系统路径（joinPath）

```typescript
// Unix/Mac
joinPath('/Users/name/vault', 'folder', 'file.md')
// => '/Users/name/vault/folder/file.md'

// Windows
joinPath('D:\\vault', 'folder', 'file.md')
// => 'D:\\vault\\folder\\file.md'

// 混合分隔符也能正确处理
joinPath('D:\\vault', 'folder/subfolder', 'file.md')
// => 'D:\\vault\\folder\\subfolder\\file.md'
```

### Vault 相对路径（joinVaultPath + Obsidian API）

```typescript
// 所有平台都使用 / （由 Obsidian normalizePath 保证）
joinVaultPath('.obsidian/plugins/mdfriday', 'workspace')
// => '.obsidian/plugins/mdfriday/workspace'

joinVaultPath('workspace', 'projects', 'my-site')
// => 'workspace/projects/my-site'

// 即使输入包含 \，也会被 Obsidian API 规范化为 /
joinVaultPath('.obsidian\\plugins\\mdfriday', 'workspace')
// => '.obsidian/plugins/mdfriday/workspace'
```

## 路径类型说明

| 路径类型 | 使用场景 | 使用函数 | 底层实现 | 分隔符 |
|---------|---------|---------|---------|--------|
| 文件系统绝对路径 | Desktop 环境文件操作 | `joinPath()` | 自定义实现 | 平台自动检测（`\` 或 `/`）|
| Vault 相对路径 | vault.adapter API | `joinVaultPath()` | **Obsidian `normalizePath`** | 强制 `/` |
| URL 路径 | 网络请求 | 直接使用 `/` | - | 固定 `/` |

## 为什么使用 Obsidian API？

✅ **官方维护**：由 Obsidian 团队维护，与 API 行为保持一致  
✅ **减少维护**：无需自己处理各种边界情况  
✅ **最佳实践**：符合 Obsidian 插件开发规范  
✅ **功能完整**：`normalizePath` 还能处理 `.` 和 `..` 等特殊路径  
✅ **类型安全**：TypeScript 类型定义完善  

## 测试验证

- ✅ 构建成功
- ✅ 无 linter 错误
- ✅ 兼容 Node.js 和浏览器环境
- ✅ 自动检测平台类型
- ✅ Mobile 和 Desktop 环境都适配
- ✅ 使用 Obsidian 官方 API

## 预期效果

### Windows 文件系统路径
```
修复前: D:\英语火箭计划/MDFriday/note/content/index.md
修复后: D:\英语火箭计划\MDFriday\note\content\index.md
```

### Obsidian Vault 路径（所有平台，由 Obsidian API 保证）
```
.obsidian/plugins/mdfriday/workspace
.obsidian/plugins/mdfriday/workspace/projects/index
```

所有路径分隔符统一为平台对应的格式，避免混合使用导致的文件操作错误。

## 注意事项

1. **URL 路径无需修改**：网络请求中的 URL 路径（如 `${apiUrl}/api/counter`）继续使用 `/`，这是正确的
2. **日志输出无需修改**：日志中的字符串插值（如 `${file.path}`）无需修改
3. **Obsidian API 约定**：vault.adapter 在所有平台都使用 `/`，必须使用 `joinVaultPath()`
4. **官方 API 优先**：对于 vault 路径，优先使用 Obsidian 的 `normalizePath` API
5. **可以直接使用**：你也可以直接导入使用 `import { normalizePath } from 'obsidian'`

## 相关 Obsidian API

- `normalizePath(path: string): string` - 规范化路径，统一使用 `/` 分隔符
- `getLinkpath(linktext: string): string` - 获取链接路径

详见：https://github.com/obsidianmd/obsidian-api
