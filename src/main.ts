import {App, Plugin, PluginSettingTab, Setting, TFolder, TFile} from 'obsidian';
import ServerView, {FRIDAY_SERVER_VIEW_TYPE} from './server';
import {User} from "./user";
import './styles/theme-modal.css';
import './styles/publish-settings.css';
import {ThemeSelectionModal} from "./theme/modal";
import {Hugoverse} from "./hugoverse";
import {NetlifyAPI} from "./netlify";
import {I18nService} from "./i18n";
import {FTPUploader} from "./ftp";

interface FridaySettings {
	username: string;
	password: string;
	userToken: string;
	// Publish Settings
	publishMethod: 'netlify' | 'ftp';
	netlifyAccessToken: string;
	netlifyProjectId: string;
	// FTP Settings
	ftpServer: string;
	ftpUsername: string;
	ftpPassword: string;
	ftpRemoteDir: string;
	ftpIgnoreCert: boolean;
}

const DEFAULT_SETTINGS: FridaySettings = {
	username: '',
	password: '',
	userToken: '',
	// Publish Settings defaults
	publishMethod: 'netlify',
	netlifyAccessToken: '',
	netlifyProjectId: '',
	// FTP Settings defaults
	ftpServer: '',
	ftpUsername: '',
	ftpPassword: '',
	ftpRemoteDir: '',
	ftpIgnoreCert: true, // Default to true for easier setup with self-signed certs
}

export const FRIDAY_ICON = 'dice-5';
export const API_URL_DEV = 'http://127.0.0.1:1314';
export const API_URL_PRO = 'https://mdfriday.sunwei.xyz';
export function GetBaseUrl(): string {
	return process.env.NODE_ENV === 'development' ? API_URL_DEV : API_URL_PRO;
}

export default class FridayPlugin extends Plugin {
	settings: FridaySettings;
	statusBar: HTMLElement

	pluginDir: string
	apiUrl: string
	user: User
	hugoverse: Hugoverse
	netlify: NetlifyAPI
	i18n: I18nService
	ftp: FTPUploader | null = null

	async onload() {
		this.pluginDir = `${this.manifest.dir}`;
		await this.loadSettings();
		await this.initFriday()
		
		// Initialize FTP uploader
		this.initializeFTP();

		this.statusBar = this.addStatusBarItem();

		this.addSettingTab(new FridaySettingTab(this.app, this));

		this.registerView(FRIDAY_SERVER_VIEW_TYPE, leaf => new ServerView(leaf, this))
		this.app.workspace.onLayoutReady(() => this.initLeaf())

		// Register export HTML command
		this.addCommand({
			id: "export-current-note-with-css",
			name: this.i18n.t('menu.publish_to_web'),
			checkCallback: (checking) => {
				const file = this.app.workspace.getActiveFile();
				if (file && file.extension === 'md') {
					if (!checking) {
						this.openPublishPanel(null, file);
					}
					return true;
				}
				return false;
			}
		});

		// Register context menu for files and folders
		this.registerEvent(
			this.app.workspace.on('file-menu', (menu, file) => {
				if (file instanceof TFolder) {
					menu.addItem(item => {
						item
							.setTitle(this.i18n.t('menu.publish_to_web'))
							.setIcon(FRIDAY_ICON)
							.onClick(async () => {
								await this.openPublishPanel(file, null);
							});
					});
				} else if (file instanceof TFile && file.extension === 'md') {
					// Add publish option for markdown files (unified behavior)
					menu.addItem(item => {
						item
							.setTitle(this.i18n.t('menu.publish_to_web'))
							.setIcon(FRIDAY_ICON)
							.onClick(async () => {
								await this.openPublishPanel(null, file);
							});
					});
				}
			})
		);
	}

