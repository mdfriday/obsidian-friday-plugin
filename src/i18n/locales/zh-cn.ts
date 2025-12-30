import type { TranslationNamespace } from "../types";

/**
 * Simplified Chinese translations
 */
export const zhCn: TranslationNamespace = {
	settings: {
		welcome_back: "欢迎回来！",
		welcome: "欢迎！",
		logged_in_as: "已登录用户：{{username}}",
		please_enter_credentials: "请输入您的登录信息。",
		email: "邮箱",
		email_desc: "请输入您的邮箱地址",
		email_placeholder: "your@email.com",
		password: "密码",
		password_desc: "请输入您的密码",
		password_placeholder: "密码",
		register: "注册",
		login: "登录",
		logout: "退出登录",

		// License Settings
		license: "许可证",
		license_key: "许可证密钥",
		license_key_placeholder: "MDF-XXXX-XXXX-XXXX",
		activate: "激活",
		activating: "激活中…",
		license_active: "许可证已激活",
		plan: "套餐",
		valid_until: "有效期至",
		devices: "设备",
		sync: "同步",
		publish: "发布",
		enabled: "已启用",
		disabled: "未启用",
		details: "详情",
		hide_details: "隐藏详情",
		license_invalid_format: "许可证密钥格式无效。正确格式：MDF-XXXX-XXXX-XXXX",
		license_activation_failed: "许可证激活失败，请检查您的许可证密钥。",
		license_activated_success: "许可证激活成功！",

		// Sync Settings (License-based)
		sync_enabled: "同步已启用",
		sync_description: "您的数据已安全同步至各设备。",
		sync_first_time_title: "这是您首次使用同步功能。",
		sync_first_time_desc: "请选择如何在此设备上设置同步。",
		upload_local_to_cloud: "上传本地数据到云端",
		download_from_cloud: "从云端下载数据",
		sync_data_available: "云端已有数据可供下载。",
		sync_uploading: "上传中...",
		sync_downloading: "下载中...",
		sync_upload_success: "本地数据已成功上传到云端！",
		sync_download_success: "云端数据已成功下载！",
		sync_operation_failed: "同步操作失败，请重试。",

		// Security Settings
		security: "安全",
		encryption_enabled: "端到端加密已启用",
		encryption_password: "加密密码",
		show_password: "显示",
		hide_password: "隐藏",

		// Publish settings
		publish_settings: "发布设置",
		publish_method: "发布方式",
		publish_method_desc: "选择您想要发布网站的方式",
		publish_method_netlify: "Netlify",
		publish_method_ftp: "FTP",

		// Netlify settings
		netlify_settings: "Netlify 设置",
		netlify_access_token: "个人访问令牌",
		netlify_access_token_desc: "您的 Netlify 个人访问令牌，用于 API 认证",
		netlify_access_token_placeholder: "请输入您的 Netlify 访问令牌",
		netlify_project_id: "项目 ID",
		netlify_project_id_desc: "您的 Netlify 项目/站点的 ID",
		netlify_project_id_placeholder: "请输入您的项目 ID",

		// FTP settings
		ftp_settings: "FTP 设置",
		ftp_server: "服务器地址",
		ftp_server_desc: "FTP 服务器域名或 IP 地址",
		ftp_server_placeholder: "例如：ftp.example.com",
		ftp_username: "用户名",
		ftp_username_desc: "FTP 登录用户名",
		ftp_username_placeholder: "请输入用户名",
		ftp_password: "密码",
		ftp_password_desc: "FTP 登录密码",
		ftp_password_placeholder: "请输入密码",
		ftp_remote_dir: "远程目录",
		ftp_remote_dir_desc: "上传的目标目录路径",
		ftp_remote_dir_placeholder: "例如：/www/site",
		ftp_ignore_cert: "忽略证书验证",
		ftp_ignore_cert_desc: "适配自签名证书，建议开启",
		ftp_test_connection: "测试 FTP 连接",
		ftp_test_connection_desc: "测试当前 FTP 设置是否正确",
		ftp_test_connection_testing: "测试中...",
		ftp_test_connection_success: "连接成功",
		ftp_test_connection_failed: "连接失败",

		// General settings
		general_settings: "通用设置",
		download_server: "下载服务器",
		download_server_desc: "选择下载主题和资源的服务器",
		download_server_global: "全球",
		download_server_east: "东区",

		// MDFriday Account
		mdfriday_account: "MDFriday 账户（可选）",
		mdfriday_account_desc: "登录以使用高级功能，如主题市场和云端发布。",
	},

	ui: {
		// Server view
		desktop_only_title: "仅支持桌面版",
		desktop_only_message: "抱歉，目前仅支持桌面版本。",
		mobile_coming_soon:
			"移动端和平板端即将推出。\n感谢您的耐心等待和理解！",

		// Site builder
		multilingual_content: "多语言内容",
		content_path: "内容路径",
		language: "语言",
		default_language: "默认语言",
		clear: "清空",
		clear_all_content: "清空所有内容",
		default: "默认",
		no_content_selected: "未选择内容",
		no_content_selected_hint: '右键点击文件夹或文件并选择"发布到网站"开始',
		remove_language: "移除语言",
		site_name: "站点名称",
		site_name_placeholder: "请输入站点名称",
		site_assets: "站点资源",
		site_assets_placeholder: "未设置资源文件夹",
		site_assets_hint: '右键点击文件夹并选择"设为站点资源"来设置',
		clear_assets: "清除",
		advanced_settings: "高级设置",
		site_path: "站点路径",
		site_path_placeholder: "/",
		site_path_hint: '指定站点的基础路径。使用 "/" 表示根路径部署。',
		site_password: "站点密码",
		site_password_placeholder: "输入站点密码",
		site_password_hint: "设置站点级别的访问密码（可选）",
		google_analytics_id: "Google Analytics ID",
		google_analytics_placeholder: "G-XXXXXXXXXX",
		google_analytics_hint: "您的 Google Analytics 测量 ID（可选）",
		disqus_shortname: "Disqus 短名称",
		disqus_placeholder: "your-site-shortname",
		disqus_hint: "您的 Disqus 短名称，用于评论功能（可选）",
		theme: "主题",
		change_theme: "更换主题",
		download_sample: "下载样例",
		downloading_sample: "下载中...",

		// Preview section
		preview: "预览",
		preview_building: "正在构建预览...",
		preview_success: "预览已就绪！",
		preview_failed: "预览构建失败",
		generate_preview: "生成预览",
		regenerate_preview: "重新生成预览",
		preview_link: "预览链接：",
		export_site: "导出站点",
		exporting: "导出中...",
		export_site_dialog_title: "保存站点压缩包",

		// Publish section
		publish: "发布",
		publish_method: "发布方式",
		publish_option_mdfriday: "MDFriday 预览",
		publish_option_netlify: "Netlify",
		publish_option_ftp: "FTP 上传",
		mdfriday_preview_hint: "MDFriday 预览提供即时托管服务，无需额外配置。您的站点将直接发布到我们的预览服务。",
		publish_building: "正在发布...",
		publish_success: "发布成功！",
		publish_failed: "发布失败",
		published_successfully: "✅ 发布成功！",

		// Server section
		server_start: "启动服务器",
		server_stop: "停止服务器",
		server_running: "服务器运行中",
		server_stopped: "服务器已停止",
	},

	menu: {
		publish_to_web: "发布到网络",
		set_as_site_assets: "设为站点资源",
	},

	commands: {},

	theme: {
		choose_theme: "选择主题",
		search_themes: "搜索主题...",
		filter_by_tags: "按标签筛选：",
		clear_filters: "清除筛选",
		loading_themes: "正在加载主题...",
		loading_tags: "正在加载标签...",
		loading_initial: "正在初始化主题库...",
		loading_search: "正在搜索主题...",
		loading_error: "加载失败，请重试",
		no_themes_found: "未找到主题",
		view_demo: "查看演示",
		live_demo: "在线演示",
		use_it: "使用",
		current: "当前",
		free: "免费",
		by_author: "作者：{{author}}",
		retry: "重试",
	},

	projects: {
		manage_projects: "管理项目",
		project_list: "项目列表",
		no_projects: "暂无已保存的项目",
		select_project_to_view: "请选择一个项目以查看详情",
		configuration: "配置信息",
		build_history: "构建历史",
		no_build_history: "暂无构建历史",
		apply_to_panel: "应用到面板",
		delete_project: "删除",
		delete_project_permanent: "删除此项目",
		danger_zone: "危险区域",
		clear_history_title: "清空预览历史",
		clear_history_message: "此操作将永久删除该项目的所有预览目录和构建历史记录，但不会影响已导出和已发布的站点。",
		clear_preview_history: "清空所有预览",
		confirm_clear_history: "确定要删除所有预览文件吗？此操作可释放磁盘空间，但无法撤销。",
		preview_history_cleared: "预览历史已清空，共删除 {{count}} 个目录",
		no_preview_files: "未找到需要删除的预览文件",
		delete_warning_title: "删除项目",
		delete_warning_message: "删除项目后，所有配置信息和构建历史将被永久移除，此操作无法撤销。",
		confirm_delete: '确定要删除项目 "{{name}}" 吗？',
		project_applied: "项目配置应用成功",
		project_applied_no_content: "项目配置已应用，但内容路径未找到 - 请右键点击文件夹/文件添加内容",
		project_deleted: "项目已成功删除",
		view_site: "查看站点",
		export_build: "导出",
		preview_not_found: "预览目录未找到，可能已被删除",
		just_now: "刚刚",
		minutes_ago: "{{count}} 分钟前",
		hours_ago: "{{count}} 小时前",
		days_ago: "{{count}} 天前",
	},

	messages: {
		desktop_only_notice: "目前仅支持桌面版本。",
		preview_url_copied: "预览链接已复制到剪贴板",
		publish_url_copied: "发布链接已复制到剪贴板",
		build_started: "开始构建",
		build_completed: "构建成功完成",
		build_failed: "构建失败",
		publish_started: "开始发布",
		publish_completed: "发布成功",
		publish_failed: "发布失败",

		// Preview messages
		no_folder_selected: "未选择文件夹",
		no_folder_or_file_selected: "未选择文件夹或文件",
		must_select_folder_type:
			'内容类型不匹配：您之前选择了文件夹，现在选择了文件。要发布文件，请点击右上角的"清空"按钮移除之前的选择，然后只选择文件。',
		must_select_file_type:
			'内容类型不匹配：您之前选择了文件，现在选择了文件夹。要发布文件夹，请点击右上角的"清空"按钮移除之前的选择，然后只选择文件夹。',
		all_content_cleared: "所有内容已成功清空",
		language_added_successfully: "语言内容添加成功",
		please_use_publish_first: '请先在文件夹或文件上使用"发布到网站"功能',
		add_language_instruction:
			'右键点击文件夹或文件并选择"发布到网站"以添加更多语言',
		preview_generated_successfully: "预览生成成功！",
		preview_failed: "预览失败：{{error}}",
		please_generate_preview_first: "请先生成预览",
		preview_data_missing: "预览数据缺失",
		site_published_successfully: "站点发布成功！",
		publishing_failed: "发布失败：{{error}}",
		site_exported_successfully: "站点导出成功至：{{path}}",
		export_failed: "导出失败：{{error}}",
		incremental_upload_stats: "增量上传：已上传 {{uploaded}} 个，已删除 {{deleted}} 个，未变化 {{unchanged}} 个（节省约 {{saved}}% 时间）",

		// Netlify messages
		netlify_settings_missing: "请先配置 Netlify 设置",
		netlify_deploy_failed: "Netlify 部署失败：{{error}}",
		netlify_deploy_success: "站点已成功部署到 Netlify！",

	// FTP messages
	ftp_settings_missing: "请先配置 FTP 设置",
	ftp_upload_failed: "FTP 上传失败：{{error}}",
	ftp_upload_success: "站点已成功上传到 FTP 服务器！",
	ftp_fallback_to_plain: "服务器不支持加密，已切换到普通 FTP",
	ftp_fallback_to_full: "⚠️ 增量上传失败，正在尝试完整上传作为备选方案...",

		// User messages
		enter_email_password: "请输入您的邮箱和密码",
		enter_valid_email: "请输入有效的邮箱地址",
		login_failed: "登录失败",
		register_failed: "注册用户失败",

		// Site assets messages
		invalid_assets_folder: "无效的资源文件夹",
		site_assets_set_successfully: "站点资源设置成功",
		site_assets_cleared: "站点资源已清除",

		// Sample download messages
		sample_downloaded_successfully:
			'主题样例 "{{themeName}}" 下载成功！已保存到文件夹：{{folderName}}',
		sample_download_failed: "样例下载失败：{{error}}",

		// Structured folder messages
		structured_folder_processed:
			'检测到结构化文件夹 "{{folderName}}"，已自动添加 {{contentCount}} 个语言内容',
		static_folder_detected: "并检测到静态资源文件夹",

		// General messages
		failed_to_create_post: "创建文章失败。",
		failed_to_create_resource: "创建资源失败。",
	},

	info: {
		service_description:
			"你的数据，你掌控 —— 你的笔记、你的主题、你的云端。\n" +
			"MDFriday 让你自由构建与发布，完全掌握全流程。",
		learn_more: "了解更多",
	},

	common: {
		loading: "加载中...",
		success: "成功",
		error: "错误",
		cancel: "取消",
		confirm: "确认",
		save: "保存",
		close: "关闭",
		copy: "复制",
		copied: "已复制！",
	},
};
