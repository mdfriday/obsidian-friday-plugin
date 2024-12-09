import {Modal, App} from 'obsidian';

export class WebPreviewModal extends Modal {
	private readonly url: string;

	constructor(app: App, url: string) {
		super(app);
		this.url = url; // 保存传入的 URL
	}

	onOpen() {
		const {contentEl, modalEl} = this;

		// Apply CSS class to modal
		modalEl.classList.add('friday-preview-modal');

		this.showLoadingMessage()
		setTimeout(() => {
			this.loadIframe();
		}, 1000);
	}

	showLoadingMessage() {
		const { contentEl } = this;
		contentEl.empty(); // 清空内容

		const loadingMessage = document.createElement('p');
		loadingMessage.textContent = "Loading...";
		loadingMessage.classList.add('friday-preview-loading');
		contentEl.appendChild(loadingMessage);
	}

	loadIframe() {
		const { contentEl } = this;

		// Create and style the iframe with a CSS class
		const iframe = document.createElement('iframe');
		iframe.src = this.url;
		iframe.classList.add('friday-preview-iframe');
		iframe.onload = () => {
			setTimeout(() => {
				this.onIframeLoaded(contentEl, iframe);
			}, 500);
		};

		// Insert the iframe into the modal content
		contentEl.appendChild(iframe);
	}

	onIframeLoaded(contentEl: HTMLElement, iframe: HTMLIFrameElement) {
		// iframe 加载完成后，隐藏加载提示
		const loadingMessage = contentEl.querySelector('.friday-preview-loading');
		if (loadingMessage) {
			loadingMessage.remove(); // 移除加载提示
		}
	}

	onClose() {
		const {contentEl} = this;
		contentEl.empty(); // 关闭时清空内容
	}
}
