/**
 * Service for communicating with the backend API to fetch shortcodes, tags, and handle search operations
 */
import {API_BASE_URL, API_ENDPOINTS, SHORTCODE_REQUEST_PARAMS} from '../../config/api.ts';
import {ApiResponse, ApiShortcodeItem} from '../../types/api.ts';
import {ShortcodeItem, ShortcodeMetadata, ShortcodeSearchResult} from '../../types/shortcode.ts';
import {api} from '@/core/utils/apiUtils.ts';
import {getFullAssetUrl, getThumbnailUrl} from '@/core/utils/shortcodeUtils.ts';

/**
 * Maps API Shortcode item to the app's ShortcodeItem format
 */
function mapApiShortcodeToShortcodeItem(apiShortcode: ApiShortcodeItem): ShortcodeItem {
  return {
    id: apiShortcode.uuid,
    title: apiShortcode.name,
    slug: apiShortcode.slug,
    description: apiShortcode.desc,
    template: apiShortcode.template,
    example: apiShortcode.example,
    tags: apiShortcode.tags,
    asset: getFullAssetUrl(apiShortcode.asset),
    thumbnail: getThumbnailUrl({
      id: apiShortcode.id,
      assetUrl: apiShortcode.asset,
      width: apiShortcode.width,
      height: apiShortcode.height
    }),
    width: apiShortcode.width,
    height: apiShortcode.height,
  };
}

/**
 * Transform array of tags from API format to flat array
 */
function flattenTagsArray(tagsArray: string[][]): string[] {
  return tagsArray.flat().filter(Boolean);
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
    console.log('Added search term conditions:', searchFields.join(' OR '));
  }
  
  // Add tags filter
  if (selectedTags.length > 0) {
    // Format: "tags:Tag1 OR tags:Tag2 OR tags:Tag3"
    const tagsQuery = selectedTags
      .map(tag => `tags:${tag}`)
      .join(' OR ');
    
    // No parentheses for simple tag filters
    parts.push(tagsQuery);
    console.log('Added tag filter conditions:', tagsQuery);
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
  
  console.log('Final constructed query:', finalQuery);
  
  // Return the raw query without any URL encoding - the api utility will handle proper encoding
  return finalQuery;
}

/**
 * Shortcode API service for fetching shortcodes and tags from the backend
 */
