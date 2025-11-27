import * as ftp from "basic-ftp";
import * as path from "path";
import * as fs from "fs";
import * as crypto from "crypto";

export interface FTPConfig {
	server: string;
	username: string;
	password: string;
	remoteDir: string;
	ignoreCert: boolean;
	preferredSecure?: boolean; // Remember last successful connection type
}

export interface FTPUploadProgress {
	fileName: string;
	bytesTransferred: number;
	totalBytes: number;
	percentage: number;
}

export interface FileManifestEntry {
	hash: string;      // MD5 hash of file content
	size: number;      // File size in bytes
	mtime: number;     // Last modified time (timestamp)
	relativePath: string; // Relative path from upload root
}

export interface FileManifest {
	projectId: string;
	lastUploadTime: number;
	uploadMethod: 'ftp' | 'netlify' | 'other';
	remoteDir?: string; // FTP remote directory
	files: Record<string, FileManifestEntry>; // Key: relative file path, Value: file info
}

export class FTPUploader {
	private client: ftp.Client;
	private config: FTPConfig;
	private totalSize: number = 0;
	private transferredSize: number = 0;
	private onProgress?: (progress: FTPUploadProgress) => void;
	private lastProgressUpdate: number = 0;
	private onConnectionTypeDiscovered?: (secure: boolean) => void;

	constructor(config: FTPConfig) {
		this.client = new ftp.Client();
		this.config = config;
	}

	/**
	 * Set callback for when connection type is discovered
	 */
	setConnectionTypeCallback(callback: (secure: boolean) => void) {
		this.onConnectionTypeDiscovered = callback;
	}

	/**
	 * Set progress callback
	 */
	setProgressCallback(callback: (progress: FTPUploadProgress) => void) {
		this.onProgress = callback;
	}

	/**
	 * Calculate MD5 hash of a file
	 */
	private async calculateFileHash(filePath: string): Promise<string> {
		return new Promise((resolve, reject) => {
			const hash = crypto.createHash('md5');
			const stream = fs.createReadStream(filePath);
			
			stream.on('data', (data) => hash.update(data));
			stream.on('end', () => resolve(hash.digest('hex')));
			stream.on('error', reject);
		});
	}

	/**
	 * Generate file manifest for a directory
	 */
	async generateManifest(localDir: string, projectId: string): Promise<FileManifest> {
		const files: Record<string, FileManifestEntry> = {};

		const scanRecursive = async (currentPath: string, relativePath: string = '') => {
			const items = await fs.promises.readdir(currentPath, { withFileTypes: true });
			
			for (const item of items) {
				const itemPath = path.join(currentPath, item.name);
				const itemRelativePath = relativePath ? path.join(relativePath, item.name) : item.name;
				
				if (item.isDirectory()) {
					await scanRecursive(itemPath, itemRelativePath);
				} else if (item.isFile()) {
					const stats = await fs.promises.stat(itemPath);
					const hash = await this.calculateFileHash(itemPath);
					
					// Normalize path separators for cross-platform compatibility
					const normalizedPath = itemRelativePath.replace(/\\/g, '/');
					
					files[normalizedPath] = {
						hash,
						size: stats.size,
						mtime: stats.mtimeMs,
						relativePath: normalizedPath
					};
				}
			}
		};

		await scanRecursive(localDir);

		return {
			projectId,
			lastUploadTime: Date.now(),
			uploadMethod: 'ftp',
			remoteDir: this.config.remoteDir,
			files
		};
	}

