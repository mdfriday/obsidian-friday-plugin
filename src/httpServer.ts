import type { App } from 'obsidian';
import * as http from 'http';
import * as fs from 'fs';
import * as path from 'path';
import * as url from 'url';

export class LocalHttpServer {
    private app: App;
    private server: http.Server | null = null;
    private port: number = 8090;
    private isRunning: boolean = false;
    private previewDir: string;
    private watchers: fs.FSWatcher[] = [];

    constructor(app: App, previewDir: string) {
        this.app = app;
        this.previewDir = previewDir;
    }

    // Add method to change preview directory
    setPreviewDir(newPreviewDir: string): void {
        this.previewDir = newPreviewDir;
    }

    getPreviewDir(): string {
        return this.previewDir;
    }

    async start(): Promise<boolean> {
        if (this.isRunning) {
            return true;
        }

        try {
            this.server = http.createServer((req, res) => {
                this.handleRequest(req, res).catch(error => {
                    console.error('Error handling HTTP request:', error);
                    this.serve404(res);
                });
            });

            return new Promise((resolve) => {
                this.server!.listen(this.port, 'localhost', () => {
                    this.isRunning = true;
                    // this.startFileWatching();
                    resolve(true);
                });

                this.server!.on('error', (error: any) => {
                    console.error('Failed to start HTTP server:', error);
                    if (error.code === 'EADDRINUSE') {
                        // 端口被占用，尝试下一个端口
                        this.port++;
                        if (this.port < 8099) { // 最多尝试5个端口
                            this.server!.listen(this.port, 'localhost');
                        } else {
                            resolve(false);
                        }
                    } else {
                        resolve(false);
                    }
                });
            });
        } catch (error) {
            console.error('Failed to start HTTP server:', error);
            return false;
        }
    }

    private async handleRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
        const parsedUrl = url.parse(req.url || '/', true);
        let pathname = parsedUrl.pathname || '/';

        // 移除开头的斜杠
        if (pathname.startsWith('/')) {
            pathname = pathname.substring(1);
        }

        // 如果是根路径，先检查是否有index.html
        if (pathname === '' || pathname === '/') {
            const rootIndexPath = path.join(this.previewDir, 'index.html');
            try {
                const indexExists = await this.app.vault.adapter.exists(rootIndexPath);
                if (indexExists) {
                    await this.serveFile(rootIndexPath, res);
                    return;
                }
            } catch (error) {
                console.error('Error checking root index.html:', error);
            }
            // 如果没有index.html，显示预览目录列表
            await this.serveDirectoryListing(res);
            return;
        }

        // 构建文件路径
        const filePath = path.join(this.previewDir, pathname);

