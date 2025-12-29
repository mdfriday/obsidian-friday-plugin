<script lang="ts">
    type Props = {
        value: string;
        name?: string;
        placeholder?: string;
        disabled?: boolean;
        required?: boolean;
    };
    let {
        value = $bindable(),
        name = "password",
        placeholder = "Enter your password",
        disabled = false,
        required = false,
    }: Props = $props();
    let showPassword = $state(false);
    const type = $derived.by(() => (showPassword ? "text" : "password"));
</script>

<input
    {type}
    {name}
    {placeholder}
    bind:value
    {disabled}
    {required}
    spellcheck="false"
    autocorrect="off"
    autocapitalize="off"
/>
<input type="checkbox" bind:checked={showPassword} />
