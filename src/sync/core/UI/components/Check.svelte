<script lang="ts">
    type Props = {
        title: string;
        value: boolean;
        noteOnSelected?: () => any;
        noteOnUnselected?: () => any;
        children?: () => any;
    };

    let { title, value = $bindable(), noteOnSelected, noteOnUnselected, children }: Props = $props();
</script>

<label class="choice-row">
    <input type="checkbox" bind:checked={value} />
    <span class="choice-title">{title}</span>
</label>
<div class="choice-notes">
    <!-- TODO Highlight selected option -->
    {#if value && noteOnSelected}
        {@render noteOnSelected()}
    {:else if !value && noteOnUnselected}
        {@render noteOnUnselected()}
    {/if}
    {@render children?.()}
</div>

<style>
    .choice-row {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        margin-top: 1rem;
        cursor: pointer;
    }
    .choice-row span.choice-title {
        width: auto;
    }
    .choice-row input[type="checkbox"] {
        /* width: 1.2rem;
        height: 1.2rem; */
        cursor: pointer;
    }

    .choice-notes {
        margin-left: 2rem;
        margin-top: 0.25rem;
        color: var(--text-muted);
        font-size: 0.9rem;
    }
</style>
