/**
 * Shortcode processor for Obsidian's post-processing of markdown
 */

import { MarkdownPostProcessorContext, Plugin } from 'obsidian';
import { shortcodeService } from './shortcodeService';

/**
 * Register the shortcode post processor with Obsidian
 * @param plugin The current Obsidian plugin instance
 */
export function registerShortcodeProcessor(plugin: Plugin): void {
    // Register the code block processor for 'shortcode' blocks
    plugin.registerMarkdownCodeBlockProcessor('shortcode', async (source, el, ctx) => {
        await processShortcodeBlock(source, el, ctx, plugin);
    });
}

/**
 * Process a shortcode block in the markdown
 * @param source The source content of the code block
 * @param el The HTML element to render to
 * @param ctx The Markdown post processor context
 * @param plugin The current Obsidian plugin instance
 */
async function processShortcodeBlock(
    source: string,
    el: HTMLElement,
    ctx: MarkdownPostProcessorContext,
    plugin: Plugin
): Promise<void> {
    try {
        // First, ensure all shortcodes are registered
        await shortcodeService.ensureShortcodesRegistered(source);
        
        // Perform step 1: Replace shortcodes with placeholders
        const renderedMarkdown = shortcodeService.render(source);
        
        if (renderedMarkdown === source) {
            // If no rendering occurred, show the original source
            el.createEl('pre', { text: source });
            return;
        }
        
        // Apply the rendered HTML
        el.innerHTML = renderedMarkdown;
        
        // Add a class to the container for styling
        el.addClass('obsidian-friday-shortcode-container');
    } catch (error) {
        console.error('Error processing shortcode block:', error);
        
        // Show error in the UI
        const errorEl = el.createEl('div', { cls: 'shortcode-error' });
        errorEl.createEl('h3', { text: 'Error rendering shortcode' });
        errorEl.createEl('pre', { text: error.message });
        errorEl.createEl('pre', { text: source });
    }
} 
