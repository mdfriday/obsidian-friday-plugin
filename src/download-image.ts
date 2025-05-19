import {
    App,
    MarkdownView,
    Modal,
    Notice,
    Plugin,
    TFile,
    WorkspaceLeaf,
    requestUrl,
    PluginSettingTab,
    Setting,
    TFolder,
    Editor,
    FrontMatterCache,
    MarkdownRenderer,
    Component
} from 'obsidian';
// @ts-ignore - We'll add this file in the lib directory
import domtoimage from './lib/dom-to-image-more';

interface ExportImageSettings {
    width: number;
    showFilename: boolean;
    resolutionMode: '1x' | '2x' | '3x' | '4x';
    format: 'png' | 'jpg';
    padding: {
        top: number;
        right: number;
        bottom: number;
        left: number;
    };
    quickExportSelection: boolean;
}

const DEFAULT_SETTINGS: ExportImageSettings = {
    width: 640,
    showFilename: true,
    resolutionMode: '2x',
    format: 'png',
    padding: {
        top: 8,
        right: 8,
        bottom: 8,
        left: 8
    },
    quickExportSelection: false
};

export class DownloadImageFeature {
    public plugin: Plugin;
    public settings: ExportImageSettings;
    private modal: ExportImageModal | null = null;
    private buttonAdded: Set<string> = new Set();
    private buttons: Map<string, HTMLElement> = new Map();
    private component: Component;
    private currentFile: TFile | null = null;

    constructor(plugin: Plugin) {
        this.plugin = plugin;
        this.settings = DEFAULT_SETTINGS;
        this.component = new Component();
        this.loadSettings();
    }

    async loadSettings() {
        try {
            const savedSettings = await this.plugin.loadData();
            if (savedSettings && savedSettings.exportImageSettings) {
                this.settings = { 
                    ...DEFAULT_SETTINGS, 
                    ...savedSettings.exportImageSettings 
                };
            }
        } catch (error) {
            console.error('Failed to load export image settings:', error);
        }
    }

    async saveSettings() {
        try {
            const data = await this.plugin.loadData() || {};
            data.exportImageSettings = this.settings;
            await this.plugin.saveData(data);
        } catch (error) {
            console.error('Failed to save export image settings:', error);
        }
    }

    /**
     * Initialize and mount the download image functionality
     */
    initialize(): void {
        // Add command - can be used via command palette
        this.plugin.addCommand({
            id: 'export-current-note-as-image',
            name: 'Export current note as image',
            icon: 'image-down',
            checkCallback: (checking: boolean) => {
                const activeView = this.plugin.app.workspace.getActiveViewOfType(MarkdownView);
                if (activeView) {
                    if (!checking) {
                        this.exportImage(activeView.file, this.plugin.app);
                    }
                    return true;
                }
                return false;
            }
        });

        // Add command for exporting selection
        this.plugin.addCommand({
            id: 'export-selection-as-image',
            name: 'Export selection as image',
            icon: 'text-select',
            editorCheckCallback: (checking: boolean, editor: Editor, view: MarkdownView) => {
                const selection = editor.getSelection();
                if (selection) {
                    if (!checking) {
                        this.exportSelectionAsImage(selection, view.file, this.plugin.app);
                    }
                    return true;
                }
                return false;
            }
        });

        // Register context menu for files
        this.plugin.registerEvent(
            this.plugin.app.workspace.on('file-menu', (menu, file) => {
                if (file instanceof TFile && file.extension === 'md') {
                    menu.addItem(item => {
                        item
                            .setTitle('Export as image')
                            .setIcon('image-down')
                            .onClick(async () => {
                                this.exportImage(file, this.plugin.app);
                            });
                    });
                } else if (file instanceof TFolder) {
                    // Could implement folder export in the future
                }
            })
        );

        // Register context menu for editor
        this.plugin.registerEvent(
            this.plugin.app.workspace.on('editor-menu', (menu, editor) => {
                const view = this.plugin.app.workspace.getActiveViewOfType(MarkdownView);
                if (!view || !view.file) {
                    return;
                }

                if (editor.somethingSelected()) {
                    menu.addItem(item => {
                        item
                            .setTitle('Export selection as image')
                            .setIcon('text-select')
                            .onClick(async () => {
                                const selection = editor.getSelection();
                                await this.exportSelectionAsImage(selection, view.file, this.plugin.app);
                            });
                    });
                }

                menu.addItem(item => {
                    item
                        .setTitle('Export as image')
                        .setIcon('image-down')
                        .onClick(async () => {
                            await this.exportImage(view.file, this.plugin.app);
                        });
                });
            })
        );
    }

