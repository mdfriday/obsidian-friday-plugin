<script lang="ts">
    type Props = {
        label: string;
        children?: () => any;
    };
    const { label, children }: Props = $props();
</script>

<label class="row"
    ><span>{label}</span>
    {@render children?.()}
</label>