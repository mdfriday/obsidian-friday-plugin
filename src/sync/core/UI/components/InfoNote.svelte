<script lang="ts">
    type Props = {
        title?: string;
        children?: () => any;
        cssClass?: string;
        warning?: boolean;
        error?: boolean;
        info?: boolean;
        visible?: boolean;
    };
    const {
        title,
        children,
        cssClass,
        warning: isWarning,
        error: isError,
        info: isInfo = true,
        visible,
    }: Props = $props();
    const derivedCssClass = $derived.by(() => {
        if (isError) {
            return "note-error";
        } else if (isWarning) {
            return "note-important";
        } else if (isInfo) {
            return "note";
        } else {
            return "";
        }
    });
</script>

{#if visible === undefined || visible === true}
    <div class={(cssClass ?? "") + " " + derivedCssClass}>
        {#if title}<h3>{title}</h3>{/if}
        {@render children?.()}
    </div>
{/if}
