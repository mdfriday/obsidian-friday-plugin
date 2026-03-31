/**
 * 发布方式枚举类型
 */

/**
 * 所有支持的发布方式
 * 包括旧的兼容值 'mdfriday'（已废弃，映射到 'mdf-share'）
 */
export type PublishMethod = 
	| 'netlify'           // Netlify 发布
	| 'ftp'               // FTP 发布
	| 'mdf-free'          // MDFriday Free（免费版，24小时有效期）
	| 'mdf-share'         // MDFriday Share（快速分享）
	| 'mdf-app'           // MDFriday App（子域名发布）
	| 'mdf-custom'        // MDFriday 自定义域名
	| 'mdf-enterprise'    // MDFriday 企业版
	| 'mdfriday';         // 已废弃，兼容旧值，映射到 'mdf-share'

/**
 * 当前有效的发布方式（不包括废弃值）
 */
export type ValidPublishMethod = 
	| 'netlify'
	| 'ftp'
	| 'mdf-free'
	| 'mdf-share'
	| 'mdf-app'
	| 'mdf-custom'
	| 'mdf-enterprise';

/**
 * 所有有效的发布方式数组
 */
export const VALID_PUBLISH_METHODS: readonly ValidPublishMethod[] = [
	'netlify',
	'ftp',
	'mdf-free',
	'mdf-share',
	'mdf-app',
	'mdf-custom',
	'mdf-enterprise'
] as const;

/**
 * 默认发布方式
 */
export const DEFAULT_PUBLISH_METHOD: ValidPublishMethod = 'mdf-share';

/**
 * 检查是否是有效的发布方式
 */
export function isValidPublishMethod(method: string): method is ValidPublishMethod {
	return VALID_PUBLISH_METHODS.includes(method as ValidPublishMethod);
}

/**
 * 标准化发布方式（处理旧的 'mdfriday' 值）
 * @param method - 发布方式
 * @returns 标准化后的发布方式
 */
export function normalizePublishMethod(method: PublishMethod | string): ValidPublishMethod {
	// 兼容旧值
	if (method === 'mdfriday') {
		return 'mdf-share';
	}
	
	// 验证是否有效
	if (isValidPublishMethod(method)) {
		return method;
	}
	
	// 无效值，返回默认值
	console.warn(`[Friday] Invalid publish method: ${method}, using default: ${DEFAULT_PUBLISH_METHOD}`);
	return DEFAULT_PUBLISH_METHOD;
}

/**
 * 发布方式显示名称映射
 */
export const PUBLISH_METHOD_LABELS: Record<ValidPublishMethod, string> = {
	'netlify': 'Netlify',
	'ftp': 'FTP',
	'mdf-free': 'MDFriday Free',
	'mdf-share': 'MDFriday Share',
	'mdf-app': 'MDFriday App',
	'mdf-custom': 'MDFriday Custom Domain',
	'mdf-enterprise': 'MDFriday Enterprise'
};
