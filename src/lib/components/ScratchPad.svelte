<script lang="ts">
    import { onMount } from 'svelte';
    import type { ScratchPadVerseBlock } from '@codex-scriptura/core';
    import { scratchPad } from '$lib/stores/scratchPad.svelte';
    import { ui } from '$lib/stores/ui.svelte';
    import { extractAnchors } from '$lib/utils/scratchPad';
    import { formatOsisLabel } from '$lib/utils/verse-render';

    const isMac = typeof navigator !== 'undefined' && /Mac/.test(navigator.platform);
    const VERSE_MIME = 'application/x-codex-scriptura-verses';

    let textareaEl: HTMLTextAreaElement | undefined = $state();
    let selStart = $state(0);
    let selEnd = $state(0);
    let dragOver = $state(false);

    onMount(() => {
        scratchPad.load();
    });

    function syncSelection() {
        if (!textareaEl) return;
        selStart = textareaEl.selectionStart;
        selEnd = textareaEl.selectionEnd;
        scratchPad.setCursor(textareaEl.selectionEnd);
    }

    // "Convert to note" promotes the selection - or the whole pad when
    // nothing is selected - and anchors it to the verse references the
    // text contains. Non-destructive: the pad is left untouched.
    let promoteText = $derived(
        selStart !== selEnd ? scratchPad.content.slice(selStart, selEnd) : scratchPad.content
    );
    let promoteAnchors = $derived(extractAnchors(promoteText, scratchPad.droppedVerses));
    let canPromote = $derived(promoteText.trim().length > 0 && promoteAnchors.length > 0);
    let promoteTitle = $derived(
        canPromote
            ? `Promote to a note on ${promoteAnchors.map((a) => formatOsisLabel(a)).join(', ')}`
            : 'Select scratch pad text that includes a dropped verse reference to promote it to a note'
    );

    function convertToNote() {
        if (!canPromote) return;
        ui.requestNotePrefill(promoteText.trim(), promoteAnchors);
    }

    function handleClear() {
        if (!scratchPad.content.trim() && scratchPad.droppedVerses.length === 0) return;
        if (confirm('Clear the scratch pad? This cannot be undone.')) {
            scratchPad.clear();
        }
    }

    // ── Drag & drop (verse numbers are the drag handles) ──
    function handleDragOver(e: DragEvent) {
        if (!e.dataTransfer?.types.includes(VERSE_MIME)) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
        dragOver = true;
    }

    function handleDragLeave(e: DragEvent) {
        if (e.currentTarget === e.target) dragOver = false;
    }

    function handleDrop(e: DragEvent) {
        dragOver = false;
        const raw = e.dataTransfer?.getData(VERSE_MIME);
        if (!raw) return;
        // Handled here for the whole panel (textarea included), so
        // prevent the browser's own text/plain drop into the textarea.
        e.preventDefault();
        try {
            const blocks = JSON.parse(raw) as ScratchPadVerseBlock[];
            if (Array.isArray(blocks) && blocks.length > 0) scratchPad.insertBlocks(blocks);
        } catch {
            // Malformed payload - ignore the drop
        }
    }
</script>

