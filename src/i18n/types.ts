/**
 * Supported language codes
 */
export type LanguageCode =
	| "en"
	| "zh-cn"
	| "es"
	| "fr"
	| "de"
	| "ja"
	| "ko"
	| "pt";

/**
 * Language information for display
 */
export interface LanguageInfo {
	code: LanguageCode;
	name: string;
	nativeName: string;
}

/**
 * Translation namespace structure
 */
export interface TranslationNamespace {
	// Settings page translations
	settings: {
		welcome_back: string;
		welcome: string;
		logged_in_as: string;
		please_enter_credentials: string;
		email: string;
		email_desc: string;
		email_placeholder: string;
		password: string;
		password_desc: string;
		password_placeholder: string;
		register: string;
		login: string;
		logout: string;

		// Publish settings
		publish_settings: string;
		publish_method: string;
		publish_method_desc: string;
		publish_method_netlify: string;
		publish_method_ftp: string;

		// Netlify settings
		netlify_settings: string;
		netlify_access_token: string;
		netlify_access_token_desc: string;
		netlify_access_token_placeholder: string;
		netlify_project_id: string;
		netlify_project_id_desc: string;
		netlify_project_id_placeholder: string;

		// FTP settings
		ftp_settings: string;
		ftp_server: string;
		ftp_server_desc: string;
		ftp_server_placeholder: string;
		ftp_username: string;
		ftp_username_desc: string;
		ftp_username_placeholder: string;
		ftp_password: string;
		ftp_password_desc: string;
		ftp_password_placeholder: string;
		ftp_remote_dir: string;
		ftp_remote_dir_desc: string;
		ftp_remote_dir_placeholder: string;
		ftp_ignore_cert: string;
		ftp_ignore_cert_desc: string;
		ftp_test_connection: string;
		ftp_test_connection_desc: string;
		ftp_test_connection_testing: string;
		ftp_test_connection_success: string;
		ftp_test_connection_failed: string;

		// General settings
		general_settings: string;
		download_server: string;
		download_server_desc: string;
		download_server_global: string;
		download_server_east: string;

		// MDFriday Account
		mdfriday_account: string;
		mdfriday_account_desc: string;
	};

	// Main UI translations
	ui: {
		// Server view
		desktop_only_title: string;
		desktop_only_message: string;
		mobile_coming_soon: string;

		// Site builder
		multilingual_content: string;
		content_path: string;
		language: string;
		default_language: string;
		clear: string;
		clear_all_content: string;
		default: string;
		no_content_selected: string;
		no_content_selected_hint: string;
		remove_language: string;
		site_name: string;
		site_name_placeholder: string;
		site_assets: string;
		site_assets_placeholder: string;
		site_assets_hint: string;
		clear_assets: string;
		advanced_settings: string;
		site_path: string;
		site_path_placeholder: string;
		site_path_hint: string;
		site_password: string;
		site_password_placeholder: string;
		site_password_hint: string;
		google_analytics_id: string;
		google_analytics_placeholder: string;
		google_analytics_hint: string;
		disqus_shortname: string;
		disqus_placeholder: string;
		disqus_hint: string;
		theme: string;
		change_theme: string;
		download_sample: string;
		downloading_sample: string;

		// Preview section
		preview: string;
		preview_building: string;
		preview_success: string;
		preview_failed: string;
		generate_preview: string;
		regenerate_preview: string;
		preview_link: string;
		export_site: string;
		exporting: string;
		export_site_dialog_title: string;

		// Publish section
		publish: string;
		publish_method: string;
		publish_option_mdfriday: string;
		publish_option_netlify: string;
		publish_option_ftp: string;
		mdfriday_preview_hint: string;
		publish_building: string;
		publish_success: string;
		publish_failed: string;
		published_successfully: string;

		// Server section
		server_start: string;
		server_stop: string;
		server_running: string;
		server_stopped: string;
	};

	// Menu and actions
	menu: {
		publish_to_web: string;
		set_as_site_assets: string;
	};

	// Commands
	commands: {};

	// Theme selection
	theme: {
		choose_theme: string;
		search_themes: string;
		filter_by_tags: string;
		clear_filters: string;
		loading_themes: string;
		loading_tags: string;
		loading_initial: string;
		loading_search: string;
		loading_error: string;
		no_themes_found: string;
		view_demo: string;
		live_demo: string;
		use_it: string;
		current: string;
		free: string;
		by_author: string;
		retry: string;
	};

	// Project management
	projects: {
		manage_projects: string;
		project_list: string;
		no_projects: string;
		select_project_to_view: string;
		configuration: string;
		build_history: string;
		no_build_history: string;
		apply_to_panel: string;
		delete_project: string;
		delete_project_permanent: string;
		danger_zone: string;
		clear_history_title: string;
		clear_history_message: string;
		clear_preview_history: string;
		confirm_clear_history: string;
		preview_history_cleared: string;
		no_preview_files: string;
		delete_warning_title: string;
		delete_warning_message: string;
		confirm_delete: string;
		project_applied: string;
		project_applied_no_content: string;
		project_deleted: string;
		view_site: string;
		export_build: string;
		preview_not_found: string;
		just_now: string;
		minutes_ago: string;
		hours_ago: string;
		days_ago: string;
	};

	// Notifications and messages
	messages: {
		desktop_only_notice: string;
		preview_url_copied: string;
		publish_url_copied: string;
		build_started: string;
		build_completed: string;
		build_failed: string;
		publish_started: string;
		publish_completed: string;
		publish_failed: string;

		// Preview messages
		no_folder_selected: string;
		no_folder_or_file_selected: string;
		must_select_folder_type: string;
		must_select_file_type: string;
		all_content_cleared: string;
		language_added_successfully: string;
		please_use_publish_first: string;
		add_language_instruction: string;
		preview_generated_successfully: string;
		preview_failed: string;
		please_generate_preview_first: string;
		preview_data_missing: string;
		site_published_successfully: string;
		publishing_failed: string;
		site_exported_successfully: string;
		export_failed: string;

		// User messages
		enter_email_password: string;
		enter_valid_email: string;
		login_failed: string;
		register_failed: string;

		// General messages
		failed_to_create_post: string;
		failed_to_create_resource: string;

		// Site assets messages
		invalid_assets_folder: string;
		site_assets_set_successfully: string;
		site_assets_cleared: string;

		// Sample download messages
		sample_downloaded_successfully: string;
		sample_download_failed: string;

		// Structured folder messages
		structured_folder_processed: string;
		static_folder_detected: string;

		// Netlify messages
		netlify_settings_missing: string;
		netlify_deploy_failed: string;
		netlify_deploy_success: string;

		// FTP messages
		ftp_settings_missing: string;
		ftp_upload_failed: string;
		ftp_upload_success: string;
		ftp_fallback_to_plain: string;
		incremental_upload_stats: string;
	};

	// Info and descriptions
	info: {
		service_description: string;
		learn_more: string;
	};

	// Common terms
	common: {
		loading: string;
		success: string;
		error: string;
		cancel: string;
		confirm: string;
		save: string;
		close: string;
		copy: string;
		copied: string;
	};
}

/**
 * Translation function type with parameter support
 */
export type TranslationFunction = (
	key: string,
	params?: Record<string, any>
) => string;

/**
 * I18n service interface
 */
export interface II18nService {
	getCurrentLanguage(): LanguageCode;
	setLanguage(language: LanguageCode): Promise<void>;
	getAvailableLanguages(): LanguageInfo[];
	t: TranslationFunction;
	isReady(): boolean;
}
