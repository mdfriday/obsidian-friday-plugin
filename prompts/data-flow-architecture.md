# 数据存储规则与数据流架构

## 概述

重构后的数据架构遵循**单一数据源**原则，明确了各种数据的存储位置和访问方式。

## 数据存储架构

```
┌─────────────────────────────────────────────────────────────┐
│                    Foundry Services                          │
│                   (Single Source of Truth)                   │
│                                                              │
│  ┌────────────────┐  ┌────────────────┐  ┌───────────────┐ │
│  │  AuthService   │  │ LicenseService │  │ DomainService │ │
│  │                │  │                │  │               │ │
│  │ • Server URL   │  │ • License Key  │  │ • Subdomain   │ │
│  │ • Token        │  │ • Plan         │  │ • Custom      │ │
│  │ • Email        │  │ • Features     │  │   Domain      │ │
│  │ • Auth Status  │  │ • Expires      │  │               │ │
│  └────────────────┘  └────────────────┘  └───────────────┘ │
└─────────────────────────────────────────────────────────────┘
           │                      │                    │
           │                      ▼                    │
           │          ┌───────────────────────┐       │
           │          │  LicenseStateManager  │       │
           │          │  (Unified Interface)  │       │
           │          └───────────────────────┘       │
           │                      │                    │
           └──────────────────────┴────────────────────┘
                                 │
        ┌────────────────────────┼────────────────────────┐
        │                        │                        │
        ▼                        ▼                        ▼
┌───────────────┐     ┌──────────────────┐     ┌──────────────┐
│ Global Config │     │  Obsidian        │     │  UI Display  │
│ (Defaults)    │     │  Settings        │     │              │
│               │     │  (UI Cache)      │     │              │
│ • FTP         │     │                  │     │ • Settings   │
│ • Netlify     │     │ • license*       │     │   Tab        │
│ • Publish     │     │ • licenseUser*   │     │ • Publish    │
│   Method      │     │ • licenseSync*   │     │   Panel      │
│               │     │ • (For UI only)  │     │              │
└───────────────┘     └──────────────────┘     └──────────────┘

* = For UI display only, not for logic decisions
```

## 数据存储规则

### ✅ Foundry Services（单一数据源）

#### 1. AuthService
- **存储位置**: `workspace/.mdfriday/user-data.json`
- **管理数据**:
  - Server URL (apiUrl, websiteUrl) - **企业服务器 URL**
  - Authentication Token
  - User Email
  - Authentication Status
  - Sync Config (Foundry 26.3.16+)
- **访问方式**:
  - `authService.getConfig()` - 获取服务器配置
  - `authService.getStatus()` - 获取认证状态（包含 sync config）
  - `authService.updateConfig()` - 更新服务器配置
- **UI 集成**:
  - Settings UI 修改企业服务器 URL 时需调用 `updateConfig()`
  - 插件初始化时从 `getConfig()` 加载企业服务器 URL
  - 本地 settings 优先（仅在为空时从 Foundry 加载）

#### 2. LicenseService
- **存储位置**: `workspace/.mdfriday/user-data.json`
- **管理数据**:
  - License Key
  - Plan (free/pro/enterprise)
  - Features (syncEnabled, customDomain, etc.)
  - Expiration Date
  - Trial Status
- **访问方式**:
  - `licenseService.getLicenseInfo()` - 获取 license 详情
  - `licenseService.activateLicense()` - 激活 license
  - `licenseService.getLicenseUsage()` - 获取使用量
  - **推荐**: 通过 `licenseState` 统一访问

#### 3. DomainService
- **存储位置**: `workspace/.mdfriday/user-data.json` + 服务器端
- **管理数据**:
  - Subdomain
  - Custom Domain
  - HTTPS Status
- **访问方式**:
  - `domainService.getDomainInfo()` - 获取域名信息
  - `domainService.updateSubdomain()` - 更新子域名
  - `domainService.addCustomDomain()` - 添加自定义域名
  - **推荐**: 通过 `licenseState` 统一访问

#### 4. LicenseStateManager（推荐）
- **作用**: 统一的 license 状态管理接口
- **数据来源**: 整合 AuthService + LicenseService + DomainService
- **访问方式**:
  ```typescript
  // 检查激活状态
  licenseState.isActivated()
  licenseState.isExpired()
  
  // 获取 license 信息
  licenseState.getLicenseKey()
  licenseState.getPlan()
  licenseState.hasFeature('syncEnabled')
  
  // 获取用户信息
  licenseState.getEmail()
  licenseState.getUserDir()
  
  // 获取 sync 配置（Foundry 26.3.16+）
  licenseState.hasSyncConfig()
  licenseState.getSyncConfig()
  licenseState.isSyncActive()
  licenseState.getSyncDbEndpoint()
  licenseState.getSyncDbName()
  licenseState.getSyncEmail()
  licenseState.getSyncUserDir()
  
  // 获取域名信息
  licenseState.getSubdomain()
  licenseState.getCustomDomain()
  
  // 刷新状态
  licenseState.refresh()
  ```