export const shortcodeApiService = {
  /**
   * Fetch shortcodes with pagination and tag filtering
   */
  async fetchShortcodes(
    page = 1,
    limit = SHORTCODE_REQUEST_PARAMS.count,
    selectedTags: string[] = [],
    searchTerm = ''
  ): Promise<ShortcodeSearchResult> {
    return this.searchShortcodes(page, limit, searchTerm, selectedTags);
  },
  
  /**
   * Search shortcodes with pagination, text search and tag filtering
   */
  async searchShortcodes(
    page = 1,
    limit = SHORTCODE_REQUEST_PARAMS.count,
    searchTerm = '',
    selectedTags: string[] = []
  ): Promise<ShortcodeSearchResult> {
    const offset = page - 1;
    
    try {
      console.log('Searching shortcodes with:', { page, limit, searchTerm, selectedTags });
      
      // Determine if we have any filters (search term or tags)
      const hasFilters = searchTerm.trim() !== '' || selectedTags.length > 0;
      
      let response: Record<string, any>;
      const params: Record<string, string | number> = {
        type: SHORTCODE_REQUEST_PARAMS.type,
        count: limit,
        offset,
        order: SHORTCODE_REQUEST_PARAMS.order,
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
          
          console.log('Search query:', searchQuery);
          console.log('Search params:', searchParams);
          
          response = await api.get<ApiResponse<ApiShortcodeItem[]>>(
            API_ENDPOINTS.SHORTCODE_SEARCH,
            { params: searchParams }
          );
        } else {
          // Fallback to regular endpoint if query is empty
          console.log('Empty search query, using regular endpoint');
          response = await api.get<ApiResponse<ApiShortcodeItem[]>>(
            API_ENDPOINTS.SHORTCODES,
            { params }
          );
        }
      } else {
        // Use regular shortcodes endpoint
        response = await api.get<ApiResponse<ApiShortcodeItem[]>>(
          API_ENDPOINTS.SHORTCODES,
          { params }
        );
      }
      
      // Validate that we received a valid response
      if (!response || !response.data) {
        console.error('Invalid API response:', response);
        return { shortcodes: [], hasMore: false };
      }
      
      // Map API shortcodes to app's ShortcodeItem format
      const shortcodes = response.data.map((apiShortcode: ApiShortcodeItem) => {
        try {
          return mapApiShortcodeToShortcodeItem(apiShortcode);
        } catch (err) {
          console.error('Error mapping API shortcode:', apiShortcode, err);
          return null;
        }
      }).filter(Boolean) as ShortcodeItem[]; // Remove any null items
      
      // Determine if there are more shortcodes
      const hasMore = shortcodes.length === limit;
      
      console.log(`Fetched ${shortcodes.length} shortcodes, hasMore: ${hasMore}`);
      
      return { shortcodes, hasMore };
    } catch (error) {
      console.error('Error searching shortcodes:', error);
      return { shortcodes: [], hasMore: false };
    }
  },
  
  /**
   * Fetch all shortcode tags
   */
  async fetchAllTags(): Promise<string[]> {
    try {
      console.log('Fetching all shortcode tags');
      
      const params: Record<string, string> = {
        type: SHORTCODE_REQUEST_PARAMS.type,
      };
      
      const response = await api.get<ApiResponse<string[][]>>(
        API_ENDPOINTS.SHORTCODE_TAGS,
        { params }
      );

      // Validate that we received a valid response
      if (!response || !response.data) {
        console.error('Invalid API response for tags:', response);
        return [];
      }
      
      // API returns { data: [[tag1, tag2, ...]] }
      if (!Array.isArray(response.data)) {
        console.error('Tags data is not an array:', response.data);
        return [];
      }

      return flattenTagsArray(response.data);
    } catch (error) {
      console.error('Error fetching tags:', error);
      return [];
    }
  },
  
  /**
   * Fetch a specific shortcode by ID
   */
  async fetchShortcodeById(id: number): Promise<ShortcodeItem | null> {
    try {
      console.log(`Fetching shortcode with ID: ${id}`);
      
      const params: Record<string, string | number | undefined> = {
        type: SHORTCODE_REQUEST_PARAMS.type,
        id,
        status: undefined // Optional parameter, only include if needed
      };
      
      const response = await api.get<ApiResponse<ApiShortcodeItem[]>>(
        API_ENDPOINTS.SHORTCODE_DETAILS,
        { params }
      );
      
      console.log('Shortcode details API response:', JSON.stringify(response, null, 2));
      
      // Validate that we received a valid response
      if (!response || !response.data || !Array.isArray(response.data) || response.data.length === 0) {
        console.error('Invalid API response for shortcode details:', response);
        return null;
      }
      
      // Map API shortcode to app's ShortcodeItem format
      return mapApiShortcodeToShortcodeItem(response.data[0]);
    } catch (error) {
      console.error(`Error fetching shortcode with ID: ${id}`, error);
      return null;
    }
  },
  
  /**
   * Fetch a specific shortcode by slug
   */
  async fetchShortcodeBySlug(slug: string): Promise<ShortcodeItem | null> {
    try {
      console.log(`Fetching shortcode with slug: ${slug}`);
      
      // Use search to find by slug
      const params: Record<string, string | number> = {
        type: SHORTCODE_REQUEST_PARAMS.type,
        count: 1,
        offset: 0,
        q: `slug:${slug}`
      };
      
      const response = await api.get<ApiResponse<ApiShortcodeItem[]>>(
        API_ENDPOINTS.SHORTCODE_SEARCH,
        { params }
      );
      
      console.log('Shortcode by slug API response:', JSON.stringify(response, null, 2));
      
      // Validate that we received a valid response
      if (!response || !response.data || !Array.isArray(response.data) || response.data.length === 0) {
        console.error('Invalid API response for shortcode by slug:', response);
        return null;
      }
      
      // Map API shortcode to app's ShortcodeItem format
      return mapApiShortcodeToShortcodeItem(response.data[0]);
    } catch (error) {
      console.error(`Error fetching shortcode with slug: ${slug}`, error);
      return null;
    }
  },
  
  /**
   * Create shortcode metadata from a ShortcodeItem
   */
  createShortcodeMetadata(shortcode: ShortcodeItem): ShortcodeMetadata {
    return {
      id: parseInt(shortcode.id, 10) || 0, // Convert string id to number
      name: shortcode.title,
      template: shortcode.template,
      uuid: shortcode.id,
      tags: shortcode.tags
    };
  },

  /**
   * Fetch a shortcode by its name using the hash endpoint
   * @param name The name of the shortcode to fetch
   * @returns The shortcode item, or null if not found
   */
  async fetchShortcodeByName(name: string): Promise<ShortcodeItem | null> {
    try {
      console.log(`Fetching shortcode by name: ${name}`);
      
      // Build the endpoint URL - using the base URL since this endpoint isn't in API_ENDPOINTS
      const endpoint = `${API_BASE_URL}/api/sc/hash?name=${encodeURIComponent(name)}`;
      
      // Make the API call with the correct response structure
      const response = await api.get<{ data: ApiShortcodeItem[] }>(endpoint);
      
      // Validate the response based on the actual structure
      if (!response || !response.data || !Array.isArray(response.data) || response.data.length === 0) {
        console.error('Invalid or empty response when fetching shortcode by name:', response);
        return null;
      }
      
      // The response has a data array with the shortcode information
      const apiShortcode = response.data[0];
      
      // Map the API shortcode to our application's ShortcodeItem format
      return mapApiShortcodeToShortcodeItem(apiShortcode);
    } catch (error) {
      console.error(`Error fetching shortcode by name '${name}':`, error);
      return null;
    }
  },
}; 