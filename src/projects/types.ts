/**
 * Project configuration types
 */

export interface ProjectLanguageContent {
	languageCode: string;
	contentPath: string; // relative path from vault root
	weight: number;
}

export interface ProjectPublishConfig {
	method: 'netlify' | 'ftp' | 'mdf-share';
	netlify?: {
		accessToken?: string;
		projectId?: string;
	};
	ftp?: {
		server?: string;
		username?: string;
		password?: string;
		remoteDir?: string;
		ignoreCert?: boolean;
		preferredSecure?: boolean; // Remember last successful connection type
	};
}

export interface ProjectConfig {
	// Unique identifier - relative path from vault root
	id: string;
	
	// Project name
	name: string;
	
	// Content configuration
	contents: ProjectLanguageContent[];
	defaultContentLanguage: string;
	
	// Site assets
	assetsPath?: string; // relative path from vault root
	
	// Basic settings
	sitePath: string;
	
	// Theme
	themeUrl: string;
	themeName: string;
	themeId: string;
	
	// Advanced settings
	googleAnalyticsId?: string;
	disqusShortname?: string;
	sitePassword?: string;
	
	// Publish configuration (project-specific)
	publishConfig?: ProjectPublishConfig;
	
	// Metadata
	createdAt: number;
	updatedAt: number;
}

export interface ProjectBuildHistory {
	projectId: string;
	timestamp: number;
	success: boolean;
	type: 'preview' | 'publish';
	publishMethod?: 'netlify' | 'ftp' | 'mdf-share';
	url?: string;
	error?: string;
	previewId?: string; // Preview directory ID for exporting
}

export interface ProjectsData {
	projects: ProjectConfig[];
	buildHistory: ProjectBuildHistory[];
}

