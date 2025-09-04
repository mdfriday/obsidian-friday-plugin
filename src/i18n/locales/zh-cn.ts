import type { TranslationNamespace } from '../types';

/**
 * Simplified Chinese translations
 */
export const zhCn: TranslationNamespace = {
	settings: {
		welcome_back: '欢迎回来！',
		welcome: '欢迎！',
		logged_in_as: '已登录用户：{{username}}',
		please_enter_credentials: '请输入您的登录信息。',
		email: '邮箱',
		email_desc: '请输入您的邮箱地址',
		email_placeholder: 'your@email.com',
		password: '密码',
		password_desc: '请输入您的密码',
		password_placeholder: '密码',
		register: '注册',
		login: '登录',
		logout: '退出登录',
		
		// Publish settings
		publish_settings: '发布设置',
		publish_method: '发布方式',
		publish_method_desc: '选择您想要发布网站的方式',
		publish_method_netlify: 'Netlify',
		publish_method_ftp: 'FTP',
		
		// Netlify settings
		netlify_settings: 'Netlify 设置',
		netlify_access_token: '个人访问令牌',
		netlify_access_token_desc: '您的 Netlify 个人访问令牌，用于 API 认证',
		netlify_access_token_placeholder: '请输入您的 Netlify 访问令牌',
		netlify_project_id: '项目 ID',
		netlify_project_id_desc: '您的 Netlify 项目/站点的 ID',
		netlify_project_id_placeholder: '请输入您的项目 ID',
		
		// FTP settings
		ftp_settings: 'FTP 设置',
		ftp_server: '服务器地址',
		ftp_server_desc: 'FTP 服务器域名或 IP 地址',
		ftp_server_placeholder: '例如：ftp.example.com',
		ftp_username: '用户名',
		ftp_username_desc: 'FTP 登录用户名',
		ftp_username_placeholder: '请输入用户名',
		ftp_password: '密码',
		ftp_password_desc: 'FTP 登录密码',
		ftp_password_placeholder: '请输入密码',
		ftp_remote_dir: '远程目录',
		ftp_remote_dir_desc: '上传的目标目录路径',
		ftp_remote_dir_placeholder: '例如：/www/site',
		ftp_ignore_cert: '忽略证书验证',
		ftp_ignore_cert_desc: '适配自签名证书，建议开启',
		ftp_test_connection: '测试 FTP 连接',
		ftp_test_connection_desc: '测试当前 FTP 设置是否正确',
		ftp_test_connection_testing: '测试中...',
		ftp_test_connection_success: '连接成功',
		ftp_test_connection_failed: '连接失败',
		
		// MDFriday Account
		mdfriday_account: 'MDFriday 账户（可选）',
		mdfriday_account_desc: '登录以使用高级功能，如主题市场和云端发布。',
	},

	ui: {
		// Server view
		desktop_only_title: '仅支持桌面版',
		desktop_only_message: '抱歉，目前仅支持桌面版本。',
		mobile_coming_soon: '移动端和平板端即将推出。\n感谢您的耐心等待和理解！',
		
		// Site builder
		content_path: '内容路径',
		site_name: '站点名称',
		site_name_placeholder: '请输入站点名称',
		advanced_settings: '高级设置',
		site_path: '站点路径',
		site_path_placeholder: '/',
		site_path_hint: '指定站点的基础路径。使用 "/" 表示根路径部署。',
		google_analytics_id: 'Google Analytics ID',
		google_analytics_placeholder: 'G-XXXXXXXXXX',
		google_analytics_hint: '您的 Google Analytics 测量 ID（可选）',
		disqus_shortname: 'Disqus 短名称',
		disqus_placeholder: 'your-site-shortname',
		disqus_hint: '您的 Disqus 短名称，用于评论功能（可选）',
		theme: '主题',
		change_theme: '更换主题',
		
		// Preview section
		preview: '预览',
		preview_building: '正在构建预览...',
		preview_success: '预览已就绪！',
		preview_failed: '预览构建失败',
		generate_preview: '生成预览',
		regenerate_preview: '重新生成预览',
		preview_link: '预览链接：',
		export_site: '导出站点',
		exporting: '导出中...',
		export_site_dialog_title: '保存站点压缩包',
		
		// Publish section
		publish: '发布',
		publish_option_mdfriday: 'MDFriday 预览',
		publish_option_netlify: 'Netlify',
		publish_option_ftp: 'FTP 上传',
		publish_building: '正在发布...',
		publish_success: '发布成功！',
		publish_failed: '发布失败',
		published_successfully: '✅ 发布成功！',
		
		// Server section
		server_start: '启动服务器',
		server_stop: '停止服务器',
		server_running: '服务器运行中',
		server_stopped: '服务器已停止',
	},

	menu: {
		publish_to_web: '发布到网络',
	},

	commands: {
	},

	theme: {
		choose_theme: '选择主题',
		search_themes: '搜索主题...',
		filter_by_tags: '按标签筛选：',
		clear_filters: '清除筛选',
		loading_themes: '正在加载主题...',
		loading_tags: '正在加载标签...',
		loading_initial: '正在初始化主题库...',
		loading_search: '正在搜索主题...',
		loading_error: '加载失败，请重试',
		no_themes_found: '未找到主题',
		view_demo: '查看演示',
		use_it: '使用',
		current: '当前',
		by_author: '作者：{{author}}',
		retry: '重试',
	},

	messages: {
		desktop_only_notice: '目前仅支持桌面版本。',
		preview_url_copied: '预览链接已复制到剪贴板',
		publish_url_copied: '发布链接已复制到剪贴板',
		build_started: '开始构建',
		build_completed: '构建成功完成',
		build_failed: '构建失败',
		publish_started: '开始发布',
		publish_completed: '发布成功',
		publish_failed: '发布失败',
		
		// Preview messages
		no_folder_selected: '未选择文件夹',
		no_folder_or_file_selected: '未选择文件夹或文件',
		preview_generated_successfully: '预览生成成功！',
		preview_failed: '预览失败：{{error}}',
		please_generate_preview_first: '请先生成预览',
		preview_data_missing: '预览数据缺失',
		site_published_successfully: '站点发布成功！',
		publishing_failed: '发布失败：{{error}}',
		site_exported_successfully: '站点导出成功至：{{path}}',
		export_failed: '导出失败：{{error}}',
		
		// Netlify messages
		netlify_settings_missing: '请先配置 Netlify 设置',
		netlify_deploy_failed: 'Netlify 部署失败：{{error}}',
		netlify_deploy_success: '站点已成功部署到 Netlify！',
		
		// FTP messages
		ftp_settings_missing: '请先配置 FTP 设置',
		ftp_upload_failed: 'FTP 上传失败：{{error}}',
		ftp_upload_success: '站点已成功上传到 FTP 服务器！',
		ftp_fallback_to_plain: '服务器不支持加密，已切换到普通 FTP',
		
		// User messages
		enter_email_password: '请输入您的邮箱和密码',
		enter_valid_email: '请输入有效的邮箱地址',
		login_failed: '登录失败',
		register_failed: '注册用户失败',
		
		// General messages
		failed_to_create_post: '创建文章失败。',
		failed_to_create_resource: '创建资源失败。',
	},

	info: {
		service_description: '你的数据，你掌控 —— 你的笔记、你的主题、你的云端。\n' +
			'MDFriday 让你自由构建与发布，完全掌握全流程。',
		learn_more: '了解更多',
	},

	common: {
		loading: '加载中...',
		success: '成功',
		error: '错误',
		cancel: '取消',
		confirm: '确认',
		save: '保存',
		close: '关闭',
		copy: '复制',
		copied: '已复制！',
	},
};
