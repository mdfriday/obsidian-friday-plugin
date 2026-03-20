# License Service 集成文档

## 概述

已成功将 Foundry 的 `ObsidianLicenseService` 集成到 Obsidian Friday 插件中，提供了完整的 License 管理功能，包括试用申请、激活、信息查询和使用监控。

## 文件结构

### 核心文件

- **`src/services/license.ts`**: License Service Manager 实现
  - `LicenseServiceManager` 类：封装所有 license 相关操作
  - 处理配置保存和同步逻辑
  - 提供统一的错误处理

- **`src/main.ts`**: 插件主文件
  - 初始化 Foundry License Service
  - 创建 LicenseServiceManager 实例
  - 提供简单的委托方法供外部调用

## 架构设计

### 分层结构

```
FridayPlugin (main.ts)
    ↓ (delegates to)
LicenseServiceManager (services/license.ts)
    ↓ (uses)
Foundry Services (ObsidianLicenseService, ObsidianAuthService, ObsidianGlobalConfigService)
```

### 职责划分

1. **`LicenseServiceManager`** (`services/license.ts`)
   - 封装所有 license 业务逻辑
   - 管理配置保存和同步
   - 处理错误和日志
   - 独立可测试

2. **`FridayPlugin`** (`main.ts`)
   - 初始化服务和依赖
   - 提供公共 API 接口
   - 保持向后兼容性

## 初始化

### 在 `main.ts` 中

```typescript
// 1. 导入
import { LicenseServiceManager } from './services/license';

// 2. 属性定义
foundryLicenseService?: ObsidianLicenseService | null
licenseServiceManager?: LicenseServiceManager | null

// 3. 初始化 (在 initializeWorkspace 方法中)
const identityHttpClient = createObsidianIdentityHttpClient();
this.foundryLicenseService = await createObsidianLicenseService(
    this.absWorkspacePath, 
    identityHttpClient
);

// 4. 创建 Manager
if (this.foundryLicenseService && this.foundryAuthService && this.foundryGlobalConfigService) {
    this.licenseServiceManager = new LicenseServiceManager(
        this.foundryLicenseService,
        this.foundryAuthService,
        this.foundryGlobalConfigService,
        this.absWorkspacePath
    );
}
```

## 核心方法 (services/license.ts)

### LicenseServiceManager 类

#### 构造函数

```typescript
constructor(
    private licenseService: ObsidianLicenseService,
    private authService: ObsidianAuthService,
    private globalConfigService: ObsidianGlobalConfigService,
    private workspacePath: string
)
```

## 公共 API (main.ts)

插件通过简单的委托方法暴露给外部使用：

#### 2.1 请求试用 License

```typescript
async requestTrialLicense(email: string): Promise<{ success: boolean; error?: string; data?: any }>
```

**内部实现**:
```typescript
async requestTrialLicense(email: string) {
    if (!this.licenseServiceManager) {
        return { success: false, error: 'License service not initialized' };
    }
    return await this.licenseServiceManager.requestTrial(email);
}
```

**功能**:
- 使用邮箱申请试用 License
- 自动保存 License Key 到 global config 的 `publish.mdfriday` 配置
- 自动同步 License 信息到 auth 用户数据

**保存的配置结构**:
```json
{
  "publish": {
    "mdfriday": {
      "licenseKey": "MDF-XXXX-XXXX-XXXX",
      "type": "share",
      "enabled": true
    }
  }
}
```

**使用示例**:
```typescript
const result = await this.plugin.requestTrialLicense('user@example.com');
if (result.success) {
    new Notice('Trial license activated!');
    console.log('License data:', result.data);
} else {
    new Notice(`Failed: ${result.error}`);
}
```

#### 2.2 激活 License

```typescript
async activateLicenseWithKey(licenseKey: string): Promise<{ success: boolean; error?: string; data?: any }>
```

**功能**:
- 使用 License Key 激活
- 保存到 global config
- 同步到 auth 用户数据

**使用示例**:
```typescript
const result = await this.plugin.activateLicenseWithKey('MDF-XXXX-XXXX-XXXX');
if (result.success) {
    new Notice('License activated successfully!');
} else {
    new Notice(`Activation failed: ${result.error}`);
}
```

#### 2.3 获取 License 信息

```typescript
async getFoundryLicenseInfo(): Promise<{ success: boolean; error?: string; data?: any }>
```

**返回数据结构**:
```typescript
{
  success: true,
  data: {
    key: string,
    plan: string,
    isExpired: boolean,
    expires: string,  // formatted date
    expiresAt: number,  // timestamp
    daysRemaining: number,
    isTrial: boolean,
    features: {
      maxDevices: number,
      maxIps: number,
      syncEnabled: boolean,
      syncQuota: number,
      publishEnabled: boolean,
      maxSites: number,
      maxStorage: number,
      customDomain: boolean,
      customSubDomain: boolean,
      validityDays: number
    },
    activatedAt: number
  }
}
```

