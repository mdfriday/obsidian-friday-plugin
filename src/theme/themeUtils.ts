/**
 * Utility functions for theme operations
 */

import {GetBaseUrl} from '../main';
import type {ThumbnailParams} from './types';

/**
 * Generate thumbnail URL for theme assets
 */
export function getThumbnailUrl(params: ThumbnailParams): string {
    const {id, assetUrl, width, height, maxWidth, maxHeight} = params;
    
    // If no asset URL provided, return placeholder
    if (!assetUrl) {
        return `https://via.placeholder.com/${width}x${height}?text=Theme+${id}`;
    }
    
    // Calculate responsive dimensions
    let finalWidth = width;
    let finalHeight = height;
    
    if (maxWidth && width > maxWidth) {
        const ratio = maxWidth / width;
        finalWidth = maxWidth;
        finalHeight = Math.round(height * ratio);
    }
    
    if (maxHeight && finalHeight > maxHeight) {
        const ratio = maxHeight / finalHeight;
        finalHeight = maxHeight;
        finalWidth = Math.round(finalWidth * ratio);
    }
    
    // Return the processed thumbnail URL
    return `${GetBaseUrl()}${assetUrl}`;
}

/**
 * Get full asset URL for theme
 */
export function getFullAssetUrl(assetUrl: string): string {
    if (!assetUrl) {
        return '';
    }
    
    // If already a full URL, return as is
    if (assetUrl.startsWith('http://') || assetUrl.startsWith('https://')) {
        return assetUrl;
    }
    
    // Clean up the asset URL (remove leading slash if present)
    const cleanAssetUrl = assetUrl.startsWith('/') ? assetUrl : `/${assetUrl}`;
    
    // Return full asset URL
    return `${GetBaseUrl()}${cleanAssetUrl}`;
}

/**
 * Build search query for Theme tags
 */
export function buildThemeTagsQuery(tags: string[]): string {
    if (!tags || tags.length === 0) {
        return '';
    }
    
    // Format the query as "tags:tag1 OR tags:tag2 OR tags:tag3"
    return tags.map(tag => `tags:${tag}`).join(' OR ');
}

/**
 * Parse JSON with error handling
 */
export function parseJson<T>(jsonString: string): T | null {
    try {
        return JSON.parse(jsonString) as T;
    } catch (error) {
        console.error('Failed to parse JSON:', error);
        return null;
    }
}

/**
 * Decode base64 string with error handling
 */
export function decodeBase64(base64String: string): string | null {
    try {
        return atob(base64String);
    } catch (error) {
        console.error('Failed to decode base64:', error);
        return null;
    }
} 