	async openPublishPanel(folder: TFolder | null, file: TFile | null) {
		const rightSplit = this.app.workspace.rightSplit;
		if (!rightSplit) {
			return;
		}
		if (rightSplit.collapsed) {
			rightSplit.expand();
		}
		const leaves = this.app.workspace.getLeavesOfType(FRIDAY_SERVER_VIEW_TYPE);
		if (leaves.length > 0) {
			const serverView = leaves[0].view as ServerView;
			// Set selected folder or file and switch to site tab
			if (folder) {
				serverView.setSelectedFolder(folder);
			} else if (file) {
				(serverView as any).setSelectedFile(file);
			}
			await this.app.workspace.revealLeaf(leaves[0]);
		} else {
			// If no existing view, create a new one
			const leaf = this.app.workspace.getRightLeaf(false);
			if (leaf) {
				await leaf.setViewState({
					type: FRIDAY_SERVER_VIEW_TYPE,
					active: true,
				});
				const serverView = leaf.view as ServerView;
				if (folder) {
					serverView.setSelectedFolder(folder);
				} else if (file) {
					(serverView as any).setSelectedFile(file);
				}
			}
		}
	}

	showThemeSelectionModal(selectedTheme: string, onSelect: (themeUrl: string, themeName?: string, themeId?: string) => void, isForSingleFile: boolean = false) {
		const modal = new ThemeSelectionModal(this.app, selectedTheme, onSelect, this, isForSingleFile);
		modal.open();
	}

	async initFriday(): Promise<void> {
		this.apiUrl = process.env.NODE_ENV === 'development' ? API_URL_DEV : API_URL_PRO;
		
		// Initialize i18n service first
		this.i18n = new I18nService(this);
		await this.i18n.init();
		
		this.user = new User(this);
		this.hugoverse = new Hugoverse(this);
		this.netlify = new NetlifyAPI(this);
	}

	initLeaf(): void {
		if (this.app.workspace.getLeavesOfType(FRIDAY_SERVER_VIEW_TYPE).length > 0) return

		this.app.workspace.getRightLeaf(false)?.setViewState({
			type: FRIDAY_SERVER_VIEW_TYPE,
			active: true,
		}).then(r => {})
	}

	async onunload() {
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
		// Reinitialize FTP uploader when settings change
		this.initializeFTP();
	}

	/**
	 * Initialize FTP uploader with current settings
	 */
	initializeFTP() {
		const { ftpServer, ftpUsername, ftpPassword, ftpRemoteDir, ftpIgnoreCert } = this.settings;
		
		if (ftpServer && ftpUsername && ftpPassword) {
			this.ftp = new FTPUploader({
				server: ftpServer,
				username: ftpUsername,
				password: ftpPassword,
				remoteDir: ftpRemoteDir || '/',
				ignoreCert: ftpIgnoreCert
			});
		} else {
			this.ftp = null;
		}
	}

	/**
	 * Test FTP connection
	 */
	async testFTPConnection(): Promise<{ success: boolean; message: string }> {
		if (!this.ftp) {
			return {
				success: false,
				message: 'FTP not configured'
			};
		}

		try {
			const result = await this.ftp.testConnection();
			if (result.success) {
				const secureInfo = result.usedSecure ? 'FTPS' : 'FTP (Plain)';
				return {
					success: true,
					message: `Connection successful using ${secureInfo}`
				};
			} else {
				return {
					success: false,
					message: result.error || 'Connection failed'
				};
			}
		} catch (error) {
			return {
				success: false,
				message: error instanceof Error ? error.message : String(error)
			};
		}
	}

	async status(text: string) {
		this.statusBar.setText(text)
	}
}

class FridaySettingTab extends PluginSettingTab {
	plugin: FridayPlugin;