**使用示例**:
```typescript
const result = await this.plugin.getFoundryLicenseInfo();
if (result.success && result.data) {
    const license = result.data;
    console.log(`Plan: ${license.plan}`);
    console.log(`Expires in ${license.daysRemaining} days`);
    console.log(`Max sites: ${license.features.maxSites}`);
}
```

#### 2.4 获取 License 使用情况

```typescript
async getFoundryLicenseUsage(): Promise<{ success: boolean; error?: string; data?: any }>
```

**返回数据结构**:
```typescript
{
  success: true,
  data: {
    devices: {
      count: number,
      max: number,
      list: Array<{
        name: string,
        type: string,
        status: string,
        lastSeenAt: number
      }>
    },
    ips: {
      count: number,
      max: number,
      list: Array<{
        ip: string,
        city: string,
        region: string,
        country: string,
        lastSeenAt: number
      }>
    },
    disk: {
      syncUsage: number,
      publishUsage: number,
      totalUsage: number,
      maxStorage: number,
      unit: string
    }
  }
}
```

**使用示例**:
```typescript
const result = await this.plugin.getFoundryLicenseUsage();
if (result.success && result.data) {
    const usage = result.data;
    console.log(`Devices: ${usage.devices.count}/${usage.devices.max}`);
    console.log(`IPs: ${usage.ips.count}/${usage.ips.max}`);
    console.log(`Disk: ${usage.disk.totalUsage} ${usage.disk.unit}`);
}
```

#### 2.5 重置 License 使用数据

```typescript
async resetFoundryLicenseUsage(force: boolean = false): Promise<{ success: boolean; error?: string }>
```

⚠️ **警告**: 此操作会删除所有 sync 和 publish 数据，不可恢复！

**使用示例**:
```typescript
const result = await this.plugin.resetFoundryLicenseUsage(true);
if (result.success) {
    new Notice('Usage data reset successfully');
}
```

### 3. 配置存储结构

#### 3.1 Global Config - Publish 配置

保存在 `workspace/.mdfriday/global.json` 的 `publish.mdfriday`:

```json
{
  "publish": {
    "mdfriday": {
      "licenseKey": "MDF-XXXX-XXXX-XXXX",
      "type": "share",
      "enabled": true
    },
    "ftp": { ... },
    "netlify": { ... }
  }
}
```

#### 3.2 Global Config - Auth 用户信息

保存在 `workspace/.mdfriday/global.json` 的 `auth.userInfo`:

```json
{
  "auth": {
    "userInfo": {
      "serverConfig": {
        "apiUrl": "https://app.mdfriday.com",
        "websiteUrl": "https://mdfriday.com"
      },
      "token": {
        "token": "eyJ0eXAiOiJKV1QiLCJhbGc..."
      },
      "license": {
        "key": "MDF-XXXX-XXXX-XXXX",
        "plan": "free",
        "expiresAt": 1773993318093,
        "features": {
          "maxDevices": 3,
          "maxIps": 3,
          "syncEnabled": true,
          "syncQuota": 500,
          "publishEnabled": true,
          "maxSites": 3,
          "maxStorage": 10240,
          "customDomain": true,
          "customSubDomain": true,
          "validityDays": 7
        },
        "activatedAt": 1773390687362
      },
      "email": "user@mdfriday.com"
    }
  }
}
```

### 4. 自动同步机制

#### syncLicenseInfoToAuth()

这是一个私有方法，在以下场景自动调用：

1. **请求试用成功后**: `requestTrialLicense()` → `syncLicenseInfoToAuth()`
2. **激活 License 后**: `activateLicenseWithKey()` → `syncLicenseInfoToAuth()`

**同步内容**:
- 从 `licenseService.getLicenseInfo()` 获取 license 详情
- 从 `authService.getStatus()` 获取 token 和 email
- 从 `authService.getConfig()` 获取服务器配置
- 组合成完整的 auth 用户信息
- 保存到 `global.json` 的 `auth.userInfo`

### 5. 加载机制

在 `loadSettingsFromFoundryGlobalConfig()` 中：

```typescript
// 从 auth.userInfo 加载 license 数据
if (foundryConfig['auth']?.userInfo) {
    const userInfo = foundryConfig['auth'].userInfo;
    
    // 加载到 settings.license
    if (userInfo.license) {
        this.settings.license = {
            key: userInfo.license.key,
            plan: userInfo.license.plan,
            expiresAt: userInfo.license.expiresAt,
            features: userInfo.license.features,
            activatedAt: userInfo.license.activatedAt
        };
    }
    
    // 加载到 settings.licenseUser
    if (userInfo.email) {
        this.settings.licenseUser = {
            email: userInfo.email,
            userDir: userInfo.email.split('@')[0]
        };
    }
}
```

### 6. 集成到现有功能

#### 替换场景

以下是可以使用 Foundry License Service 替换的现有场景：

