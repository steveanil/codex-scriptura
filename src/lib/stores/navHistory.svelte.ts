import { getKv, setKv } from '@codex-scriptura/db';

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
            // Already visited - update scrollTop in place
            entries = entries.map((e, i) =>
                i === idx ? { ...e, scrollTop: entry.scrollTop } : e
            );
        } else {
            // New chapter - append (evict oldest if at limit)
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
     *
     * The backStack (cap 20) can reference chapters already evicted from
     * entries (cap 6) - those keys are skipped, walking further back, so a
     * back action never consumes the stack and then lands on nothing.
     */
    function goBack(): NavEntry | undefined {
        while (backStack.length >= 2) {
            backStack = backStack.slice(0, -1);
            const prevKey = backStack[backStack.length - 1];
            const entry = entries.find(
                (e) => entryKey(e.book, e.chapter) === prevKey
            );
            if (entry) {
                persist();
                return entry;
            }
        }
        persist();
        return undefined;
    }

    function clear() {
        entries = [];
        backStack = [];
        persist();
    }

    async function persist() {
        try {
            // $state.snapshot: entries/backStack are reactive proxies, and
            // IndexedDB's structured clone throws DataCloneError on proxies -
            // this catch was silently eating that error on every visit.
            await setKv('navHistory', {
                entries: $state.snapshot(entries),
                backStack: $state.snapshot(backStack),
            });
        } catch {
            // Silently ignore persistence errors
        }
    }

    async function load() {
        try {
            const saved = await getKv<{ entries?: NavEntry[]; backStack?: string[] }>('navHistory');
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
            // A back target must still exist in entries - stack keys whose
            // entries were evicted don't count (mirrors goBack's skip logic).
            return backStack
                .slice(0, -1)
                .some((k) => entries.some((e) => entryKey(e.book, e.chapter) === k));
        },
        visit,
        goBack,
        clear,
        load,
    };
}

export const navHistory = createNavHistoryStore();
