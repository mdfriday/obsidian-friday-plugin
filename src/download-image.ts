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
