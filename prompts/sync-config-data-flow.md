# Sync 配置数据流更新

## 更新日期
2026-03-23

## 背景

Foundry 26.3.16 版本更新后，`authService.getStatus()` 方法会返回 sync 配置信息。我们需要调整实现，确保 sync 配置也遵循"Foundry 为单一数据源"的原则。

## 更新内容

### 1. LicenseStateManager 新增 Sync 方法

**文件**: `src/services/licenseState.ts`

**新增方法**:

```typescript
/**
 * Check if sync is enabled and configured
 */
hasSyncConfig(): boolean {
  return this.authStatus?.hasSyncConfig || false;
}

/**
 * Get sync configuration from authStatus
 */
getSyncConfig(): any | null {
  if (!this.authStatus?.hasSyncConfig || !this.authStatus?.syncConfig) {
    return null;
  }
  return this.authStatus.syncConfig;
}

/**
 * Check if sync is active
 */
isSyncActive(): boolean {
  const syncConfig = this.getSyncConfig();
  return syncConfig?.isActive || false;
}

/**
 * Get CouchDB endpoint from sync config
 */
getSyncDbEndpoint(): string | null {
  const syncConfig = this.getSyncConfig();
  return syncConfig?.dbEndpoint || null;
}

/**
 * Get CouchDB database name from sync config
 */
getSyncDbName(): string | null {
  const syncConfig = this.getSyncConfig();
  return syncConfig?.dbName || null;
}

/**
 * Get sync email from sync config
 */
getSyncEmail(): string | null {
  const syncConfig = this.getSyncConfig();
  return syncConfig?.email || null;
}

/**
 * Get user directory from sync config
 */
getSyncUserDir(): string | null {
  const syncConfig = this.getSyncConfig();
  return syncConfig?.userDir || this.getUserDir();
}
```

### 2. 更新 syncLicenseToSettings()

**文件**: `src/main.ts`

**变更**: 添加 sync 配置同步逻辑

```typescript
// Update sync config data (for UI display)
// Sync config comes from authService.getStatus() in Foundry 26.3.16+
if (this.licenseState.hasSyncConfig()) {
  const syncConfig = this.licenseState.getSyncConfig();
  if (syncConfig) {
    this.settings.licenseSync = {
      enabled: true,
      endpoint: syncConfig.dbEndpoint,
      dbName: syncConfig.dbName,
      email: syncConfig.email,
      dbPassword: syncConfig.dbPassword || ''
    };
    console.log('[Friday] Synced sync config to settings:', {
      dbName: syncConfig.dbName,
      email: syncConfig.email,
      userDir: syncConfig.userDir,
      isActive: syncConfig.isActive
    });
  }
}
```

### 3. 更新 activateLicense() 方法

**文件**: `src/main.ts`

**变更**: 使用 licenseState 获取 sync 配置

**之前**:
```typescript
// Step 5: Configure sync if enabled
if (licenseInfo.sync && licenseInfo.features.syncEnabled) {
  this.plugin.settings.licenseSync = {
    enabled: true,
    endpoint: licenseInfo.sync.dbEndpoint,
    dbName: licenseInfo.sync.dbName,
    email: licenseInfo.sync.email,
    dbPassword: licenseInfo.sync.dbPassword
  };
  // ...
}
```

**之后**:
```typescript
// Step 4: Sync to settings (for UI display only)
// This includes license, user, and sync config from Foundry
await this.plugin.syncLicenseToSettings();

// Step 5: Configure sync service if enabled
// Check if sync is enabled from licenseState (Foundry is the source of truth)
if (this.plugin.licenseState?.hasFeature('syncEnabled') && 
    this.plugin.licenseState.hasSyncConfig()) {
  
  const syncConfig = this.plugin.licenseState.getSyncConfig();
  if (syncConfig) {
    // Configure the actual sync config for SyncService
    this.plugin.settings.syncEnabled = true;
    this.plugin.settings.syncConfig = {
      ...this.plugin.settings.syncConfig,
      couchDB_URI: syncConfig.dbEndpoint.replace(`/${syncConfig.dbName}`, ''),
      couchDB_DBNAME: syncConfig.dbName,
      couchDB_USER: syncConfig.email,
      couchDB_PASSWORD: syncConfig.dbPassword || '',
      encrypt: true,
      syncOnStart: true,
      syncOnSave: true,
      liveSync: true
    };
    // ...
  }
}
```

## Sync 配置数据流

### 数据来源

