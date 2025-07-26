import { App } from 'obsidian';
import * as http from 'http';
import * as fs from 'fs';
import * as path from 'path';
import * as url from 'url';

export class LocalHttpServer {
    private app: App;
    private server: http.Server | null = null;
    private port: number = 1314;
    private isRunning: boolean = false;
    private previewDir: string;
    private watchers: fs.FSWatcher[] = [];

    constructor(app: App, previewDir: string) {
        this.app = app;
        this.previewDir = previewDir;
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
                    console.log(`HTTP server started on http://localhost:${this.port}`);
                    this.startFileWatching();
                    resolve(true);
                });

                this.server!.on('error', (error: any) => {
                    console.error('Failed to start HTTP server:', error);
                    if (error.code === 'EADDRINUSE') {
                        // 端口被占用，尝试下一个端口
                        this.port++;
                        if (this.port < 1320) { // 最多尝试5个端口
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

        console.log(`HTTP Request: ${req.method} ${pathname}`);

        // 移除开头的斜杠
        if (pathname.startsWith('/')) {
            pathname = pathname.substring(1);
        }

        // 如果是根路径，显示预览目录列表
        if (pathname === '' || pathname === '/') {
            await this.serveDirectoryListing(res);
            return;
        }

        // 构建文件路径
        const filePath = path.join(this.previewDir, pathname);
        console.log(`Trying to serve file: ${filePath}`);
        
        try {
            // 使用Obsidian的文件系统API检查文件是否存在
            const exists = await this.app.vault.adapter.exists(filePath);
            console.log(`File exists: ${exists}`);
            
            if (!exists) {
                // 如果是目录路径，尝试查找index.html
                const indexPath = path.join(filePath, 'index.html');
                console.log(`Trying index.html: ${indexPath}`);
                const indexExists = await this.app.vault.adapter.exists(indexPath);
                console.log(`Index exists: ${indexExists}`);
                
                if (indexExists) {
                    await this.serveFile(indexPath, res);
                } else {
                    this.serve404(res);
                }
                return;
            }

            // 检查是否是目录
            const stat = await this.app.vault.adapter.stat(filePath);
            if (stat && stat.type === 'folder') {
                const indexPath = path.join(filePath, 'index.html');
                const indexExists = await this.app.vault.adapter.exists(indexPath);
                if (indexExists) {
                    await this.serveFile(indexPath, res);
                } else {
                    await this.serveDirectoryListing(res, filePath);
                }
            } else {
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
            '.html': 'text/html',
            '.css': 'text/css',
            '.js': 'application/javascript',
            '.json': 'application/json',
            '.png': 'image/png',
            '.jpg': 'image/jpeg',
            '.jpeg': 'image/jpeg',
            '.gif': 'image/gif',
            '.svg': 'image/svg+xml',
            '.ico': 'image/x-icon'
        };

        const contentType = mimeTypes[ext] || 'text/plain';
        console.log(`Serving file: ${filePath} as ${contentType}`);

        try {
            const data = await this.app.vault.adapter.read(filePath);
            res.writeHead(200, { 
                'Content-Type': contentType,
                'Cache-Control': 'no-cache'
            });
            res.end(data);
        } catch (error) {
            console.error(`Error reading file ${filePath}:`, error);
            this.serve404(res);
        }
    }

    private async serveDirectoryListing(res: http.ServerResponse, dirPath?: string): Promise<void> {
        const targetDir = dirPath || this.previewDir;
        console.log(`Serving directory listing for: ${targetDir}`);
        
        try {
            // 确保目录存在
            const exists = await this.app.vault.adapter.exists(targetDir);
            if (!exists) {
                console.log(`Directory does not exist: ${targetDir}`);
                this.serve404(res);
                return;
            }

            const files = await this.app.vault.adapter.list(targetDir);
            console.log(`Directory contents:`, files);
            
            const allItems = [...files.folders, ...files.files];
            const fileNames = allItems.map(item => path.basename(item));

            const html = `
<!DOCTYPE html>
<html>
<head>
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

            res.writeHead(200, { 'Content-Type': 'text/html' });
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
        
        res.writeHead(404, { 'Content-Type': 'text/html' });
        res.end(html);
    }

    private startFileWatching(): void {
        try {
            // 监控预览根目录
            const watcher = fs.watch(this.previewDir, { recursive: true }, (eventType, filename) => {
                if (filename) {
                    console.log(`File ${eventType}: ${filename}`);
                    // 这里可以添加更多的文件变化处理逻辑
                    // 比如通知客户端刷新页面等
                }
            });

            this.watchers.push(watcher);
            console.log(`Started watching directory: ${this.previewDir}`);
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
                        console.log('HTTP server stopped');
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

export function stopGlobalHttpServer(): Promise<void> {
    if (globalHttpServer) {
        return globalHttpServer.stop();
    }
    return Promise.resolve();
} 