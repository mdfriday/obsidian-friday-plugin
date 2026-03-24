import type { TFolder, TFile } from 'obsidian';

/**
 * Site 组件事件类型
 */
export type SiteEventType = 
	| 'initialized'          // 组件初始化完成
	| 'configChanged'        // 配置变更
	| 'buildRequested'       // 请求构建
	| 'previewRequested'     // 请求预览
	| 'publishRequested'     // 请求发布
	| 'testConnection'       // 测试连接
	| 'stopPreview';         // 停止预览

/**
 * Site 组件事件数据
 */
export interface SiteEventData {
	initialized: {
		projectName: string;
	};
	configChanged: {
		key: string;
		value: any;
	};
	buildRequested: {
		projectName: string;
	};
	previewRequested: {
		projectName: string;
		port: number;
		renderer?: any;
	};
	publishRequested: {
		projectName: string;
		method: string;
		config: any;
	};
	testConnection: {
		projectName: string;
		config: any;
	};
	stopPreview: {
		projectName: string;
	};
}

/**
 * 进度更新
 */
export interface ProgressUpdate {
	phase: 'initializing' | 'building' | 'watching' | 'publishing' | 'ready';
	percentage: number;
	message?: string;
}

/**
 * 项目状态
 */
export interface ProjectState {
	name: string;
	folder: TFolder | null;
	file: TFile | null;
	config: Record<string, any>;
	status: 'initializing' | 'active' | 'building' | 'previewing' | 'publishing';
}