	constructor(app: App, plugin: FridayPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const {containerEl} = this;

		containerEl.empty();

		const {username, password, userToken, publishMethod, netlifyAccessToken, netlifyProjectId, ftpServer, ftpUsername, ftpPassword, ftpRemoteDir, ftpIgnoreCert} = this.plugin.settings;



		// Publish Settings Section
		containerEl.createEl("h2", {text: this.plugin.i18n.t('settings.publish_settings')});
		
		// Create containers for dynamic content
		let netlifySettingsContainer: HTMLElement;
		let ftpSettingsContainer: HTMLElement;
		
		// Publish Method Dropdown
		new Setting(containerEl)
			.setName(this.plugin.i18n.t('settings.publish_method'))
			.setDesc(this.plugin.i18n.t('settings.publish_method_desc'))
			.addDropdown((dropdown) => {
				dropdown
					.addOption('netlify', this.plugin.i18n.t('settings.publish_method_netlify'))
					.addOption('ftp', this.plugin.i18n.t('settings.publish_method_ftp'))
					.setValue(publishMethod || 'netlify')
					.onChange(async (value: 'netlify' | 'ftp') => {
						this.plugin.settings.publishMethod = value;
						await this.plugin.saveSettings();
						showPublishSettings(value);
					});
			});

		// Create containers for different publish methods
		netlifySettingsContainer = containerEl.createDiv('netlify-settings-container');
		ftpSettingsContainer = containerEl.createDiv('ftp-settings-container');

		// Function to show/hide publish settings based on selected method
		const showPublishSettings = (method: 'netlify' | 'ftp') => {
			if (method === 'netlify') {
				netlifySettingsContainer.style.display = 'block';
				ftpSettingsContainer.style.display = 'none';
			} else {
				netlifySettingsContainer.style.display = 'none';
				ftpSettingsContainer.style.display = 'block';
			}
		};

		// Netlify Settings
		netlifySettingsContainer.createEl("h3", {text: this.plugin.i18n.t('settings.netlify_settings')});
		
		// Netlify Access Token
		new Setting(netlifySettingsContainer)
			.setName(this.plugin.i18n.t('settings.netlify_access_token'))
			.setDesc(this.plugin.i18n.t('settings.netlify_access_token_desc'))
			.addText((text) => {
				text
					.setPlaceholder(this.plugin.i18n.t('settings.netlify_access_token_placeholder'))
					.setValue(netlifyAccessToken || "")
					.onChange(async (value) => {
						this.plugin.settings.netlifyAccessToken = value;
						await this.plugin.saveSettings();
					});
				text.inputEl.type = "password";
			});

		// Netlify Project ID
		new Setting(netlifySettingsContainer)
			.setName(this.plugin.i18n.t('settings.netlify_project_id'))
			.setDesc(this.plugin.i18n.t('settings.netlify_project_id_desc'))
			.addText((text) =>
				text
					.setPlaceholder(this.plugin.i18n.t('settings.netlify_project_id_placeholder'))
					.setValue(netlifyProjectId || "")
					.onChange(async (value) => {
						this.plugin.settings.netlifyProjectId = value;
						await this.plugin.saveSettings();
					})
			);

		// FTP Settings
		ftpSettingsContainer.createEl("h3", {text: this.plugin.i18n.t('settings.ftp_settings')});
		
		// Declare resetButtonState function first (will be defined later)
		let resetButtonState: (() => void) | undefined;

		// FTP Server
		new Setting(ftpSettingsContainer)
			.setName(this.plugin.i18n.t('settings.ftp_server'))
			.setDesc(this.plugin.i18n.t('settings.ftp_server_desc'))
			.addText((text) =>
				text
					.setPlaceholder(this.plugin.i18n.t('settings.ftp_server_placeholder'))
					.setValue(ftpServer || "")
					.onChange(async (value) => {
						this.plugin.settings.ftpServer = value;
						await this.plugin.saveSettings();
						if (resetButtonState) resetButtonState();
					})
			);

		// FTP Username
		new Setting(ftpSettingsContainer)
			.setName(this.plugin.i18n.t('settings.ftp_username'))
			.setDesc(this.plugin.i18n.t('settings.ftp_username_desc'))
			.addText((text) =>
				text
					.setPlaceholder(this.plugin.i18n.t('settings.ftp_username_placeholder'))
					.setValue(ftpUsername || "")
					.onChange(async (value) => {
						this.plugin.settings.ftpUsername = value;
						await this.plugin.saveSettings();
						if (resetButtonState) resetButtonState();
					})
			);

		// FTP Password
		new Setting(ftpSettingsContainer)
			.setName(this.plugin.i18n.t('settings.ftp_password'))
			.setDesc(this.plugin.i18n.t('settings.ftp_password_desc'))
			.addText((text) => {
				text
					.setPlaceholder(this.plugin.i18n.t('settings.ftp_password_placeholder'))
					.setValue(ftpPassword || "")
					.onChange(async (value) => {
						this.plugin.settings.ftpPassword = value;
						await this.plugin.saveSettings();
						if (resetButtonState) resetButtonState();
					});
				text.inputEl.type = "password";
			});

		// FTP Remote Directory
		new Setting(ftpSettingsContainer)
			.setName(this.plugin.i18n.t('settings.ftp_remote_dir'))
			.setDesc(this.plugin.i18n.t('settings.ftp_remote_dir_desc'))
			.addText((text) =>
				text
					.setPlaceholder(this.plugin.i18n.t('settings.ftp_remote_dir_placeholder'))
					.setValue(ftpRemoteDir || "")
					.onChange(async (value) => {
						this.plugin.settings.ftpRemoteDir = value;
						await this.plugin.saveSettings();
						if (resetButtonState) resetButtonState();
					})
			);

		// FTP Ignore Certificate Verification
		new Setting(ftpSettingsContainer)
			.setName(this.plugin.i18n.t('settings.ftp_ignore_cert'))
			.setDesc(this.plugin.i18n.t('settings.ftp_ignore_cert_desc'))
			.addToggle((toggle) =>
				toggle
					.setValue(ftpIgnoreCert)
					.onChange(async (value) => {
						this.plugin.settings.ftpIgnoreCert = value;
						await this.plugin.saveSettings();
						if (resetButtonState) resetButtonState();
					})
			);

		// FTP Test Connection Button
		const testConnectionSetting = new Setting(ftpSettingsContainer)
			.setName(this.plugin.i18n.t('settings.ftp_test_connection'))
			.setDesc(this.plugin.i18n.t('settings.ftp_test_connection_desc'));

		let testButton: HTMLButtonElement;
		let testResultEl: HTMLElement | null = null;

		// Function to check if all required FTP settings are filled
		const isFTPConfigured = () => {
			return !!(this.plugin.settings.ftpServer?.trim() && 
					 this.plugin.settings.ftpUsername?.trim() && 
					 this.plugin.settings.ftpPassword?.trim());
		};

		// Function to update button state
		const updateButtonState = (state: 'idle' | 'testing' | 'success' | 'error', message?: string) => {
			// Remove existing result element
			if (testResultEl) {
				testResultEl.remove();
				testResultEl = null;
			}

			switch (state) {
				case 'idle':
					testButton.textContent = this.plugin.i18n.t('settings.ftp_test_connection');
					testButton.disabled = !isFTPConfigured();
					testButton.removeClass('ftp-test-success', 'ftp-test-error');
					break;
				case 'testing':
					testButton.textContent = this.plugin.i18n.t('settings.ftp_test_connection_testing');
					testButton.disabled = true;
					testButton.removeClass('ftp-test-success', 'ftp-test-error');
					break;
				case 'success':
					testButton.textContent = this.plugin.i18n.t('settings.ftp_test_connection_success');
					testButton.disabled = false;
					testButton.removeClass('ftp-test-error');
					testButton.addClass('ftp-test-success');
					if (message) {
						// Insert after the setting element
						testResultEl = ftpSettingsContainer.createEl('div', { 
							text: `✅ ${message}`,
							cls: 'ftp-test-result ftp-test-result-success'
						});
						// Insert the result element right after the test connection setting
						testConnectionSetting.settingEl.insertAdjacentElement('afterend', testResultEl);
					}
					break;
				case 'error':
					testButton.textContent = this.plugin.i18n.t('settings.ftp_test_connection_failed');
					testButton.disabled = false;
					testButton.removeClass('ftp-test-success');
					testButton.addClass('ftp-test-error');
					if (message) {
						// Insert after the setting element
						testResultEl = ftpSettingsContainer.createEl('div', { 
							text: `❌ ${message}`,
							cls: 'ftp-test-result ftp-test-result-error'
						});
						// Insert the result element right after the test connection setting
						testConnectionSetting.settingEl.insertAdjacentElement('afterend', testResultEl);
					}
					break;
			}
		};

		// Function to reset button state when settings change
		resetButtonState = () => {
			updateButtonState('idle');
		};

		testConnectionSetting.addButton((button) => {
			testButton = button.buttonEl;
			updateButtonState('idle');
			
			button.onClick(async () => {
				updateButtonState('testing');
				
				try {
					// Refresh FTP configuration with latest settings
					this.plugin.initializeFTP();
					const result = await this.plugin.testFTPConnection();
					
					if (result.success) {
						updateButtonState('success', result.message);
					} else {
						updateButtonState('error', result.message);
					}
				} catch (error) {
					const errorMessage = error instanceof Error ? error.message : String(error);
					updateButtonState('error', errorMessage);
				}
			});
		});

		// Initialize the display based on current publish method
		showPublishSettings(publishMethod || 'netlify');



		// MDFriday Account Section (optional for advanced features)
		containerEl.createEl("h2", {text: this.plugin.i18n.t('settings.mdfriday_account')});
		
		if (userToken) {
			// 用户已登录的界面
			containerEl.createEl("p", {text: this.plugin.i18n.t('settings.logged_in_as', { username })});

			new Setting(containerEl)
				.addButton((button) =>
					button
						.setButtonText(this.plugin.i18n.t('settings.logout'))
						.setCta()
						.onClick(async () => {
							await this.plugin.user.logout(); // 处理登出逻辑
							this.display(); // 刷新界面
						})
				);
		} else {
			// 用户未登录的界面
			containerEl.createEl("p", {text: this.plugin.i18n.t('settings.mdfriday_account_desc')});

			// Email 输入框
			new Setting(containerEl)
				.setName(this.plugin.i18n.t('settings.email'))
				.setDesc(this.plugin.i18n.t('settings.email_desc'))
				.addText((text) =>
					text
						.setPlaceholder(this.plugin.i18n.t('settings.email_placeholder'))
						.setValue(username || "") // 填充现有用户名
						.onChange(async (value) => {
							this.plugin.settings.username = value;
							await this.plugin.saveSettings();
						})
				);

			// Password 输入框
			new Setting(containerEl)
				.setName(this.plugin.i18n.t('settings.password'))
				.setDesc(this.plugin.i18n.t('settings.password_desc'))
				.addText((text) => {
					text
						.setPlaceholder(this.plugin.i18n.t('settings.password_placeholder'))
						.setValue(password || "") // 填充现有密码
						.onChange(async (value) => {
							this.plugin.settings.password = value;
							await this.plugin.saveSettings();
						})
					text.inputEl.type = "password";
				});

			// Register 按钮
			new Setting(containerEl)
				.addButton((button) =>
					button
						.setButtonText(this.plugin.i18n.t('settings.register'))
						.setCta()
						.onClick(async () => {
							await this.plugin.user.register(); // 处理注册逻辑
							this.display(); // 刷新界面
						})
				).addButton((button) =>
				button
					.setButtonText(this.plugin.i18n.t('settings.login'))
					.setCta()
					.onClick(async () => {
						await this.plugin.user.login(); // 处理登录逻辑
						this.display(); // 刷新界面
					})
			);
		}
	}
}
