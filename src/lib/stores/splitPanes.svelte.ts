import type { VerseRecord, Annotation, Person, Place, BibleEvent } from '@codex-scriptura/core';
import {
    getChapter,
    getBookList,
    getChapterList,
    getAnnotationsForBook,
    getEntitiesForChapter,
    getKv,
    setKv,
} from '@codex-scriptura/db';

// ─── Per-pane navigable location (persisted to the Dexie kv table) ─
export type PaneLocation = {
    book: string;
    chapter: number;
    translation: string;
};

const KV_KEY = 'splitPanes';
// Pre-v18 location - read once as a migration fallback, then removed.
const LEGACY_STORAGE_KEY = 'codex:splitPanes';

// ─── PaneState ────────────────────────────────────────────────
// Self-contained reactive state + loading logic for one reader pane.
// Every pane - including the primary (index 0) - is a PaneState
// instance; the workspace wires per-pane concerns (nav history,
// preferences, layout persistence) through the navigation hooks below.
export class PaneState {
    readonly id: string;

    // Navigation hooks - set by the workspace. `onBeforeNavigate` fires
    // just before a navigation action mutates the location (and only when
    // it actually will); `onAfterNavigate` fires after the new chapter has
    // loaded. `jumpTo()` fires neither - those callers orchestrate history
    // and persistence themselves.
    onBeforeNavigate: (() => void) | undefined;
    onAfterNavigate: (() => void) | undefined;

    // Navigation
    book = $state('Gen');
    chapter = $state(1);
    translation = $state('KJV');

    // Data
    verses = $state<VerseRecord[]>([]);
    loading = $state(true);
    availableChapters = $state<number[]>([]);
    availableBooks = $state<string[]>([]);
    enrichment = $state<{ persons: Person[]; places: Place[]; events: BibleEvent[] } | null>(null);
    allBookAnnotations = $state<Annotation[]>([]);

    // Pane UI state
    selectedVerses = $state<number[]>([]);
    panelMode = $state<'none' | 'detail' | 'list' | 'lineage'>('none');
    bookSelectorOpen = $state(false);

    // DOM ref for chapter pills - bound from the template
    chapterPillsEl: HTMLDivElement | undefined = $state();

    // Guards against interleaved loadChapter calls on rapid navigation
    // (not reactive state - purely internal bookkeeping).
    #loadGeneration = 0;

    constructor(loc: Partial<PaneLocation> = {}) {
        this.id = crypto.randomUUID();
        if (loc.book) this.book = loc.book;
        if (loc.chapter) this.chapter = loc.chapter;
        if (loc.translation) this.translation = loc.translation;
    }

    // ─── Data loading ─────────────────────────────────────────

    async loadNavigation(): Promise<void> {
        this.availableBooks = await getBookList(this.translation);
        this.availableChapters = await getChapterList(this.translation, this.book);
    }

