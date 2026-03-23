# License State 重构方案：以 Foundry 为单一数据源

## 背景

当前 Obsidian Friday Plugin 的 license 管理存在数据源混乱、同步复杂、状态不一致等问题。本文档提供完整的重构方案，将 Foundry Services 作为唯一数据源。

## 问题分析

### 当前架构的问题

#### 1. 多数据源导致数据混乱

```typescript
// 数据来源 1: Obsidian Plugin Settings (data.json)
this.settings.license           // StoredLicenseData
this.settings.licenseUser       // StoredUserData  
this.settings.licenseSync       // StoredSyncData
this.settings.licenseUsage      // StoredUsageData

// 数据来源 2: Foundry Global Config (workspace/.mdfriday/config.json)
foundryConfig['auth'].userInfo.license
foundryConfig['publish'].mdfriday.licenseKey

// 数据来源 3: Foundry Services (workspace/.mdfriday/user-data.json)
authService.getStatus()         // 认证状态、license key、token
licenseService.getLicenseInfo() // license 详细信息、features
domainService.getDomainInfo()   // domain 信息
```

**问题**：
- 数据分散在 3 个地方，优先级不清晰
- 需要手动同步多个存储位置
- 容易出现数据不一致
- 判断逻辑依赖本地缓存，可能是过期数据

#### 2. 复杂的数据同步逻辑

激活 license 时的数据流：

```typescript
activateLicense()
  ↓
licenseService.activateLicense(licenseKey)  // Foundry 激活
  ↓
this.settings.license = {...}                // 保存到 Obsidian settings
  ↓
this.saveSettings()                          // 触发保存到 data.json
  ↓
saveSettingsToFoundryGlobalConfig()          // 保存到 Global Config
  ↓
authService.updateConfig()                   // 更新 Auth 配置
  ↓ (问题出现)
authService 内部重置 user 状态
  ↓
user 变成 anonymous，license 丢失
```

#### 3. 分散的功能判断逻辑

```typescript
// 判断 license 是否激活
if (license && !isLicenseExpired(license.expiresAt)) { ... }

// 检查功能权限
if (license.features.customSubDomain) { ... }
if (license.features.syncEnabled) { ... }

// 获取用户信息
const userDir = this.settings.licenseUser?.userDir
const subdomain = this.settings.customSubdomain ?? userDir
```

**问题**：
- 判断逻辑分散在各处
- 依赖本地缓存数据
- 没有统一的状态管理

## 重构方案

### 核心原则

1. **Foundry 是唯一真实数据源** - 所有 license 相关数据由 Foundry Services 管理
2. **Obsidian Settings 仅作为 UI 显示缓存** - 用于快速显示，不作为判断依据
3. **统一数据流向** - 数据只从 Foundry 流向 Obsidian，不反向同步

### 重构架构

```
┌─────────────────────────────────────────────────────────┐
│                   Foundry Services                       │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  │
│  │ AuthService  │  │LicenseService│  │DomainService │  │
│  │              │  │              │  │              │  │
│  │ • getStatus()│  │• getLicense  │  │• getDomain   │  │
│  │   - license  │  │  Info()      │  │  Info()      │  │
│  │   - token    │  │  - features  │  │              │  │
│  │   - email    │  │  - plan      │  │              │  │
│  │              │  │  - expires   │  │              │  │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘  │
│         │                 │                 │           │
│         └─────────────────┴─────────────────┘           │
│                           │                              │
└───────────────────────────┼──────────────────────────────┘
                            │ (Single Source of Truth)
                            ▼
                ┌───────────────────────┐
                │  LicenseStateManager  │
                │  (统一状态管理)        │
                │                       │
                │  • licenseInfo        │
                │  • authStatus         │
                │  • domainInfo         │
                │  • lastSyncTime       │
                │  • 统一判断方法       │
                └───────────┬───────────┘
                            │
                            ▼
                ┌───────────────────────┐
                │  Obsidian Settings    │
                │  (UI Display Only)    │
                │                       │
                │  • 快速显示缓存       │
                │  • 不用于逻辑判断     │
                └───────────────────────┘
```

