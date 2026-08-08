import { getKv, setKv } from '@codex-scriptura/db';
import type { ScratchPadState, ScratchPadVerseBlock } from '@codex-scriptura/core';
import { insertBlocksIntoContent } from '$lib/utils/scratchPad';

// ─── Scratch Pad Store ─────────────────────────────────────
// Workspace-level notepad (issue #23). Content and dropped-verse registry
// persist in the kv table under one key; open/closed is session state on
// the module singleton, so the pad survives route changes but not reloads.
// Writes are debounced 500ms, same as preferences.

const KV_KEY = 'scratchPad';

function createScratchPadStore() {
    let content = $state('');
    let droppedVerses = $state<ScratchPadVerseBlock[]>([]);
    let isOpen = $state(false);
    let saveTimer: ReturnType<typeof setTimeout> | null = null;
    /** Last known caret position in the pad textarea; null = end. */
    let cursor: number | null = null;
    let loadPromise: Promise<void> | null = null;

    function load(): Promise<void> {
        loadPromise ??= (async () => {
            const saved = await getKv<ScratchPadState>(KV_KEY);
            if (saved) {
                content = saved.content ?? '';
                droppedVerses = saved.droppedVerses ?? [];
            }
        })();
        return loadPromise;
    }

    function persist(): Promise<void> {
        // $state.snapshot: droppedVerses is a deep-reactive proxy and
        // IndexedDB's structured clone rejects proxies.
        const data: ScratchPadState = {
            content,
            droppedVerses: $state.snapshot(droppedVerses) as ScratchPadVerseBlock[],
        };
        return setKv(KV_KEY, data);
    }

    function scheduleSave(): void {
        if (saveTimer !== null) clearTimeout(saveTimer);
        saveTimer = setTimeout(async () => {
            await persist();
            saveTimer = null;
        }, 500);
    }

    async function insertBlocks(blocks: ScratchPadVerseBlock[]): Promise<void> {
        if (blocks.length === 0) return;
        // A send can race the initial load; wait so the loaded content
        // never overwrites the insertion.
        await load();
        const result = insertBlocksIntoContent(content, blocks, isOpen ? cursor : null);
        content = result.content;
        cursor = result.cursor;
        const known = new Set(droppedVerses.map((b) => b.osisId));
        const fresh = blocks.filter((b) => !known.has(b.osisId));
        if (fresh.length > 0) droppedVerses = [...droppedVerses, ...fresh];
        isOpen = true;
        scheduleSave();
    }

    async function clear(): Promise<void> {
        content = '';
        droppedVerses = [];
        cursor = null;
        if (saveTimer !== null) {
            clearTimeout(saveTimer);
            saveTimer = null;
        }
        await persist();
    }

    return {
        get content(): string {
            return content;
        },
        set content(value: string) {
            content = value;
            scheduleSave();
        },
        get droppedVerses(): ScratchPadVerseBlock[] {
            return droppedVerses;
        },
        get isOpen(): boolean {
            return isOpen;
        },
        setCursor(pos: number | null): void {
            cursor = pos;
        },
        open(): void {
            isOpen = true;
        },
        close(): void {
            isOpen = false;
        },
        toggle(): void {
            isOpen = !isOpen;
        },
        load,
        insertBlocks,
        clear,
    };
}

export const scratchPad = createScratchPadStore();
