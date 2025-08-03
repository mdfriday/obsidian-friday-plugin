/**
 * Service for communicating with the backend API to fetch themes
 */

import {requestUrl} from 'obsidian';
import {GetBaseUrl} from '../main';
import {getFullAssetUrl, getThumbnailUrl} from "./themeUtils";
import type {ThemeItem, ThemeSearchResult} from './types';

// Define API endpoints
const API_ENDPOINTS = {
    THEMES: '/api/themes',
    THEME_DETAILS: '/api/theme',
    THEME_SEARCH: '/api/theme/search',
    THEME_TAGS: '/api/theme/tags',
};

// Define theme request parameters
const THEME_REQUEST_PARAMS = {
    type: 'Theme',
    count: 20,
    order: 'desc',
};

/**
 * Helper API utility for making API requests
 */
const api = {
    async get<T>(url: string, options?: { params?: Record<string, any> }): Promise<T> {
        try {
            const apiUrl = GetBaseUrl();
            let fullUrl = apiUrl + url;
            
            // Add query parameters if provided
            if (options?.params) {
                const queryParams = new URLSearchParams();
                for (const [key, value] of Object.entries(options.params)) {
                    if (value !== undefined) {
                        queryParams.append(key, String(value));
                    }
                }
                const queryString = queryParams.toString();
                if (queryString) {
                    fullUrl += `?${queryString}`;
                }
            }

            const response = await requestUrl({
                url: fullUrl,
                method: 'GET',
                headers: {
                    'Content-Type': 'application/json'
                }
            });
            
            if (response.status !== 200) {
                throw new Error(`API request failed with status ${response.status}`);
            }
            
            return response.json as unknown as T;
        } catch (error) {
            console.error('API request failed:', error);
            throw error;
        }
    }
};

/**
 * Maps API Template item to the app's ThemeItem format
 */
function mapApiTemplateToThemeItem(apiTemplate: any): ThemeItem {
    return {
        // Direct fields from backend
        id: String(apiTemplate.id),
        name: apiTemplate.name,
        slug: apiTemplate.slug,
        tags: Array.isArray(apiTemplate.tags) ? apiTemplate.tags : [],
        uuid: apiTemplate.uuid,
        status: apiTemplate.status,
        namespace: apiTemplate.namespace,
        hash: apiTemplate.hash,
        timestamp: apiTemplate.timestamp,
        updated: apiTemplate.updated,
        author: apiTemplate.author,
        version: apiTemplate.version,
        screenshot: apiTemplate.screenshot,
        download_url: apiTemplate.download_url,
        demo_url: apiTemplate.demo_url,
        
        // Computed fields for UI
        title: apiTemplate.name || `Theme ${apiTemplate.id}`,
        description: `${apiTemplate.name} theme by ${apiTemplate.author || 'Unknown'}`,
        thumbnail: apiTemplate.screenshot ? getThumbnailUrl({
            id: apiTemplate.id,
            assetUrl: apiTemplate.screenshot,
            width: 300,
            height: 200,
            maxWidth: 400,
            maxHeight: 300
        }) : `https://via.placeholder.com/300x200?text=${encodeURIComponent(apiTemplate.name || 'Theme')}`,
        demo: apiTemplate.demo_url,
        asset: apiTemplate.screenshot ? getFullAssetUrl(apiTemplate.screenshot) : ''
    };
}

/**
 * Flattens nested tags array
 */
function flattenTagsArray(tagsArray: string[][]): string[] {
    return tagsArray.flat().filter((tag, index, array) => array.indexOf(tag) === index);
}

/**
 * Constructs search query for API from search term and tags
 */
function buildSearchQuery(searchTerm: string, selectedTags: string[]): string {
    const parts: string[] = [];
    
    // Add search term for multiple fields if exists
    if (searchTerm.trim()) {
        // Search across multiple fields with OR condition
        const searchTermTrimmed = searchTerm.trim();
        const searchFields = [
            `name:${searchTermTrimmed}`,
            `slug:${searchTermTrimmed}`,
            `tags:${searchTermTrimmed}`
        ];
        
        // Add the field searches WITHOUT wrapping in parentheses for simple queries
        parts.push(searchFields.join(' OR '));
    }
    
    // Add tags filter
    if (selectedTags.length > 0) {
        // Format: "tags:Tag1 OR tags:Tag2 OR tags:Tag3"
        const tagsQuery = selectedTags
            .map(tag => `tags:${tag}`)
            .join(' OR ');
        
        // No parentheses for simple tag filters
        parts.push(tagsQuery);
    }
    
    // Join with AND if we have multiple parts to ensure both search term and tags are matched
    let finalQuery = '';
    if (parts.length > 1) {
        // For complex queries with multiple conditions, use parentheses for proper grouping
        finalQuery = parts.map(part => `(${part})`).join(' AND ');
    } else {
        // For simple queries, no parentheses needed
        finalQuery = parts[0] || '';
    }

    // Return the raw query without any URL encoding - the api utility will handle proper encoding
    return finalQuery;
}