## 实施步骤

### 阶段 1: 创建 LicenseStateManager

创建 `src/services/licenseState.ts`：

```typescript
/**
 * License State Manager
 * 
 * 统一的 license 状态管理器，从 Foundry Services 获取所有数据
 * 提供统一的状态查询和功能判断接口
 */

import type {
    ObsidianLicenseService,
    ObsidianLicenseInfo,
    ObsidianAuthService,
    ObsidianAuthStatus,
    ObsidianDomainService,
    ObsidianDomainInfo,
} from '@mdfriday/foundry';

export class LicenseStateManager {
    private licenseInfo: ObsidianLicenseInfo | null = null;
    private authStatus: ObsidianAuthStatus | null = null;
    private domainInfo: ObsidianDomainInfo | null = null;
    private lastUpdateTime: number = 0;
    private readonly CACHE_TTL = 60000; // 1分钟缓存

    constructor(
        private licenseService: ObsidianLicenseService,
        private authService: ObsidianAuthService,
        private domainService: ObsidianDomainService,
        private workspacePath: string
    ) {}

    /**
     * 初始化/刷新所有状态
     * 插件加载时调用，以及需要刷新时调用
     */
    async initialize(): Promise<{
        isActivated: boolean;
        licenseKey?: string;
        error?: string;
    }> {
        try {
            // 1. 首先获取认证状态（最重要）
            const authResult = await this.authService.getStatus(this.workspacePath);
            
            if (!authResult.success) {
                return { isActivated: false, error: authResult.error };
            }
            
            this.authStatus = authResult.data;
            
            // 2. 判断是否已激活
            if (!this.authStatus.isAuthenticated || !this.authStatus.license) {
                return { isActivated: false };
            }
            
            // 3. 获取详细的 license 信息
            const licenseResult = await this.licenseService.getLicenseInfo(this.workspacePath);
            if (licenseResult.success) {
                this.licenseInfo = licenseResult.data;
            }
            
            // 4. 获取 domain 信息（如果有权限）
            if (this.hasFeature('customSubDomain') || this.hasFeature('customDomain')) {
                const domainResult = await this.domainService.getDomainInfo(this.workspacePath);
                if (domainResult.success) {
                    this.domainInfo = domainResult.data;
                }
            }
            
            this.lastUpdateTime = Date.now();
            
            return {
                isActivated: true,
                licenseKey: this.authStatus.license
            };
            
        } catch (error) {
            console.error('[LicenseState] Initialize failed:', error);
            return { isActivated: false, error: error.message };
        }
    }

    /**
     * 检查是否已激活
     */
    isActivated(): boolean {
        return this.authStatus?.isAuthenticated && !!this.authStatus?.license;
    }

    /**
     * 获取 license key
     */
    getLicenseKey(): string | null {
        return this.authStatus?.license || null;
    }

    /**
     * 检查是否过期
     */
    isExpired(): boolean {
        if (!this.licenseInfo) return true;
        return this.licenseInfo.isExpired || false;
    }

    /**
     * 获取 plan
     */
    getPlan(): string {
        return this.licenseInfo?.plan || 'free';
    }

    /**
     * 统一的功能检查方法
     */
    hasFeature(feature: keyof LicenseFeatures): boolean {
        if (!this.licenseInfo?.features) return false;
        return this.licenseInfo.features[feature] === true;
    }

    /**
     * 获取用户邮箱
     */
    getEmail(): string | null {
        return this.authStatus?.email || null;
    }

    /**
     * 获取用户目录
     */
    getUserDir(): string | null {
        const email = this.getEmail();
        return email ? email.split('@')[0] : null;
    }

    /**
     * 获取子域名
     */
    getSubdomain(): string | null {
        return this.domainInfo?.subdomain || this.getUserDir();
    }

    /**
     * 获取自定义域名
     */
    getCustomDomain(): string | null {
        return this.domainInfo?.customDomain || null;
    }

    /**
     * 获取完整的 license 信息（用于 UI 显示）
     */
    getLicenseInfo(): ObsidianLicenseInfo | null {
        return this.licenseInfo;
    }

    /**
     * 获取认证状态（用于 UI 显示）
     */
    getAuthStatus(): ObsidianAuthStatus | null {
        return this.authStatus;
    }

    /**
     * 判断缓存是否过期
     */
    isCacheValid(): boolean {
        return Date.now() - this.lastUpdateTime < this.CACHE_TTL;
    }

    /**
     * 强制刷新
     */
    async refresh(): Promise<void> {
        await this.initialize();
    }

    /**
     * 清空状态
     */
    clear(): void {
        this.licenseInfo = null;
        this.authStatus = null;
        this.domainInfo = null;
        this.lastUpdateTime = 0;
    }
}
```

