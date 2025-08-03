/**
 * Service for managing themes
 */

import {themeApiService} from "./themeApiService";
import type {ThemeItem, ThemeMetadata} from "./types";
import {parseJson, decodeBase64} from "./themeUtils";

// Global theme registry (if needed for future extensions)
class ThemeRegistry {
    private themes: Map<string, ThemeMetadata> = new Map();

    registerTheme(metadata: ThemeMetadata): void {
        this.themes.set(metadata.name, metadata);
    }

    getTheme(name: string): ThemeMetadata | undefined {
        return this.themes.get(name);
    }

    getAllThemes(): ThemeMetadata[] {
        return Array.from(this.themes.values());
    }

    clear(): void {
        this.themes.clear();
    }
}

const globalThemeRegistry = new ThemeRegistry();

export const themeService = {
    /**
     * Get the global theme registry instance
     */
    getRegistry(): ThemeRegistry {
        return globalThemeRegistry;
    },

    /**
     * Register a theme from API data
     */
    registerTheme(themeItem: ThemeItem): void {
        // Make sure we have a valid theme item
        if (!themeItem.id || !themeItem.name) {
            console.error('Invalid theme item provided for registration:', themeItem);
            return;
        }

        try {
            // Create theme metadata
            const metadata: ThemeMetadata = {
                id: parseInt(themeItem.id, 10),
                name: themeItem.name,
                template: '', // No template in real data
                uuid: themeItem.id,
                tags: themeItem.tags || []
            };

            globalThemeRegistry.registerTheme(metadata);
            console.log(`Theme registered: ${themeItem.name}`);
        } catch (error) {
            console.error(`Failed to register theme: ${themeItem.name}`, error);
        }
    },

    /**
     * Fetch and register themes from API
     */
    async loadAndRegisterThemes(searchTerm = '', selectedTags: string[] = []): Promise<ThemeItem[]> {
        try {
            const result = await themeApiService.searchThemes(1, 50, searchTerm, selectedTags);
            
            // Register all themes
            result.themes.forEach(theme => {
                this.registerTheme(theme);
            });

            return result.themes;
        } catch (error) {
            console.error('Failed to load and register themes:', error);
            return [];
        }
    },

    /**
     * Get theme by ID
     */
    async getThemeById(themeId: string): Promise<ThemeItem | null> {
        try {
            return await themeApiService.fetchThemeByName(themeId);
        } catch (error) {
            console.error(`Failed to fetch theme by ID: ${themeId}`, error);
            return null;
        }
    },

    /**
     * Search themes
     */
    async searchThemes(
        page = 1,
        limit = 20,
        searchTerm = '',
        selectedTags: string[] = []
    ): Promise<{themes: ThemeItem[], hasMore: boolean}> {
        try {
            return await themeApiService.searchThemes(page, limit, searchTerm, selectedTags);
        } catch (error) {
            console.error('Failed to search themes:', error);
            return {themes: [], hasMore: false};
        }
    },

    /**
     * Get all available tags
     */
    async getAllTags(): Promise<string[]> {
        try {
            return await themeApiService.fetchAllTags();
        } catch (error) {
            console.error('Failed to fetch theme tags:', error);
            return [];
        }
    },

    /**
     * Clear all registered themes
     */
    clearRegistry(): void {
        globalThemeRegistry.clear();
    }
}; 