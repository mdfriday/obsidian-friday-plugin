<script lang="ts">
	import {App} from "obsidian";
	import Info from "./Info.svelte"
	import Site from "./Site.svelte"
	import {onMount, onDestroy} from "svelte";
	import FridayPlugin from "../main";

	// 接收 props
	export let app: App;
	export let plugin: FridayPlugin;
	
	// Reactive translation function
	$: t = plugin.i18n?.t || ((key: string) => key);

	// Note: This component is only loaded on desktop (via dynamic import in main.ts)
	// No platform check needed here

	onMount(async () => {
		// Desktop-only initialization can go here
	});

	onDestroy(() => {
	});

</script>


<div class="friday-plugin-main">
	<section id="friday-plugin-main">
		<!-- 标签页内容 -->
		<div class="friday-tab-content">
				<div
					role="tabpanel" 
					id="panel-site" 
					aria-labelledby="tab-site" 
					tabindex="0"
				>
					<Site {app} {plugin} />
					
					<Info {plugin}/>
				</div>
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

	.friday-tab-content {
		padding: 10px 0;
	}
</style>
