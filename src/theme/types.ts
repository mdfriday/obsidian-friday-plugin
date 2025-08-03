/**
 * Centralized type definitions for themes
 */

/**
 * Metadata for a registered theme
 */
export interface ThemeMetadata {
    id: number;
    name: string;
    template?: string; // Optional since not in real backend data
    uuid: string;
    tags: string[];
}

/**
 * Item received from the theme API
 */
export interface ThemeItem {
    id: string;
    name: string;
    slug: string;
    tags: string[];
    uuid: string;
    status: string;
    namespace: string;
    hash: string;
    timestamp: number;
    updated: number;
    author: string;
    version: string;
    screenshot: string;
    download_url: string;
    demo_url: string;
    // Computed fields for UI
    title: string; // Computed from name
    description?: string; // Computed description
    thumbnail?: string; // Computed thumbnail URL
    demo?: string; // Alias for demo_url
    asset?: string; // Alias for screenshot
}

/**
 * Result of a theme search operation
 */
export interface ThemeSearchResult {
    themes: ThemeItem[];
    hasMore: boolean;
}

// Parameters for getThumbnailUrl
export interface ThumbnailParams {
    id: number;
    assetUrl: string;
    width: number;
    height: number;
    maxWidth?: number;
    maxHeight?: number;
} 