    /**
     * Export the entire note as an image
     */
    async exportImage(file: TFile, app: App): Promise<void> {
        if (!file || file.extension !== 'md') {
            new Notice('No active markdown file');
            return;
        }

        // Store the current file
        this.currentFile = file;

        let frontmatter: FrontMatterCache | undefined;
        // @ts-ignore - Accessing internal API
        frontmatter = app.metadataCache.getCache(file.path)?.frontmatter;

        const markdown = await app.vault.read(file);
        await this.showExportModal(app, markdown, file, frontmatter, 'file');
    }

    /**
     * Export selected text as an image
     */
    async exportSelectionAsImage(selection: string, file: TFile, app: App): Promise<void> {
        if (!selection) {
            new Notice('No text selected');
            return;
        }

        if (!file) {
            new Notice('No active file');
            return;
        }

        // Store the current file
        this.currentFile = file;

        let frontmatter: FrontMatterCache | undefined;
        // @ts-ignore - Accessing internal API
        frontmatter = app.metadataCache.getCache(file.path)?.frontmatter;

        if (this.settings.quickExportSelection) {
            await this.quickExport(app, selection, file, frontmatter);
        } else {
            await this.showExportModal(app, selection, file, frontmatter, 'selection');
        }
    }

    /**
     * Resolves local image paths to data URLs
     * This ensures local images are properly embedded in the exported image
     */
    public async resolveLocalImages(element: HTMLElement, app: App, basePath: string): Promise<void> {
        // For debugging - collect unresolved images
        const unresolvedImages: string[] = [];
        
        // Process all img elements
        await this.processImgElements(element, app, basePath, unresolvedImages);
        
        // Process background images in inline styles
        await this.processBackgroundImages(element, app, basePath, unresolvedImages);
        
        // If there are unresolved images, log them for debugging
        if (unresolvedImages.length > 0) {
            console.warn('Unresolved images:', unresolvedImages);
            
            // Show a notice with the count of unresolved images
            new Notice(`Warning: ${unresolvedImages.length} image(s) could not be resolved. Check console for details.`, 5000);
        }
    }
    
    /**
     * Process all img elements in the container
     */
    private async processImgElements(element: HTMLElement, app: App, basePath: string, unresolvedImages: string[]): Promise<void> {
        // Find all image elements
        const images = element.querySelectorAll('img');
        
        for (const img of Array.from(images)) {
            // Skip images that are already data URLs or external URLs
            if (img.src.startsWith('data:') || (img.src.startsWith('http') && !img.src.includes('app://'))) {
                continue;
            }
            
            try {
                // Extract the image path
                let imgPath = img.src;
                
                // Handle Obsidian app:// URLs
                if (imgPath.startsWith('app://')) {
                    imgPath = this.extractPathFromAppUrl(imgPath);
                } else {
                    // Handle relative paths
                    if (!imgPath.startsWith('/')) {
                        // Get the directory of the base file
                        const baseDir = basePath.substring(0, basePath.lastIndexOf('/'));
                        imgPath = `${baseDir}/${imgPath}`;
                    }
                    
                    // Remove leading slash for vault access
                    if (imgPath.startsWith('/')) {
                        imgPath = imgPath.substring(1);
                    }
                }
                
                // Resolve the image
                const dataUrl = await this.resolveImageToDataUrl(imgPath, app, unresolvedImages);
                if (dataUrl) {
                    img.src = dataUrl;
                } else {
                    // Image not found - add warning styling
                    this.markUnresolvedImage(img, imgPath, unresolvedImages);
                }
            } catch (error) {
                console.error('Error processing image:', error);
                unresolvedImages.push(img.src);
            }
        }
    }
    
