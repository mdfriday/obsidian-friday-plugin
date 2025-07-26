import { App, TFolder, TFile, TAbstractFile, EventRef } from 'obsidian';
import * as path from 'path';

export class FileWatcher {
    private app: App;
    private watchedFolder: TFolder | null = null;
    private previewDir: string = '';
    private isWatching: boolean = false;
    private eventRefs: EventRef[] = [];

    constructor(app: App) {
        this.app = app;
    }

    startWatching(folder: TFolder, previewDir: string): void {
        if (this.isWatching) {
            this.stopWatching();
        }

        this.watchedFolder = folder;
        this.previewDir = previewDir;
        this.isWatching = true;

        // 监听文件修改事件
        const onModify = this.app.vault.on('modify', (file: TAbstractFile) => {
            if (file instanceof TFile && this.shouldWatchFile(file)) {
                this.handleFileChange(file, 'modify');
            }
        });

        // 监听文件创建事件
        const onCreate = this.app.vault.on('create', (file: TAbstractFile) => {
            if (file instanceof TFile && this.shouldWatchFile(file)) {
                this.handleFileChange(file, 'create');
            }
        });

        // 监听文件删除事件
        const onDelete = this.app.vault.on('delete', (file: TAbstractFile) => {
            if (file instanceof TFile && this.shouldWatchFile(file)) {
                this.handleFileChange(file, 'delete');
            }
        });

        // 监听文件重命名事件
        const onRename = this.app.vault.on('rename', (file: TAbstractFile, oldPath: string) => {
            if (file instanceof TFile && this.shouldWatchFile(file)) {
                this.handleFileRename(file, oldPath);
            }
        });

        // 保存事件引用以便后续清理
        this.eventRefs = [onModify, onCreate, onDelete, onRename];

        console.log(`Started watching folder: ${folder.path}`);
    }

    stopWatching(): void {
        if (!this.isWatching) {
            console.log('FileWatcher: Already stopped, skipping');
            return;
        }

        console.log(`FileWatcher: Stopping file watching for folder: ${this.watchedFolder?.path || 'unknown'}`);

        // 清理所有事件监听器
        this.eventRefs.forEach(eventRef => {
            this.app.vault.offref(eventRef);
        });
        this.eventRefs = [];

        this.isWatching = false;
        this.watchedFolder = null;
        this.previewDir = '';

        console.log('FileWatcher: Stopped file watching');
    }

    private shouldWatchFile(file: TFile): boolean {
        if (!this.watchedFolder || !file) {
            return false;
        }

        // 检查文件是否在监控的文件夹内
        return file.path.startsWith(this.watchedFolder.path);
    }

    private async handleFileChange(file: TFile, changeType: 'modify' | 'create' | 'delete'): Promise<void> {
        if (!this.watchedFolder || !this.previewDir) {
            return;
        }

        try {
            const relativePath = file.path.substring(this.watchedFolder.path.length + 1);
            const targetPath = path.join(this.previewDir, 'content', relativePath);

            switch (changeType) {
                case 'modify':
                case 'create':
                    // 复制更新的文件到预览目录
                    const content = await this.app.vault.read(file);
                    await this.app.vault.adapter.write(targetPath, content);
                    console.log(`File updated in preview: ${relativePath}`);
                    break;

                case 'delete':
                    // 从预览目录删除文件
                    if (await this.app.vault.adapter.exists(targetPath)) {
                        await this.app.vault.adapter.remove(targetPath);
                        console.log(`File removed from preview: ${relativePath}`);
                    }
                    break;
            }

            // 这里可以添加通知预览服务器重新构建的逻辑
            // 例如发送一个HTTP请求到本地服务器的重建端点
            this.notifyPreviewServer();

        } catch (error) {
            console.error(`Error handling file change for ${file.path}:`, error);
        }
    }

    private async handleFileRename(file: TFile, oldPath: string): Promise<void> {
        if (!this.watchedFolder || !this.previewDir) {
            return;
        }

        try {
            // 计算旧文件和新文件的相对路径
            const oldRelativePath = oldPath.substring(this.watchedFolder.path.length + 1);
            const newRelativePath = file.path.substring(this.watchedFolder.path.length + 1);
            
            const oldTargetPath = path.join(this.previewDir, 'content', oldRelativePath);
            const newTargetPath = path.join(this.previewDir, 'content', newRelativePath);

            // 删除旧文件
            if (await this.app.vault.adapter.exists(oldTargetPath)) {
                await this.app.vault.adapter.remove(oldTargetPath);
            }

            // 创建新文件
            const content = await this.app.vault.read(file);
            await this.app.vault.adapter.write(newTargetPath, content);

            console.log(`File renamed in preview: ${oldRelativePath} -> ${newRelativePath}`);
            
            this.notifyPreviewServer();

        } catch (error) {
            console.error(`Error handling file rename for ${file.path}:`, error);
        }
    }

    private notifyPreviewServer(): void {
        // 这里应该通知预览服务器重新构建
        // 在实际实现中，可能需要发送HTTP请求到本地服务器
        // 或者使用其他机制来触发重建
        console.log('Notifying preview server to rebuild...');
    }

    isCurrentlyWatching(): boolean {
        return this.isWatching;
    }

    getWatchedFolder(): TFolder | null {
        return this.watchedFolder;
    }
} 