    async loadChapter(): Promise<void> {
        const gen = ++this.#loadGeneration;
        this.loading = true;
        this.selectedVerses = [];
        this.panelMode = 'none';
        let loaded = await getChapter(this.translation, this.book, this.chapter);
        if (gen !== this.#loadGeneration) return;

        // Fall forward, then backward, to find a non-empty chapter
        if (loaded.length === 0 && this.availableChapters.length > 0) {
            const curIdx = this.availableChapters.indexOf(this.chapter);
            for (let i = curIdx + 1; i < this.availableChapters.length; i++) {
                const tryVs = await getChapter(this.translation, this.book, this.availableChapters[i]);
                if (gen !== this.#loadGeneration) return;
                if (tryVs.length > 0) {
                    this.chapter = this.availableChapters[i];
                    loaded = tryVs;
                    break;
                }
            }
            if (loaded.length === 0) {
                for (let i = curIdx - 1; i >= 0; i--) {
                    const tryVs = await getChapter(this.translation, this.book, this.availableChapters[i]);
                    if (gen !== this.#loadGeneration) return;
                    if (tryVs.length > 0) {
                        this.chapter = this.availableChapters[i];
                        loaded = tryVs;
                        break;
                    }
                }
            }
        }
        this.verses = loaded;

        const anns = await getAnnotationsForBook(this.book);
        if (gen !== this.#loadGeneration) return;
        this.allBookAnnotations = anns;
        this.loading = false;
        requestAnimationFrame(() => this.scrollActiveChapterIntoView());
        const ent = await getEntitiesForChapter(this.verses.map((v) => v.osisId));
        if (gen !== this.#loadGeneration) return;
        this.enrichment = ent;
    }

    // ─── Navigation actions ───────────────────────────────────

    async navigateToBook(bookId: string): Promise<void> {
        if (bookId === this.book) return;
        this.onBeforeNavigate?.();
        this.book = bookId;
        this.bookSelectorOpen = false;
        await this.loadNavigation();
        this.chapter = this.availableChapters[0] ?? 1;
        await this.loadChapter();
        this.onAfterNavigate?.();
    }

    async navigateToChapter(ch: number): Promise<void> {
        if (ch === this.chapter) return;
        this.onBeforeNavigate?.();
        this.chapter = ch;
        await this.loadChapter();
        this.onAfterNavigate?.();
    }

    async prevChapter(): Promise<void> {
        // Nearest earlier chapter rather than indexOf-1: the current chapter
        // may not exist in this translation's chapter list at all.
        const target = [...this.availableChapters].reverse().find((c) => c < this.chapter);
        if (target !== undefined) {
            this.onBeforeNavigate?.();
            this.chapter = target;
        } else {
            const bookIdx = this.availableBooks.indexOf(this.book);
            if (bookIdx > 0) {
                this.onBeforeNavigate?.();
                this.book = this.availableBooks[bookIdx - 1];
                await this.loadNavigation();
                this.chapter = this.availableChapters[this.availableChapters.length - 1] ?? 1;
            } else {
                return;
            }
        }
        await this.loadChapter();
        this.onAfterNavigate?.();
    }

    async nextChapter(): Promise<void> {
        const target = this.availableChapters.find((c) => c > this.chapter);
        if (target !== undefined) {
            this.onBeforeNavigate?.();
            this.chapter = target;
        } else {
            const bookIdx = this.availableBooks.indexOf(this.book);
            if (bookIdx < this.availableBooks.length - 1) {
                this.onBeforeNavigate?.();
                this.book = this.availableBooks[bookIdx + 1];
                await this.loadNavigation();
                this.chapter = this.availableChapters[0] ?? 1;
            } else {
                return;
            }
        }
        await this.loadChapter();
        this.onAfterNavigate?.();
    }

    async switchTranslation(id: string): Promise<void> {
        if (id === this.translation) return;
        this.onBeforeNavigate?.();
        this.translation = id;
        await this.loadNavigation();
        // The new translation may not contain the current book (e.g. OEB's
        // partial canon) or chapter - fall back instead of rendering empty.
        if (!this.availableBooks.includes(this.book)) {
            this.book = this.availableBooks[0] ?? this.book;
            this.chapter = 1;
            await this.loadNavigation();
        } else if (!this.availableChapters.includes(this.chapter)) {
            this.chapter = this.availableChapters[0] ?? 1;
        }
        await this.loadChapter();
        this.onAfterNavigate?.();
    }

    /**
     * Navigate directly to a location (cross-reference clicks, history
     * jumps, annotation navigation). Fires no navigation hooks - callers
     * orchestrate history and persistence around it.
     */
    async jumpTo(book: string, chapter: number): Promise<void> {
        if (book !== this.book) {
            this.book = book;
            await this.loadNavigation();
        }
        this.chapter = chapter;
        await this.loadChapter();
    }

    // ─── DOM helpers ──────────────────────────────────────────

    scrollActiveChapterIntoView(): void {
        if (!this.chapterPillsEl) return;
        const active = this.chapterPillsEl.querySelector('.chapter-pill.active') as HTMLElement | null;
        if (active) active.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
    }

    handleChapterWheel(e: WheelEvent): void {
        if (!this.chapterPillsEl) return;
        if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
            e.preventDefault();
            this.chapterPillsEl.scrollLeft += e.deltaY;
        }
    }

    // ─── Serialisation ────────────────────────────────────────

    toLocation(): PaneLocation {
        return { book: this.book, chapter: this.chapter, translation: this.translation };
    }
}

// ─── Dexie kv persistence (known-issues #15 consolidation) ────

type PersistedPanes = {
    count: number;
    locations: PaneLocation[];
};

export function persistSplitPanes(locations: PaneLocation[]): void {
    const data: PersistedPanes = {
        count: locations.length,
        // Locations come from toLocation() reading $state fields - plain
        // strings/numbers, safe for IndexedDB's structured clone.
        locations,
    };
    // Fire-and-forget: layout persistence must never block navigation.
    setKv(KV_KEY, data).catch(() => {});
}

/** Returns persisted extra-pane locations (does NOT include pane 0 - that is managed by workspace). */
export async function restoreExtraPaneLocations(): Promise<PaneLocation[]> {
    try {
        let data = await getKv<PersistedPanes>(KV_KEY);

        // One-time migration from the pre-v18 localStorage location
        if (!data) {
            const raw = localStorage.getItem(LEGACY_STORAGE_KEY);
            if (raw) {
                data = JSON.parse(raw) as PersistedPanes;
                await setKv(KV_KEY, data);
                localStorage.removeItem(LEGACY_STORAGE_KEY);
            }
        }

        if (!data) return [];
        // locations[0] is the primary pane - workspace restores it from preferences.
        // We only return the extra ones (indexes 1+).
        return data.locations.slice(1, Math.min(data.count, 3));
    } catch {
        return [];
    }
}
