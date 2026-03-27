# Foundry项目管理模态框

## 概述

这是一个基于 Obsidian 原生 `SuggestModal` 的项目管理界面，用于快速搜索、选择和管理 Foundry 项目。

## 功能特性

### 1. 快速搜索
- 使用 Obsidian 原生的 `SuggestModal` 实现
- 支持按项目名称实时搜索
- 键盘导航友好（↑↓ 导航，Enter 选择，Esc 关闭）

### 2. 项目列表显示
- 每行显示项目名称
- 右对齐的删除按钮（垃圾桶图标）
- 清晰的视觉反馈（悬停和选中状态）

### 3. 应用项目配置
- 选中项目后，自动将项目配置应用到右侧面板
- 遵循现有的事件驱动架构
- 与 `openPublishPanel` 使用相同的配置流程
- 自动展开右侧面板

### 4. 删除项目
- 点击垃圾桶图标删除项目
- 带确认对话框，防止误删
- 删除时同时删除项目文件（`deleteFiles: true`）
- 删除后自动更新列表

## 使用方式

1. 点击左侧 Ribbon 栏的骰子图标（🎲）
2. 在弹出的搜索框中输入项目名称进行搜索
3. 使用键盘或鼠标选择项目
4. 选中后项目配置会自动应用到右侧面板
5. 点击项目右侧的垃圾桶图标可删除项目

## 技术实现

### 架构设计

```
FoundryProjectManagementModal
├── 继承自 SuggestModal<ObsidianProjectInfo>
├── 项目列表加载（listProjects）
├── 搜索过滤（getSuggestions）
├── 自定义渲染（renderSuggestion）
├── 应用配置（applyProjectToPanel）
└── 删除项目（deleteProject + DeleteConfirmModal）
```

### 关键代码路径

#### 1. Modal 类定义
文件：`src/projects/foundryModal.ts`
- `FoundryProjectManagementModal`: 主模态框类
- `DeleteConfirmModal`: 删除确认对话框

#### 2. 样式定义
文件：`src/styles/project-modal.css`
- `.friday-project-suggestion`: 项目列表项样式
- `.friday-project-name`: 项目名称样式
- `.friday-project-delete`: 删除按钮样式
- `.modal-button-container`: 确认对话框按钮样式

#### 3. 主插件集成
文件：`src/main.ts`
- 动态导入 `FoundryProjectManagementModal`
- Ribbon 图标点击处理
- 存储 modal 类引用

### 配置应用流程

```typescript
// 1. 获取项目信息
const project = await this.plugin.foundryProjectService.listProjects()

// 2. 用户选择项目
onChooseSuggestion(project)
  ↓
// 3. 应用项目到面板
applyProjectToPanel(project)
  ↓
// 4. 展开右侧面板
rightSplit.expand()
  ↓
// 5. 设置初始化标志（防止自动保存）
this.plugin.isProjectInitializing = true
  ↓
// 6. 设置当前项目名
this.plugin.currentProjectName = project.name
  ↓
// 7. 从 contentLinks 加载内容（关键！）
loadProjectContents(project)
  - 遍历 project.contentLinks
  - 将 sourcePath 转换为 TFolder/TFile
  - 使用 initializeContentWithLanguage 初始化第一个内容
  - 使用 addLanguageContentWithCode 添加其他内容
  ↓
// 8. 获取项目配置
const config = await this.plugin.projectServiceManager.getConfig(project.name)
  ↓
// 9. 准备项目状态
const projectState = { name, folder: null, file: null, config, status: 'active' }
  ↓
// 10. 调用 Site.svelte 的 initialize 方法
this.plugin.siteComponent.initialize(projectState)
  - 加载站点名称、主题、sitePath
  - 加载发布方式（selectedPublishOption）
  - 应用语言配置（applyLanguageConfiguration）
  ↓
// 11. 重置初始化标志
this.plugin.isProjectInitializing = false
```

## 关键修复说明

### 内容、语言、发布方式应用问题

