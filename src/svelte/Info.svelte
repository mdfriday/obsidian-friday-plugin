<script lang="ts">
	import FridayPlugin from "../main";
	
	// Get plugin instance from parent component
	export let plugin: FridayPlugin;
	
	// Reactive translation function
	$: t = plugin?.i18n?.t || ((key: string) => key);
</script>

<div class="mdf-info">
	{t('info.service_description')}
	<br />
	<br />
	<a href="https://mdfriday.com" target="_blank">
		<img src="https://gohugo.net/mdfriday.svg" alt="MDFriday" width="20" height="20" />
	</a>
</div>

<style>
	.mdf-info {
		font-size: 0.9em;
		text-align: center;
	}
</style>
