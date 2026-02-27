/**
 * File Progress Events
 * 
 * 文件操作事件定义 - 从 sync/core 层向外传递
 * core 层通过回调函数发出这些事件，外层监听并更新 UI
 */

// ========== 上传相关事件 ==========

export interface UploadStartEvent {
    type: 'upload_start';
    totalFiles: number;
}

export interface UploadProgressEvent {
    type: 'upload_progress';
    uploadedFiles: number;
    totalFiles: number;
    currentFile?: string;  // 可选：当前上传的文件路径
}

export interface UploadCompleteEvent {
    type: 'upload_complete';
    totalFiles: number;
    successCount: number;
    errorCount: number;
}

// ========== 下载相关事件 ==========

export interface DownloadStartEvent {
    type: 'download_start';
    totalDocs: number;
}

export interface DownloadProgressEvent {
    type: 'download_progress';
    downloadedDocs: number;
    totalDocs: number;
}

export interface DownloadCompleteEvent {
    type: 'download_complete';
    totalDocs: number;
}

// ========== 文件写入相关事件 ==========

export interface FileWriteStartEvent {
    type: 'file_write_start';
    totalFiles: number;
}

export interface FileWriteProgressEvent {
    type: 'file_write_progress';
    writtenFiles: number;
    totalFiles: number;
    currentFilePath?: string;
}

export interface FileWriteCompleteEvent {
    type: 'file_write_complete';
    totalFiles: number;
    successCount: number;
    errorCount: number;
}

// ========== 实时同步活动事件（不确定总数的场景）==========

export interface SyncActivityStartEvent {
    type: 'sync_activity_start';
    // 不需要 totalFiles，因为实时同步时不确定总文件数
}

export interface SyncActivityProgressEvent {
    type: 'sync_activity_progress';
    processedFiles: number;  // 已处理的文件数（只增不减）
}

export interface SyncActivityCompleteEvent {
    type: 'sync_activity_complete';
    totalProcessed: number;
}

// ========== 联合类型 ==========

export type FileProgressEvent = 
    | UploadStartEvent
    | UploadProgressEvent
    | UploadCompleteEvent
    | DownloadStartEvent
    | DownloadProgressEvent
    | DownloadCompleteEvent
    | FileWriteStartEvent
    | FileWriteProgressEvent
    | FileWriteCompleteEvent
    | SyncActivityStartEvent
    | SyncActivityProgressEvent
    | SyncActivityCompleteEvent;

/**
 * 文件进度回调函数类型
 * core 层通过这个回调向外发送事件
 */
export type FileProgressCallback = (event: FileProgressEvent) => void;
