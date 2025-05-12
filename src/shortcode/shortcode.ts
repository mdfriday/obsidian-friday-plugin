/**
 * Shortcode class for managing shortcodes in Obsidian Friday plugin
 * Handles registration, rendering, and extraction of shortcodes
 */

import { ShortcodeMetadata } from './types';

/**
 * The Shortcode class manages registration and rendering of shortcodes
 */
export class Shortcode {
    // Map to store registered shortcodes by name
    private shortcodes: Map<string, ShortcodeMetadata>;

    constructor() {
        this.shortcodes = new Map();
    }

    /**
     * Register a shortcode with its metadata
     * @param metadata The shortcode metadata
     * @returns True if registration was successful, false otherwise
     */
    registerShortcode(metadata: ShortcodeMetadata): boolean {
        if (!metadata.name || !metadata.template) {
            console.error('Invalid shortcode metadata:', metadata);
            return false;
        }

        this.shortcodes.set(metadata.name, metadata);
        console.log(`Registered shortcode: ${metadata.name}`);
        return true;
    }

    /**
     * Find a shortcode by name
     * @param name The name of the shortcode to find
     * @returns The shortcode metadata, or undefined if not found
     */
    findByName(name: string): ShortcodeMetadata | undefined {
        return this.shortcodes.get(name);
    }

    /**
     * Extract shortcode names from a markdown string
     * @param markdown The markdown string to extract shortcode names from
     * @returns Array of shortcode names
     */
    extractShortcodeNames(markdown: string): string[] {
        // Regular expression to match shortcode names
        // Matches {{< ShortcodeName or {{< ShortcodeName paramName=
        const regex = /{{<\s*(\w+)(?:\s+|\/>|>)/g;
        
        const names: string[] = [];
        let match;
        
        while ((match = regex.exec(markdown)) !== null) {
            if (match[1] && !names.includes(match[1])) {
                names.push(match[1]);
            }
        }
        
        return names;
    }

    /**
     * Parse attributes from shortcode content
     * @param content The shortcode content string
     * @returns Object containing the parsed attributes
     */
    private parseAttributes(content: string): Record<string, string> {
        const attributes: Record<string, string> = {};
        
        // Regular expression to match attributes in the format: name="value"
        const regex = /(\w+)=["']([^"']*)["']/g;
        let match;
        
        while ((match = regex.exec(content)) !== null) {
            const [, name, value] = match;
            attributes[name] = value;
        }
        
        return attributes;
    }

    /**
     * Render a shortcode with the provided content
     * @param shortcodeName The name of the shortcode to render
     * @param content The content string containing attributes
     * @returns The rendered HTML, or null if shortcode not found
     */
    renderShortcode(shortcodeName: string, content: string): string | null {
        const shortcode = this.findByName(shortcodeName);
        
        if (!shortcode) {
            console.warn(`Shortcode not found: ${shortcodeName}`);
            return null;
        }
        
        try {
            // Parse attributes from the content
            const attributes = this.parseAttributes(content);
            
            // Create a template function from the shortcode template
            let template = shortcode.template;
            
            // Replace attribute placeholders in the template
            Object.entries(attributes).forEach(([key, value]) => {
                const placeholder = new RegExp(`{{\\s*${key}\\s*}}`, 'g');
                template = template.replace(placeholder, value);
            });
            
            // Replace any remaining placeholders with empty strings
            template = template.replace(/{{[^}]*}}/g, '');
            
            return template;
        } catch (error) {
            console.error(`Error rendering shortcode ${shortcodeName}:`, error);
            return null;
        }
    }

    /**
     * Step 1 of markdown rendering: replace shortcodes with placeholders
     * @param markdown The markdown to render
     * @returns The rendered markdown with placeholders
     */
    stepRender(markdown: string): string {
        // For this implementation, we directly render the shortcodes
        return this.render(markdown);
    }

    /**
     * Step 3 of markdown rendering: final rendering
     * @param html The HTML with shortcode placeholders
     * @returns The final HTML with shortcodes rendered
     */
    finalRender(html: string): string {
        // In this implementation, we don't use placeholders
        return html;
    }

    /**
     * Render all shortcodes in a markdown string
     * @param markdown The markdown string containing shortcodes
     * @returns The markdown with shortcodes rendered as HTML
     */
    render(markdown: string): string {
        if (!markdown) return markdown;

        // Regular expression to match shortcode blocks
        const blockRegex = /```shortcode\n([\s\S]*?)```/g;
        
        return markdown.replace(blockRegex, (match, shortcodeBlock) => {
            try {
                // Extract the first shortcode in the block
                const shortcodeMatch = shortcodeBlock.match(/{{<\s*(\w+)([\s\S]*?)\/?>}}/);
                
                if (!shortcodeMatch) {
                    console.warn('No valid shortcode found in block:', shortcodeBlock);
                    return match; // Return original if no match
                }
                
                const [fullShortcode, shortcodeName, content] = shortcodeMatch;
                const rendered = this.renderShortcode(shortcodeName, content);
                
                if (!rendered) {
                    return match; // Return original if rendering failed
                }
                
                // Return rendered HTML wrapped in a div
                return `<div class="obsidian-friday-shortcode">${rendered}</div>`;
            } catch (error) {
                console.error('Error rendering shortcode block:', error);
                return match; // Return original on error
            }
        });
    }

    /**
     * Get all registered shortcode names
     * @returns Array of registered shortcode names
     */
    getRegisteredShortcodeNames(): string[] {
        return Array.from(this.shortcodes.keys());
    }
} 