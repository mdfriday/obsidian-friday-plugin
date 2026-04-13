# 修复：右键选择单文件时多语言内容区域为空

## 🐛 问题描述

当用户右键选择单个 Markdown 文件并"添加到发布列表"时，右侧功能面板的"多语言内容"区域一直为空，只显示"内容已清空"提示。但通过 Ribbon Icon 打开项目管理面板选择同一项目时，内容却能正常显示。

## 🔍 问题根源

### 对比分析

**方式 1：右键选择文件 → 添加到发布列表（❌ 不显示）**
- 调用 `main.ts` 的 `loadExistingProjectContent()`
- 只处理 `project.contentLinks`（多语言文件夹）
- **缺少对 `project.fileLink`（单文件）的处理**

**方式 2：Ribbon Icon → 选择项目（✅ 正常显示）**
- 调用 `foundryModal.ts` 的 `loadProjectContents()`
- 同时处理 `project.contentLinks` 和 `project.fileLink`
- 能正确加载单文件项目

### 项目类型差异

Foundry 根据项目类型使用不同字段：

| 项目类型 | 使用字段 | 说明 |
|---------|---------|------|
| 单文件项目 | `fileLink` | 选择单个 .md 文件时 |
| 文件夹项目（单语言） | `contentLinks` | 选择文件夹时，通常 1 个条目 |
| 文件夹项目（多语言） | `contentLinks` | 如 content/ 和 content.zh/，多个条目 |

### 代码问题位置

**`src/main.ts` 第 1240 行：**

```typescript
// ❌ 修复前：缺少对 fileLink 的处理
private async loadExistingProjectContent(project: ObsidianProjectInfo) {
    // Load content links
    if (project.contentLinks && project.contentLinks.length > 0) {
        // 处理文件夹项目...
    }
    
    // ❌ 没有处理 project.fileLink
    
    // Load static link
    if (project.staticLink) {
        // 处理静态资源...
    }
}
```

## ✅ 解决方案

### 修改内容

在 `loadExistingProjectContent` 方法中添加对 `project.fileLink` 的处理，参考 `foundryModal.ts` 的正确实现：

```typescript
// ✅ 修复后：完整处理所有项目类型
private async loadExistingProjectContent(project: ObsidianProjectInfo) {
    let contentLoaded = false;
    
    // 1. 处理文件夹项目（contentLinks）
    if (project.contentLinks && project.contentLinks.length > 0) {
        for (let i = 0; i < project.contentLinks.length; i++) {
            // ... 加载多语言内容
        }
        contentLoaded = true;
    }
    
    // ✅ 2. 新增：处理单文件项目（fileLink）
    if (project.fileLink) {
        const relativePath = this.getVaultRelativePath(project.fileLink.sourcePath);
        const abstractFile = this.app.vault.getAbstractFileByPath(relativePath);
        
        if (abstractFile instanceof TFile && abstractFile.extension === 'md') {
            const language = project.language || 'en';
            this.site.initializeContentWithLanguage(
                null,
                abstractFile,
                language
            );
            contentLoaded = true;
        }
    }
    
    // 3. 添加警告日志
    if (!contentLoaded) {
        console.warn('[Friday] No content links or file link found in project');
    }
    
    // 4. 处理静态资源（staticLink）
    if (project.staticLink) {
        // ... 加载静态资源
    }
}
```

### 关键改进点

1. **✅ 添加 `fileLink` 处理**：检查并加载单文件项目
2. **✅ 使用项目语言配置**：`project.language` 或默认 'en'
3. **✅ 添加内容加载追踪**：`contentLoaded` 标志
4. **✅ 增强错误处理**：更详细的警告日志
5. **✅ 完善 staticLink 错误处理**：添加警告信息

## 📋 修改的文件

- `src/main.ts` - `loadExistingProjectContent()` 方法（第 1240-1291 行）

## 🎯 测试场景

修复后应该能正确处理以下场景：

| 场景 | 项目类型 | 预期结果 |
|------|---------|---------|
| ✅ 右键选择单个文件 | 单文件项目（fileLink） | 多语言内容显示文件 |
| ✅ 右键选择单语言文件夹 | 文件夹项目（1 个 contentLink） | 多语言内容显示 1 个条目 |
| ✅ 右键选择多语言文件夹 | 文件夹项目（多个 contentLinks） | 多语言内容显示多个条目 |
| ✅ Ribbon Icon 选择项目 | 任何类型 | 保持原有正常显示 |

## 🔧 构建验证

```bash
npm run build
# ✅ Build completed successfully
# ✅ No linter errors
```

## 📝 相关代码参考

- `src/projects/foundryModal.ts` - `loadProjectContents()` 方法（第 190-283 行）
  - 提供了正确处理 fileLink 的参考实现

## 💡 技术要点

### Foundry 项目数据结构

```typescript
interface ObsidianProjectInfo {
    name: string;
    path: string;
    
    // 文件夹项目（可能多语言）
    contentLinks?: Array<{
        sourcePath: string;      // 绝对路径
        languageCode: string;    // 如 'en', 'zh'
    }>;
    
    // 单文件项目
    fileLink?: {
        sourcePath: string;      // 绝对路径
    };
    
    // 单文件项目的语言配置
    language?: string;           // 默认 'en'
    
    // 静态资源文件夹
    staticLink?: {
        sourcePath: string;      // 绝对路径
    };
}
```

### 路径转换

```typescript
// 绝对路径 → Vault 相对路径
const relativePath = this.getVaultRelativePath(absolutePath);

// 通过相对路径获取文件/文件夹对象
const abstractFile = this.app.vault.getAbstractFileByPath(relativePath);
```

## 🎉 预期效果

修复后，无论通过哪种方式打开项目：
1. ✅ 右键选择文件/文件夹 → 添加到发布列表
2. ✅ Ribbon Icon → 选择项目

都能正确显示"多语言内容"区域，不再出现内容为空的情况。
