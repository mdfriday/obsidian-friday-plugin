<script lang="ts">
    type Props = {
        title: string;
        message: string;
        buttons: string[];
        commit: (button: string) => void;
    };
    const { title, message, buttons, commit }: Props = $props();

    function handleEsc(event: KeyboardEvent) {
        if (event.key === "Escape") {
            commit("");
        }
    }
</script>

<popup>
    <header>{title}</header>
    <article><div class="msg">{message}</div></article>
    <div class="buttons">
        {#each buttons as button}
            <button onclick={() => commit(button)}>{button}</button>
        {/each}
    </div>
</popup>
<div class="background" onclick={() => commit("")} onkeydown={handleEsc} role="none"></div>

<style>
    popup {
        z-index: 1000;
        position: fixed;
        background: rgba(255, 255, 255, 0.8);
        max-width: 70vw;
        max-height: 80vh;
        margin: auto;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        min-width: 50vw;
        min-height: 50vh;
        backdrop-filter: blur(5px);
        display: flex;
        flex-direction: column;
        border-radius: 5px;
        box-shadow: 0 0 10px rgba(0, 0, 0, 0.5);
        border: 1px solid var(--background-primary-alt);
        justify-content: space-between;
    }
    popup header {
        background: var(--background-primary);
        color: var(--text-normal);
        padding: 1em;
        border-bottom: 1px solid var(--background-primary-alt);
        font: size 1.4em;
    }
    popup article {
        padding: 1em;
        display: flex;
        justify-content: center;
        overflow-y: auto;
    }
    popup article .msg {
        white-space: pre-wrap;
    }
    popup .buttons {
        border-top: 1px solid var(--background-primary-alt);
        display: flex;
        justify-content: center;
        align-items: center;
        padding: 1em;
    }
    popup .buttons button {
        margin: 0 0.5em;
        background-color: var(--background-primary-alt);
    }
    popup ~ .background {
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background: rgba(0, 0, 0, 0.125);
    }
</style>
