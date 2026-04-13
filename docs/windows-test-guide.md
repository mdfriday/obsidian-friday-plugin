# Windows 单文件项目测试指南

## 📦 已修复的问题

1. **路径分隔符统一**：`getVaultRelativePath()` 现在会将 Windows 的 `\` 转换为 Obsidian 需要的 `/`
2. **增强调试日志**：添加了详细的日志输出，帮助定位问题

## 🧪 测试步骤

### 1. 重新加载插件

在 Windows 的 Obsidian 中：
1. 打开设置 → 社区插件
2. 找到 Friday 插件
3. 关闭 → 重新开启
4. 或者直接使用 `Ctrl+R` 重新加载 Obsidian

### 2. 打开开发者控制台

按 `Ctrl+Shift+I` 打开开发者控制台

### 3. 删除旧的测试项目

**重要**：删除之前创建的测试项目，避免旧数据干扰：

1. 点击 Ribbon Icon（左侧边栏的 Friday 图标）
2. 找到测试项目 "1" 或其他单文件项目
3. 删除它
4. 关闭项目列表面板

### 4. 创建新的测试项目

1. 在文件浏览器中，右键点击一个 `.md` 文件
2. 选择 "添加到发布列表"
3. 立即查看控制台输出

### 5. 检查控制台日志

你应该看到类似这样的日志：

```javascript
// 📋 项目创建成功
{"level":"info","message":"Project created from file {...}"}

// 🔍 关键调试日志（我们添加的）
[Friday] loadExistingProjectContent - project name: "1"
[Friday] loadExistingProjectContent - project keys: ["name", "id", "path", ...]
[Friday] loadExistingProjectContent - hasContentLinks: false
[Friday] loadExistingProjectContent - hasFileLink: true/false  ← 关键！
[Friday] loadExistingProjectContent - hasStaticLink: false

// 📄 完整的项目对象
[Friday] loadExistingProjectContent - full project: {
  "name": "1",
  "id": "1-mnwieiy7",
  "path": "E:\\华为云盘\\...",
  "fileLink": {  ← 这个字段存在吗？
    "sourcePath": "E:\\华为云盘\\...",
    "languageCode": "en"
  },
  ...
}
```

## 🎯 关键检查点

### 检查点 1：fileLink 字段是否存在？

**场景 A：fileLink 存在**
```javascript
[Friday] loadExistingProjectContent - hasFileLink: true
[Friday] loadExistingProjectContent - full project: {
  ...,
  "fileLink": {
    "sourcePath": "E:\\华为云盘\\...",
    ...
  }
}
```

如果之后还显示 "File path not found"，那是路径转换的问题。

**场景 B：fileLink 不存在**
```javascript
[Friday] loadExistingProjectContent - hasFileLink: false
[Friday] loadExistingProjectContent - project keys: ["name", "id", "path"]  // 没有 fileLink
```

这说明 Foundry 在 Windows 上没有保存 fileLink 字段，需要检查 Foundry 库的问题。

### 检查点 2：如果有 fileLink，路径转换是否正确？

应该看到：
```javascript
[Friday] Processing fileLink: {
  sourcePath: "E:\\华为云盘\\海外运营\\sites\\books\\一人公司\\content\\docs\\1.md",
  relativePath: "sites/books/一人公司/content/docs/1.md"  ← 应该使用 /
}
```

**正确**：`relativePath` 使用 `/` 分隔符
**错误**：`relativePath` 使用 `\` 分隔符

### 检查点 3：文件是否找到？

**成功**：
```javascript
[Friday] Successfully loaded single file content
```

**失败**：
```javascript
[Friday] File path not found: E:\... (relative: sites\books\...)  ← 如果用 \，这是问题
```

## 🔍 手动检查配置文件

如果 fileLink 不存在，手动检查配置文件：

### 1. 找到配置文件路径

根据你的日志：
```
E:\华为云盘\海外运营\.obsidian\plugins\mdfriday\workspace\projects\1\config.json
```

### 2. 打开 config.json

用文本编辑器打开该文件，查看内容：

**正确的配置应该包含：**
```json
{
  "name": "1",
  "id": "1-mnwieiy7",
  "path": "E:\\华为云盘\\海外运营\\.obsidian\\plugins\\mdfriday\\workspace\\projects\\1",
  "language": "en",
  "fileLink": {
    "sourcePath": "E:\\华为云盘\\海外运营\\sites\\books\\一人公司\\content\\docs\\1.md",
    "languageCode": "en"
  }
}
```

**如果配置不包含 fileLink：**
```json
{
  "name": "1",
  "id": "1-mnwieiy7",
  "path": "E:\\华为云盘\\..."
  // ❌ 缺少 fileLink 字段
}
```

这说明 Foundry 在保存项目时出了问题。

## 📊 可能的结果

### 结果 1：路径分隔符问题（已修复）✅

**症状**：
- hasFileLink: true
- 但显示 "File path not found"
- relativePath 使用 `\`

**状态**：已通过修复 1 解决

### 结果 2：Foundry 没有保存 fileLink ❌

**症状**：
- hasFileLink: false
- project keys 里没有 "fileLink"
- config.json 也没有 fileLink 字段

**需要检查**：
1. Foundry 版本
2. 创建项目时的参数（`sourceFile` 有没有正确传递）
3. Foundry 在 Windows 上的保存逻辑

### 结果 3：字段名不同 ❌

**症状**：
- hasFileLink: false
- 但 project keys 里有 "file"、"sourceFile" 或其他类似字段

**需要调整**：代码中的字段名映射

## 📝 需要反馈的信息

请将以下信息完整复制给我：

1. **控制台完整日志**（从 "loadExistingProjectContent" 开始的所有日志）

2. **config.json 文件内容**
   - 路径：`E:\华为云盘\海外运营\.obsidian\plugins\mdfriday\workspace\projects\1\config.json`
   - 用文本编辑器打开，复制全部内容

3. **右侧面板的表现**
   - 多语言内容区域是否有显示？
   - 是否显示文件名？
   - 是否能看到内容？

## 🔧 临时解决方案

如果确认是 Foundry 的问题（fileLink 不存在），可以手动修改 config.json：

1. 关闭 Obsidian
2. 编辑 config.json，添加：
   ```json
   "fileLink": {
     "sourcePath": "E:\\华为云盘\\海外运营\\sites\\books\\一人公司\\content\\docs\\1.md",
     "languageCode": "en"
   }
   ```
3. 保存文件
4. 重新打开 Obsidian
5. 再次测试

## ⚠️ 注意事项

- Windows 路径在 JSON 中要使用 `\\`（双反斜杠转义）
- sourcePath 应该是完整的绝对路径
- languageCode 通常是 "en"、"zh" 等

## 🆚 与 macOS 对比

如果想对比，可以在 macOS 上创建同样的项目，然后查看 config.json 的内容，对比两者的差异。
