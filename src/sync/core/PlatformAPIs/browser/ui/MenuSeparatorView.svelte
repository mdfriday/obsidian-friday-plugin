<script lang="ts">
    import type { Menu, MenuItem, MenuSeparator } from "../Menu";

    type Props = {
        item: MenuSeparator;
    };
    const { item = $bindable() }: Props = $props();
</script>

<hr />
