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
		
		// Netlify settings
		netlify_settings: 'Netlify Settings',
		netlify_access_token: 'Personal Access Token',
		netlify_access_token_desc: 'Your Netlify personal access token for API authentication',
		netlify_access_token_placeholder: 'Enter your Netlify access token',
		netlify_project_id: 'Project ID',
		netlify_project_id_desc: 'The ID of your Netlify project/site',
		netlify_project_id_placeholder: 'Enter your project ID',
		
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
		content_path: 'Content Path',
		site_name: 'Site Name',
		site_name_placeholder: 'Enter site name',
		advanced_settings: 'Advanced Settings',
		site_path: 'Site Path',
		site_path_placeholder: '/',
		site_path_hint: 'Specify the base path for your site. Use "/" for root deployment.',
		theme: 'Theme',
		change_theme: 'Change Theme',
		
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
		build_as_site: 'Build as site',
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
		
		// User messages
		enter_email_password: 'Please enter your email and password',
		enter_valid_email: 'Please enter a valid email address',
		login_failed: 'Failed to login',
		register_failed: 'Failed to register user',
		
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
