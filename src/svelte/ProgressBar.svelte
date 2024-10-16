<script>
	// 定义一个 'progress' 属性，表示下载进度
	export let progress = 0;
</script>

<div class="progress-container">
	<div class="progress-bar" style="width: {progress}%"></div>
</div>

<!-- 样式 -->
<style>
	.progress-container {
		width: 100%;              /* 进度条占据父元素的宽度 */
		background-color: #e0e0e0; /* 外部背景，浅灰色 */
		border-radius: 8px;        /* 圆角边框 */
		height: 10px;              /* 高度设置为 20px */
		margin-top: 10px;          /* 与上方内容留出间距 */
		overflow: hidden;          /* 圆角时避免内部内容溢出 */
		position: relative;
	}

	.progress-bar {
		height: 10px;
		background-color: rgb(124 58 237);
		border-radius: 8px 0 0 8px; /* 进度条左边圆角 */
		transition: width 0.4s ease; /* 平滑过渡动画，表示进度 */
		position: absolute;         /* 设置为绝对定位 */
		top: 0;                     /* 确保从容器顶部开始 */
		left: 0;                    /* 确保从容器左侧开始 */
	}
</style>
