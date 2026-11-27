<script lang="ts">
    let { isOpen = $bindable(false), onNavigate }: {
        isOpen?: boolean;
        onNavigate: (book: string, chapter: number, verse: number) => void;
        [prop: string]: unknown;
    } = $props();
</script>

<div data-testid="sidebar" data-open={isOpen}>
    <button onclick={() => onNavigate('Ps', 5, 2)}>sidebar note</button>
</div>
