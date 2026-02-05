import type { TranslationNamespace } from "../types";

/**
 * English translations (default language)
 */
export const en: TranslationNamespace = {
	settings: {
		welcome_back: "Welcome Back!",
		welcome: "Welcome!",
		logged_in_as: "Logged in as: {{username}}",
		please_enter_credentials: "Please enter your credentials.",
		email: "Email",
		email_desc: "Enter your email address",
		email_placeholder: "your@email.com",
		password: "Password",
		password_desc: "Enter your password",
		password_placeholder: "password",
		register: "Register",
		login: "Login",
		logout: "Logout",

		// License Settings
		license: "License",
		license_key: "License Key",
		license_key_placeholder: "MDF-XXXX-XXXX-XXXX",
		activate: "Activate",
		activating: "Activating…",
		license_active: "License Active",
		plan: "Plan",
		valid_until: "Valid Until",
		devices: "Devices",
		devices_registered: "Registered devices on this license",
		storage_usage: "Storage Usage",
		storage_usage_desc: "Total disk space usage",
		sync: "Sync",
		publish: "Publish",
		enabled: "Enabled",
		disabled: "Disabled",
		details: "Details",
		hide_details: "Hide Details",
		license_invalid_format: "Invalid license key format. Expected: MDF-XXXX-XXXX-XXXX",
		license_activation_failed: "License activation failed. Please check your license key.",
		license_activated_success: "License activated successfully!",
		click_to_refresh_license_info: "Click to refresh license info",
		refreshing: "Refreshing...",
		license_info_refreshed: "License info updated",
		refresh_failed: "Failed to refresh license info",

		// Sync Settings (License-based)
		sync_enabled: "Sync is enabled",
		sync_description: "Your data is securely synced across devices.",
		sync_first_time_title: "This is your first time using sync.",
		sync_first_time_desc: "Choose how you want to set up sync on this device.",
		upload_local_to_cloud: "Upload local data to cloud",
		download_from_cloud: "Download data from cloud",
		sync_data_available: "Data is available in the cloud.",
		sync_uploading: "Uploading...",
		sync_downloading: "Downloading...",
		sync_upload_success: "Local data uploaded to cloud successfully!",
		sync_download_success: "Cloud data downloaded successfully!",
		sync_operation_failed: "Sync operation failed. Please try again.",

		// UI Display Settings
		show_editor_status: "Show Editor Status Display",
		show_editor_status_desc: "Show sync status in the top-right corner of the editor (always shown on mobile)",
		hide_editor_status: "Hide Editor Status Display",
		reconnect_sync: "Reconnect Sync",
		sync_settings: "Sync Settings",

		// Security Settings
		security: "Security",
		encryption_enabled: "End-to-end encryption is enabled",
		encryption_password: "Encryption Password",
		encryption_password_desc: "Enter the encryption password from your first activation to decrypt cloud data",
		encryption_password_placeholder: "Enter encryption password",
		encryption_password_required: "Please enter the encryption password first",
		show_password: "Show",
		hide_password: "Hide",

		// Selective Sync Settings
		selective_sync: "Selective Sync",
		sync_images: "Sync Images",
		sync_images_desc: "Sync image files: bmp, png, jpg, jpeg, gif, svg, webp, avif.",
		sync_audio: "Sync Audio",
		sync_audio_desc: "Sync audio files: mp3, wav, m4a, 3gp, flac, ogg, oga, opus.",
		sync_video: "Sync Video",
		sync_video_desc: "Sync video files: mp4, webm, ogv, mov, mkv.",
		sync_pdf: "Sync PDF",
		sync_pdf_desc: "Sync PDF files.",
		sync_themes: "Sync Themes",
		sync_themes_desc: "Sync Obsidian themes from .obsidian/themes folder.",
		sync_snippets: "Sync Snippets",
		sync_snippets_desc: "Sync CSS snippets from .obsidian/snippets folder.",
		sync_plugins: "Sync Plugins",
		sync_plugins_desc: "Sync Obsidian plugins from .obsidian/plugins folder.",
		ignore_patterns: "Ignore Patterns",
		ignore_patterns_desc: "Files and folders matching these patterns will not be synced. Use gitignore format.",
		ignore_patterns_placeholder: "e.g. images/, *.tmp",
		ignore_patterns_add: "Add Rule",
		ignore_patterns_delete: "Delete Rule",
		ignore_patterns_custom_rule: "Custom rule",

		// Publish settings
		publish_settings: "Publish Settings",
		publish_method: "Publish Method",
		publish_method_desc: "Choose how you want to publish your site",
		publish_method_mdfriday: "MDFriday Subdomain",
		publish_method_netlify: "Netlify",
		publish_method_ftp: "FTP",
		publish_method_mdfriday_custom: "MDFriday Custom Domain",
		license_required: "Please upgrade your plan to use this feature",
		upgrade_for_mdfshare: "Please upgrade your plan to use MDFriday Share",
		upgrade_for_subdomain: "Please upgrade your plan to use MDFriday Subdomain",
		upgrade_for_custom_domain: "Please upgrade your plan to use MDFriday Custom Domain",
		upgrade_for_enterprise: "Please upgrade to Enterprise plan and configure enterprise server URL",

		// Netlify settings
		netlify_settings: "Netlify Settings",
		netlify_access_token: "Personal Access Token",
		netlify_access_token_desc:
			"Your Netlify personal access token for API authentication",
		netlify_access_token_placeholder: "Enter your Netlify access token",
		netlify_project_id: "Project ID",
		netlify_project_id_desc: "The ID of your Netlify project/site",
		netlify_project_id_placeholder: "Enter your project ID",

		// FTP settings
		ftp_settings: "FTP Settings",
		ftp_server: "Server Address",
		ftp_server_desc: "FTP server domain or IP address",
		ftp_server_placeholder: "e.g. ftp.example.com",
		ftp_username: "Username",
		ftp_username_desc: "FTP login username",
		ftp_username_placeholder: "Enter username",
		ftp_password: "Password",
		ftp_password_desc: "FTP login password",
		ftp_password_placeholder: "Enter password",
		ftp_remote_dir: "Remote Directory",
		ftp_remote_dir_desc: "Target directory path for upload",
		ftp_remote_dir_placeholder: "e.g. /www/site",
		ftp_ignore_cert: "Ignore Certificate Verification",
		ftp_ignore_cert_desc:
			"Enable for self-signed certificates, recommended",
		ftp_test_connection: "Test FTP Connection",
		ftp_test_connection_desc: "Test if current FTP settings are correct",
		ftp_test_connection_testing: "Testing...",
		ftp_test_connection_success: "Connection Successful",
		ftp_test_connection_failed: "Connection Failed",

		// MDFriday Subdomain Settings
		mdfriday_app: "MDFriday Subdomain",
		mdfriday_app_desc: "Configure your personal subdomain for publishing sites",
		
		// MDFriday Custom Domain Settings
		mdfriday_custom_domain: "MDFriday Custom Domain",
		custom_domain_desc: "Your custom domain",
		custom_domain_placeholder: "Enter your custom domain (e.g. example.com)",
		domain_check: "Check DNS",
		domain_checking: "Checking...",
		domain_check_success: "Domain DNS is configured correctly",
		domain_check_failed: "Domain DNS check failed",
		domain_save: "Save",
		domain_saving: "Saving...",
		domain_saved: "Custom domain saved successfully",
		domain_save_failed: "Failed to save custom domain",
		domain_https_check: "Check HTTPS",
		domain_https_checking: "Checking...",
		domain_https_ready: "HTTPS is fully operational",
		domain_https_pending: "HTTPS certificate is being issued (1-2 minutes)",
		domain_https_error: "HTTPS certificate error",
		domain_https_check_failed: "Failed to check HTTPS status",
		
		subdomain: "Subdomain",
		subdomain_desc: "Your personal subdomain for MDFriday Subdomain",
		subdomain_placeholder: "Enter subdomain",
		subdomain_check: "Check",
		subdomain_checking: "Checking...",
		subdomain_update: "Update",
		subdomain_updating: "Updating...",
		subdomain_available: "Subdomain is available",
		subdomain_unavailable: "Subdomain is already taken",
		subdomain_updated: "Subdomain updated successfully!",
		subdomain_update_failed: "Failed to update subdomain: {{error}}",
		subdomain_check_failed: "Failed to check subdomain availability",
		subdomain_invalid: "Subdomain can only contain lowercase letters, numbers, and hyphens",
		subdomain_invalid_format: "Subdomain can only contain lowercase letters, numbers, and hyphens, and cannot start or end with a hyphen",
		subdomain_too_short: "Subdomain must be at least 4 characters",
		subdomain_too_long: "Subdomain must be at most 32 characters",
		subdomain_same: "Subdomain is the same as current",
		subdomain_reserved: "This subdomain is reserved and cannot be used",

		// General settings
		general_settings: "General Settings",
		download_server: "Download Server",
		download_server_desc:
			"Choose the server for downloading themes and resources",
		download_server_global: "Global",
		download_server_east: "East",

		// Enterprise settings
		enterprise_settings: "Enterprise Settings",
		enterprise_server_url: "Enterprise Server URL",
		enterprise_server_url_desc: "Custom server URL for enterprise users. Leave empty to use default server.",

		// MDFriday Account
		mdfriday_account: "MDFriday Account (Optional)",
		mdfriday_account_desc:
			"Sign in to access advanced features like theme marketplace and cloud publishing.",

		// Danger Zone - Reset
		danger_zone: "Danger Zone",
		reset_sync_title: "Reset cloud data",
		reset_sync_message: "This will permanently delete all your cloud sync data and published sites. Your local files will not be affected. A new encryption password will be generated.",
		reset_sync_button: "Reset Cloud Data",
		reset_input_placeholder: "Type RESET to confirm",
		reset_sync_success: "Cloud data reset successfully! You can now upload your local data.",
		reset_sync_failed: "Failed to reset cloud data: {{error}}",
	},

	ui: {
		// Server view
		desktop_only_title: "Desktop Only",
		desktop_only_message:
			"We're sorry, only desktop is supported at this time.",
		mobile_coming_soon:
			"Mobile and Tablet is coming soon.\nThank you for your patience and understanding!",

		// Site builder
		multilingual_content: "Multilingual Content",
		content_path: "Content Path",
		language: "Language",
		default_language: "Default Language",
		clear: "Clear",
		clear_all_content: "Clear all content",
		default: "Default",
		no_content_selected: "No content selected",
		no_content_selected_hint:
			'Right-click on a folder or file and select "Publish to Web" to get started',
		remove_language: "Remove language",
		site_name: "Site Name",
		site_name_placeholder: "Enter site name",
		site_assets: "Site Assets",
		site_assets_placeholder: "No assets folder set",
		site_assets_hint:
			'Right-click on a folder and select "Set as Site Assets" to configure',
		clear_assets: "Clear",
		advanced_settings: "Advanced Settings",
		site_path: "Site Path",
		site_path_placeholder: "/",
		site_path_hint:
			'Specify the base path for your site. Use "/" for root deployment.',
		site_password: "Site Password",
		site_password_placeholder: "Enter site password",
		site_password_hint: "Set a site-level access password (optional)",
		google_analytics_id: "Google Analytics ID",
		google_analytics_placeholder: "G-XXXXXXXXXX",
		google_analytics_hint:
			"Your Google Analytics measurement ID (optional)",
		disqus_shortname: "Disqus Shortname",
		disqus_placeholder: "your-site-shortname",
		disqus_hint: "Your Disqus shortname for comments (optional)",
		theme: "Theme",
		change_theme: "Change Theme",
		download_sample: "Download Sample",
		downloading_sample: "Downloading...",

		// Preview section
		preview: "Preview",
		preview_building: "Building preview...",
		preview_success: "Preview ready!",
		preview_failed: "Preview build failed",
		generate_preview: "Generate Preview",
		regenerate_preview: "Regenerate Preview",
		preview_link: "Preview link:",
		export_site: "Export Site",
		exporting: "Exporting...",
		export_site_dialog_title: "Save Site Archive",

		// Publish section
		publish: "Publish",
		publish_method: "Publish Method",
		publish_option_mdfriday_share: "MDFriday Share",
		publish_option_mdfriday_app: "MDFriday Subdomain",
		publish_option_mdfriday_custom: "MDFriday Custom Domain",
		publish_option_mdfriday_enterprise: "MDFriday Enterprise",
		publish_option_netlify: "Netlify",
		publish_option_ftp: "FTP Upload",
		mdfriday_share_hint: "MDFriday Share allows you to share your site instantly. Your site will be published to your personal MDFriday space.",
		mdfriday_app_hint: "MDFriday Subdomain publishes your site to your personal subdomain. Your site will be available at your-subdomain.mdfriday.com.",
		mdfriday_custom_hint: "MDFriday Custom Domain publishes your site to your custom domain. Make sure DNS is configured correctly.",
		mdfriday_enterprise_hint: "MDFriday Enterprise publishes your site to your enterprise server. Make sure enterprise server URL is configured.",
		mdfriday_license_required: "This feature requires an activated license. Please activate your license in Settings.",
		publish_building: "Publishing...",
		publish_success: "Published successfully!",
		publish_failed: "Publish failed",
		published_successfully: "✅ Published successfully!",

		// Server section
		server_start: "Start Server",
		server_stop: "Stop Server",
		server_running: "Server Running",
		server_stopped: "Server Stopped",
	},

	menu: {
		publish_to_web: "Publish to Web",
		set_as_site_assets: "Set as Site Assets",
		quick_share: "Quick Share",
	},

	commands: {},

	theme: {
		choose_theme: "Choose a Theme",
		search_themes: "Search themes...",
		filter_by_tags: "Filter by tags:",
		clear_filters: "Clear filters",
		loading_themes: "Loading themes...",
		loading_tags: "Loading tags...",
		loading_initial: "Initializing theme library...",
		loading_search: "Searching themes...",
		loading_error: "Loading failed, please retry",
		no_themes_found: "No themes found",
		view_demo: "View Demo",
		live_demo: "Live Demo",
		use_it: "Use It",
		current: "Current",
		free: "Free",
		by_author: "by {{author}}",
		retry: "Retry",
	},

	projects: {
		manage_projects: "Manage Projects",
		project_list: "Projects",
		no_projects: "No projects saved yet",
		select_project_to_view: "Select a project to view details",
		configuration: "Configuration",
		build_history: "Build History",
		no_build_history: "No build history",
		apply_to_panel: "Apply to Panel",
		delete_project: "Delete",
		delete_project_permanent: "Delete this project",
		danger_zone: "Danger Zone",
		clear_history_title: "Clear preview history",
		clear_history_message: "This will permanently delete all preview directories and build history for this project. Exported sites and published sites will not be affected.",
		clear_preview_history: "Clear all previews",
		confirm_clear_history: "Are you sure you want to delete all preview files? This will free up disk space but cannot be undone.",
		preview_history_cleared: "Preview history cleared successfully. {{count}} directories deleted.",
		no_preview_files: "No preview files found to delete.",
		delete_warning_title: "Delete project",
		delete_warning_message: "Once you delete a project, all its configuration and build history will be permanently removed. This action cannot be undone.",
		confirm_delete: 'Are you sure you want to delete project "{{name}}"?',
		project_applied: "Project configuration applied successfully",
		project_applied_no_content: "Project configuration applied. Content paths not found - please right-click folders/files to add content.",
		project_deleted: "Project deleted successfully",
		view_site: "View Site",
		export_build: "Export",
		preview_not_found: "Preview directory not found. It may have been deleted.",
		just_now: "Just now",
		minutes_ago: "{{count}} minutes ago",
		hours_ago: "{{count}} hours ago",
		days_ago: "{{count}} days ago",
	},

	messages: {
		desktop_only_notice: "Only desktop is supported at this time.",
		sync_not_enabled: "Sync is not enabled. Please enable it in settings first.",
		publishing_desktop_only: "Publishing is only available on desktop",
		site_assets_desktop_only: "Setting site assets is only available on desktop",
		theme_selection_desktop_only: "Theme selection is only available on desktop",
		project_management_desktop_only: "Project management is only available on desktop",
		quick_share_desktop_only: "Quick share is only available on desktop",
		preview_url_copied: "Preview URL copied to clipboard",
		publish_url_copied: "Publish URL copied to clipboard",
		build_started: "Build started",
		build_completed: "Build completed successfully",
		build_failed: "Build failed",
		publish_started: "Publishing started",
		publish_completed: "Published successfully",
		publish_failed: "Publishing failed",

		// Preview messages
		no_folder_selected: "No folder selected",
		no_folder_or_file_selected: "No folder or file selected",
		must_select_folder_type:
			'Content type mismatch: You previously selected a folder, but now selected a file. To publish files, click the "Clear" button in the top-right to remove previous selections, then select files only.',
		must_select_file_type:
			'Content type mismatch: You previously selected a file, but now selected a folder. To publish folders, click the "Clear" button in the top-right to remove previous selections, then select folders only.',
		all_content_cleared: "All content cleared successfully",
		language_added_successfully: "Language content added successfully",
		please_use_publish_first:
			'Please use "Publish to Web" on a folder or file first to get started',
		add_language_instruction:
			'Right-click on a folder or file and select "Publish to Web" to add more languages',
		preview_generated_successfully: "Preview generated successfully!",
		preview_failed: "Preview failed: {{error}}",
		please_generate_preview_first: "Please generate preview first",
		preview_data_missing: "Preview data is missing",
		site_published_successfully: "Site published successfully!",
		publishing_failed: "Publishing failed: {{error}}",
		site_exported_successfully: "Site exported successfully to: {{path}}",
		export_failed: "Export failed: {{error}}",
		incremental_upload_stats: "Incremental upload: {{uploaded}} uploaded, {{deleted}} deleted, {{unchanged}} unchanged (~{{saved}}% time saved)",

		// Netlify messages
		netlify_settings_missing: "Please configure Netlify settings first",
		netlify_deploy_failed: "Netlify deployment failed: {{error}}",
		netlify_deploy_success: "Site deployed to Netlify successfully!",

	// FTP messages
	ftp_settings_missing: "Please configure FTP settings first",
	ftp_upload_failed: "FTP upload failed: {{error}}",
	ftp_upload_success: "Site uploaded to FTP server successfully!",
	ftp_fallback_to_plain:
		"Server does not support encryption, switched to plain FTP",
	ftp_fallback_to_full:
		"⚠️ Incremental upload failed, trying full upload as fallback...",

	// Quick share messages
	no_markdown_file: "Please open a Markdown file first",
	license_required_for_share: "Please activate your license to use Quick Share",
	quick_share_starting: "🚀 Preparing quick share...",
	preview_failed_generic: "Preview generation failed",
	quick_share_ready: "✅ Ready to share! Click 'Publish' to share your note",
	quick_share_failed: "Quick share failed: {{error}}",

		// User messages
		enter_email_password: "Please enter your email and password",
		enter_valid_email: "Please enter a valid email address",
		login_failed: "Failed to login",
		register_failed: "Failed to register user",

		// Site assets messages
		invalid_assets_folder: "Invalid assets folder",
		site_assets_set_successfully: "Site assets set successfully",
		site_assets_cleared: "Site assets cleared",

		// Sample download messages
		sample_downloaded_successfully:
			'Theme sample "{{themeName}}" downloaded successfully! Saved to folder: {{folderName}}',
		sample_download_failed: "Sample download failed: {{error}}",

		// Structured folder messages
		structured_folder_processed:
			'Structured folder "{{folderName}}" detected, automatically added {{contentCount}} language contents',
		static_folder_detected: "and detected static assets folder",

		// General messages
		failed_to_create_post: "Failed to create post.",
		failed_to_create_resource: "Failed to create resource.",
	},

	info: {
		service_description:
			"You own it — your notes, your themes, your cloud.\n" +
			"MDFriday lets you build and publish with full control.",
		learn_more: "Learn more",
	},

	common: {
		loading: "Loading...",
		success: "Success",
		error: "Error",
		cancel: "Cancel",
		confirm: "Confirm",
		save: "Save",
		close: "Close",
		copy: "Copy",
		copied: "Copied!",
	},
};