	/**
	 * Compare two manifests and determine which files need to be uploaded/deleted
	 */
	compareManifests(oldManifest: FileManifest | null, newManifest: FileManifest): {
		toUpload: string[];      // Files to upload (new or modified)
		toDelete: string[];      // Files to delete from remote
		unchanged: string[];     // Files that haven't changed
	} {
		const toUpload: string[] = [];
		const toDelete: string[] = [];
		const unchanged: string[] = [];

		// If no old manifest, upload everything
		if (!oldManifest) {
			return {
				toUpload: Object.keys(newManifest.files),
				toDelete: [],
				unchanged: []
			};
		}

		// Find files to upload (new or modified)
		for (const [filePath, newEntry] of Object.entries(newManifest.files)) {
			const oldEntry = oldManifest.files[filePath];
			
			if (!oldEntry) {
				// New file
				toUpload.push(filePath);
			} else if (oldEntry.hash !== newEntry.hash) {
				// Modified file
				toUpload.push(filePath);
			} else {
				// Unchanged file
				unchanged.push(filePath);
			}
		}

		// Find files to delete (exist in old but not in new)
		for (const filePath of Object.keys(oldManifest.files)) {
			if (!newManifest.files[filePath]) {
				toDelete.push(filePath);
			}
		}

		return { toUpload, toDelete, unchanged };
	}
	private async calculateDirectorySize(dirPath: string): Promise<number> {
		let totalSize = 0;

		const calculateRecursive = async (currentPath: string) => {
			const items = await fs.promises.readdir(currentPath, { withFileTypes: true });
			
			for (const item of items) {
				const itemPath = path.join(currentPath, item.name);
				
				if (item.isDirectory()) {
					await calculateRecursive(itemPath);
				} else if (item.isFile()) {
					const stats = await fs.promises.stat(itemPath);
					totalSize += stats.size;
				}
			}
		};

		await calculateRecursive(dirPath);

		return totalSize;
	}

	/**
	 * Connect to FTP server with automatic fallback
	 * Now defaults to plain FTP first, then tries FTPS if that fails
	 */
	private async connectWithFallback(): Promise<{ usedSecure: boolean }> {
		// Enable verbose logging only in development
		const isDevelopment = process.env.NODE_ENV === 'development';
		this.client.ftp.verbose = isDevelopment;
		
		// Force IPv4 to avoid EPSV issues on Windows
		this.client.ftp.ipFamily = 4;

		// Determine connection order based on preferredSecure
		const trySecureFirst = this.config.preferredSecure === true;
		const tryPlainFirst = this.config.preferredSecure === false || this.config.preferredSecure === undefined;

		// Try preferred method first
		if (tryPlainFirst) {
			// Try plain FTP first (default and faster)
			const plainStart = Date.now();
			try {
				const result = await this.tryPlainFTP();
				if (this.onConnectionTypeDiscovered) {
					this.onConnectionTypeDiscovered(false);
				}
				return result;
			} catch (err) {
				// Plain FTP failed, try FTPS as fallback
				const ftpsStart = Date.now();
				try {
					this.client.close();
					this.client = new ftp.Client();
					this.client.ftp.verbose = isDevelopment;
					this.client.ftp.ipFamily = 4;
					
					const result = await this.trySecureFTP();
					const ftpsDuration = Date.now() - ftpsStart;
					if (this.onConnectionTypeDiscovered) {
						this.onConnectionTypeDiscovered(true);
					}
					return result;
				} catch (secureErr) {
					const ftpsDuration = Date.now() - ftpsStart;
					console.error(`[FTP Performance] ❌ FTPS also failed: ${ftpsDuration}ms`);
					console.error('[FTP Performance] ❌ Both plain FTP and FTPS failed');
					throw err; // Throw original error
				}
			}
		} else {
			// Try FTPS first (if user's previous connection was secure)
			try {
				const result = await this.trySecureFTP();
				if (this.onConnectionTypeDiscovered) {
					this.onConnectionTypeDiscovered(true);
				}
				return result;
			} catch (err) {
				// FTPS failed, try plain FTP as fallback
				const plainStart = Date.now();
				try {
					this.client.close();
					this.client = new ftp.Client();
					this.client.ftp.verbose = isDevelopment;
					this.client.ftp.ipFamily = 4;
					
					const result = await this.tryPlainFTP();
					if (this.onConnectionTypeDiscovered) {
						this.onConnectionTypeDiscovered(false);
					}
					return result;
				} catch (plainErr) {
					const plainDuration = Date.now() - plainStart;
					console.error(`[FTP Performance] ❌ Plain FTP also failed: ${plainDuration}ms`);
					console.error('[FTP Performance] ❌ Both FTPS and plain FTP failed');
					throw err; // Throw original error
				}
			}
		}
	}

