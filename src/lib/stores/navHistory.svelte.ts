import { db } from '@codex-scriptura/db';

// ─── Navigation History Store ─────────────────────────────────────
// In-session reading history stack persisted to Dexie Settings.
// Cleared on tab close; depth cap of 50 entries.

export type NavEntry = {
    book: string;
    chapter: number;
    verseId?: number;
    scrollTop: number;
};

const MAX_DEPTH = 50;

function createNavHistoryStore() {
    let stack = $state<NavEntry[]>([]);

    function push(entry: NavEntry) {
        // Don't push duplicate of current top
        const top = stack[stack.length - 1];
        if (top && top.book === entry.book && top.chapter === entry.chapter) return;
        stack = [...stack, entry].slice(-MAX_DEPTH);
        persist();
    }

    function pop(): NavEntry | undefined {
        if (stack.length === 0) return undefined;
        const entry = stack[stack.length - 1];
        stack = stack.slice(0, -1);
        persist();
        return entry;
    }

    function clear() {
        stack = [];
        persist();
    }

    async function persist() {
        try {
            await db.settings.put({ id: 'navHistory', stack } as any);
        } catch {
            // Silently ignore persistence errors
        }
    }

    async function load() {
        try {
            const saved = (await db.settings.get('navHistory')) as any;
            if (saved?.stack && Array.isArray(saved.stack)) {
                stack = saved.stack.slice(-MAX_DEPTH);
            }
        } catch {
            // Silently ignore load errors
        }
    }

    return {
        get stack() {
            return stack;
        },
        get canGoBack() {
            return stack.length > 0;
        },
        push,
        pop,
        clear,
        load,
    };
}

export const navHistory = createNavHistoryStore();
