/**
 * File Progress Tracker
 * 
 * 文件级别的进度追踪
 * 专注于用户可见的文件操作：上传、下载、写入
 */

import type { FileProgressEvent } from '../types/FileProgressEvents';
import { $msg } from '../core/common/i18n';

export interface FileProgressState {
    // 上传
    totalFilesToUpload: number;
    uploadedFiles: number;
    
    // 下载
    totalFilesToDownload: number;
    downloadedFiles: number;
    
    // 写入
    totalFilesToWrite: number;
    writtenFiles: number;
    
    // 实时同步活动
    syncActivityProcessed: number;
    syncActivityCompleted: boolean;  // 新增：标记同步是否已完成
    
    // 当前操作
    currentOperation: 'upload' | 'download' | 'write' | 'sync_activity' | 'sync_completed' | 'idle';
}

export class FileProgressTracker {
    private state: FileProgressState = {
        totalFilesToUpload: 0,
        uploadedFiles: 0,
        totalFilesToDownload: 0,
        downloadedFiles: 0,
        totalFilesToWrite: 0,
        writtenFiles: 0,
        syncActivityProcessed: 0,
        syncActivityCompleted: false,
        currentOperation: 'idle',
    };
    
    private onChange: ((state: FileProgressState) => void) | null = null;
    
    /**
     * 处理来自 core 的文件进度事件
     */
    handleEvent(event: FileProgressEvent): void {
        switch (event.type) {
            // === 上传事件 ===
            case 'upload_start':
                this.state.currentOperation = 'upload';
                this.state.totalFilesToUpload = event.totalFiles;
                this.state.uploadedFiles = 0;
                break;
                
            case 'upload_progress':
                this.state.uploadedFiles = event.uploadedFiles;
                break;
                
            case 'upload_complete':
                this.state.uploadedFiles = event.successCount;
                setTimeout(() => this.reset(), 2000);
                break;
            
            // === 下载事件 ===
            case 'download_start':
                this.state.currentOperation = 'download';
                this.state.totalFilesToDownload = event.totalDocs;
                this.state.downloadedFiles = 0;
                break;
                
            case 'download_progress':
                this.state.downloadedFiles = event.downloadedDocs;
                break;
                
            case 'download_complete':
                this.state.downloadedFiles = event.totalDocs;
                // 下载完成后通常会进入写入阶段，不立即重置
                break;
            
            // === 文件写入事件 ===
            case 'file_write_start':
                this.state.currentOperation = 'write';
                this.state.totalFilesToWrite = event.totalFiles;
                this.state.writtenFiles = 0;
                break;
                
            case 'file_write_progress':
                this.state.writtenFiles = event.writtenFiles;
                break;
                
            case 'file_write_complete':
                this.state.writtenFiles = event.successCount;
                setTimeout(() => this.reset(), 2000);
                break;
            
            // === 实时同步活动事件 ===
            case 'sync_activity_start':
                this.state.currentOperation = 'sync_activity';
                this.state.syncActivityProcessed = 0;
                this.state.syncActivityCompleted = false;
                break;
                
            case 'sync_activity_progress':
                this.state.syncActivityProcessed = event.processedFiles;
                break;
                
            case 'sync_activity_complete':
                this.state.currentOperation = 'sync_completed';
                this.state.syncActivityProcessed = event.totalProcessed;
                this.state.syncActivityCompleted = true;
                // 显示完成状态3秒后隐藏
                setTimeout(() => this.reset(), 3000);
                break;
        }
        
        this.notifyChange();
    }
    
    /**
     * 重置状态
     */
    reset(): void {
        this.state = {
            totalFilesToUpload: 0,
            uploadedFiles: 0,
            totalFilesToDownload: 0,
            downloadedFiles: 0,
            totalFilesToWrite: 0,
            writtenFiles: 0,
            syncActivityProcessed: 0,
            syncActivityCompleted: false,
            currentOperation: 'idle',
        };
        this.notifyChange();
    }
    
    /**
     * 获取当前状态
     */
    getState(): FileProgressState {
        return { ...this.state };
    }
    
    /**
     * 计算总体进度（0-100）
     * @returns -1 表示不确定进度（显示滚动动画），0-100 表示确定进度
     */
    getOverallProgress(): number {
        const { currentOperation } = this.state;
        
        if (currentOperation === 'upload') {
            const { uploadedFiles, totalFilesToUpload } = this.state;
            return totalFilesToUpload > 0 ? (uploadedFiles / totalFilesToUpload) * 100 : 0;
        }
        
        if (currentOperation === 'download') {
            const { downloadedFiles, totalFilesToDownload } = this.state;
            return totalFilesToDownload > 0 ? (downloadedFiles / totalFilesToDownload) * 100 : 0;
        }
        
        if (currentOperation === 'write') {
            const { writtenFiles, totalFilesToWrite } = this.state;
            return totalFilesToWrite > 0 ? (writtenFiles / totalFilesToWrite) * 100 : 0;
        }
        
        // 实时同步进行中：返回 -1 表示不确定进度（触发滚动动画）
        if (currentOperation === 'sync_activity') {
            return -1;
        }
        
        // 实时同步完成：返回 100（显示绿色完成状态）
        if (currentOperation === 'sync_completed') {
            return 100;
        }
        
        return 0;
    }
    
    /**
     * 获取显示文本
     */
    getDisplayText(): string {
        const { currentOperation } = this.state;
        
        if (currentOperation === 'upload') {
            return $msg('fridaySync.progress.uploadingFiles', {
                current: this.state.uploadedFiles.toString(),
                total: this.state.totalFilesToUpload.toString()
            }) || `上传文件：${this.state.uploadedFiles}/${this.state.totalFilesToUpload}`;
        }
        
        if (currentOperation === 'download') {
            return $msg('fridaySync.progress.downloadingFiles', {
                current: this.state.downloadedFiles.toString(),
                total: this.state.totalFilesToDownload.toString()
            }) || `下载文件：${this.state.downloadedFiles}/${this.state.totalFilesToDownload}`;
        }
        
        if (currentOperation === 'write') {
            return $msg('fridaySync.progress.writingFiles', {
                current: this.state.writtenFiles.toString(),
                total: this.state.totalFilesToWrite.toString()
            }) || `写入文件：${this.state.writtenFiles}/${this.state.totalFilesToWrite}`;
        }
        
        // 实时同步进行中：不显示具体数字
        if (currentOperation === 'sync_activity') {
            return $msg('fridaySync.progress.syncing') || '正在同步...';
        }
        
        // 实时同步完成：显示完成提示
        if (currentOperation === 'sync_completed') {
            return $msg('fridaySync.progress.syncCompleted') || '同步完成 ✓';
        }
        
        return '';
    }
    
    /**
     * 监听状态变化
     */
    onStateChange(callback: (state: FileProgressState) => void): void {
        this.onChange = callback;
    }
    
    /**
     * 通知状态变化
     */
    private notifyChange(): void {
        if (this.onChange) {
            this.onChange(this.state);
        }
    }
}