### ✅ Global Config（默认发布配置）

- **存储位置**: `workspace/.mdfriday/config.json`
- **用途**: 存储**默认的**发布配置，作为新建项目的模板
- **存储内容**:
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
      "method": "ftp"
    },
    "site": {
      "downloadServer": "global"
    }
  }
  ```
- **访问方式**:
  - 保存: `saveSettingsToFoundryGlobalConfig()`
  - 加载: `loadSettingsFromFoundryGlobalConfig()`
- **注意**: 
  - ❌ 不存储 domain 设置
  - ❌ 不存储 auth 配置
  - ❌ 不存储 license 数据

### ✅ Project Config（项目级发布配置）

- **存储位置**: `workspace/projects/<project-name>/hugo.json`
- **用途**: 每个项目可以有自己的发布配置
- **存储内容**:
  ```json
  {
    "baseURL": "/",
    "title": "My Site",
    "publish": {
      "method": "netlify",
      "netlify": {
        "accessToken": "...",
        "siteId": "..."
      }
    }
  }
  ```
- **优先级**: Project Config > Global Config
- **访问方式**: `foundryProjectConfigService`

### ❌ Obsidian Settings（仅用于 UI 显示）

- **存储位置**: `.obsidian/plugins/mdfriday/data.json`
- **用途**: **仅用于 UI 快速显示**，不用于逻辑判断
- **存储内容**:
  ```typescript
  {
    // License 相关（从 licenseState 同步，仅用于显示）
    license: StoredLicenseData | null,     // ⚠️ For UI only
    licenseUser: StoredUserData | null,    // ⚠️ For UI only
    licenseSync: StoredSyncData | null,    // ⚠️ For UI only (Foundry 26.3.16+)
    licenseUsage: StoredUsageData | null,  // ⚠️ For UI only
    
    // 企业服务器 URL（双向存储）
    enterpriseServerUrl: string,           // ⚠️ Also saved to Foundry via updateConfig()
    
    // 发布配置（默认值，可被 Global/Project Config 覆盖）
    ftpServer: string,
    ftpUsername: string,
    ftpPassword: string,
    // ...
    
    // UI 状态
    syncEnabled: boolean,
    encryptionPassphrase: string,
    // ...
  }
  ```
- **重要原则**:
  - ✅ 可以用于 UI 快速显示
  - ❌ **不能用于逻辑判断**（如权限检查、激活状态检查）
  - ✅ 通过 `syncLicenseToSettings()` 从 `licenseState` 同步

## 数据流规则

### 1. License 数据流

```
激活流程:
User Input (License Key)
    ↓
licenseService.loginWithLicense()
    ↓
licenseService.activateLicense()
    ↓
licenseState.initialize()  ← 从 Foundry Services 读取所有数据
    ↓
syncLicenseToSettings()    ← 同步到 settings（仅用于 UI）
    ↓
UI Display

查询流程:
UI Code
    ↓
licenseState.isActivated()     ← 使用这个！
licenseState.hasFeature()      ← 使用这个！
    ↓
Foundry Services (实时数据)

错误示例（不要这样做）:
UI Code
    ↓
this.settings.license          ← ❌ 不要用于判断！
    ↓
可能是过期的缓存数据
```

### 2. Domain 数据流

```
获取域名:
UI Code
    ↓
licenseState.getSubdomain()      ← 推荐方式
licenseState.getCustomDomain()   ← 推荐方式
    ↓
DomainService.getDomainInfo()
    ↓
Foundry Services + Server API

更新域名:
User Input
    ↓
domainService.updateSubdomain()
    ↓
Server API
    ↓
licenseState.refresh()           ← 刷新状态
    ↓
UI Update
```

### 3. 发布配置数据流

```
默认配置:
Settings UI
    ↓
this.settings.ftpServer = "..."
    ↓
saveSettings()
    ↓
saveSettingsToFoundryGlobalConfig()
    ↓
Global Config (作为新项目的默认值)

项目配置:
Project Settings UI
    ↓
foundryProjectConfigService.set()
    ↓
Project Config (覆盖 Global Config)
```

### 4. 企业服务器 URL 数据流（双向存储）

```
保存流程 (UI → Foundry):
Settings UI onChange
    ↓
1. this.settings.enterpriseServerUrl = newValue
2. await this.saveSettings()
    ↓
3. await authService.updateConfig(workspace, { apiUrl: newValue })
    ↓
双向保存:
- Obsidian: .obsidian/plugins/mdfriday/data.json
- Foundry: workspace/.mdfriday/user-data.json

加载流程 (Foundry → Settings):
插件初始化
    ↓
await authService.getConfig(workspace)
    ↓
检查 this.settings.enterpriseServerUrl
    ↓
如果为空 → 使用 Foundry 的 apiUrl
如果不为空 → 保持本地值（本地优先）
    ↓