### 阶段 2: 集成到 FridayPlugin

修改 `src/main.ts`：

```typescript
export default class FridayPlugin extends Plugin {
    // 新增：统一的 license 状态管理
    licenseState?: LicenseStateManager;
    
    // 保留：Obsidian settings 仅用于 UI 快速显示
    settings: FridaySettings;

    async initDesktopFeatures() {
        // ... 其他初始化 ...
        
        // 初始化 workspace
        await this.initializeWorkspace();
        
        // 创建 License State Manager
        if (this.foundryLicenseService && 
            this.foundryAuthService && 
            this.foundryDomainService) {
            
            this.licenseState = new LicenseStateManager(
                this.foundryLicenseService,
                this.foundryAuthService,
                this.foundryDomainService,
                this.absWorkspacePath
            );
            
            // 初始化 license 状态
            const initResult = await this.licenseState.initialize();
            
            if (initResult.isActivated) {
                console.log('[Friday] License activated:', initResult.licenseKey);
                
                // 同步到 settings（仅用于UI显示）
                await this.syncLicenseToSettings();
                
                // 如果有 sync 功能，初始化 sync service
                if (this.licenseState.hasFeature('syncEnabled')) {
                    await this.initializeSyncService();
                }
            } else {
                console.log('[Friday] No license activated');
            }
        }
    }

    /**
     * 将 Foundry 状态同步到 Obsidian settings（仅用于 UI 显示）
     */
    private async syncLicenseToSettings(): Promise<void> {
        if (!this.licenseState) return;
        
        const licenseInfo = this.licenseState.getLicenseInfo();
        const authStatus = this.licenseState.getAuthStatus();
        
        // 更新 settings（仅用于UI快速显示）
        if (licenseInfo) {
            this.settings.license = {
                key: this.licenseState.getLicenseKey() || '',
                plan: licenseInfo.plan,
                expiresAt: licenseInfo.expiresAt || 0,
                features: licenseInfo.features,
                activatedAt: Date.now()
            };
        }
        
        if (authStatus?.email) {
            this.settings.licenseUser = {
                email: authStatus.email,
                userDir: this.licenseState.getUserDir() || ''
            };
        }
        
        // 不需要 saveSettings()，因为这只是内存缓存
    }
}
```

### 阶段 3: 重构 Settings UI

修改 `src/main.ts` 中的 `FridaySettingTab`：

