<script lang="ts">
    import { goto } from '$app/navigation';
    import { onMount } from 'svelte';

    onMount(() => {
        goto('/read', { replaceState: true });
    });
</script>

<div class="welcome">
    <p>Redirecting to reader…</p>
</div>

<style>
    .welcome {
        display: flex;
        justify-content: center;
        align-items: center;
        height: 100vh;
        color: var(--color-text-muted);
    }
</style>