    /**
     * Process background images in inline styles
     */
    private async processBackgroundImages(element: HTMLElement, app: App, basePath: string, unresolvedImages: string[]): Promise<void> {
        // Find all elements with inline style
        const elementsWithStyle = element.querySelectorAll('*[style*="background-image"]');
        
        for (const el of Array.from(elementsWithStyle)) {
            try {
                const style = (el as HTMLElement).style;
                const backgroundImage = style.backgroundImage;
                
                // Skip if no background image or already a data URL
                if (!backgroundImage || backgroundImage === 'none' || backgroundImage.startsWith('url("data:')
                    || (backgroundImage.startsWith('url("http') && !backgroundImage.includes('app://'))) {
                    continue;
                }
                
                // Extract URL from the background-image style
                // Format is typically: url("path/to/image.png")
                const urlMatch = backgroundImage.match(/url\(['"]?([^'"]+)['"]?\)/);
                if (!urlMatch || !urlMatch[1]) continue;
                
                let imgPath = urlMatch[1];
                
                // Handle Obsidian app:// URLs
                if (imgPath.startsWith('app://')) {
                    imgPath = this.extractPathFromAppUrl(imgPath);
                } else {
                    // Handle relative paths
                    if (!imgPath.startsWith('/')) {
                        // Get the directory of the base file
                        const baseDir = basePath.substring(0, basePath.lastIndexOf('/'));
                        imgPath = `${baseDir}/${imgPath}`;
                    }
                    
                    // Remove leading slash for vault access
                    if (imgPath.startsWith('/')) {
                        imgPath = imgPath.substring(1);
                    }
                }
                
                // Resolve the image
                const dataUrl = await this.resolveImageToDataUrl(imgPath, app, unresolvedImages);
                if (dataUrl) {
                    style.backgroundImage = `url("${dataUrl}")`;
                } else {
                    // Mark element with unresolved background image
                    (el as HTMLElement).classList.add('friday-unresolved-bg-image');
                    (el as HTMLElement).title = `Background image not found: ${imgPath}`;
                    // Add a visual indicator for background images
                    (el as HTMLElement).style.border = '2px dashed orange';
                    (el as HTMLElement).style.position = 'relative';
                    
                    // Add a warning icon or text to indicate missing background
                    const warningEl = document.createElement('div');
                    warningEl.style.position = 'absolute';
                    warningEl.style.top = '2px';
                    warningEl.style.right = '2px';
                    warningEl.style.backgroundColor = 'rgba(255, 165, 0, 0.7)';
                    warningEl.style.color = 'white';
                    warningEl.style.padding = '2px 5px';
                    warningEl.style.fontSize = '10px';
                    warningEl.style.borderRadius = '3px';
                    warningEl.textContent = '⚠️ Missing BG';
                    (el as HTMLElement).appendChild(warningEl);
                }
            } catch (error) {
                console.error('Error processing background image:', error);
                unresolvedImages.push(`background-image in element ${(el as HTMLElement).tagName}`);
            }
        }
    }
    
