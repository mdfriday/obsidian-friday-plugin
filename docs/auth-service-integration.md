# Auth Service 集成文档

## 概述

已成功将 Foundry 的 `ObsidianAuthService` 集成到 Obsidian Friday 插件中，实现了双向配置同步：

1. **Obsidian 设置 → Foundry Workspace**：当用户在 Obsidian 设置页面修改配置时，自动保存到 Foundry workspace
2. **Foundry Workspace → Obsidian 设置**：启动时从 Foundry workspace 加载配置，作为本地设置的备份

## 集成内容

### 1. HTTP Client 实现

创建了 `ObsidianIdentityHttpClient` 类，实现 `IdentityHttpClient` 接口：

**位置**: `src/http.ts`

```typescript
export class ObsidianIdentityHttpClient implements IdentityHttpClient {
  async postJSON(url: string, data: any, headers?: Record<string, string>): Promise<IdentityHttpResponse>
  async get(url: string, headers?: Record<string, string>): Promise<IdentityHttpResponse>
}

export function createObsidianIdentityHttpClient(): IdentityHttpClient
```

### 2. AuthService 初始化

**位置**: `src/main.ts`

在 `FridayPlugin` 类中添加：

```typescript
// 属性
foundryAuthService?: ObsidianAuthService | null

// 初始化 (在 initializeWorkspace 方法中)
const identityHttpClient = createObsidianIdentityHttpClient();
this.foundryAuthService = await createObsidianAuthService(this.absWorkspacePath, identityHttpClient);
```

### 3. 配置保存

**位置**: `src/main.ts` → `saveSettingsToFoundryGlobalConfig()`

当用户在设置页面修改 `enterpriseServerUrl` 时：

```typescript
// Save auth configuration to Foundry AuthService
if (this.foundryAuthService && this.settings.enterpriseServerUrl) {
    const authConfig = {
        apiUrl: this.settings.enterpriseServerUrl,
    };
    
    const updateResult = await this.foundryAuthService.updateConfig(authConfig);
    if (updateResult.success) {
        console.log('[Friday] Auth config saved to Foundry:', authConfig);
    }
}
```

### 4. 配置加载

**位置**: `src/main.ts` → `loadSettingsFromFoundryGlobalConfig()`

启动时从 Foundry workspace 加载配置：

```typescript
// Load auth configuration from Foundry AuthService
if (this.foundryAuthService) {
    const authConfigResult = await this.foundryAuthService.getConfig();
    if (authConfigResult.success && authConfigResult.data) {
        // Only load if local setting is empty
        if (!this.settings.enterpriseServerUrl && authConfigResult.data.apiUrl) {
            this.settings.enterpriseServerUrl = authConfigResult.data.apiUrl;
            console.log('[Friday] Loaded auth config from Foundry:', authConfigResult.data);
        }
    }
}
```

## 配置优先级策略

采用 **本地优先 (Local First)** 策略：

1. **保存时**: 同时保存到 Obsidian 本地存储和 Foundry workspace
2. **加载时**: 
   - 如果 Obsidian 本地设置已有值，使用本地值
   - 如果 Obsidian 本地设置为空，从 Foundry workspace 加载

这样确保了：
- 用户的本地配置始终优先
- Foundry workspace 作为配置的备份和跨设备同步基础
- 首次使用或重置后可以从 workspace 恢复配置

## AuthService 管理的配置

根据 Foundry API 文档，AuthService 主要管理：

- `apiUrl`: API 服务器 URL（对应 `settings.enterpriseServerUrl`）
- `websiteUrl`: 网站 URL（可选，当前未使用）

**注意**: 用户的认证凭证（username, password, token）由 AuthService 内部管理，不需要插件显式保存。

## 使用示例

### 获取当前认证状态

```typescript
if (this.foundryAuthService) {
    const statusResult = await this.foundryAuthService.getStatus();
    
    if (statusResult.success && statusResult.data) {
        const status = statusResult.data;
        if (status.isAuthenticated) {
            console.log(`Logged in as: ${status.email}`);
            console.log(`Token: ${status.token?.substring(0, 20)}...`);
            console.log(`Server: ${status.serverUrl}`);
        }
    }
}
```

### 更新服务器配置

```typescript
if (this.foundryAuthService) {
    const result = await this.foundryAuthService.updateConfig({
        apiUrl: 'https://your-server.com/api',
        websiteUrl: 'https://your-server.com'
    });
    
    if (result.success) {
        console.log('Server configuration updated');
    }
}
```

### 获取服务器配置

```typescript
if (this.foundryAuthService) {
    const configResult = await this.foundryAuthService.getConfig();
    
    if (configResult.success && configResult.data) {
        console.log(`API URL: ${configResult.data.apiUrl}`);
        console.log(`Website URL: ${configResult.data.websiteUrl || 'Not set'}`);
    }
}
```

## 集成的其他 Foundry 服务

除了 AuthService，插件还集成了：

1. **WorkspaceService**: Workspace 初始化和管理
2. **ProjectService**: 项目创建和管理
3. **BuildService**: 静态站点构建
4. **ConfigService** (Global & Project): 配置管理
5. **ServeService**: 本地预览服务器
6. **PublishService**: 发布到 Netlify/FTP 等平台

所有这些服务都使用统一的 workspace 路径进行操作，确保配置和数据的一致性。

## 调试建议

1. **检查 workspace 是否初始化**:
   ```typescript
   const exists = await this.workspaceService.workspaceExists(this.absWorkspacePath);
   ```

2. **查看 AuthService 日志**:
   - 保存配置时：`[Friday] Auth config saved to Foundry`
   - 加载配置时：`[Friday] Loaded auth config from Foundry`

3. **验证配置同步**:
   - 修改设置 → 检查 workspace 文件
   - 清空本地设置 → 重启插件 → 验证是否从 workspace 恢复

## 注意事项

⚠️ **重要**:

1. AuthService 需要 workspace 已经初始化，否则会返回错误
2. AuthService 仅在桌面环境 (`Platform.isDesktop`) 中可用
3. 配置同步失败不会影响插件的正常运行（已做错误处理）
4. 所有涉及 Foundry 服务的操作都有成功/失败的结果检查

## 未来扩展

可以考虑集成的其他 AuthService 功能：

1. **用户认证状态监听**: 实时显示登录状态
2. **Token 刷新**: 自动刷新过期的认证 token
3. **多服务器支持**: 支持在不同的企业服务器间切换
4. **配置导入/导出**: 批量管理配置