	/**
	 * Try plain FTP connection
	 */
	private async tryPlainFTP(): Promise<{ usedSecure: boolean }> {
		const plainConfig = {
			host: this.config.server,
			user: this.config.username,
			password: this.config.password,
			secure: false,
			timeout: 90000
		};
		
		await this.client.access(plainConfig);
		return { usedSecure: false };
	}

	/**
	 * Try secure FTP connection
	 */
	private async trySecureFTP(): Promise<{ usedSecure: boolean }> {
		const secureConfig = {
			host: this.config.server,
			user: this.config.username,
			password: this.config.password,
			secure: true,
			secureOptions: { 
				rejectUnauthorized: !this.config.ignoreCert 
			},
			timeout: 90000
		};
		
		await this.client.access(secureConfig);
		return { usedSecure: true };
	}

	/**
	 * Upload directory to FTP server (full upload)
	 */
	async uploadDirectory(localDir: string): Promise<{ success: boolean; usedSecure: boolean; error?: string }> {
		const startTime = Date.now();

		try {
			// Start calculating total size asynchronously (don't block upload start)
			this.totalSize = 0;
			this.transferredSize = 0;
			const sizeCalculationPromise = this.calculateDirectorySize(localDir).then(size => {
				this.totalSize = size;
			});

			// Connect with automatic fallback first
			const connectionResult = await this.connectWithFallback();

			// Send initial 40% progress to give immediate visual feedback
			if (this.onProgress) {
				this.onProgress({
					fileName: 'Preparing upload...',
					bytesTransferred: 0,
					totalBytes: this.totalSize,
					percentage: 40
				});
			}

			// Setup throttled progress tracking after successful connection
			const PROGRESS_THROTTLE_MS = 200; // Update progress every 200ms max
			this.lastProgressUpdate = 0;
			
			this.client.trackProgress(info => {
				this.transferredSize += info.bytes;
				
				// Throttle progress updates to avoid excessive UI updates
				const now = Date.now();
				if (now - this.lastProgressUpdate < PROGRESS_THROTTLE_MS) {
					return; // Skip this update
				}
				this.lastProgressUpdate = now;
				
				// Calculate real progress percentage
				const realProgress = this.totalSize > 0 ? 
					(this.transferredSize / this.totalSize) : 0;
				
				// Apply easing function for better visual perception
				// Start from 40% and scale to 100% using square root
				// This makes: 0% → 40%, 25% → 70%, 50% → 82%, 75% → 92%, 100% → 100%
				const BASE_PROGRESS = 40; // Start at 40%
				const PROGRESS_RANGE = 60; // Remaining 60% to fill
				const easedProgress = Math.sqrt(realProgress);
				const percentage = Math.round(BASE_PROGRESS + easedProgress * PROGRESS_RANGE);

				if (this.onProgress) {
					this.onProgress({
						fileName: info.name || 'Unknown',
						bytesTransferred: this.transferredSize,
						totalBytes: this.totalSize,
						percentage
					});
				}
			});

			// Change to remote directory (create if needed)
			if (this.config.remoteDir && this.config.remoteDir !== '/') {
				try {
					await this.client.cd(this.config.remoteDir);
				} catch (err) {
					// Try to create the directory if it doesn't exist
					await this.client.ensureDir(this.config.remoteDir);
					await this.client.cd(this.config.remoteDir);
				}
			}

			// Upload directory contents
			await this.client.uploadFromDir(localDir);

			// Wait for size calculation to complete (if still running)
			await sizeCalculationPromise;

			// Send final 100% progress update
			if (this.onProgress) {
				this.onProgress({
					fileName: 'Complete',
					bytesTransferred: this.totalSize || this.transferredSize,
					totalBytes: this.totalSize || this.transferredSize,
					percentage: 100
				});
			}

			return {
				success: true,
				usedSecure: connectionResult.usedSecure
			};

		} catch (error) {
			const totalDuration = Date.now() - startTime;
			console.error(`[FTP Performance] ❌ Upload failed after ${totalDuration}ms:`, error);
			return {
				success: false,
				usedSecure: false,
				error: error instanceof Error ? error.message : String(error)
			};
		} finally {
			// Always close connection
			this.client.close();
		}
	}

