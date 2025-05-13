import { Shortcode } from '@mdfriday/shortcode';
import { ShortcodeItem, ShortcodeMetadata } from '@/types/shortcode';
import { shortcodeApiService } from './shortcodeApiService';

// Initialize a singleton instance of the Shortcode class
const globalShortcode = new Shortcode();

/**
 * Decodes a base64 encoded string with UTF-8 support
 * @param base64String The base64 encoded string to decode
 * @returns The decoded string, or empty string if decoding fails
 */
function decodeBase64(base64String: string): string {
  try {
    // First decode base64 to binary data
    const binaryString = atob(base64String);
    // Convert the binary string to an array of bytes
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    // Use TextDecoder to decode the UTF-8 bytes to a string
    return new TextDecoder('utf-8').decode(bytes);
  } catch (error) {
    console.error('Error decoding base64 string:', error);
    return '';
  }
}

/**
 * Parses a JSON string
 * @param jsonString The JSON string to parse
 * @returns The parsed object, or null if parsing fails
 */
function parseJson<T>(jsonString: string): T | null {
  try {
    return JSON.parse(jsonString) as T;
  } catch (error) {
    console.error('Error parsing JSON:', error);
    return null;
  }
}

/**
 * Service for managing shortcodes
 * Handles registration, discovery, and optimization of shortcodes
 */