显示在 Settings UI

优先级: 本地 settings > Foundry config
```

### 5. Sync 配置数据流（Foundry 26.3.16+）

```
获取 Sync 配置:
插件初始化 / License 激活
    ↓
licenseState.initialize()
    ↓
authService.getStatus(workspace)
    ↓
返回 authStatus {
  hasSyncConfig: boolean,
  syncConfig: {
    dbEndpoint, dbName, email,
    dbPassword, userDir, status, isActive
  }
}
    ↓
licenseState 缓存
    ↓
syncLicenseToSettings()
    ↓
this.settings.licenseSync (UI 缓存)
this.settings.syncConfig (SyncService 使用)

查询 Sync 配置:
UI Code
    ↓
licenseState.hasSyncConfig()      ← 推荐
licenseState.getSyncConfig()      ← 推荐
licenseState.isSyncActive()       ← 推荐
    ↓
authService.getStatus() (实时数据)
```

## 代码示例

### ✅ 正确的用法

```typescript
// 1. 检查 license 是否激活
if (this.licenseState?.isActivated() && !this.licenseState.isExpired()) {
  // License 有效
}

// 2. 检查功能权限
if (this.licenseState?.hasFeature('customSubDomain')) {
  // 有子域名权限
}

// 3. 获取域名
const subdomain = this.licenseState?.getSubdomain();
const customDomain = this.licenseState?.getCustomDomain();

// 4. 刷新 license 状态
await this.licenseState?.refresh();
await this.syncLicenseToSettings(); // 更新 UI 缓存
this.display(); // 刷新 UI

// 5. 获取 sync 配置（Foundry 26.3.16+）
if (this.licenseState?.hasSyncConfig()) {
  const syncConfig = this.licenseState.getSyncConfig();
  console.log('DB Name:', syncConfig.dbName);
  console.log('Is Active:', syncConfig.isActive);
}

// 6. 更新企业服务器 URL
if (this.foundryAuthService && this.absWorkspacePath) {
  await this.foundryAuthService.updateConfig(
    this.absWorkspacePath,
    { apiUrl: newUrl }
  );
  this.settings.enterpriseServerUrl = newUrl;
  await this.saveSettings();
}
```

### ❌ 错误的用法

```typescript
// ❌ 不要用 settings 进行逻辑判断
if (this.settings.license && !isLicenseExpired(this.settings.license.expiresAt)) {
  // 可能是过期的缓存数据！应该用 licenseState.isActivated()
}

// ❌ 不要用 settings 检查功能权限
if (this.settings.license?.features.customSubDomain) {
  // 数据可能不同步！应该用 licenseState.hasFeature('customSubDomain')
}

// ❌ 不要用 settings.licenseSync 进行判断
if (this.settings.licenseSync?.enabled) {
  // 错误！应该用 licenseState.hasSyncConfig()
}

// ❌ 不要忘记调用 updateConfig 保存企业服务器 URL
this.settings.enterpriseServerUrl = newUrl;
await this.saveSettings(); // 不够！还需要调用 authService.updateConfig()

// ❌ 不要手动保存 license 数据到 Global Config
await config.set(workspace, 'auth.userInfo.license', {...}); // 错误！
```

## 迁移指南

### 从旧代码迁移到新架构

#### 1. 替换激活状态检查

```typescript
// 旧代码
const license = this.plugin.settings.license;
if (license && !isLicenseExpired(license.expiresAt)) {
  // ...
}

// 新代码
if (this.plugin.licenseState?.isActivated() && 
    !this.plugin.licenseState.isExpired()) {
  // ...
}
```

#### 2. 替换功能权限检查

```typescript
// 旧代码
if (license?.features?.customSubDomain === true) {
  // ...
}

// 新代码
if (this.plugin.licenseState?.hasFeature('customSubDomain')) {
  // ...
}
```

#### 3. 替换刷新逻辑

```typescript
// 旧代码
await this.plugin.refreshLicenseInfo();
await this.plugin.refreshLicenseUsage();

// 新代码
await this.plugin.licenseState?.refresh();
await this.plugin.syncLicenseToSettings();
```

## 总结

### 核心原则

1. **Foundry Services = Single Source of Truth**
   - 所有 license、auth、domain 数据都从 Foundry 获取

2. **LicenseStateManager = Unified Interface**
   - 统一的访问接口，简化代码

3. **Global Config = Default Publish Settings**
   - 只存储默认的发布配置
   - 不存储 license/auth/domain 数据

4. **Obsidian Settings = UI Display Cache**
   - 仅用于 UI 快速显示
   - 不用于逻辑判断

5. **Clear Data Flow**
   - 单向数据流：Foundry → LicenseState → Settings → UI
   - 避免数据循环同步

### 优势

- ✅ 消除数据不一致问题
- ✅ 简化代码逻辑
- ✅ 便于维护和测试
- ✅ 支持多设备同步
- ✅ 实时状态更新