// Define the ApiResponse type
type ApiResponse<T> = {
    data: T;
};

/**
 * API service for fetching themes
 */
export const themeApiService = {
    /**
     * Get the API URL based on the environment
     */
    getApiUrl(): string {
        return GetBaseUrl();
    },

    /**
     * Fetch themes with pagination and tag filtering
     */
    async fetchThemes(
        page = 1,
        limit = THEME_REQUEST_PARAMS.count,
        selectedTags: string[] = [],
        searchTerm = ''
    ): Promise<ThemeSearchResult> {
        return this.searchThemes(page, limit, searchTerm, selectedTags);
    },
    
    /**
     * Search themes with pagination, text search and tag filtering
     */
    async searchThemes(
        page = 1,
        limit = THEME_REQUEST_PARAMS.count,
        searchTerm = '',
        selectedTags: string[] = []
    ): Promise<ThemeSearchResult> {
        const offset = page - 1;
        
        try {
            // Determine if we have any filters (search term or tags)
            const hasFilters = searchTerm.trim() !== '' || selectedTags.length > 0;
            
            let response: ApiResponse<any[]>;
            const params: Record<string, string | number> = {
                type: THEME_REQUEST_PARAMS.type,
                count: limit,
                offset,
                order: THEME_REQUEST_PARAMS.order,
            };
            
            if (hasFilters) {
                // Build search query that combines searchTerm and tags
                const searchQuery = buildSearchQuery(searchTerm, selectedTags);
                
                // Only add query param if we have a valid query
                if (searchQuery) {
                    const searchParams = {
                        ...params,
                        q: searchQuery,
                    };
                    
                    response = await api.get<ApiResponse<any[]>>(
                        API_ENDPOINTS.THEME_SEARCH,
                        { params: searchParams }
                    );
                } else {
                    // Fallback to regular endpoint if query is empty
                    response = await api.get<ApiResponse<any[]>>(
                        API_ENDPOINTS.THEMES,
                        { params }
                    );
                }
            } else {
                // Use regular templates endpoint
                response = await api.get<ApiResponse<any[]>>(
                    API_ENDPOINTS.THEMES,
                    { params }
                );
            }
            
            // Validate that we received a valid response
            if (!response || !response.data || !Array.isArray(response.data)) {
                console.error('Invalid API response:', response);
                return { themes: [], hasMore: false };
            }
            
            // Map API templates to app's ThemeItem format
            const themes = response.data.map((apiTemplate: any) => {
                try {
                    return mapApiTemplateToThemeItem(apiTemplate);
                } catch (err) {
                    console.error('Error mapping API template:', apiTemplate, err);
                    return null;
                }
            }).filter(Boolean) as ThemeItem[]; // Remove any null items
            
            // Determine if there are more themes
            const hasMore = themes.length === limit;

            return { themes, hasMore };
        } catch (error) {
            console.error('Error searching themes:', error);
            return { themes: [], hasMore: false };
        }
    },
    
    /**
     * Fetch all theme tags
     */
    async fetchAllTags(): Promise<string[]> {
        try {
            const response = await api.get<ApiResponse<string[][]>>(
                API_ENDPOINTS.THEME_TAGS,
                {
                    params: {
                        type: THEME_REQUEST_PARAMS.type
                    }
                }
            );
            
            if (!response || !response.data || !Array.isArray(response.data)) {
                console.error('Invalid tags API response:', response);
                return [];
            }
            
            // Flatten the nested array and remove duplicates
            const allTags = flattenTagsArray(response.data);
            
            // Sort tags alphabetically and return
            return allTags.sort((a, b) => a.localeCompare(b));
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
            template: '', // No template field in real data
            uuid: theme.id,
            tags: theme.tags
        };
    },

    /**
     * Fetch a theme by its name using the hash endpoint
     * @param name The name of the theme to fetch
     * @returns The theme item, or null if not found
     */
    async fetchThemeByName(name: string): Promise<ThemeItem | null> {
        try {
            // Build the endpoint URL - using the base URL since this endpoint isn't in API_ENDPOINTS
            const apiUrl = this.getApiUrl();
            const endpoint = `${apiUrl}/api/template/hash?name=${encodeURIComponent(name)}`;
            
            // Make the API call
            const response = await requestUrl({
                url: endpoint,
                method: 'GET',
                headers: {
                    'Content-Type': 'application/json'
                }
            });
            
            if (response.status !== 200) {
                console.error(`Failed to fetch theme by name: ${name}`, response);
                return null;
            }
            
            const data = response.json;
            
            // Validate the response based on the actual structure
            if (!data || !data.data || !Array.isArray(data.data) || data.data.length === 0) {
                console.error('Invalid or empty response when fetching theme by name:', data);
                return null;
            }
            
            // The response has a data array with the theme information
            const apiTemplate = data.data[0];
            
            // Map the API template to our application's ThemeItem format
            return mapApiTemplateToThemeItem(apiTemplate);
        } catch (error) {
            console.error(`Error fetching theme by name '${name}':`, error);
            return null;
        }
    }
}; 