```
Foundry 26.3.16+
    ↓
authService.getStatus()
    ↓
返回 authStatus {
  isAuthenticated: boolean,
  license: string,
  email: string,
  hasSyncConfig: boolean,  ← 新增
  syncConfig: {            ← 新增
    dbEndpoint: string,
    dbName: string,
    email: string,
    dbPassword: string,
    userDir: string,
    status: string,
    isActive: boolean
  }
}
```

### 数据流向

```
激活 License:
  User Input
    ↓
  licenseService.loginWithLicense()
    ↓
  licenseService.activateLicense()
    ↓
  licenseState.initialize()
    → authService.getStatus() (包含 sync config)
    ↓
  syncLicenseToSettings()
    → 同步 sync config 到 settings.licenseSync (UI 缓存)
    → 配置 settings.syncConfig (SyncService 使用)
    ↓
  initializeSyncService() (首次激活)

查询 Sync 配置:
  UI Code
    ↓
  licenseState.hasSyncConfig()      ← 推荐
  licenseState.getSyncConfig()      ← 推荐
  licenseState.isSyncActive()       ← 推荐
    ↓
  authService.getStatus() (实时数据)

错误示例（不要这样做）:
  UI Code
    ↓
  this.settings.licenseSync          ← ❌ 不要用于判断！
    ↓
  可能是过期的缓存数据
```

## 数据存储职责

### ✅ Foundry Services (Single Source of Truth)

**authService.getStatus()** 现在返回:
- isAuthenticated
- license key
- email
- token
- **hasSyncConfig** (新增)
- **syncConfig** (新增)
  - dbEndpoint
  - dbName
  - email
  - dbPassword
  - userDir
  - status
  - isActive

**authService.getConfig()** 返回:
- apiUrl (企业服务器 URL)
- websiteUrl

**authService.updateConfig()** 保存:
- apiUrl (企业服务器 URL)
- websiteUrl

### ✅ LicenseStateManager (Unified Interface)

**提供统一的 Sync 查询接口**:
- `hasSyncConfig()` - 检查是否有 sync 配置
- `getSyncConfig()` - 获取完整 sync 配置
- `isSyncActive()` - 检查 sync 是否激活
- `getSyncDbEndpoint()` - 获取数据库端点
- `getSyncDbName()` - 获取数据库名称
- `getSyncEmail()` - 获取 sync 邮箱
- `getSyncUserDir()` - 获取用户目录

### ❌ Obsidian Settings (UI Display Only)

**settings.licenseSync** (仅用于 UI 显示):
```typescript
{
  enabled: boolean,
  endpoint: string,
  dbName: string,
  email: string,
  dbPassword: string
}
```

**settings.syncConfig** (SyncService 使用):
```typescript
{
  couchDB_URI: string,
  couchDB_DBNAME: string,
  couchDB_USER: string,
  couchDB_PASSWORD: string,
  encrypt: boolean,
  syncOnStart: boolean,
  syncOnSave: boolean,
  liveSync: boolean,
  passphrase: string,
  // ...
}
```

**settings.enterpriseServerUrl** (双向存储):
```typescript
string // 企业服务器 URL
```

注意：
- `enterpriseServerUrl` 在 UI 修改时会同时保存到：
  1. Obsidian settings (通过 `saveSettings()`)
  2. Foundry AuthService (通过 `authService.updateConfig()`)
- 加载时优先使用本地 settings，如果为空才从 Foundry 加载

## 代码示例

### ✅ 正确的用法

```typescript
// 1. 检查是否有 sync 配置
if (this.licenseState?.hasSyncConfig()) {
  // 有 sync 配置
}

// 2. 获取 sync 配置
const syncConfig = this.licenseState?.getSyncConfig();
if (syncConfig) {
  console.log('DB Name:', syncConfig.dbName);
  console.log('Email:', syncConfig.email);
}

// 3. 检查 sync 是否激活
if (this.licenseState?.isSyncActive()) {
  // Sync 已激活
}

// 4. 获取特定信息
const dbEndpoint = this.licenseState?.getSyncDbEndpoint();
const dbName = this.licenseState?.getSyncDbName();
const syncEmail = this.licenseState?.getSyncEmail();

// 5. 更新企业服务器 URL (在 UI onChange 中)
if (this.plugin.foundryAuthService && this.plugin.absWorkspacePath) {
  await this.plugin.foundryAuthService.updateConfig(
    this.plugin.absWorkspacePath,
    { apiUrl: newUrl }
  );
}

// 6. 加载企业服务器 URL (在初始化时)
const configResult = await this.foundryAuthService.getConfig(this.absWorkspacePath);
if (configResult.success && configResult.data?.apiUrl) {
  // Only load if local setting is empty (local has priority)
  if (!this.settings.enterpriseServerUrl) {
    this.settings.enterpriseServerUrl = configResult.data.apiUrl;
  }
}
```