**问题描述**:
- 选中项目后，站点名称、主题、sitePath 可以正常应用
- 但内容（Content）、语言、发布方式没有应用成功
- 右键选中文件/文件夹时，所有配置都能正常应用

**根本原因**:
1. 项目信息 `ObsidianProjectInfo` 包含 `contentLinks` 数组，存储了项目的内容路径
2. 之前的实现直接调用 `site.initializeContent(null, null)`，创建空内容
3. `Site.svelte` 的 `applyLanguageConfiguration` 方法检查 `currentContents.length === 0` 时直接返回
4. 导致语言配置无法应用，进而影响内容显示

**解决方案**:

1. **添加 `loadProjectContents()` 方法**：从 `project.contentLinks` 恢复内容路径
2. **设置初始化标志**：`isProjectInitializing` 防止初始化时自动保存
3. **调用顺序**：先 `loadProjectContents()`，再 `siteComponent.initialize()`

**修复对比**:

| 项目 | 修复前 | 修复后 |
|-----|-------|-------|
| 内容初始化 | `initializeContent(null, null)` | `loadProjectContents()` 从 contentLinks 恢复 |
| currentContents | 空数组 | 包含实际内容路径 |
| 语言配置 | ❌ 无法应用 | ✅ 正确应用 |
| 发布方式 | ⚠️ 可能不正确 | ✅ 正确应用 |
| 内容显示 | ❌ 无内容 | ✅ 显示实际内容 |

### 删除流程

```typescript
// 1. 点击删除按钮
deleteProject(project)
  ↓
// 2. 显示确认对话框
confirmDelete(project.name)
  ↓
// 3. 用户确认后删除
this.plugin.foundryProjectService.deleteProject(
  workspacePath, 
  projectName, 
  { deleteFiles: true }
)
  ↓
// 4. 更新本地列表
this.projects = this.projects.filter(p => p.id !== project.id)
  ↓
// 5. 刷新 UI
this.inputEl.dispatchEvent(new Event('input'))
```

## 与现有架构的关系

### 事件驱动架构
- 遵循 Main.ts 作为控制器，Site.svelte 作为视图的架构
- 通过 `siteComponent.initialize()` 应用配置
- 使用 `ProjectState` 类型传递状态

### 与 openPublishPanel 的对比

| 特性 | openPublishPanel | FoundryProjectManagementModal (修复后) |
|------|------------------|----------------------------------------|
| 触发方式 | 右键菜单、命令面板 | Ribbon 图标 |
| 上下文 | 文件/文件夹 | 项目信息（ObsidianProjectInfo） |
| 内容来源 | 用户选择的 folder/file | project.contentLinks |
| 内容加载 | initializeContent(folder, file) | loadProjectContents() |
| 语言配置 | ✅ 正确应用 | ✅ 正确应用（修复后） |
| 发布方式 | ✅ 正确应用 | ✅ 正确应用（修复后） |
| 配置流程 | ✓ 事件驱动架构 | ✓ 事件驱动架构 |

## 样式定制

所有样式都使用 Obsidian CSS 变量，自动适配主题：

- `--background-modifier-hover`: 悬停背景色
- `--background-modifier-active-hover`: 选中背景色
- `--background-modifier-error`: 删除按钮悬停背景色
- `--text-normal`: 正常文本颜色
- `--text-muted`: 次要文本颜色
- `--text-error`: 错误文本颜色
- `--interactive-accent`: 主要操作按钮颜色

## 未来改进

1. **批量操作**: 支持选择多个项目进行批量删除
2. **项目重命名**: 在 modal 中直接重命名项目
3. **项目信息**: 显示更多项目元信息（创建时间、主题等）
4. **排序选项**: 支持按名称、时间等排序
5. **项目搜索**: 支持更高级的搜索选项（按主题、语言等）

## 测试建议

1. 创建多个项目，测试搜索功能
2. 选择项目，验证配置正确应用到面板
3. 删除项目，确认文件被正确删除
4. 测试键盘导航和快捷键
5. 测试在不同主题下的样式表现
