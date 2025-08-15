/**
 * Theme item from the simplified JSON structure
 */
export interface ThemeItem {
    id: string;
    name: string;
    author: string;
    version: string;
    screenshot: string;
    download_url: string;
    demo_url: string;
    demo_notes_url: string;
    tags: string[];
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
