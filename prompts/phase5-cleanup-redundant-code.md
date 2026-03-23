# Phase 5: 移除冗余代码 - 实施总结

## 实施日期
2026-03-23

## 背景

在实施 License State 重构后，发现 Global Config (`workspace/.mdfriday/config.json`) 中仍然存在不应该存在的 `auth.userInfo` 配置，这是因为历史遗留代码 `syncLicenseInfoToAuth()` 仍在将 auth 和 license 信息写入 Global Config。

根据重构原则，auth 和 license 数据应该由 Foundry Services 管理，而不是保存在 Global Config 中。

## 问题分析

### Global Config 中的数据

```json
{
  "publish": {
    "mdfriday": {
      "licenseKey": "MDF-6PQP-LHR6-9SCH",  // ✅ 应该保留
      "type": "share",
      "enabled": true
    }
  },
  "auth": {  // ❌ 不应该存在
    "userInfo": {
      "serverConfig": { ... },
      "token": { ... },
      "license": { ... },
      "email": "..."
    }
  }
}
```

### 根本原因

**`LicenseServiceManager.syncLicenseInfoToAuth()` 方法**:
- **位置**: `src/services/license.ts:184-245`
- **问题**: 将 auth 和 license 信息写入 Global Config
- **调用时机**:
  - License 激活时 (`activateLicense()`)
  - 申请试用 License 时 (`requestTrial()`)

## 清理内容

### 1. 移除 `syncLicenseInfoToAuth()` 方法

**文件**: `src/services/license.ts`

**删除的代码**:
```typescript
/**
 * Sync license info to auth user data
 * This stores license information in the auth workspace structure
 */
private async syncLicenseInfoToAuth(): Promise<void> {
  // ... 60+ lines of code
  await this.globalConfigService.set(
    this.workspacePath,
    'auth.userInfo',
    authUserInfo  // ← 将 auth/license 数据写入 Global Config
  );
}
```

**影响**: 不再将 auth/license 数据写入 Global Config

### 2. 更新 `requestTrial()` 方法

**文件**: `src/services/license.ts`

**变更前**:
```typescript
// Save license key to global config for MDFriday publishing
if (result.data.key) {
  await this.saveLicenseKeyToConfig(result.data.key);
  console.log('[Friday] Trial license key saved to global config');
}

// Get full license info and save to auth user info
await this.syncLicenseInfoToAuth();  // ← 移除
```

**变更后**:
```typescript
// Save license key to global config for MDFriday publishing
if (result.data.key) {
  await this.saveLicenseKeyToConfig(result.data.key);
  console.log('[Friday] Trial license key saved to global config');
}

// Note: Auth and license data are now managed by Foundry Services
// No need to manually sync - use licenseState.initialize() to refresh
```

### 3. 更新 `activateLicense()` 方法

**文件**: `src/services/license.ts`

**变更前**:
```typescript
// Save license key to global config
await this.saveLicenseKeyToConfig(licenseKey);
console.log('[Friday] License key saved to global config');

// Sync license info to auth
await this.syncLicenseInfoToAuth();  // ← 移除
```

**变更后**:
```typescript
// Save license key to global config for MDFriday publishing
await this.saveLicenseKeyToConfig(licenseKey);
console.log('[Friday] License key saved to global config');

// Note: Auth and license data are now managed by Foundry Services
// No need to manually sync - use licenseState.initialize() to refresh
```

### 4. 增强 `saveLicenseKeyToConfig()` 注释

**文件**: `src/services/license.ts`

**添加详细注释说明**:
```typescript
/**
 * Save license key to global config for MDFriday publishing
 * This is the ONLY data that should be saved to global config from license service
 * 
 * Purpose: Stores default license key for MDFriday publishing method
 * Location: workspace/.mdfriday/config.json under publish.mdfriday
 * 
 * Note: All other license/auth data is managed by Foundry Services in user-data.json
 */
private async saveLicenseKeyToConfig(licenseKey: string): Promise<void> {
  // ...
}
```

### 5. 移除 `refreshLicenseInfo()` 方法

**文件**: `src/main.ts`

**删除的方法**:
```typescript
/**
 * Refresh license information from API
 * Called when user clicks on plan badge in settings
 */
async refreshLicenseInfo(): Promise<void> {
  // ... 40+ lines of code
  // 手动从 API 获取并更新 settings.license
}
```

**替代方案**: 使用 `licenseState.refresh()` + `syncLicenseToSettings()`

## 数据流对比

### 变更前（存在问题）

```
License 激活
    ↓
licenseServiceManager.activateLicense()
    ↓
saveLicenseKeyToConfig()       ← ✅ 保存发布配置
    ↓
syncLicenseInfoToAuth()        ← ❌ 保存 auth/license 到 Global Config
    ↓
globalConfigService.set('auth.userInfo', {...})
    ↓
写入 workspace/.mdfriday/config.json
```

### 变更后（符合架构）

