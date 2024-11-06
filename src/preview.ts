import { Modal, App } from 'obsidian';

export class WebPreviewModal extends Modal {
	private readonly url: string;

	constructor(app: App, url: string) {
		super(app);
		this.url = url; // 保存传入的 URL
	}

	onOpen() {
		const { contentEl, modalEl } = this;

		// 设置 Modal 的宽度和高度
		modalEl.style.width = '900px';
		modalEl.style.height = `${window.innerHeight * 0.9}px`; // 设置 Modal 高度为屏幕的 90%

		// 创建 iframe 元素
		const iframe = document.createElement('iframe');
		iframe.src = this.url; // 设置 iframe 的链接

		// 设置 iframe 的样式
		iframe.style.width = '100%'; // 让 iframe 填满 Modal 的宽度
		iframe.style.height = '100%'; // 让 iframe 填满 Modal 的高度
		iframe.style.border = 'none'; // 去除边框
		iframe.style.backgroundColor = 'white'; // 设置背景色为白色

		// 将 iframe 插入到 modal 内容中
		contentEl.appendChild(iframe);

		// 动态调整 iframe 的高度
		window.addEventListener('resize', () => {
			modalEl.style.height = `${window.innerHeight * 0.9}px`; // 监听窗口调整事件，动态调整 Modal 高度
			iframe.style.height = `${window.innerHeight * 0.9}px`; // 同时调整 iframe 的高度
		});
	}

	onClose() {
		const { contentEl } = this;
		contentEl.empty(); // 关闭时清空内容
	}
}
