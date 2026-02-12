/**
 * Service for fetching themes from a single JSON source
 */

import {requestUrl} from 'obsidian';
import type {ThemeItem, ThemeSearchResult} from './types';
import type FridayPlugin from '../main';

// Define the themes JSON URLs
const THEMES_JSON_URLS = {
    global: 'https://gohugo.net/themes.json',
    east: 'https://mdfriday.com/mdf/themes-zh.json'
};

// Cache for themes data (separate cache for each server)
let themesCache: { [key: string]: ThemeItem[] } = {};
let allTagsCache: { [key: string]: string[] } = {};
let cacheTimestamp: { [key: string]: number } = {};

// Cache expiration time: 2 hours in milliseconds
const CACHE_EXPIRY_MS = 2 * 60 * 60 * 1000;

/**
 * Raw theme data structure from the JSON file
 */
interface RawThemeData {
    id: number;
    name: string;
    author: string;
    version: string;
    screenshot: string;
    download_url: string;
    demo_url: string;
    demo_notes_url: string;
    tags: string[];
    kind?: string[]; // Plan types (e.g., ["Free"], ["Creator"], ["Pro"])
}

/**
 * Maps raw theme data to the app's ThemeItem format
 */
function mapRawThemeToThemeItem(rawTheme: RawThemeData): ThemeItem {
    return {
        // Direct fields from JSON
        id: String(rawTheme.id),
        name: rawTheme.name,
        author: rawTheme.author,
        version: rawTheme.version,
        screenshot: rawTheme.screenshot,
        download_url: rawTheme.download_url,
        demo_url: rawTheme.demo_url,
        demo_notes_url: rawTheme.demo_notes_url,
        tags: Array.isArray(rawTheme.tags) ? rawTheme.tags : [],
        kind: Array.isArray(rawTheme.kind) ? rawTheme.kind : undefined,
        
        // Computed fields for UI
        title: rawTheme.name || `Theme ${rawTheme.id}`,
        description: `${rawTheme.name} theme by ${rawTheme.author || 'Unknown'}`,
        thumbnail: rawTheme.screenshot,
        demo: rawTheme.demo_url,
        asset: rawTheme.screenshot
    };
}

/**
 * Fetches all themes from the specified JSON URL
 */
async function fetchAllThemes(themesUrl: string): Promise<ThemeItem[]> {
    try {
        // Add timestamp to URL to bypass Obsidian's cache
        const timestamp = Date.now();
        const urlWithTimestamp = `${themesUrl}?_t=${timestamp}`;
        
        const response = await requestUrl({
            url: urlWithTimestamp,
            method: 'GET',
            headers: {
                'Content-Type': 'application/json'
            }
        });
        
        if (response.status !== 200) {
            throw new Error(`Failed to fetch themes: ${response.status}`);
        }
        
        const rawThemes: RawThemeData[] = response.json;
        
        if (!Array.isArray(rawThemes)) {
            throw new Error('Invalid themes data format');
        }
        
        return rawThemes
            .map(mapRawThemeToThemeItem)
            .filter(theme => theme.name !== 'Base'); // 过滤掉 Base 主题
    } catch (error) {
        console.error('Error fetching themes:', error);
        throw error;
    }
}

/**
 * Extracts all unique tags from themes
 */
function extractAllTags(themes: ThemeItem[]): string[] {
    const allTags = themes.flatMap(theme => theme.tags);
    const uniqueTags = [...new Set(allTags)];
    return uniqueTags.sort((a, b) => a.localeCompare(b));
}

/**
 * Filters themes based on search term and selected tags
 */
function filterThemes(
    themes: ThemeItem[], 
    searchTerm: string = '', 
    selectedTags: string[] = []
): ThemeItem[] {
    let filteredThemes = themes;
    
    // Apply search term filter
    if (searchTerm.trim()) {
        const term = searchTerm.trim().toLowerCase();
        filteredThemes = filteredThemes.filter(theme => 
            theme.name.toLowerCase().includes(term) ||
            theme.author.toLowerCase().includes(term) ||
            theme.tags.some(tag => tag.toLowerCase().includes(term))
        );
    }
    
    // Apply tags filter
    if (selectedTags.length > 0) {
        filteredThemes = filteredThemes.filter(theme =>
            selectedTags.every(selectedTag =>
                theme.tags.some(tag => tag === selectedTag)
            )
        );
    }
    
    return filteredThemes;
}

/**
 * Get the current themes URL based on plugin settings
 */
function getThemesUrl(plugin?: FridayPlugin): string {
    if (!plugin) {
        return THEMES_JSON_URLS.global; // Default fallback
    }
    const downloadServer = plugin.settings.downloadServer || 'global';
    return THEMES_JSON_URLS[downloadServer];
}

/**
 * Simplified API service for fetching themes from JSON
 */
