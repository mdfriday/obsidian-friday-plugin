import type { TranslationNamespace } from '../types';

/**
 * English translations (default language)
 */
export const en: TranslationNamespace = {
	settings: {
		welcome_back: 'Welcome Back!',
		welcome: 'Welcome!',
		logged_in_as: 'Logged in as: {{username}}',
		please_enter_credentials: 'Please enter your credentials.',
		email: 'Email',
		email_desc: 'Enter your email address',
		email_placeholder: 'your@email.com',
		password: 'Password',
		password_desc: 'Enter your password',
		password_placeholder: 'password',
		register: 'Register',
		login: 'Login',
		logout: 'Logout',
		
		// Publish settings
		publish_settings: 'Publish Settings',
		publish_method: 'Publish Method',
		publish_method_desc: 'Choose how you want to publish your site',
		publish_method_netlify: 'Netlify',
		publish_method_ftp: 'FTP',
		
		// Netlify settings
		netlify_settings: 'Netlify Settings',
		netlify_access_token: 'Personal Access Token',
		netlify_access_token_desc: 'Your Netlify personal access token for API authentication',
		netlify_access_token_placeholder: 'Enter your Netlify access token',
		netlify_project_id: 'Project ID',
		netlify_project_id_desc: 'The ID of your Netlify project/site',
		netlify_project_id_placeholder: 'Enter your project ID',
		
		// FTP settings
		ftp_settings: 'FTP Settings',
		ftp_server: 'Server Address',
		ftp_server_desc: 'FTP server domain or IP address',
		ftp_server_placeholder: 'e.g. ftp.example.com',
		ftp_username: 'Username',
		ftp_username_desc: 'FTP login username',
		ftp_username_placeholder: 'Enter username',
		ftp_password: 'Password',
		ftp_password_desc: 'FTP login password',
		ftp_password_placeholder: 'Enter password',
		ftp_remote_dir: 'Remote Directory',
		ftp_remote_dir_desc: 'Target directory path for upload',
		ftp_remote_dir_placeholder: 'e.g. /www/site',
		ftp_ignore_cert: 'Ignore Certificate Verification',
		ftp_ignore_cert_desc: 'Enable for self-signed certificates, recommended',
		ftp_test_connection: 'Test FTP Connection',
		ftp_test_connection_desc: 'Test if current FTP settings are correct',
		ftp_test_connection_testing: 'Testing...',
		ftp_test_connection_success: 'Connection Successful',
		ftp_test_connection_failed: 'Connection Failed',
		
		// General settings
		general_settings: 'General Settings',
		download_server: 'Download Server',
		download_server_desc: 'Choose the server for downloading themes and resources',
		download_server_global: 'Global',
		download_server_east: 'East',
		
		// MDFriday Account
		mdfriday_account: 'MDFriday Account (Optional)',
		mdfriday_account_desc: 'Sign in to access advanced features like theme marketplace and cloud publishing.',
	},

	ui: {
		// Server view
		desktop_only_title: 'Desktop Only',
		desktop_only_message: "We're sorry, only desktop is supported at this time.",
		mobile_coming_soon: 'Mobile and Tablet is coming soon.\nThank you for your patience and understanding!',
		
		// Site builder
		multilingual_content: 'Multilingual Content',
		content_path: 'Content Path',
		language: 'Language',
		clear: 'Clear',
		clear_all_content: 'Clear all content',
		default: 'Default',
		no_content_selected: 'No content selected',
		no_content_selected_hint: 'Right-click on a folder or file and select "Publish to Web" to get started',
		remove_language: 'Remove language',
		site_name: 'Site Name',
		site_name_placeholder: 'Enter site name',
		site_assets: 'Site Assets',
		site_assets_placeholder: 'No assets folder set',
		site_assets_hint: 'Right-click on a folder and select "Set as Site Assets" to configure',
		clear_assets: 'Clear',
		advanced_settings: 'Advanced Settings',
		site_path: 'Site Path',
		site_path_placeholder: '/',
		site_path_hint: 'Specify the base path for your site. Use "/" for root deployment.',
		google_analytics_id: 'Google Analytics ID',
		google_analytics_placeholder: 'G-XXXXXXXXXX',
		google_analytics_hint: 'Your Google Analytics measurement ID (optional)',
		disqus_shortname: 'Disqus Shortname',
		disqus_placeholder: 'your-site-shortname',
		disqus_hint: 'Your Disqus shortname for comments (optional)',
		theme: 'Theme',
		change_theme: 'Change Theme',
		download_sample: 'Download Sample',
		downloading_sample: 'Downloading...',
		
		// Preview section
		preview: 'Preview',
		preview_building: 'Building preview...',
		preview_success: 'Preview ready!',
		preview_failed: 'Preview build failed',
		generate_preview: 'Generate Preview',
		regenerate_preview: 'Regenerate Preview',
		preview_link: 'Preview link:',
		export_site: 'Export Site',
		exporting: 'Exporting...',
		export_site_dialog_title: 'Save Site Archive',
		
		// Publish section
		publish: 'Publish',
		publish_option_mdfriday: 'MDFriday Preview',
		publish_option_netlify: 'Netlify',
		publish_option_ftp: 'FTP Upload',
		publish_building: 'Publishing...',
		publish_success: 'Published successfully!',
		publish_failed: 'Publish failed',
		published_successfully: '✅ Published successfully!',
		
		// Server section
		server_start: 'Start Server',
		server_stop: 'Stop Server',
		server_running: 'Server Running',
		server_stopped: 'Server Stopped',
	},

	menu: {
		publish_to_web: 'Publish to Web',
		set_as_site_assets: 'Set as Site Assets',
	},

	commands: {
	},

	theme: {
		choose_theme: 'Choose a Theme',
		search_themes: 'Search themes...',
		filter_by_tags: 'Filter by tags:',
		clear_filters: 'Clear filters',
		loading_themes: 'Loading themes...',
		loading_tags: 'Loading tags...',
		loading_initial: 'Initializing theme library...',
		loading_search: 'Searching themes...',
		loading_error: 'Loading failed, please retry',
		no_themes_found: 'No themes found',
		view_demo: 'View Demo',
		use_it: 'Use It',
		current: 'Current',
		by_author: 'by {{author}}',
		retry: 'Retry',
	},

	messages: {
		desktop_only_notice: 'Only desktop is supported at this time.',
		preview_url_copied: 'Preview URL copied to clipboard',
		publish_url_copied: 'Publish URL copied to clipboard',
		build_started: 'Build started',
		build_completed: 'Build completed successfully',
		build_failed: 'Build failed',
		publish_started: 'Publishing started',
		publish_completed: 'Published successfully',
		publish_failed: 'Publishing failed',
		
		// Preview messages
		no_folder_selected: 'No folder selected',
		no_folder_or_file_selected: 'No folder or file selected',
		must_select_folder_type: 'Content type mismatch: You previously selected a folder, but now selected a file. To publish files, click the "Clear" button in the top-right to remove previous selections, then select files only.',
		must_select_file_type: 'Content type mismatch: You previously selected a file, but now selected a folder. To publish folders, click the "Clear" button in the top-right to remove previous selections, then select folders only.',
		all_content_cleared: 'All content cleared successfully',
		language_added_successfully: 'Language content added successfully',
		please_use_publish_first: 'Please use "Publish to Web" on a folder or file first to get started',
		add_language_instruction: 'Right-click on a folder or file and select "Publish to Web" to add more languages',
		preview_generated_successfully: 'Preview generated successfully!',
		preview_failed: 'Preview failed: {{error}}',
		please_generate_preview_first: 'Please generate preview first',
		preview_data_missing: 'Preview data is missing',
		site_published_successfully: 'Site published successfully!',
		publishing_failed: 'Publishing failed: {{error}}',
		site_exported_successfully: 'Site exported successfully to: {{path}}',
		export_failed: 'Export failed: {{error}}',
		
		// Netlify messages
		netlify_settings_missing: 'Please configure Netlify settings first',
		netlify_deploy_failed: 'Netlify deployment failed: {{error}}',
		netlify_deploy_success: 'Site deployed to Netlify successfully!',
		
		// FTP messages
		ftp_settings_missing: 'Please configure FTP settings first',
		ftp_upload_failed: 'FTP upload failed: {{error}}',
		ftp_upload_success: 'Site uploaded to FTP server successfully!',
		ftp_fallback_to_plain: 'Server does not support encryption, switched to plain FTP',
		
		// User messages
		enter_email_password: 'Please enter your email and password',
		enter_valid_email: 'Please enter a valid email address',
		login_failed: 'Failed to login',
		register_failed: 'Failed to register user',
		
		// Site assets messages
		invalid_assets_folder: 'Invalid assets folder',
		site_assets_set_successfully: 'Site assets set successfully',
		site_assets_cleared: 'Site assets cleared',
		
		// Sample download messages
		sample_downloaded_successfully: 'Theme sample "{{themeName}}" downloaded successfully! Saved to folder: {{folderName}}',
		sample_download_failed: 'Sample download failed: {{error}}',
		
		// Structured folder messages
		structured_folder_processed: 'Structured folder "{{folderName}}" detected, automatically added {{contentCount}} language contents',
		static_folder_detected: 'and detected static assets folder',
		
		// General messages
		failed_to_create_post: 'Failed to create post.',
		failed_to_create_resource: 'Failed to create resource.',
	},

	info: {
		service_description: 'You own it — your notes, your themes, your cloud.\n' +
			'MDFriday lets you build and publish with full control.',
		learn_more: 'Learn more',
	},

	common: {
		loading: 'Loading...',
		success: 'Success',
		error: 'Error',
		cancel: 'Cancel',
		confirm: 'Confirm',
		save: 'Save',
		close: 'Close',
		copy: 'Copy',
		copied: 'Copied!',
	},
};
