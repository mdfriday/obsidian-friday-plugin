/**
 * Shortcode processor for Obsidian's post-processing of markdown
 */

import type { MarkdownPostProcessorContext, Plugin } from 'obsidian';
import { shortcodeService } from './shortcodeService';
import { transformShortcodeImagePaths } from '../obsidian';

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
        
        // Get the current file path for image resolution
        const currentFilePath = ctx.sourcePath;
        
        // Transform image paths in shortcode content before rendering
        // Use the async version of the function
        const transformedSource = await transformShortcodeImagePaths(
            source, 
            plugin.app, 
            currentFilePath
        );

        // Perform rendering of the shortcode
        const renderedMarkdown = shortcodeService.render(transformedSource);
        
        if (renderedMarkdown === transformedSource) {
            // If no rendering occurred, show the original source
            el.createEl('pre', { text: source });
            return;
        }
        
        // Apply the rendered HTML
        el.innerHTML = renderedMarkdown;
        
        // Add a class to the container for styling
        el.addClass('obsidian-friday-shortcode-container');
    } catch (error) {
        // Show error in the UI
        const errorEl = el.createEl('div', { cls: 'shortcode-error' });
        errorEl.createEl('h3', { text: '渲染 shortcode 时出错' });
        errorEl.createEl('pre', { text: error.message });
        errorEl.createEl('pre', { text: source });
    }
} 