<!-- Rendered always (not {#if}) so the slide transition actually plays;
     inert keeps focus and clicks out while closed. -->
<aside
    class="scratch-pad"
    class:open={scratchPad.isOpen}
    class:drag-over={dragOver}
    inert={!scratchPad.isOpen}
    aria-label="Scratch pad"
    aria-hidden={!scratchPad.isOpen}
    ondragover={handleDragOver}
    ondragleave={handleDragLeave}
    ondrop={handleDrop}
>
    <div class="pad-header">
        <h2>Scratch pad</h2>
        <div class="pad-actions">
            <button
                class="convert-btn"
                id="scratch-pad-convert"
                disabled={!canPromote}
                onclick={convertToNote}
                title={promoteTitle}
            >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M12 20h9" />
                    <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
                </svg>
                Convert to note
            </button>
            <button class="icon-btn" id="scratch-pad-clear" onclick={handleClear} title="Clear the scratch pad" aria-label="Clear the scratch pad">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6" />
                </svg>
            </button>
            <button class="icon-btn" onclick={() => scratchPad.close()} title="Close ({isMac ? '⌘⇧P' : 'Ctrl+Shift+P'})" aria-label="Close scratch pad">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M18 6L6 18M6 6l12 12" />
                </svg>
            </button>
        </div>
    </div>

    <textarea
        id="scratch-pad-text"
        class="pad-textarea"
        bind:this={textareaEl}
        bind:value={scratchPad.content}
        oninput={syncSelection}
        onkeyup={syncSelection}
        onmouseup={syncSelection}
        onselect={syncSelection}
        placeholder={'Jot anything - the pad stays put across books and chapters.\n\nSelect verses while reading and hit "Scratch" on the toolbar, or drag a verse number in.'}
    ></textarea>

    <div class="pad-footer">
        <span class="pad-hint">Persists until you clear it</span>
        <kbd>{isMac ? '⌘⇧P' : 'Ctrl+Shift+P'}</kbd>
    </div>
</aside>

<style>
    .scratch-pad {
        position: fixed;
        top: 0;
        right: 0;
        width: 340px;
        max-width: 90vw;
        height: 100vh;
        background: var(--color-bg-elevated);
        border-left: 1px solid var(--color-border);
        box-shadow: var(--shadow-lg);
        z-index: 140;
        display: flex;
        flex-direction: column;
        transform: translateX(100%);
        transition: transform 0.3s cubic-bezier(0.16, 1, 0.3, 1);
    }
    .scratch-pad.open {
        transform: translateX(0);
    }
    .scratch-pad.drag-over {
        outline: 2px dashed var(--color-accent);
        outline-offset: -6px;
    }

    .pad-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: var(--space-2);
        padding: var(--space-3) var(--space-4);
        border-bottom: 1px solid var(--color-border);
        flex-shrink: 0;
    }
    .pad-header h2 {
        font-family: var(--font-ui);
        font-size: var(--font-size-base);
        font-weight: 600;
        color: var(--color-text-primary);
        margin: 0;
        white-space: nowrap;
    }
    .pad-actions {
        display: flex;
        align-items: center;
        gap: var(--space-1);
    }

    .convert-btn {
        display: flex;
        align-items: center;
        gap: var(--space-1);
        background: var(--color-bg-control);
        border: 1px solid var(--color-border);
        border-radius: var(--radius-sm);
        padding: var(--space-1) var(--space-2);
        color: var(--color-text-secondary);
        font-family: var(--font-ui);
        font-size: var(--font-size-xs);
        font-weight: 600;
        cursor: pointer;
        white-space: nowrap;
        transition: all var(--transition-fast);
    }
    .convert-btn:hover:not(:disabled) {
        color: var(--color-text-primary);
        border-color: var(--color-accent);
    }
    .convert-btn:disabled {
        opacity: 0.5;
        cursor: not-allowed;
    }

    .icon-btn {
        background: none;
        border: none;
        color: var(--color-text-secondary);
        cursor: pointer;
        padding: var(--space-1);
        border-radius: var(--radius-sm);
        display: flex;
        align-items: center;
    }
    .icon-btn:hover {
        background: var(--color-bg-hover);
        color: var(--color-text-primary);
    }

    .pad-textarea {
        flex: 1;
        width: 100%;
        background: transparent;
        border: none;
        resize: none;
        padding: var(--space-4);
        color: var(--color-text-primary);
        font-family: var(--font-ui);
        font-size: var(--font-size-sm);
        line-height: 1.6;
    }
    .pad-textarea:focus {
        outline: none;
    }
    .pad-textarea::placeholder {
        color: var(--color-text-faint);
    }

    .pad-footer {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: var(--space-2) var(--space-4);
        border-top: 1px solid var(--color-border-subtle);
        flex-shrink: 0;
    }
    .pad-hint {
        font-family: var(--font-ui);
        font-size: var(--font-size-xs);
        color: var(--color-text-faint);
    }
    .pad-footer kbd {
        font-family: var(--font-mono);
        font-size: var(--font-size-xs);
        color: var(--color-text-muted);
        background: var(--color-bg-control);
        border: 1px solid var(--color-border);
        border-radius: var(--radius-sm);
        padding: 1px 5px;
    }
</style>
