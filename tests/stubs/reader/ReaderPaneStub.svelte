<!-- Stands in for ReaderPane in workspace tests: shows the pane's location,
     offers one passage link of each kind, and logs flashes. -->
<script lang="ts">
    import type { PaneState } from '$lib/stores/splitPanes.svelte';
    import type { PassageTarget } from '$lib/reader/navigation';
    import { stubLog } from './log';

    let { pane, onNavigate, onOpenAnnotationSidebar }: {
        pane: PaneState;
        onNavigate?: (target: PassageTarget, inNewPane?: boolean) => void;
        onOpenAnnotationSidebar: () => void;
        [prop: string]: unknown;
    } = $props();

    export function flashVerse(verse: number | string) {
        stubLog.flashes.push(`${pane.translation}:${pane.book}.${pane.chapter}:${verse}`);
    }
    export function getScrollFraction() { return 0; }
    export function setScrollFraction(_fraction: number) {}
    export function getScrollAnchor() { return null; }
    export function setScrollAnchor(_anchor: unknown) { return false; }
</script>

<div class="reader-content" data-testid="pane" data-loc="{pane.translation}:{pane.book}.{pane.chapter}" data-loading={pane.loading}>
    <button onclick={() => onNavigate?.({ book: 'Exod', chapter: 2, verse: 3 })}>xref</button>
    <button onclick={() => onNavigate?.({ book: 'Ps', chapter: 3 }, true)}>open in split</button>
    <button onclick={onOpenAnnotationSidebar}>notes</button>
</div>