    /**
     * Extract file path from Obsidian app:// URL
     */
    private extractPathFromAppUrl(appUrl: string): string {
        // Format is typically: app://some-id/absolute/path/to/file.png?timestamp
        try {
            // Remove the app:// prefix and any query parameters
            let cleanPath = appUrl.replace(/^app:\/\/[^\/]+\//, '');
            cleanPath = cleanPath.split('?')[0];
            
            // Extract just the filename for vault lookup
            const filename = cleanPath.split('/').pop() || '';
            
            // Search for the file in the vault
            const files = this.plugin.app.vault.getAllLoadedFiles();
            const matchingFile = files.find(f => 
                f instanceof TFile && 
                f.name === filename
            );
            
            if (matchingFile && matchingFile instanceof TFile) {
                return matchingFile.path;
            }
            
            // Fallback: just return the cleaned path, and we'll try to resolve it later
            return cleanPath;
        } catch (error) {
            console.error('Error extracting path from app URL:', error);
            return '';
        }
    }
    
    /**
     * Resolve an image path to a data URL
     */
    private async resolveImageToDataUrl(imgPath: string, app: App, unresolvedImages: string[]): Promise<string | null> {
        // Check if the image file exists in the vault
        const imageFile = app.vault.getAbstractFileByPath(imgPath);
        
        if (imageFile instanceof TFile) {
            // Read the image file content
            const imageArrayBuffer = await app.vault.readBinary(imageFile);
            const blob = new Blob([imageArrayBuffer], { type: this.getMimeType(imageFile.extension) });
            
            // Convert to data URL
            return await this.blobToDataURL(blob);
        }
        
        // If we can't find the file by path, try a more aggressive search by filename
        const filename = imgPath.split('/').pop() || '';
        if (filename) {
            const files = app.vault.getAllLoadedFiles();
            const matchingFile = files.find(f => 
                f instanceof TFile && 
                f.name === filename && 
                this.isImageFile(f.extension)
            );
            
            if (matchingFile && matchingFile instanceof TFile) {
                // Read the image file content
                const imageArrayBuffer = await app.vault.readBinary(matchingFile);
                const blob = new Blob([imageArrayBuffer], { type: this.getMimeType(matchingFile.extension) });
                
                // Convert to data URL
                return await this.blobToDataURL(blob);
            }
        }
        
        // If we reach here, the image couldn't be resolved
        unresolvedImages.push(imgPath);
        return null;
    }
    
    /**
     * Mark an unresolved image with visual indicators
     */
    private markUnresolvedImage(img: HTMLImageElement, imgPath: string, unresolvedImages: string[]): void {
        // Add a class to the image for styling
        img.classList.add('friday-unresolved-image');
        
        // Add title attribute with error information
        img.title = `Image not found: ${imgPath}`;
        
        // Add a warning border to make it visible in the preview
        img.style.border = '2px dashed red';
        
        // Add to the list of unresolved images
        unresolvedImages.push(imgPath);
    }
    
    /**
     * Check if a file extension is an image type
     */
    private isImageFile(extension: string): boolean {
        const imageExtensions = ['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'bmp', 'tiff', 'tif'];
        return imageExtensions.includes(extension.toLowerCase());
    }

    /**
     * Convert a blob to a data URL
     */
    public blobToDataURL(blob: Blob): Promise<string> {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result as string);
            reader.onerror = reject;
            reader.readAsDataURL(blob);
        });
    }
    
    /**
     * Get MIME type from file extension
     */
    public getMimeType(extension: string): string {
        const mimeTypes: Record<string, string> = {
            'png': 'image/png',
            'jpg': 'image/jpeg',
            'jpeg': 'image/jpeg',
            'gif': 'image/gif',
            'svg': 'image/svg+xml',
            'webp': 'image/webp'
        };
        
        return mimeTypes[extension.toLowerCase()] || 'application/octet-stream';
    }

    /**
     * Show the export modal with preview and options
     */
    private async showExportModal(
        app: App,
        markdown: string,
        file: TFile,
        frontmatter: FrontMatterCache | undefined,
        type: 'file' | 'selection'
    ): Promise<void> {
        const modal = new ExportImageModal(app, markdown, file, frontmatter, this.settings, this);
        modal.open();
    }

    /**
     * Quick export without showing the modal
     */
    private async quickExport(
        app: App,
        markdown: string,
        file: TFile,
        frontmatter: FrontMatterCache | undefined
    ): Promise<void> {
        try {
            const container = document.createElement('div');
            container.style.width = `${this.settings.width}px`;
            container.style.position = 'fixed';
            container.style.top = '-9999px';
            container.style.left = '-9999px';
            container.className = 'export-image-container';
            document.body.appendChild(container);

            // Render content
            const el = document.createElement('div');
            el.className = 'friday-export-preview markdown-rendered';
            el.style.padding = `${this.settings.padding.top}px`; // Use unified padding
            
            if (this.settings.showFilename) {
                const filenameEl = document.createElement('div');
                filenameEl.className = 'friday-export-filename';
                filenameEl.textContent = file.basename;
                el.appendChild(filenameEl);
            }
            
            const contentEl = document.createElement('div');
            await MarkdownRenderer.render(app, markdown, contentEl, file.path, this.component);
            el.appendChild(contentEl);
            
            container.appendChild(el);
            
            // Wait for rendering
            await new Promise(r => setTimeout(r, 500));
            
            // Resolve local images before capturing
            await this.resolveLocalImages(container, app, file.path);
            
            // Capture as image
            await this.captureAndSave(container, file.basename);
            
            // Clean up
            document.body.removeChild(container);
            
        } catch (error) {
            console.error('Export failed:', error);
            new Notice('Failed to export image');
        }
    }

    /**
     * Capture element and download as image
     */
    private async captureAndSave(element: HTMLElement, filename: string): Promise<void> {
        const notice = new Notice('Generating image...', 0);
        try {
            // Before capturing, ensure all local images are resolved
            if (this.currentFile) {
                await this.resolveLocalImages(element, this.plugin.app, this.currentFile.path);
            }
            
            const scale = this.settings.resolutionMode === '2x' ? 2 : 
                          this.settings.resolutionMode === '3x' ? 3 : 
                          this.settings.resolutionMode === '4x' ? 4 : 1;
                          
            const blob = await domtoimage.toBlob(element, {
                width: element.clientWidth,
                height: element.clientHeight,
                quality: 0.85,
                scale: scale,
                bgcolor: 'white',
                style: {
                    'background-color': 'white'
                }
            });

            // Create download link
            const downloadLink = document.createElement('a');
            downloadLink.href = URL.createObjectURL(blob);
            downloadLink.download = `${filename}.${this.settings.format}`;
            document.body.appendChild(downloadLink);
            downloadLink.click();
            document.body.removeChild(downloadLink);
            
            notice.hide();
            new Notice('Image downloaded successfully');
        } catch (error) {
            notice.hide();
            console.error('Error generating image:', error);
            new Notice('Failed to generate image');
        }
    }

    /**
     * Add button to current active leaf
     */
    private addButtonToActiveLeaf(): void {
        const activeLeaf = this.plugin.app.workspace.activeLeaf;
        if (activeLeaf) {
            this.onLeafChange(activeLeaf);
        }
    }

    /**
     * Handle leaf change event
     */
    private onLeafChange(leaf: WorkspaceLeaf | null): void {
        if (!leaf) return;
        
        // Check view type, only add button to markdown view
        const view = leaf.view;
        if (view instanceof MarkdownView) {
            this.addButtonToLeaf(leaf);
        }
    }

    /**
     * Add download button to specified leaf
     */
    private addButtonToLeaf(leaf: WorkspaceLeaf): void {
        const view = leaf.view;
        if (!(view instanceof MarkdownView)) return;
        
        // Get leaf's unique ID to avoid duplicate buttons
        const leafId = (leaf as any).id || String(Math.random());
        if (this.buttonAdded.has(leafId)) return;
        
        // Find preview mode toolbar
        const viewActions = view.containerEl.querySelector('.view-actions');
        if (!viewActions) return;
        
        // Create download button
        const button = document.createElement('button');
        button.className = 'view-action friday-download-image';
        button.setAttribute('aria-label', 'Export as image');
        
        // Use Lucide built-in icon
        const icon = document.createElement('span');
        icon.className = 'icon lucide-image-down'; 
        button.appendChild(icon);
        
        // Add click event handler
        button.addEventListener('click', () => {
            this.exportImage(view.file, this.plugin.app);
        });
        
        // Add to toolbar
        viewActions.appendChild(button);
        
        // Mark this leaf as having a button and save button reference
        this.buttonAdded.add(leafId);
        this.buttons.set(leafId, button);
        
        // Clean up when plugin unloads
        this.plugin.register(() => {
            button.remove();
            this.buttonAdded.delete(leafId);
            this.buttons.delete(leafId);
        });
    }

    /**
     * 在销毁时清理资源
     */
    destroy() {
        // 卸载组件以清理事件监听器
        this.component.unload();
        
        // 关闭任何打开的模态窗口
        if (this.modal) {
            this.modal.close();
            this.modal = null;
        }
    }
}