        try {
            // 使用Obsidian的文件系统API检查文件是否存在
            const exists = await this.app.vault.adapter.exists(filePath);

            if (!exists) {
                this.serve404(res);
                return;
            }

            // 检查是否是目录
            const stat = await this.app.vault.adapter.stat(filePath);
            if (stat && stat.type === 'folder') {
                // 如果是目录，首先尝试查找index.html
                const indexPath = path.join(filePath, 'index.html');
                const indexExists = await this.app.vault.adapter.exists(indexPath);
                if (indexExists) {
                    await this.serveFile(indexPath, res);
                } else {
                    // 如果没有index.html，显示目录列表
                    await this.serveDirectoryListing(res, filePath);
                }
            } else {
                // 如果是文件，直接提供文件服务
                await this.serveFile(filePath, res);
            }
        } catch (error) {
            console.error('Error handling request:', error);
            this.serve404(res);
        }
    }

    private async serveFile(filePath: string, res: http.ServerResponse): Promise<void> {
        const ext = path.extname(filePath).toLowerCase();
        const mimeTypes: { [key: string]: string } = {
            '.html': 'text/html; charset=utf-8',
            '.css': 'text/css; charset=utf-8',
            '.js': 'application/javascript; charset=utf-8',
            '.json': 'application/json; charset=utf-8',
            '.png': 'image/png',
            '.jpg': 'image/jpeg',
            '.jpeg': 'image/jpeg',
            '.gif': 'image/gif',
            '.svg': 'image/svg+xml',
            '.ico': 'image/x-icon'
        };

        const contentType = mimeTypes[ext] || 'text/plain; charset=utf-8';

        // 判断是否为二进制文件（图片文件）
        const binaryExtensions = ['.png', '.jpg', '.jpeg', '.gif', '.ico', '.bmp', '.webp', '.tiff', '.tif'];
        const isBinary = binaryExtensions.includes(ext);

        try {
            let data: string | ArrayBuffer;
            
            if (isBinary) {
                // 对于二进制文件，使用readBinary方法
                data = await this.app.vault.adapter.readBinary(filePath);
            } else {
                // 对于文本文件，使用read方法
                data = await this.app.vault.adapter.read(filePath);
            }
            
            res.writeHead(200, { 
                'Content-Type': contentType,
                'Cache-Control': 'no-cache'
            });
            
            if (isBinary) {
                // 对于二进制数据，需要转换为Buffer
                res.end(Buffer.from(data as ArrayBuffer));
            } else {
                res.end(data as string);
            }
        } catch (error) {
            console.error(`Error reading file ${filePath}:`, error);
            this.serve404(res);
        }
    }

    private async serveDirectoryListing(res: http.ServerResponse, dirPath?: string): Promise<void> {
        const targetDir = dirPath || this.previewDir;

        try {
            // 确保目录存在
            const exists = await this.app.vault.adapter.exists(targetDir);
            if (!exists) {
                this.serve404(res);
                return;
            }

            const files = await this.app.vault.adapter.list(targetDir);

            const allItems = [...files.folders, ...files.files];
            const fileNames = allItems.map(item => path.basename(item));

            const html = `
<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <title>MDFriday Preview Server</title>
    <style>
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; margin: 40px; }
        h1 { color: #333; border-bottom: 2px solid #007acc; padding-bottom: 10px; }
        .directory { background: #f5f5f5; padding: 20px; border-radius: 8px; }
        .file-item { padding: 10px; border-bottom: 1px solid #ddd; }
        .file-item:last-child { border-bottom: none; }
        .file-item a { text-decoration: none; color: #007acc; }
        .file-item a:hover { text-decoration: underline; }
        .folder { color: #666; }
        .empty { color: #999; font-style: italic; }
        .debug { background: #fff3cd; padding: 10px; margin: 20px 0; border-radius: 4px; font-family: monospace; font-size: 12px; }
    </style>
</head>
<body>
    <h1>📁 MDFriday Preview Server</h1>
    <div class="debug">
        <strong>Debug Info:</strong><br>
        Target Directory: ${targetDir}<br>
        Files Found: ${fileNames.length}<br>
        Folders: ${files.folders.length}<br>
        Files: ${files.files.length}
    </div>
    <div class="directory">
        <h3>Available Previews:</h3>
        ${fileNames.length === 0 ? 
            '<p class="empty">No preview sites available. Create a preview from Obsidian first.</p>' :
            fileNames.map(fileName => {
                const isDir = files.folders.some(folder => path.basename(folder) === fileName);
                return `<div class="file-item">
                    ${isDir ? '📁' : '📄'} <a href="/${fileName}${isDir ? '/' : ''}">${fileName}</a>
                </div>`;
            }).join('')
        }
    </div>
    <p style="margin-top: 30px; color: #666; font-size: 14px;">
        Server running on port ${this.port} | MDFriday Obsidian Plugin
    </p>
</body>
</html>`;

            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
            res.end(html);
        } catch (error) {
            console.error(`Error reading directory ${targetDir}:`, error);
            this.serve404(res);
        }
    }

    private serve404(res: http.ServerResponse): void {
        const html = `
<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <title>404 - Not Found</title>
    <style>
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; margin: 40px; text-align: center; }
        h1 { color: #e74c3c; }
    </style>
</head>
<body>
    <h1>404 - Not Found</h1>
    <p>The requested file or directory was not found.</p>
    <a href="/">← Back to Preview List</a>
</body>
</html>`;
        
        res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(html);
    }

    private startFileWatching(): void {
        try {
            // 监控预览根目录
            const watcher = fs.watch(this.previewDir, { recursive: true }, (eventType, filename) => {
                if (filename) {
                    // 这里可以添加更多的文件变化处理逻辑
                    // 比如通知客户端刷新页面等
                }
            });

            this.watchers.push(watcher);
        } catch (error) {
            console.warn('File watching not supported on this system:', error);
        }
    }

    async stop(): Promise<void> {
        if (!this.isRunning) {
            return;
        }

        try {
            // 停止文件监控
            this.watchers.forEach(watcher => {
                watcher.close();
            });
            this.watchers = [];

            // 停止HTTP服务器
            if (this.server) {
                return new Promise((resolve) => {
                    this.server!.close(() => {
                        this.server = null;
                        this.isRunning = false;
                        resolve();
                    });
                });
            }
        } catch (error) {
            console.error('Failed to stop HTTP server:', error);
        }
    }

    isServerRunning(): boolean {
        return this.isRunning;
    }

    getPort(): number {
        return this.port;
    }

    getPreviewUrl(previewId: string): string {
        return `http://localhost:${this.port}/${previewId}/`;
    }

    async checkHealth(): Promise<boolean> {
        if (!this.isRunning) {
            return false;
        }

        return new Promise((resolve) => {
            const req = http.request({
                hostname: 'localhost',
                port: this.port,
                path: '/',
                method: 'GET',
                timeout: 1000
            }, (res) => {
                resolve(res.statusCode === 200);
            });

            req.on('error', () => {
                resolve(false);
            });

            req.end();
        });
    }
}

// 全局HTTP服务器实例
let globalHttpServer: LocalHttpServer | null = null;

export function getGlobalHttpServer(app: App, previewDir: string): LocalHttpServer {
    if (!globalHttpServer) {
        globalHttpServer = new LocalHttpServer(app, previewDir);
    }
    return globalHttpServer;
}

export function resetGlobalHttpServer(): void {
    globalHttpServer = null;
}

export function stopGlobalHttpServer(): Promise<void> {
    if (globalHttpServer) {
        return globalHttpServer.stop();
    }
    return Promise.resolve();
} 
