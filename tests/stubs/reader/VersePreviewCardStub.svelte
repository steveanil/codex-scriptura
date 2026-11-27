<script lang="ts">
    let { onNavigate }: { onNavigate: (book: string, chapter: number, verse: number) => void } = $props();
</script>

<button onclick={() => onNavigate('Exod', 1, 4)}>preview link</button>