```
License 激活
    ↓
licenseServiceManager.activateLicense()
    ↓
saveLicenseKeyToConfig()       ← ✅ 保存发布配置到 Global Config
    ↓
licenseState.initialize()      ← ✅ 从 Foundry Services 获取数据
    ↓
Foundry Services
    ↓
workspace/.mdfriday/user-data.json  ← Auth/License 数据由 Foundry 管理
```

## Global Config 应有的数据结构

### ✅ 正确的结构

```json
{
  "publish": {
    "ftp": {
      "host": "...",
      "username": "...",
      "password": "...",
      "remotePath": "...",
      "ignoreCert": true
    },
    "netlify": {
      "accessToken": "...",
      "siteId": "..."
    },
    "mdfriday": {
      "licenseKey": "MDF-...",  // ← 发布配置，应该保留
      "type": "share",
      "enabled": true
    },
    "method": "mdfriday"
  },
  "site": {
    "downloadServer": "global"
  }
}
```

### ❌ 不应该存在的结构

```json
{
  "auth": {  // ← 不应该在 Global Config
    "userInfo": {
      "serverConfig": { ... },
      "token": { ... },
      "license": { ... },
      "email": "..."
    }
  }
}
```

## 数据管理职责

### ✅ Global Config (`config.json`) 管理

- FTP 默认配置
- Netlify 默认配置
- MDFriday 发布默认配置（包括 license key）
- 下载服务器设置
- 默认发布方法

### ✅ Foundry Services (`user-data.json`) 管理

- Auth 信息（token, email, server config）
- License 详细信息（plan, features, expires）
- Domain 信息（subdomain, custom domain）
- Sync 配置（db endpoint, db name, etc.）

### ✅ LicenseStateManager 管理

- 统一查询接口
- 数据缓存
- 状态刷新

### ❌ Obsidian Settings (`data.json`) 用途

- **仅用于 UI 显示**
- 不用于逻辑判断
- 数据来自 `syncLicenseToSettings()`

## 优势

### 1. 数据职责清晰

- ✅ Global Config 只存储发布相关的默认配置
- ✅ Auth/License 数据由 Foundry Services 独家管理
- ✅ 没有数据冗余和不一致

### 2. 简化维护

- ✅ 不需要手动同步 auth/license 数据
- ✅ Foundry Services 自动管理所有数据
- ✅ 减少了 60+ 行冗余代码

### 3. 符合架构原则

- ✅ Foundry 是单一数据源
- ✅ Settings 仅用于 UI 显示
- ✅ 数据流清晰明确

### 4. 避免数据污染

- ✅ Global Config 不再包含不应该存在的数据
- ✅ 数据来源和存储位置明确
- ✅ 便于调试和维护

## 迁移指南

### 对于现有用户

**旧的 Global Config 数据**:
- 现有的 `auth.userInfo` 数据不会自动删除
- 但不会再被读取或更新
- 数据会从 Foundry Services 获取

**建议操作**（可选）:
```bash
# 手动清理旧的 auth.userInfo 数据
cd workspace/.mdfriday
# 编辑 config.json，删除 auth.userInfo 部分
```

### 对于新用户

- 不会在 Global Config 中生成 `auth.userInfo`
- 所有 auth/license 数据由 Foundry Services 管理
- 无需任何额外操作

## 测试要点

### 功能测试

- [ ] License 激活后不会在 Global Config 生成 `auth.userInfo`
- [ ] License 激活后 `publish.mdfriday.licenseKey` 正确保存
- [ ] 申请试用后不会在 Global Config 生成 `auth.userInfo`
- [ ] `licenseState` 正确获取 auth/license 数据
- [ ] Settings UI 正确显示 license 信息
- [ ] 刷新功能正常工作（使用 `licenseState.refresh()`）

### 数据一致性测试

- [ ] Global Config 只包含发布配置
- [ ] Auth/License 数据从 Foundry Services 获取
- [ ] Settings 数据正确同步（仅用于显示）

### 回归测试

- [ ] 发布功能正常工作
- [ ] License 管理功能正常工作
- [ ] Sync 功能正常工作
- [ ] Domain 管理功能正常工作

## 相关文档

- `prompts/license-state-refactor.md` - License State 重构方案
- `prompts/license-state-implementation-summary.md` - 实施总结（Phase 1-4）
- `prompts/data-flow-architecture.md` - 数据流架构文档
- `prompts/sync-config-data-flow.md` - Sync 配置数据流文档

## 总结

这次清理工作完成了 **Phase 5: 移除冗余代码**，彻底解决了 Global Config 数据污染的问题：

1. ✅ 移除了 `syncLicenseInfoToAuth()` 方法（60+ 行冗余代码）
2. ✅ 移除了 `refreshLicenseInfo()` 方法（40+ 行冗余代码）
3. ✅ 更新了注释说明数据管理职责
4. ✅ 确保 Global Config 只存储发布相关的默认配置
5. ✅ Auth/License 数据完全由 Foundry Services 管理

**核心原则得到彻底贯彻**:
- Foundry Services = 单一数据源
- LicenseStateManager = 统一查询接口
- Settings = 仅用于 UI 显示
- Global Config = 仅存储发布默认配置

数据流清晰、职责明确、易于维护！