```typescript
/**
 * 渲染 License 部分
 */
private renderLicenseSection(containerEl: HTMLElement): void {
    containerEl.createEl("h2", {text: this.plugin.i18n.t('settings.license')});

    // 使用 licenseState 判断，而不是 this.plugin.settings.license
    if (this.plugin.licenseState?.isActivated() && 
        !this.plugin.licenseState.isExpired()) {
        // ========== License Active State ==========
        
        const licenseInfo = this.plugin.licenseState.getLicenseInfo();
        if (!licenseInfo) return;
        
        // 显示 license 信息（从 Foundry 实时获取）
        const licenseKeySetting = new Setting(containerEl)
            .setName(maskLicenseKey(this.plugin.licenseState.getLicenseKey() || ''))
            .setDesc(this.plugin.i18n.t('settings.valid_until') + ': ' + licenseInfo.expires);
        
        // Plan badge - 可点击刷新
        const planBadge = licenseKeySetting.controlEl.createSpan({
            cls: `friday-plan-badge ${licenseInfo.plan.toLowerCase()} clickable`,
            text: formatPlanName(licenseInfo.plan)
        });
        
        planBadge.title = this.plugin.i18n.t('settings.click_to_refresh_license_info');
        planBadge.addEventListener('click', async () => {
            const originalText = planBadge.textContent || '';
            planBadge.textContent = 'Refreshing...';
            
            try {
                await this.plugin.licenseState?.refresh();
                await this.plugin.syncLicenseToSettings();
                this.display(); // 刷新整个UI
                new Notice('License info refreshed');
            } catch (error) {
                console.error('Failed to refresh license:', error);
                planBadge.textContent = originalText;
            }
        });
        
        // 存储用量显示
        const maxStorage = licenseInfo.features.maxStorage || 1024;
        // ... 显示存储进度条 ...
        
    } else {
        // ========== License Input State ==========
        // 显示激活输入框
        // ...
    }
}

/**
 * 渲染域名设置部分
 */
private renderDomainSection(containerEl: HTMLElement): void {
    // 使用 licenseState 检查权限
    if (!this.plugin.licenseState?.hasFeature('customSubDomain')) {
        // 显示升级提示
        return;
    }
    
    containerEl.createEl("h2", {text: this.plugin.i18n.t('settings.subdomain')});
    
    // 获取当前子域名
    const subdomain = this.plugin.licenseState.getSubdomain();
    
    // ... 显示子域名设置 ...
}
```

### 阶段 4: 简化激活流程

```typescript
/**
 * 激活 License
 */
private async activateLicense(licenseKey: string): Promise<void> {
    if (!this.plugin.licenseServiceManager) {
        throw new Error('License service not available');
    }

    try {
        // Step 1: 登录获取 token
        const loginResult = await this.plugin.licenseServiceManager.loginWithLicense(licenseKey);
        if (!loginResult.success) {
            throw new Error(loginResult.error || 'Login failed');
        }

        // Step 2: 激活 license
        const activateResult = await this.plugin.licenseServiceManager.activateLicense(licenseKey);
        if (!activateResult.success) {
            throw new Error(activateResult.error || 'Activation failed');
        }

        // Step 3: 重新初始化状态（从 Foundry 读取所有信息）
        if (this.plugin.licenseState) {
            const initResult = await this.plugin.licenseState.initialize();
            
            if (!initResult.isActivated) {
                throw new Error('License activation succeeded but state initialization failed');
            }
            
            // Step 4: 同步到 settings（仅UI显示）
            await this.plugin.syncLicenseToSettings();
            
            // Step 5: 如果是首次激活且有 sync 功能，初始化 sync
            const licenseInfo = activateResult.data;
            if (licenseInfo.activation?.firstTime && 
                this.plugin.licenseState.hasFeature('syncEnabled')) {
                
                // 生成加密密码（仅首次）
                if (!this.plugin.settings.encryptionPassphrase) {
                    this.plugin.settings.encryptionPassphrase = generateEncryptionPassphrase();
                }
                
                await this.plugin.initializeSyncService();
            }
        }

        // 显示成功提示
        new Notice(this.plugin.i18n.t('settings.license_activated_success'));
        
        // 刷新UI
        this.display();
        
    } catch (error) {
        console.error('[Friday] License activation failed:', error);
        throw error;
    }
}
```

### 阶段 5: 移除冗余代码

需要移除或简化的部分：

1. **移除 `saveSettingsToFoundryGlobalConfig()` 中的 license 同步**
   - 不再需要手动保存 license 到 global config
   - 不再调用 `authService.updateConfig()`（避免重置问题）

