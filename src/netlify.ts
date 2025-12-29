import {App, FileSystemAdapter, requestUrl} from "obsidian";
import type {RequestUrlResponse} from "obsidian";
import type FridayPlugin from "./main";
import * as path from "path";
import * as fs from "fs";
import JSZip from "jszip";

export class NetlifyAPI {
	app: App;
	plugin: FridayPlugin;
	basePath: string;

	constructor(plugin: FridayPlugin) {
		this.plugin = plugin;
		this.app = this.plugin.app;

		const adapter = this.app.vault.adapter;
		if (adapter instanceof FileSystemAdapter) {
			this.basePath = adapter.getBasePath();
		}
	}

	/**
	 * Deploy a directory to Netlify
	 * @param publicDir - The directory containing the site files
	 * @param progressCallback - Callback to report progress (0-100)
	 * @returns Promise<string> - The deployed site URL
	 */
	async deployToNetlify(publicDir: string, progressCallback?: (progress: number) => void): Promise<string> {
		const { netlifyAccessToken, netlifyProjectId } = this.plugin.settings;

		if (!netlifyAccessToken || !netlifyProjectId) {
			throw new Error('Netlify access token and project ID are required');
		}

		try {
			// Step 1: Create ZIP file (0-30%)
			progressCallback?.(5);
			const zipContent = await this.createZipFromDirectory(publicDir);
			progressCallback?.(30);

			// Step 2: Upload to Netlify (30-90%)
			const deployId = await this.uploadToNetlify(zipContent, netlifyAccessToken, netlifyProjectId, (uploadProgress) => {
				progressCallback?.(30 + uploadProgress * 0.6); // 30% to 90%
			});

			// Step 3: Wait for deployment to be ready (90-100%)
			progressCallback?.(90);

			try {
				await this.waitForDeployment(deployId, netlifyAccessToken);
			} catch (error) {
				console.warn('Failed to confirm deployment status via API, but deployment may still be successful:', error.message);
				// Continue anyway since the upload was successful
			}
			
			progressCallback?.(100);

			// Get the site URL
			return await this.getSiteUrl(netlifyProjectId, netlifyAccessToken);

		} catch (error) {
			console.error('Netlify deployment failed:', error);
			// Provide more specific error messages
			if (error.message.includes('401') || error.message.includes('Unauthorized')) {
				throw new Error('Invalid Netlify access token. Please check your settings.');
			} else if (error.message.includes('404') || error.message.includes('Not Found')) {
				throw new Error('Netlify site not found. Please check your project ID.');
			} else if (error.message.includes('network') || error.message.includes('CORS')) {
				throw new Error('Network error. Please check your internet connection.');
			}
			throw error;
		}
	}

	/**
	 * Create a ZIP file from a directory
	 */
	private async createZipFromDirectory(sourceDir: string): Promise<Uint8Array> {
		const zip = new JSZip();
		
		// Recursively add files to ZIP
		const addDirectoryToZip = async (dirPath: string, zipFolder: JSZip) => {
			const items = await fs.promises.readdir(dirPath, { withFileTypes: true });
			
			for (const item of items) {
				const itemPath = path.join(dirPath, item.name);
				
				if (item.isDirectory()) {
					const subFolder = zipFolder.folder(item.name);
					if (subFolder) {
						await addDirectoryToZip(itemPath, subFolder);
					}
			} else if (item.isFile()) {
				const fileContent = await fs.promises.readFile(itemPath);
				zipFolder.file(item.name, new Uint8Array(fileContent));
			}
			}
		};

		await addDirectoryToZip(sourceDir, zip);
		
		// Generate ZIP file
		return await zip.generateAsync({ type: 'uint8array' });
	}

	/**
	 * Upload ZIP file to Netlify using Obsidian's requestUrl to avoid CORS issues
	 * Simulates progress tracking with time-based updates
	 */
	private async uploadToNetlify(
		zipContent: Uint8Array, 
		accessToken: string, 
		siteId: string, 
		progressCallback?: (progress: number) => void
	): Promise<string> {
		try {
			// Start progress simulation
			const progressInterval = this.simulateUploadProgress(zipContent.length, progressCallback);

			const response: RequestUrlResponse = await requestUrl({
				url: `https://api.netlify.com/api/v1/sites/${siteId}/deploys`,
				method: 'POST',
				headers: {
					'Authorization': `Bearer ${accessToken}`,
					'Content-Type': 'application/zip',
				},
				body: zipContent.buffer as ArrayBuffer,
			});

			// Clear progress simulation
			clearInterval(progressInterval);
			progressCallback?.(100);

			if (response.status === 200) {
				return response.json.id;
			} else {
				throw new Error(`Upload failed with status: ${response.status} - ${response.text}`);
			}
		} catch (error) {
			console.error('Netlify upload error:', error);
			throw new Error(`Upload failed: ${error.message}`);
		}
	}

	/**
	 * Simulate upload progress based on file size and time
	 */
	private simulateUploadProgress(fileSize: number, progressCallback?: (progress: number) => void): NodeJS.Timeout {
		let progress = 0;
		const totalTime = Math.min(Math.max(fileSize / 1024 / 1024 * 2000, 3000), 30000); // 2s per MB, min 3s, max 30s
		const interval = 500; // Update every 500ms
		const increment = (interval / totalTime) * 100;

		return setInterval(() => {
			progress = Math.min(progress + increment, 95); // Cap at 95% until actual completion
			progressCallback?.(progress);
		}, interval);
	}

	/**
	 * Wait for deployment to be ready
	 */
	private async waitForDeployment(deployId: string, accessToken: string, maxAttempts = 30): Promise<void> {
		for (let i = 0; i < maxAttempts; i++) {
			try {
				const checkUrl = `https://api.netlify.com/api/v1/deploys/${deployId}`;

				const response: RequestUrlResponse = await requestUrl({
					url: checkUrl,
					method: 'GET',
					headers: {
						'Authorization': `Bearer ${accessToken}`,
					},
				});

				if (response.status === 200) {
					const deploy = response.json;
					if (deploy.state === 'ready') {
						return;
					} else if (deploy.state === 'error') {
						throw new Error(`Deployment failed: ${deploy.error_message || 'Unknown error'}`);
					}
				} else {
					console.warn(`Unexpected status code: ${response.status}, response: ${response.text}`);
				}

				// Wait 2 seconds before next check
				await new Promise(resolve => setTimeout(resolve, 2000));
			} catch (error) {
				console.error(`Error checking deployment status (attempt ${i + 1}):`, error);
				if (i === maxAttempts - 1) {
					throw error;
				}
				// Wait before retrying
				await new Promise(resolve => setTimeout(resolve, 2000));
			}
		}

		throw new Error('Deployment timed out');
	}

	/**
	 * Get the site URL
	 */
	private async getSiteUrl(siteId: string, accessToken: string): Promise<string> {
		try {
			const response: RequestUrlResponse = await requestUrl({
				url: `https://api.netlify.com/api/v1/sites/${siteId}`,
				method: 'GET',
				headers: {
					'Authorization': `Bearer ${accessToken}`,
				},
			});

			if (response.status === 200) {
				const site = response.json;
				return site.ssl_url || site.url;
			}

			throw new Error(`Failed to get site URL: ${response.status}`);
		} catch (error) {
			console.error('Failed to get site URL:', error);
			throw error;
		}
	}
}