1. **试用申请**: 
   - 旧方式: 直接调用 API
   - 新方式: `await plugin.requestTrialLicense(email)`

2. **License 激活**:
   - 旧方式: 手动调用激活 API 并保存
   - 新方式: `await plugin.activateLicenseWithKey(key)`

3. **License 信息显示**:
   - 旧方式: 从 `settings.license` 读取
   - 新方式: `await plugin.getFoundryLicenseInfo()` (实时数据)

4. **使用情况监控**:
   - 旧方式: 调用 API 获取使用情况
   - 新方式: `await plugin.getFoundryLicenseUsage()`

5. **数据重置**:
   - 旧方式: 调用 API 重置
   - 新方式: `await plugin.resetFoundryLicenseUsage(true)`

### 7. 与现有 License 系统的关系

#### 兼容性

- **保持兼容**: 现有的 `settings.license`、`settings.licenseUser` 等字段继续使用
- **自动同步**: Foundry License Service 的数据会自动同步到这些字段
- **渐进迁移**: 可以逐步将现有代码迁移到使用 Foundry 方法

#### 数据流向

```
Foundry License Service
    ↓ (requestTrial / activateLicense)
Global Config (publish.mdfriday.licenseKey)
    ↓ (syncLicenseInfoToAuth)
Global Config (auth.userInfo.license)
    ↓ (loadSettingsFromFoundryGlobalConfig)
Obsidian Settings (settings.license, settings.licenseUser)
    ↓
UI 显示和功能使用
```

## 使用示例

### 完整的 License 激活流程

```typescript
// 在设置页面或 UI 中
class LicenseActivationModal extends Modal {
    async activateTrial(email: string) {
        // 1. 请求试用
        const result = await this.plugin.requestTrialLicense(email);
        
        if (result.success) {
            new Notice('Trial activated successfully!');
            
            // 2. 获取 license 信息显示给用户
            const infoResult = await this.plugin.getFoundryLicenseInfo();
            if (infoResult.success && infoResult.data) {
                const license = infoResult.data;
                console.log(`Your trial expires in ${license.daysRemaining} days`);
                console.log(`You can create up to ${license.features.maxSites} sites`);
            }
            
            // 3. 刷新 UI
            this.close();
        } else {
            new Notice(`Activation failed: ${result.error}`);
        }
    }
    
    async activateWithKey(licenseKey: string) {
        const result = await this.plugin.activateLicenseWithKey(licenseKey);
        
        if (result.success) {
            new Notice('License activated!');
            this.close();
        } else {
            new Notice(`Failed: ${result.error}`);
        }
    }
}
```

### 在设置页面显示 License 信息

```typescript
class FridaySettingTab extends PluginSettingTab {
    async display(): Promise<void> {
        // 获取实时 license 信息
        const licenseResult = await this.plugin.getFoundryLicenseInfo();
        
        if (licenseResult.success && licenseResult.data) {
            const license = licenseResult.data;
            
            // 显示 License 信息
            new Setting(containerEl)
                .setName('License Status')
                .setDesc(`Plan: ${license.plan}, Expires in ${license.daysRemaining} days`);
            
            // 显示使用情况
            const usageResult = await this.plugin.getFoundryLicenseUsage();
            if (usageResult.success && usageResult.data) {
                const usage = usageResult.data;
                
                new Setting(containerEl)
                    .setName('Device Usage')
                    .setDesc(`${usage.devices.count} of ${usage.devices.max} devices used`);
                
                new Setting(containerEl)
                    .setName('Storage Usage')
                    .setDesc(`${usage.disk.totalUsage} ${usage.disk.unit} of ${usage.disk.maxStorage} MB`);
            }
        }
    }
}
```

## 注意事项

1. **平台限制**: License Service 仅在桌面环境 (`Platform.isDesktop`) 中可用
2. **Workspace 依赖**: License Service 需要 workspace 已初始化
3. **错误处理**: 所有方法都有完善的错误处理，失败不会影响插件运行
4. **数据持久化**: License 信息保存在 Foundry workspace，跨设备同步
5. **自动同步**: License 变更会自动同步到 auth 和 publish 配置

## 调试建议

1. **检查 License Service 状态**:
   ```typescript
   console.log('License Service:', this.plugin.foundryLicenseService ? 'Ready' : 'Not initialized');
   ```

2. **验证配置同步**:
   - 激活 license → 检查 `workspace/.mdfriday/global.json`
   - 查看 `publish.mdfriday.licenseKey`
   - 查看 `auth.userInfo.license`

3. **查看详细日志**:
   - `[Friday] Trial license requested successfully`
   - `[Friday] License key saved to global config`
   - `[Friday] License info synced to auth user data`

## 未来扩展

1. **自动续费提醒**: 监控 `daysRemaining`，提前提醒用户
2. **使用限制检查**: 在发布前检查 sites/storage 限制
3. **License 升级**: 支持从试用升级到付费版本
4. **多 License 管理**: 支持团队/企业多个 License