class ExportImageModal extends Modal {
    private markdown: string;
    private file: TFile;
    private frontmatter: FrontMatterCache | undefined;
    private previewElement: HTMLElement;
    private settings: ExportImageSettings;
    private feature: DownloadImageFeature;
    private component: Component;

    constructor(app: App, markdown: string, file: TFile, frontmatter: FrontMatterCache | undefined, settings: ExportImageSettings, feature: DownloadImageFeature) {
        super(app);
        this.markdown = markdown;
        this.file = file;
        this.frontmatter = frontmatter;
        this.settings = settings;
        this.feature = feature;
        this.component = new Component();
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.addClass('friday-export-modal');

        // Apply classes to modal
        this.modalEl.addClass('friday-export-modal-window');

        // Create title
        const titleEl = contentEl.createEl('h2');
        titleEl.textContent = 'Export Note as Image';

        // Create container with two columns
        const container = contentEl.createEl('div');
        container.addClass('friday-export-container');

        // Left column - Settings
        const settingsContainer = container.createEl('div');
        settingsContainer.addClass('friday-export-settings');

        // Right column - Preview
        const previewContainer = container.createEl('div');
        previewContainer.addClass('friday-export-preview-container');

        // Preview element wrapper - to enable horizontal scrolling if needed
        const previewWrapper = previewContainer.createEl('div');
        previewWrapper.addClass('friday-export-preview-wrapper');

        // Preview element
        this.previewElement = previewWrapper.createEl('div');
        this.previewElement.addClass('friday-export-preview');
        
        // Update preview width from settings (needed for actual rendering)
        this.previewElement.style.width = `${this.settings.width}px`;
        
        // Apply padding from settings
        this.updatePreviewPadding();

        // Add settings
        this.addSettingsUI(settingsContainer);

        // Render preview
        this.renderPreview();

        // Add buttons
        const buttonContainer = contentEl.createEl('div');
        buttonContainer.addClass('friday-export-buttons');

        const cancelButton = buttonContainer.createEl('button');
        cancelButton.textContent = 'Cancel';
        cancelButton.addEventListener('click', () => this.close());

        const exportButton = buttonContainer.createEl('button');
        exportButton.addClass('mod-cta');
        exportButton.textContent = 'Export';
        exportButton.addEventListener('click', () => this.exportImage());
    }

