/**
 * License State Manager
 * 
 * 统一的 license 状态管理器，从 Foundry Services 获取所有数据
 * 提供统一的状态查询和功能判断接口
 * 
 * 核心原则：
 * 1. Foundry 是唯一真实数据源
 * 2. 提供统一的状态查询接口
 * 3. 支持缓存以减少 API 调用
 */

import type {
	ObsidianLicenseService,
	ObsidianLicenseInfo,
	ObsidianAuthService,
	ObsidianAuthStatus,
	ObsidianDomainService,
	ObsidianDomainInfo,
} from '@mdfriday/foundry';
import type { LicenseFeatures } from '../license';

/**
 * License State Manager
 * 
 * 从 Foundry Services 统一管理 license 状态
 */
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
			console.log('[LicenseState] Initializing license state...');
			
			// 1. 首先获取认证状态（最重要）
			const authResult = await this.authService.getStatus(this.workspacePath);
			
			if (!authResult.success) {
				console.warn('[LicenseState] Failed to get auth status:', authResult.error);
				return { isActivated: false, error: authResult.error };
			}
			
			this.authStatus = authResult.data;
			console.log('[LicenseState] Auth status:', this.authStatus);
			
			// 2. 判断是否已激活
			if (!this.authStatus.isAuthenticated || !this.authStatus.license) {
				console.log('[LicenseState] Not activated or no license');
				return { isActivated: false };
			}
			
			// 3. 获取详细的 license 信息
			const licenseResult = await this.licenseService.getLicenseInfo(this.workspacePath);
			if (licenseResult.success) {
				this.licenseInfo = licenseResult.data;
				console.log('[LicenseState] License info loaded:', {
					plan: this.licenseInfo.plan,
					isExpired: this.licenseInfo.isExpired,
					features: Object.keys(this.licenseInfo.features || {})
				});
			} else {
				console.warn('[LicenseState] Failed to get license info:', licenseResult.error);
			}
			
			// 4. 获取 domain 信息（如果有权限）
			if (this.hasFeature('customSubDomain') || this.hasFeature('customDomain')) {
				const domainResult = await this.domainService.getDomainInfo(this.workspacePath);
				if (domainResult.success) {
					this.domainInfo = domainResult.data;
					console.log('[LicenseState] Domain info loaded:', {
						subdomain: this.domainInfo.subdomain,
						customDomain: this.domainInfo.customDomain
					});
				}
			}
			
			this.lastUpdateTime = Date.now();
			
			console.log('[LicenseState] Initialize completed successfully');
			return {
				isActivated: true,
				licenseKey: this.authStatus.license
			};
			
		} catch (error) {
			console.error('[LicenseState] Initialize failed:', error);
			return { isActivated: false, error: (error as Error).message };
		}
	}

	hasPublishPermission(): boolean {
		return this.isActivated() && this.hasFeature('publishEnabled');
	}

	/**
	 * 检查是否已激活
	 */
	isActivated(): boolean {
		return this.authStatus?.isAuthenticated === true && !!this.authStatus?.license;
	}

	/**
	 * 获取 license key
	 */
	getLicenseKey(): string | null {
		return this.authStatus?.license || null;
	}

	/**
	 * 获取 access token (from auth login)
	 */
	getAccessToken(): string | null {
		return this.authStatus?.token || null;
	}

	/**
	 * 获取 API URL (server URL)
	 */
	getApiUrl(): string | null {
		return this.authStatus?.serverUrl || null;
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
	 * 获取过期时间（格式化字符串）
	 */
	getExpires(): string {
		return this.licenseInfo?.expires || '';
	}

	/**
	 * 获取剩余天数
	 */
	getDaysRemaining(): number {
		return this.licenseInfo?.daysRemaining || 0;
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
		if (!this.licenseInfo?.user) return null;
		return this.licenseInfo.user.userDir
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
	 * 获取 domain 信息（用于 UI 显示）
	 */
	getDomainInfo(): ObsidianDomainInfo | null {
		return this.domainInfo;
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
		console.log('[LicenseState] Refreshing license state...');
		await this.initialize();
	}

	/**
	 * 清空状态
	 */
	clear(): void {
		console.log('[LicenseState] Clearing license state');
		this.licenseInfo = null;
		this.authStatus = null;
		this.domainInfo = null;
		this.lastUpdateTime = 0;
	}

	/**
	 * 获取最大存储空间 (MB)
	 */
	getMaxStorage(): number {
		return this.licenseInfo?.features?.maxStorage || 1024;
	}

	/**
	 * 获取所有 features
	 */
	getFeatures(): LicenseFeatures | null {
		return this.licenseInfo?.features || null;
	}

	/**
	 * 检查是否是试用版
	 */
	isTrial(): boolean {
		return this.licenseInfo?.isTrial || false;
	}

	/**
	 * 获取上次更新时间
	 */
	getLastUpdateTime(): number {
		return this.lastUpdateTime;
	}

	/**
	 * Check if sync is enabled and configured
	 */
	hasSyncConfig(): boolean {
		return this.authStatus?.hasSyncConfig || false;
	}

	/**
	 * Get sync configuration
	 * Returns sync config from authStatus if available
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
}
