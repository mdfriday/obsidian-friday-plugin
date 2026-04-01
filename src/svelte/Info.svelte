<script lang="ts">
	import FridayPlugin from "../main";
	
	// Get plugin instance from parent component
	export let plugin: FridayPlugin;
	
	// Reactive translation function
	$: t = plugin?.i18n?.t || ((key: string) => key);
</script>

<div class="mdf-info">
	<span class="info-text">{t('info.tagline')}</span>
	<p style="margin-top: 5px;">
		<a href="https://mdfriday.com" target="_blank">
			<img src="https://gohugo.net/mdfriday.svg" alt="MDFriday" width="15" height="15" />
		</a>
	</p>
</div>

<style>
	.mdf-info {
		padding: 20px 0;
		text-align: center;
	}

	.info-text {
		font-size: 11px;
		color: var(--text-muted);
		line-height: 1.4;
		opacity: 0.7;
		letter-spacing: 0.02em;
	}
</style>
