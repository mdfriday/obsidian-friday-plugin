<script lang="ts">
    type Props = {
        children?: () => any;
        important?: boolean;
        title?: string;
    };
    const { children, important, title }: Props = $props();
    const cssClass = $derived.by(() => {
        return important ? "guidance important" : "guidance";
    });
</script>

<div class={cssClass}>
    {#if title}
        <h3>{title}</h3>
    {/if}
    {@render children?.()}
</div>