    updatePreviewPadding() {
        const padding = this.settings.padding.top; // All directions use the same value now
        this.previewElement.style.padding = `${padding}px`;
    }

    addSettingsUI(container: HTMLElement) {
        // Image width
        new Setting(container)
            .setName('Image width')
            .setDesc('Width of the exported image in pixels')
            .addText(text => {
                text.setValue(String(this.settings.width))
                    .onChange(async (value) => {
                        const width = parseInt(value, 10);
                        if (!isNaN(width) && width > 0) {
                            this.settings.width = width;
                            this.previewElement.style.width = `${width}px`;
                        }
                    });
            });

        // Show filename
        new Setting(container)
            .setName('Show filename')
            .setDesc('Include the filename at the top of the image')
            .addToggle(toggle => {
                toggle.setValue(this.settings.showFilename)
                    .onChange(async (value) => {
                        this.settings.showFilename = value;
                        this.renderPreview();
                    });
            });

        // Resolution
        new Setting(container)
            .setName('Resolution')
            .setDesc('Higher resolution provides better quality but larger file size')
            .addDropdown(dropdown => {
                dropdown
                    .addOption('1x', '1x (Normal)')
                    .addOption('2x', '2x (High)')
                    .addOption('3x', '3x (Very High)')
                    .addOption('4x', '4x (Ultra High)')
                    .setValue(this.settings.resolutionMode)
                    .onChange(async (value: '1x' | '2x' | '3x' | '4x') => {
                        this.settings.resolutionMode = value;
                    });
            });

        // Image format
        new Setting(container)
            .setName('Format')
            .setDesc('Image format')
            .addDropdown(dropdown => {
                dropdown
                    .addOption('png', 'PNG')
                    .addOption('jpg', 'JPG')
                    .setValue(this.settings.format)
                    .onChange(async (value: 'png' | 'jpg') => {
                        this.settings.format = value;
                    });
            });

        // Padding settings - now using a single slider for all directions
        const paddingValueDisplay = document.createElement('span');
        paddingValueDisplay.textContent = `${this.settings.padding.top}px`;
        paddingValueDisplay.className = 'padding-value-display';
        
        const paddingSetting = new Setting(container)
            .setName('Padding')
            .setDesc('Add equal padding around the content (in pixels)')
            .addSlider(slider => {
                slider
                    .setLimits(0, 40, 4) // Min 0px, Max 40px, Step 4px
                    .setValue(this.settings.padding.top)
                    .onChange(async (value) => {
                        // Set all padding directions to the same value
                        this.settings.padding.top = value;
                        this.settings.padding.right = value;
                        this.settings.padding.bottom = value;
                        this.settings.padding.left = value;
                        this.updatePreviewPadding();
                        
                        // Update the display value
                        paddingValueDisplay.textContent = `${value}px`;
                    });
            });
            
        // Add the value display to the setting
        paddingSetting.controlEl.appendChild(paddingValueDisplay);
    }

