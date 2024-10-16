<script lang="ts">
	import Info from "./Info.svelte"
	import Service from "./Service.svelte"
	import BuildDeploy from "./BuildDeploy.svelte"
</script>


<div class="friday-plugin-main">
	<section id="friday-plugin-main">
		<div>
			<Info/>
			<Service/>
			<hr class="centered-line">
			<BuildDeploy/>
		</div>
	</section>
</div>

<style>
	.friday-plugin-main {
		padding: initial;
		width: initial;
		height: initial;
		position: initial;
		overflow-y: initial;
		overflow-wrap: initial;
	}

	.centered-line {
		width: 80%;            /* 分隔线宽度占父容器的 80% */
		margin: 20px auto;        /* 水平居中对齐 */
		border: none;          /* 去掉默认的边框样式 */
		border-top: 1px solid rgb(64 64 64);  /* 顶部边框作为分隔线 */
		height: 1px;           /* 分隔线高度 */
		background-color: transparent;    /* 确保背景透明 */
	}

</style>
