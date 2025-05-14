/**
 * Centralized type definitions for shortcodes
 */

/**
 * Metadata for a registered shortcode
 */
export interface ShortcodeMetadata {
    id: number;
    name: string;
    template: string;
    uuid: string;
    tags: string[];
}

/**
 * Item received from the shortcode API
 */
export interface ShortcodeItem {
    id: string;
    title: string;
    description?: string;
    template: string;
    tags?: string[];
    slug?: string;
    example?: string;
	asset?: string; // Image URL
	thumbnail?: string; // Thumbnail URL
	width?: number;
	height?: number;
}

/**
 * Result of a shortcode search operation
 */
export interface ShortcodeSearchResult {
    shortcodes: ShortcodeItem[];
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