export const themeApiService = {
    /**
     * Initialize and cache all themes data
     */
    async initializeThemes(plugin?: FridayPlugin): Promise<void> {
        const themesUrl = getThemesUrl(plugin);
        const serverKey = plugin?.settings.downloadServer || 'global';
        const now = Date.now();
        const isCacheExpired = !cacheTimestamp[serverKey] || (now - cacheTimestamp[serverKey]) > CACHE_EXPIRY_MS;
        
        if (!themesCache[serverKey] || isCacheExpired) {
            themesCache[serverKey] = await fetchAllThemes(themesUrl);
            allTagsCache[serverKey] = extractAllTags(themesCache[serverKey]);
            cacheTimestamp[serverKey] = now;
        }
    },

    /**
     * Get all themes, initializing cache if needed
     */
    async getAllThemes(plugin?: FridayPlugin): Promise<ThemeItem[]> {
        await this.initializeThemes(plugin);
        const serverKey = plugin?.settings.downloadServer || 'global';
        return themesCache[serverKey] || [];
    },

    /**
     * Fetch themes with pagination and filtering (for backward compatibility)
     */
    async fetchThemes(
        page = 1,
        limit = 20,
        selectedTags: string[] = [],
        searchTerm = '',
        plugin?: FridayPlugin
    ): Promise<ThemeSearchResult> {
        return this.searchThemes(page, limit, searchTerm, selectedTags, plugin);
    },
    
    /**
     * Search themes with pagination, text search and tag filtering
     */
    async searchThemes(
        page = 1,
        limit = 20,
        searchTerm = '',
        selectedTags: string[] = [],
        plugin?: FridayPlugin
    ): Promise<ThemeSearchResult> {
        try {
            await this.initializeThemes(plugin);
            const serverKey = plugin?.settings.downloadServer || 'global';
            const allThemes = themesCache[serverKey] || [];
            
            // Filter themes based on search criteria
            const filteredThemes = filterThemes(allThemes, searchTerm, selectedTags);
            
            // Apply pagination
            const startIndex = (page - 1) * limit;
            const endIndex = startIndex + limit;
            const paginatedThemes = filteredThemes.slice(startIndex, endIndex);
            
            // Determine if there are more themes
            const hasMore = endIndex < filteredThemes.length;

            return { themes: paginatedThemes, hasMore };
        } catch (error) {
            console.error('Error searching themes:', error);
            return { themes: [], hasMore: false };
        }
    },
    
    /**
     * Fetch all theme tags
     */
    async fetchAllTags(plugin?: FridayPlugin): Promise<string[]> {
        try {
            await this.initializeThemes(plugin);
            const serverKey = plugin?.settings.downloadServer || 'global';
            return allTagsCache[serverKey] || [];
        } catch (error) {
            console.error('Error fetching theme tags:', error);
            return [];
        }
    },

    /**
     * Create theme metadata object for registration
     */
    createThemeMetadata(theme: ThemeItem): any {
        return {
            id: parseInt(theme.id, 10),
            name: theme.title,
            template: '', // No template field in simplified data
            uuid: theme.id,
            tags: theme.tags
        };
    },

    /**
     * Get theme by ID
     * @param themeId The ID of the theme to fetch
     * @returns The theme item, or null if not found
     */
    async getThemeById(themeId: string, plugin?: FridayPlugin): Promise<ThemeItem | null> {
        try {
            await this.initializeThemes(plugin);
            const serverKey = plugin?.settings.downloadServer || 'global';
            const themes = themesCache[serverKey] || [];
            return themes.find(theme => theme.id === themeId) || null;
        } catch (error) {
            console.error('Error getting theme by ID:', error);
            return null;
        }
    },

    /**
     * Fetch a theme by its name
     * @param name The name of the theme to fetch
     * @returns The theme item, or null if not found
     */
    async fetchThemeByName(name: string, plugin?: FridayPlugin): Promise<ThemeItem | null> {
        try {
            await this.initializeThemes(plugin);
            const serverKey = plugin?.settings.downloadServer || 'global';
            const allThemes = themesCache[serverKey] || [];
            
            // Find theme by name (case-insensitive)
            const theme = allThemes.find(t => 
                t.name.toLowerCase() === name.toLowerCase()
            );
            
            return theme || null;
        } catch (error) {
            console.error(`Error fetching theme by name '${name}':`, error);
            return null;
        }
    },

    /**
     * Clear the themes cache (useful for testing or refreshing data)
     */
    clearCache(serverKey?: string): void {
        if (serverKey) {
            // Clear cache for specific server
            delete themesCache[serverKey];
            delete allTagsCache[serverKey];
            delete cacheTimestamp[serverKey];
        } else {
            // Clear all caches
            themesCache = {};
            allTagsCache = {};
            cacheTimestamp = {};
        }
    }
}; 