    async renderPreview() {
        this.previewElement.empty();

        // Add filename if enabled
        if (this.settings.showFilename) {
            const filenameEl = this.previewElement.createEl('div');
            filenameEl.addClass('friday-export-filename');
            filenameEl.textContent = this.file.basename;
        }

        // Render markdown content
        const contentEl = this.previewElement.createEl('div');
        contentEl.addClass('markdown-rendered');
        await MarkdownRenderer.render(this.app, this.markdown, contentEl, this.file.path, this.component);
    }

    async exportImage() {
        const notice = new Notice('Generating image...', 0);
        
        // Add processing class to preview element
        this.previewElement.addClass('friday-export-processing');
        
        try {
            // Need to first save the settings
            await this.saveSettings();
            
            // Resolve local images before capturing
            await this.feature.resolveLocalImages(this.previewElement, this.app, this.file.path);
            
            // Capture the preview as an image
            const scale = this.settings.resolutionMode === '2x' ? 2 : 
                         this.settings.resolutionMode === '3x' ? 3 : 
                         this.settings.resolutionMode === '4x' ? 4 : 1;
                         
            const blob = await domtoimage.toBlob(this.previewElement, {
                width: this.previewElement.clientWidth,
                height: this.previewElement.clientHeight,
                quality: 0.85,
                scale: scale,
                bgcolor: 'white',
                style: {
                    'background-color': 'white'
                }
            });

            // Create download link
            const downloadLink = document.createElement('a');
            downloadLink.href = URL.createObjectURL(blob);
            downloadLink.download = `${this.file.basename}.${this.settings.format}`;
            document.body.appendChild(downloadLink);
            downloadLink.click();
            document.body.removeChild(downloadLink);
            
            notice.hide();
            new Notice('Image downloaded successfully');
            this.close();
        } catch (error) {
            notice.hide();
            console.error('Error generating image:', error);
            new Notice('Failed to generate image');
            
            // Remove processing class if there was an error
            this.previewElement.removeClass('friday-export-processing');
        }
    }

    async saveSettings() {
        try {
            this.feature.settings = this.settings;
            await this.feature.saveSettings();
        } catch (error) {
            console.error('Failed to save export image settings:', error);
        }
    }

    onClose() {
        // 清理组件以避免内存泄漏
        this.component.unload();
        super.onClose();
    }
}
