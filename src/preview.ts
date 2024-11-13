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
		modalEl.classList.add('my-modal');

		// Create and style the iframe with a CSS class
		const iframe = document.createElement('iframe');
		iframe.src = this.url;
		iframe.classList.add('my-iframe');

		// Insert the iframe into the modal content
		contentEl.appendChild(iframe);
	}


	onClose() {
		const {contentEl} = this;
		contentEl.empty(); // 关闭时清空内容
	}
}
