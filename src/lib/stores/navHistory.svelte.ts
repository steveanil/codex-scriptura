import { db } from '@codex-scriptura/db';

// ─── Navigation History Store ─────────────────────────────────────
// Recently-visited chapters displayed as a breadcrumb trail with a
// "you are here" highlight. Cleared on tab close; max 6 entries.

export type NavEntry = {
    book: string;
    chapter: number;
    verseId?: number;
    scrollTop: number;
};

const MAX_ENTRIES = 6;

function entryKey(book: string, chapter: number) {
    return `${book}.${chapter}`;
}

function createNavHistoryStore() {
    // Unique visited chapters, ordered by first-visit time
    let entries = $state<NavEntry[]>([]);
    // Temporal visit order for back-navigation (stores entry keys)
    let backStack = $state<string[]>([]);

    /**
     * Record a visit to a chapter.
     * - If new: appends to entries (evicts oldest if at limit).
     * - If already in entries: updates scrollTop, no reorder.
     * - Always pushes to backStack (unless same as current top).
     */
    function visit(entry: NavEntry) {
        const key = entryKey(entry.book, entry.chapter);
        const idx = entries.findIndex(
            (e) => entryKey(e.book, e.chapter) === key
        );

        if (idx >= 0) {
            // Already visited — update scrollTop in place
            entries = entries.map((e, i) =>
                i === idx ? { ...e, scrollTop: entry.scrollTop } : e
            );
        } else {
            // New chapter — append (evict oldest if at limit)
            entries = [...entries, entry].slice(-MAX_ENTRIES);
        }

        // Track temporal order for back button (no consecutive dupes)
        if (backStack[backStack.length - 1] !== key) {
            backStack = [...backStack, key].slice(-20);
        }

        persist();
    }

    /**
     * Go back to the previously visited chapter.
     * Pops the current location off backStack and returns the one before it.
     */
    function goBack(): NavEntry | undefined {
        if (backStack.length < 2) return undefined;
        // Remove current
        backStack = backStack.slice(0, -1);
        const prevKey = backStack[backStack.length - 1];
        persist();
        return entries.find(
            (e) => entryKey(e.book, e.chapter) === prevKey
        );
    }

    function clear() {
        entries = [];
        backStack = [];
        persist();
    }

    async function persist() {
        try {
            await db.settings.put({
                id: 'navHistory',
                entries,
                backStack,
            } as any);
        } catch {
            // Silently ignore persistence errors
        }
    }

    async function load() {
        try {
            const saved = (await db.settings.get('navHistory')) as any;
            if (saved?.entries && Array.isArray(saved.entries)) {
                entries = saved.entries.slice(-MAX_ENTRIES);
            }
            if (saved?.backStack && Array.isArray(saved.backStack)) {
                backStack = saved.backStack.slice(-20);
            }
        } catch {
            // Silently ignore load errors
        }
    }

    return {
        get entries() {
            return entries;
        },
        get canGoBack() {
            return backStack.length >= 2;
        },
        visit,
        goBack,
        clear,
        load,
    };
}

export const navHistory = createNavHistoryStore();