### ❌ 错误的用法

```typescript
// ❌ 不要用 settings 进行逻辑判断
if (this.settings.licenseSync?.enabled) {
  // 可能是过期的缓存数据！
}

// ❌ 不要直接访问 settings 的 sync 配置
const dbName = this.settings.licenseSync?.dbName; // 错误！

// ❌ 不要忘记调用 updateConfig 保存企业服务器 URL
this.settings.enterpriseServerUrl = newUrl; // 不够！需要同时调用 updateConfig
```

## 优势

### 1. 单一数据源
- ✅ Sync 配置也从 Foundry 获取
- ✅ 消除 sync 配置的数据不一致问题
- ✅ 不再需要手动管理 sync 配置

### 2. 实时同步
- ✅ 通过 `authService.getStatus()` 获取最新 sync 状态
- ✅ 支持 sync 配置的动态更新
- ✅ 多设备间配置自动同步

### 3. 简化代码
- ✅ 统一的查询接口 `licenseState.getSyncConfig()`
- ✅ 不再需要从多个地方读取 sync 配置
- ✅ 减少代码复杂度

### 4. 向后兼容
- ✅ `settings.licenseSync` 保留用于 UI 显示
- ✅ `settings.syncConfig` 保留给 SyncService 使用
- ✅ 现有 UI 不受影响

## 数据更新时机

### 自动更新
1. **插件加载时**: `licenseState.initialize()` 自动获取 sync 配置
2. **License 激活时**: `activateLicense()` 后自动刷新
3. **手动刷新时**: `licenseState.refresh()` 重新获取

### 同步到 Settings
- 通过 `syncLicenseToSettings()` 同步到 Obsidian settings
- **仅用于 UI 显示**，不用于逻辑判断
- 不调用 `saveSettings()`，只是内存缓存

## 测试要点

### 功能测试
- [ ] License 激活后 sync 配置正确获取
- [ ] `licenseState.hasSyncConfig()` 正确返回
- [ ] `licenseState.getSyncConfig()` 返回完整配置
- [ ] `settings.licenseSync` 正确同步（UI 显示）
- [ ] `settings.syncConfig` 正确配置（SyncService 使用）
- [ ] Sync 功能正常工作

### 数据一致性测试
- [ ] 多次调用 `getSyncConfig()` 返回一致
- [ ] 刷新后配置正确更新
- [ ] 多设备间配置同步正确

## 总结

这次更新完善了 Sync 配置和企业服务器 URL 的数据流，使其完全符合"Foundry 为单一数据源"的架构原则：

1. **✅ Sync 配置来自 Foundry**: 通过 `authService.getStatus()` 获取
2. **✅ LicenseState 统一管理**: 提供一致的查询接口
3. **✅ Settings 仅用于显示**: 不用于逻辑判断
4. **✅ 数据流清晰**: Foundry → LicenseState → Settings → UI
5. **✅ 企业服务器 URL 双向存储**: UI 修改时调用 `authService.updateConfig()` 同步到 Foundry

这确保了 Sync 配置和企业服务器配置的数据一致性和实时性，简化了代码逻辑，提高了系统的可维护性。

## 企业服务器 URL 数据流

### 保存流程 (UI → Foundry)

```
用户在 Settings UI 修改
    ↓
onChange handler
    ↓
1. this.settings.enterpriseServerUrl = newValue
2. await this.saveSettings()
    ↓
3. await authService.updateConfig(workspace, { apiUrl: newValue })
    ↓
保存到两处:
- Obsidian: .obsidian/plugins/friday-plugin/data.json
- Foundry: workspace/.mdfriday/user-data.json
```

### 加载流程 (Foundry → Settings)

```
插件初始化
    ↓
await authService.getConfig(workspace)
    ↓
检查本地 settings.enterpriseServerUrl
    ↓
如果为空 → 使用 Foundry 的 apiUrl
如果不为空 → 保持本地值（本地优先）
    ↓
显示在 Settings UI
```

### 优先级规则

1. **本地 settings 优先**: 如果 `settings.enterpriseServerUrl` 已有值，不覆盖
2. **Foundry 作为备份**: 本地为空时，从 Foundry 加载
3. **双向同步**: UI 修改时同步到 Foundry
4. **多设备同步**: Foundry 中的配置可以在多设备间共享