2. **简化 `loadSettingsFromFoundryGlobalConfig()`**
   - 移除从 `foundryConfig['auth'].userInfo` 加载 license 的逻辑
   - License 数据只从 `licenseState` 获取

3. **移除 `refreshLicenseInfo()` 和 `refreshLicenseUsage()`**
   - 替换为 `licenseState.refresh()`

4. **简化 `LicenseServiceManager`**
   - 移除 `syncLicenseInfoToAuth()` 方法
   - 不再需要手动同步数据到 global config

## 优势总结

### ✅ 单一数据源
- 所有 license 数据都从 Foundry Services 获取
- 消除数据不一致问题
- 不再需要手动同步多个存储

### ✅ 简化判断逻辑

```typescript
// 之前：依赖本地缓存
if (this.settings.license && !isLicenseExpired(this.settings.license.expiresAt)) {
    // ...
}

// 之后：从 Foundry 实时获取
if (this.licenseState.isActivated() && !this.licenseState.isExpired()) {
    // ...
}
```

### ✅ 统一功能检查

```typescript
// 之前：分散在各处
if (license.features.customSubDomain) { ... }
if (license.features.syncEnabled) { ... }

// 之后：统一接口
if (this.licenseState.hasFeature('customSubDomain')) { ... }
if (this.licenseState.hasFeature('syncEnabled')) { ... }
```

### ✅ 实时状态
- 可以随时调用 `refresh()` 获取最新状态
- 不依赖本地缓存的过期数据
- 支持多设备同步（所有设备从同一个 Foundry 获取）

### ✅ 解决激活重置问题
- 不再在激活后调用 `saveSettingsToFoundryGlobalConfig()`
- 避免 `authService.updateConfig()` 重置 user 状态
- 数据流向清晰：Foundry → LicenseState → Settings（UI only）

## 迁移策略

### 1. 向后兼容
- 保留 `this.settings.license` 结构
- 仅用于 UI 快速显示
- 逐步迁移所有判断逻辑到 `licenseState`

### 2. 渐进式重构
1. **第一步**：创建 `LicenseStateManager`
2. **第二步**：在 `initDesktopFeatures()` 中初始化
3. **第三步**：重构 Settings UI 的判断逻辑
4. **第四步**：简化激活流程
5. **第五步**：移除冗余代码

### 3. 测试覆盖
每个阶段都要测试：
- ✅ 首次激活 license
- ✅ 已激活状态加载
- ✅ License 过期检查
- ✅ 功能权限判断（sync, customDomain, customSubDomain）
- ✅ 刷新 license 信息
- ✅ 多设备同步

## 注意事项

### 1. Mobile 兼容性
- `LicenseStateManager` 仅在 Desktop 平台初始化
- Mobile 平台可以保持原有的 `licenseServiceManager` 调用

### 2. 缓存策略
- `LicenseStateManager` 默认缓存 1 分钟
- UI 操作（如点击刷新按钮）会强制刷新
- 可以根据实际需求调整 `CACHE_TTL`

### 3. 错误处理
- 所有 Foundry API 调用都需要 try-catch
- 网络错误时使用缓存数据
- 显示友好的错误提示给用户

### 4. 性能优化
- 插件加载时并行获取多个状态
- 使用缓存减少 API 调用
- 按需加载（如 domain info 只在有权限时获取）

## 总结

这个重构方案彻底解决了当前 license 管理的数据混乱问题：

1. **Foundry 是唯一真实数据源** - 所有判断和逻辑都基于 Foundry
2. **统一的状态管理** - `LicenseStateManager` 提供一致的接口
3. **简化的数据流** - 单向数据流，从 Foundry 到 Obsidian
4. **解决激活重置问题** - 避免不必要的配置同步导致状态重置

通过这个重构，代码将更加清晰、可维护，且不会再出现数据不一致的问题。
