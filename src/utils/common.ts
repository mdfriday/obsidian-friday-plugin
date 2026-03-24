/**
 * 工具函数集合
 */

/**
 * 生成随机 ID（6位字符）
 * 用于预览 ID、项目 ID 等场景
 * 
 * @returns 6位随机字符串
 */
export function generateRandomId(): string {
	return Math.random().toString(36).substring(2, 8);
}

/**
 * 格式化日期时间为字符串
 * 
 * @param date - 日期对象
 * @returns 格式化的日期字符串
 */
export function formatDateTime(date: Date = new Date()): string {
	return date.toISOString();
}

/**
 * 安全地获取字符串的 trim 值
 * 如果值为空或只有空格，返回 undefined
 * 
 * @param value - 输入字符串
 * @returns trim 后的字符串或 undefined
 */
export function safeTrim(value: string | null | undefined): string | undefined {
	if (!value) return undefined;
	const trimmed = value.trim();
	return trimmed.length > 0 ? trimmed : undefined;
}

/**
 * 检查对象是否为空
 * 
 * @param obj - 对象
 * @returns 是否为空对象
 */
export function isEmptyObject(obj: any): boolean {
	return Object.keys(obj || {}).length === 0;
}
