import * as ftp from "basic-ftp";
import * as path from "path";
import * as fs from "fs";

export interface FTPConfig {
	server: string;
	username: string;
	password: string;
	remoteDir: string;
	ignoreCert: boolean;
}

export interface FTPUploadProgress {
	fileName: string;
	bytesTransferred: number;
	totalBytes: number;
	percentage: number;
}

export class FTPUploader {
	private client: ftp.Client;
	private config: FTPConfig;
	private totalSize: number = 0;
	private transferredSize: number = 0;
	private onProgress?: (progress: FTPUploadProgress) => void;

	constructor(config: FTPConfig) {
		this.client = new ftp.Client();
		this.config = config;
	}

	/**
	 * Set progress callback
	 */
	setProgressCallback(callback: (progress: FTPUploadProgress) => void) {
		this.onProgress = callback;
	}

	/**
	 * Calculate total size of directory
	 */
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
	 */
	private async connectWithFallback(): Promise<{ usedSecure: boolean }> {
		const accessConfig = {
			host: this.config.server,
			user: this.config.username,
			password: this.config.password,
			secure: true, // Try FTPS first
			secureOptions: { 
				rejectUnauthorized: !this.config.ignoreCert 
			},
			// Timeout settings for slow networks and large files
			timeout: 90000  // 90 seconds timeout
		};

		// Enable verbose logging for debugging
		this.client.ftp.verbose = true;
		
		// Force IPv4 to avoid EPSV issues on Windows
		this.client.ftp.ipFamily = 4;

		try {
			// First attempt: FTPS (secure)
			await this.client.access(accessConfig);
			
			// Disable EPSV, use traditional PASV (better Windows compatibility)
			try {
				await this.client.send("EPSV ALL");
			} catch (epsvErr) {
				// Some servers don't support "EPSV ALL", ignore the error
				console.log('EPSV ALL command not supported, continuing with default settings');
			}
			
			return { usedSecure: true };
		} catch (err) {
			const errorMessage = String(err);

			// Check if it's a TLS/AUTH related error or login error that might be caused by FTPS
			if (/TLS|AUTH|SSL|SECURE|certificate|handshake/i.test(errorMessage) || 
				(/530/i.test(errorMessage) && /login/i.test(errorMessage))) {

				// Create a new client for plain FTP to avoid state issues
				this.client.close();
				this.client = new ftp.Client();
				this.client.ftp.verbose = true;
				
				// Force IPv4 for new client as well
				this.client.ftp.ipFamily = 4;
				
				// Second attempt: Plain FTP
				const plainConfig = {
					host: this.config.server,
					user: this.config.username,
					password: this.config.password,
					secure: false,
					timeout: 90000  // Same timeout for plain FTP
				};
				
				await this.client.access(plainConfig);
				
				// Disable EPSV for plain FTP too
				try {
					await this.client.send("EPSV ALL");
				} catch (epsvErr) {
					console.log('EPSV ALL command not supported, continuing with default settings');
				}
				
				return { usedSecure: false };
			} else {
				// Re-throw non-TLS related errors
				console.error('FTP connection failed with non-recoverable error:', errorMessage);
				throw err;
			}
		}
	}

	/**
	 * Upload directory to FTP server
	 */
	async uploadDirectory(localDir: string): Promise<{ success: boolean; usedSecure: boolean; error?: string }> {
		try {
			// Calculate total size for progress tracking
			this.totalSize = await this.calculateDirectorySize(localDir);
			this.transferredSize = 0;

			// Connect with automatic fallback first
			const connectionResult = await this.connectWithFallback();

			// Setup progress tracking after successful connection
			this.client.trackProgress(info => {
				this.transferredSize += info.bytes;
				
				const percentage = this.totalSize > 0 ? 
					Math.round((this.transferredSize / this.totalSize) * 100) : 0;

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

			return {
				success: true,
				usedSecure: connectionResult.usedSecure
			};

		} catch (error) {
			console.error('FTP upload failed:', error);
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
		try {
			const connectionResult = await this.connectWithFallback();
			this.client.close();
			
			return {
				success: true,
				usedSecure: connectionResult.usedSecure
			};
		} catch (error) {
			console.error('FTP connection test failed:', error);
			return {
				success: false,
				usedSecure: false,
				error: error instanceof Error ? error.message : String(error)
			};
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