	/**
	 * Test FTP connection
	 */
	async testConnection(): Promise<{ success: boolean; usedSecure: boolean; error?: string }> {
		const startTime = Date.now();

		try {
			const connectionResult = await this.connectWithFallback();
			this.client.close();

			return {
				success: true,
				usedSecure: connectionResult.usedSecure
			};
		} catch (error) {
			const totalDuration = Date.now() - startTime;
			console.error(`[FTP Performance] ❌ Connection test failed after ${totalDuration}ms:`, error);
			return {
				success: false,
				usedSecure: false,
				error: error instanceof Error ? error.message : String(error)
			};
		}
	}

	/**
	 * Incremental upload - only upload changed files
	 */
	async uploadDirectoryIncremental(
		localDir: string,
		projectId: string,
		oldManifest: FileManifest | null
	): Promise<{ 
		success: boolean; 
		usedSecure: boolean; 
		error?: string; 
		newManifest?: FileManifest;
		stats?: {
			uploaded: number;
			deleted: number;
			unchanged: number;
			totalFiles: number;
		}
	}> {
		const startTime = Date.now();

		try {
			// Generate new manifest
			const newManifest = await this.generateManifest(localDir, projectId);
			
			// Compare with old manifest
			const { toUpload, toDelete, unchanged } = this.compareManifests(oldManifest, newManifest);
			
			const stats = {
				uploaded: toUpload.length,
				deleted: toDelete.length,
				unchanged: unchanged.length,
				totalFiles: Object.keys(newManifest.files).length
			};

			// If nothing to do, return early
			if (toUpload.length === 0 && toDelete.length === 0) {
				return {
					success: true,
					usedSecure: false,
					newManifest,
					stats
				};
			}

			// Calculate total size for progress tracking
			this.totalSize = toUpload.reduce((sum, filePath) => {
				return sum + (newManifest.files[filePath]?.size || 0);
			}, 0);
			this.transferredSize = 0;

			// Connect to server
			const connectionResult = await this.connectWithFallback();

			// Send initial 40% progress
			if (this.onProgress) {
				this.onProgress({
					fileName: 'Preparing incremental upload...',
					bytesTransferred: 0,
					totalBytes: this.totalSize,
					percentage: 40
				});
			}

			// Setup throttled progress tracking
			const PROGRESS_THROTTLE_MS = 200;
			this.lastProgressUpdate = 0;
			
			this.client.trackProgress(info => {
				this.transferredSize += info.bytes;
				
				const now = Date.now();
				if (now - this.lastProgressUpdate < PROGRESS_THROTTLE_MS) {
					return;
				}
				this.lastProgressUpdate = now;
				
				const realProgress = this.totalSize > 0 ? (this.transferredSize / this.totalSize) : 0;
				const BASE_PROGRESS = 40;
				const PROGRESS_RANGE = 60;
				const easedProgress = Math.sqrt(realProgress);
				const percentage = Math.round(BASE_PROGRESS + easedProgress * PROGRESS_RANGE);

				if (this.onProgress) {
					this.onProgress({
						fileName: info.name || 'Unknown',
						bytesTransferred: this.transferredSize,
						totalBytes: this.totalSize,
						percentage
					});
				}
			});

			// Change to remote directory
			if (this.config.remoteDir && this.config.remoteDir !== '/') {
				try {
					await this.client.cd(this.config.remoteDir);
				} catch (err) {
					await this.client.ensureDir(this.config.remoteDir);
					await this.client.cd(this.config.remoteDir);
				}
			}

			// Delete obsolete files first
			if (toDelete.length > 0) {
				for (const filePath of toDelete) {
					try {
						await this.client.remove(filePath);
					} catch (err) {
						console.warn(`[FTP Incremental]   - Failed to delete ${filePath}:`, err);
					}
				}
			}

			// Track created directories to avoid repeated creation attempts
			const createdDirs = new Set<string>();
			
			for (const filePath of toUpload) {
				const localFilePath = path.join(localDir, filePath);
				const remoteFilePath = filePath;
				
				// Ensure remote directory exists
				const remoteDir = path.dirname(remoteFilePath).replace(/\\/g, '/');
				if (remoteDir && remoteDir !== '.' && remoteDir !== '/') {
					if (!createdDirs.has(remoteDir)) {
						try {
							// Split path and create directories one by one
							const parts = remoteDir.split('/').filter(p => p);
							let currentPath = '';
							
							for (const part of parts) {
								currentPath = currentPath ? `${currentPath}/${part}` : part;
								
								if (!createdDirs.has(currentPath)) {
									try {
										// Try to create directory
										await this.client.ensureDir(currentPath);
										createdDirs.add(currentPath);
									} catch (err) {
										// Directory might already exist, try to cd into it
										try {
											await this.client.cd(currentPath);
											createdDirs.add(currentPath);
										} catch (cdErr) {
											console.error(`[FTP Incremental]   - Failed to ensure dir ${currentPath}:`, err);
											throw new Error(`Cannot create or access directory: ${currentPath}`);
										}
									}
								}
							}
							
							// Go back to base directory
							if (this.config.remoteDir && this.config.remoteDir !== '/') {
								await this.client.cd(this.config.remoteDir);
							}
							
							createdDirs.add(remoteDir);
						} catch (err) {
							console.error(`[FTP Incremental]   - Failed to ensure directory ${remoteDir}:`, err);
							throw err;
						}
					}
				}
				
				// Upload file
				try {
					await this.client.uploadFrom(localFilePath, remoteFilePath);
				} catch (err) {
					console.error(`[FTP Incremental]   - Failed to upload ${filePath}:`, err);
					throw err;
				}
			}

			// Send final 100% progress
			if (this.onProgress) {
				this.onProgress({
					fileName: 'Complete',
					bytesTransferred: this.totalSize,
					totalBytes: this.totalSize,
					percentage: 100
				});
			}

			return {
				success: true,
				usedSecure: connectionResult.usedSecure,
				newManifest,
				stats
			};

		} catch (error) {
			const totalDuration = Date.now() - startTime;
			console.error(`[FTP Incremental] ❌ Incremental upload failed after ${totalDuration}ms:`, error);
			return {
				success: false,
				usedSecure: false,
				error: error instanceof Error ? error.message : String(error)
			};
		} finally {
			// Always close connection
			this.client.close();
		}
	}
}

/**
 * Utility function to validate FTP configuration
 */
export function validateFTPConfig(config: Partial<FTPConfig>): { valid: boolean; errors: string[] } {
	const errors: string[] = [];

	if (!config.server?.trim()) {
		errors.push('Server address is required');
	}

	if (!config.username?.trim()) {
		errors.push('Username is required');
	}

	if (!config.password?.trim()) {
		errors.push('Password is required');
	}

	// Remote directory is optional, but if provided should be valid
	if (config.remoteDir && !config.remoteDir.startsWith('/')) {
		errors.push('Remote directory should start with /');
	}

	return {
		valid: errors.length === 0,
		errors
	};
}