export const shortcodeService = {
  /**
   * Get the global shortcode instance
   */
  getInstance(): Shortcode {
    return globalShortcode;
  },

  /**
   * Register a shortcode
   * @param shortcodeItem The shortcode item to register
   */
  registerShortcode(shortcodeItem: ShortcodeItem): void {
    // Make sure we have a valid shortcode item
    if (!shortcodeItem || !shortcodeItem.template) {
      console.error('Invalid shortcode item or missing template:', shortcodeItem);
      return;
    }

    try {
      // Check if template is base64 encoded
      const decodedTemplateString = decodeBase64(shortcodeItem.template);
      
      if (!decodedTemplateString) {
        console.error(`Failed to decode template for shortcode: ${shortcodeItem.title}`);
        console.log('Original template:', shortcodeItem.template.substring(0, 100) + '...');
        // Try to register with original template as fallback
        this.registerWithOriginalTemplate(shortcodeItem);
        return;
      }
      
      // Try to parse the decoded template as JSON
      const templateJson = parseJson<Record<string, string>>(decodedTemplateString);
      
      if (templateJson && typeof templateJson === 'object') {
        console.log(`Decoded template JSON for ${shortcodeItem.title} with ${Object.keys(templateJson).length} shortcodes`);
        
        // Find the main shortcode template using the title as key
        const mainTemplate = templateJson[shortcodeItem.title];
        
        if (mainTemplate) {
          // Register the main shortcode
          const mainMetadata: ShortcodeMetadata = {
            id: parseInt(shortcodeItem.id, 10),
            name: shortcodeItem.title,
            template: mainTemplate,
            uuid: shortcodeItem.id,
            tags: shortcodeItem.tags
          };
          
          let res = globalShortcode.registerShortcode(mainMetadata);
          console.log(`Registered main shortcode: ${shortcodeItem.title}, with ${mainTemplate}, result: ${res}`);
          
          // Register all additional sub-shortcodes
          Object.entries(templateJson).forEach(([name, template], index) => {
            // Skip the main shortcode we already registered
            if (name === shortcodeItem.title) {
              return;
            }

            const sid = parseInt(shortcodeItem.id, 10) + 10000 + index; // Not needed for registration by name
            // Register the sub-shortcode with a minimal metadata
            const subMetadata: ShortcodeMetadata = {
              id: sid, // Not needed for registration by name
              name,
              template,
              uuid: shortcodeItem.id + '-' + name, // Not needed for registration by name
              tags: [] // Not needed for registration by name
            };
            
            let res = globalShortcode.registerShortcode(subMetadata);
            console.log(`Registered sub-shortcode: ${name}, with ${template}, result: ${res}`);
          });
        } else {
          console.error(`Main template not found for shortcode: ${shortcodeItem.title}`);
          console.log('Available keys:', Object.keys(templateJson));
          // Try with the first available template as fallback
          const firstKey = Object.keys(templateJson)[0];
          if (firstKey) {
            console.log(`Using first available template key: ${firstKey}`);
            const fallbackMetadata: ShortcodeMetadata = {
              id: parseInt(shortcodeItem.id, 10),
              name: shortcodeItem.title,
              template: templateJson[firstKey],
              uuid: shortcodeItem.id,
              tags: shortcodeItem.tags
            };
            globalShortcode.registerShortcode(fallbackMetadata);
          } else {
            // Try to register with original template as last resort
            this.registerWithOriginalTemplate(shortcodeItem);
          }
        }
      } else {
        // Not a valid JSON, try to use decoded string directly as template
        console.warn(`Template for ${shortcodeItem.title} is not in the expected JSON format, using as plain template`);
        console.log('Decoded template sample:', decodedTemplateString.substring(0, 100) + '...');
        
        // Create shortcode metadata with the decoded string as template
        const metadata: ShortcodeMetadata = {
          id: parseInt(shortcodeItem.id, 10),
          name: shortcodeItem.title,
          template: decodedTemplateString,
          uuid: shortcodeItem.id,
          tags: shortcodeItem.tags
        };

        // Register the shortcode
        globalShortcode.registerShortcode(metadata);
      }
    } catch (error) {
      console.error(`Error registering shortcode ${shortcodeItem.title}:`, error);
      // Try to register with original template as last resort
      this.registerWithOriginalTemplate(shortcodeItem);
    }
  },
  
  /**
   * Register a shortcode with the original template (fallback method)
   * @param shortcodeItem The shortcode item to register
   * @private
   */
  registerWithOriginalTemplate(shortcodeItem: ShortcodeItem): void {
    console.warn(`Falling back to original template for shortcode: ${shortcodeItem.title}`);
    try {
      // Create shortcode metadata from the shortcode item with original template
      const metadata: ShortcodeMetadata = {
        id: parseInt(shortcodeItem.id, 10),
        name: shortcodeItem.title,
        template: shortcodeItem.template,
        uuid: shortcodeItem.id,
        tags: shortcodeItem.tags
      };

      // Register the shortcode
      globalShortcode.registerShortcode(metadata);
      console.log(`Registered shortcode with original template: ${shortcodeItem.title}`);
    } catch (error) {
      console.error(`Critical failure registering shortcode ${shortcodeItem.title}:`, error);
    }
  },

  /**
   * Check if a shortcode is already registered
   * @param name The name of the shortcode to check
   * @returns True if the shortcode is registered, false otherwise
   */
  isShortcodeRegistered(name: string): boolean {
    // Use the built-in findByName method
    return !!globalShortcode.findByName(name);
  },

  /**
   * Extract shortcode names from a markdown string
   * @param markdown The markdown string to extract shortcode names from
   * @returns Array of shortcode names
   */
  extractShortcodeNames(markdown: string): string[] {
    // Use the built-in extractShortcodeNames method
    return globalShortcode.extractShortcodeNames(markdown);
  },

  /**
   * Fetch shortcode details by name from the API
   * @param name The name of the shortcode to fetch
   * @returns The shortcode item, or null if not found
   */
  async fetchShortcodeByName(name: string): Promise<ShortcodeItem | null> {
    // Delegate to the shortcodeApiService
    return shortcodeApiService.fetchShortcodeByName(name);
  },

  /**
   * Decode base64 encoded example content from a shortcode
   * @param shortcodeItem The shortcode item containing the example
   * @returns The decoded example content, or the original if decoding fails
   */
  decodeExample(shortcodeItem: ShortcodeItem): string {
    if (!shortcodeItem || !shortcodeItem.example) {
      console.log('No example content to decode');
      return '';
    }
    
    try {
      // Use the same decodeBase64 function that properly handles UTF-8
      const decoded = decodeBase64(shortcodeItem.example);
      
      if (!decoded) {
        console.warn(`Failed to decode example for ${shortcodeItem.title}, using original`);
        return shortcodeItem.example;
      }
      
      // Check if the decoded content is a URL (don't try to decode URLs)
      if (decoded.startsWith('http://') || decoded.startsWith('https://')) {
        console.log('Example content is a URL:', decoded);
        return decoded;
      }
      
      console.log(`Successfully decoded example for ${shortcodeItem.title}`);
      return decoded;
    } catch (error) {
      console.error(`Error decoding example for ${shortcodeItem.title}:`, error);
      return shortcodeItem.example;
    }
  },

  /**
   * Process markdown content to ensure all shortcodes are registered
   * @param markdown The markdown content to process
   * @returns A promise that resolves when all shortcodes are registered
   */
  async ensureShortcodesRegistered(markdown: string): Promise<void> {
    // Extract all shortcode names from the markdown
    const shortcodeNames = this.extractShortcodeNames(markdown);
    console.log('Extracted shortcode names:', shortcodeNames);
    
    if (shortcodeNames.length === 0) {
      console.log('No shortcodes found in content');
      return;
    }
    
    // Check which shortcodes are not registered yet
    const unregisteredShortcodes = shortcodeNames.filter(
      name => !this.isShortcodeRegistered(name)
    );
    console.log('Unregistered shortcodes:', unregisteredShortcodes);
    
    if (unregisteredShortcodes.length === 0) {
      console.log('All shortcodes are already registered');
      return;
    }
    
    // Fetch and register all unregistered shortcodes
    const fetchPromises = unregisteredShortcodes.map(async (name) => {
      const shortcodeItem = await this.fetchShortcodeByName(name);
      if (shortcodeItem) {
        this.registerShortcode(shortcodeItem);
        console.log(`Registered shortcode: ${name}`);
      } else {
        console.warn(`Failed to fetch shortcode: ${name}`);
      }
    });
    
    // Wait for all shortcodes to be registered
    await Promise.all(fetchPromises);
  },

  /**
   * Step 1 of markdown rendering: replace shortcodes with placeholders
   * @param markdown The markdown to render
   * @returns The rendered markdown with placeholders
   */
  stepRender(markdown: string): string {
    return globalShortcode.stepRender(markdown);
  },

  /**
   * Step 3 of markdown rendering: final rendering
   * @param html The HTML with shortcode placeholders
   * @returns The final HTML with shortcodes rendered
   */
  finalRender(html: string): string {
    return globalShortcode.finalRender(html);
  }
}; 