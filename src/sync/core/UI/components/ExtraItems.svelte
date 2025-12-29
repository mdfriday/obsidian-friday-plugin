<script lang="ts">
    type Props = {
        title?: string;
        children?: () => any;
    };
    const { children, title }: Props = $props();
</script>

<details>
    <summary>{title}</summary>
    <div class="sub-section">
        {@render children?.()}
    </div>
</details>
