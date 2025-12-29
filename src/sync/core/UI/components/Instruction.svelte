<script lang="ts">
    import { setContext } from "svelte";

    type Props = {
        children?: () => any;
    };
    const { children }: Props = $props();
</script>

<div class="question-container">
    {@render children?.()}
</div>
