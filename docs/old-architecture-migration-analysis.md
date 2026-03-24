# 旧架构回调迁移到新架构分析

## 分析日期
2026-03-24

## 旧架构回调清单

### 1. `reloadFoundryProjectConfig`
**用途**: 重新加载 Foundry 项目配置到 UI
**调用位置**:
- `applyFoundryProjectToPanel` (已有 fallback)
- `loadExistingProject` (已有 fallback)

**新架构支持**: ✅ **已支持**
- 新架构: `this.siteComponent.initialize(projectState)`
- 已在 `applyFoundryProjectToPanel` 中实现，有 fallback

**行动**: 🗑️ **删除** - 已完全被新架构替代

---

### 2. `applyProjectConfigurationToPanel`
**用途**: 应用项目配置到面板（ProjectConfig 格式）
**调用位置**:
- `applyExistingProjectToPanel` (line 1355)
- `showProjectManagementModal` (line 337-341) - 传递给 modal
- 
**新架构支持**: ⚠️ **部分支持**
- 新架构: `this.siteComponent.initialize(projectState)` 使用 `ProjectState` 格式
- 旧方法使用 `ProjectConfig` 格式（来自 `src/projects/types.ts`）

**区别**:
```typescript
// 旧格式 (ProjectConfig)
interface ProjectConfig {
    id: string;
    name: string;
    path: string;
    theme: string;
    // ... 更多字段
}

// 新格式 (ProjectState)
interface ProjectState {
    name: string;
    folder: TFolder | null;
    file: TFile | null;
    config: Record<string, any>;  // Foundry config
    status: string;
}
```

**行动**: 🔄 **需要迁移** - 统一使用 Foundry 项目格式

---

### 3. `exportHistoryBuild`
**用途**: 导出历史构建
**调用位置**:
- `showProjectManagementModal` (line 340) - 传递给 modal

**新架构支持**: ❌ **未支持**
- 这是项目管理功能的一部分
- 与历史构建相关

**行动**: ⏸️ **保留** - 项目管理功能重构时处理

---

### 4. `clearPreviewHistory`
**用途**: 清除预览历史
**调用位置**:
- `showProjectManagementModal` (line 341) - 传递给 modal

**新架构支持**: ❌ **未支持**
- 这是项目管理功能的一部分
- 与历史记录相关

**行动**: ⏸️ **保留** - 项目管理功能重构时处理

---

### 5. `setSitePath`
**用途**: 设置站点路径
**调用位置**:
- `handleQuickShareClick` (line 1640) - 快速分享功能

**新架构支持**: ⚠️ **需要添加到新架构**
- 应该作为 `siteComponent` 的 public 方法

**行动**: 🔄 **迁移到新架构** - 添加到 siteComponent 注册

---

### 6. `startPreviewAndWait`
**用途**: 启动预览并等待完成
**调用位置**:
- `handleQuickShareClick` (line 1648) - 快速分享功能

**新架构支持**: ⚠️ **需要调整**
- 新架构通过事件 `previewRequested` 处理预览
- 但这个方法需要等待完成并返回结果

**行动**: 🔄 **迁移到新架构** - 添加到 siteComponent 注册

---

### 7. `selectMDFShare`
**用途**: 选择 MDFriday Share 发布选项
**调用位置**:
- `handleQuickShareClick` (line 1635) - 快速分享功能

**新架构支持**: ⚠️ **需要添加到新架构**
- 应该作为 `siteComponent` 的 public 方法

**行动**: 🔄 **迁移到新架构** - 添加到 siteComponent 注册

---

### 8. `refreshLicenseState`
**用途**: 刷新 license 状态（激活后更新 UI）
**调用位置**:
- `FridaySettingTab.activateLicense` (line 4109) - license 激活后

**新架构支持**: ⚠️ **需要添加到新架构**
- 应该作为 `siteComponent` 的 public 方法

**行动**: 🔄 **迁移到新架构** - 添加到 siteComponent 注册

---

## 迁移策略

### Phase 1: 立即删除（已被新架构替代）
1. ✅ `reloadFoundryProjectConfig` - 删除所有引用和 fallback

### Phase 2: 迁移到新架构（简单方法）
这些方法已在 Site.svelte 中实现，只需要添加到 siteComponent 注册：

2. ✅ `setSitePath` - 添加到注册
3. ✅ `startPreviewAndWait` - 添加到注册
4. ✅ `selectMDFShare` - 添加到注册
5. ✅ `refreshLicenseState` - 添加到注册

### Phase 3: 项目管理功能重构（待定）
这些与 `src/projects` 相关，需要整体重构：

6. ⏸️ `applyProjectConfigurationToPanel` - 项目管理重构时处理
7. ⏸️ `exportHistoryBuild` - 项目管理重构时处理
8. ⏸️ `clearPreviewHistory` - 项目管理重构时处理

---

## 实施计划

### 步骤 1: 删除 reloadFoundryProjectConfig
- 删除属性定义
- 删除 Site.svelte 中的注册
- 删除 Main.ts 中的 fallback 调用

### 步骤 2: 迁移简单方法到新架构
- Site.svelte: 添加方法到 siteComponent 注册
- Main.ts: 修改调用从 `this.xxx()` 改为 `this.siteComponent.xxx()`
- Main.ts: 删除旧属性定义

### 步骤 3: 标记项目管理相关方法
- 添加注释说明这些方法将在项目管理重构时处理
- 暂时保留

---

## 预期结果

### 删除的回调（1个）
- `reloadFoundryProjectConfig`

### 迁移到新架构（4个）
- `setSitePath`
- `startPreviewAndWait`
- `selectMDFShare`
- `refreshLicenseState`

### 暂时保留（3个，项目管理相关）
- `applyProjectConfigurationToPanel`
- `exportHistoryBuild`
- `clearPreviewHistory`

---

## 新架构优势

### 统一的组件引用
```typescript
// 旧架构（分散的回调）
this.setSitePath(path);
this.selectMDFShare();
this.startPreviewAndWait();

// 新架构（统一的组件引用）
this.siteComponent.setSitePath(path);
this.siteComponent.selectMDFShare();
this.siteComponent.startPreviewAndWait();
```

### 类型安全
```typescript
// 旧架构
setSitePath: ((path: string) => void) | null = null

// 新架构
siteComponent: {
    setSitePath: (path: string) => void;
    // ... 所有方法都有类型定义
} | null
```

### 易于维护
- 所有 Site 组件方法集中在 siteComponent
- 不需要单独注册每个回调
- 清晰的职责划分
