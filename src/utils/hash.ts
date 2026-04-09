/**
 * Hash utilities for generating project IDs
 * 
 * 提供跨平台的 hash 实现：
 * - PC 端: 使用 Node.js crypto 模块
 * - Mobile 端: 使用 Web Crypto API
 */

/**
 * 将字符串转换为 SHA-256 hash 的前 8 位（异步版本）
 * 
 * 跨平台兼容，推荐使用此版本
 * 
 * @param name - 输入字符串
 * @returns 8 位 hex hash
 */
export async function nameToIdAsync(name: string): Promise<string> {
	const normalized = name.trim().toLowerCase();
	
	// 检测环境
	if (typeof window !== 'undefined' && window.crypto && window.crypto.subtle) {
		// Mobile/Browser 环境：使用 Web Crypto API
		const encoder = new TextEncoder();
		const data = encoder.encode(normalized);
		const hashBuffer = await window.crypto.subtle.digest('SHA-256', data);
		const hashArray = Array.from(new Uint8Array(hashBuffer));
		const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
		return hashHex.slice(0, 8);
	} else {
		// PC 环境：动态导入 Node.js crypto
		const crypto = await import('crypto');
		return crypto.createHash('sha256')
			.update(normalized)
			.digest('hex')
			.slice(0, 8);
	}
}
