import type { VerseRecord, Annotation, Person, Place, BibleEvent } from '@codex-scriptura/core';
import { StudyRailState } from './studyRail.svelte';
import { BookAnnotations } from './bookAnnotations.svelte';
import { LatestOnly } from '$lib/utils/latestOnly';
import { chapterFallbackOrder } from '$lib/utils/chapterAvailability';
import type { PassageTarget } from '$lib/reader/navigation';
import {
    getChapter,
    getBookList,
    getChapterList,
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
    // loaded. `goTo(..., { silent: true })` fires neither.
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

    // Pane UI state
    selectedVerses = $state<number[]>([]);
    /** The pane's Study Rail (issue #243): tabs stay resident across chapter loads. */
    rail = new StudyRailState();
    bookSelectorOpen = $state(false);

    // DOM ref for chapter pills - bound from the template
    chapterPillsEl: HTMLDivElement | undefined = $state();

    // Rapid navigation overlaps loads; only the newest may commit. The
    // book/chapter lists have their own guard: they must describe the
    // pane's current translation and book, never a slower query for an
    // earlier one.
    #chapterLoad = new LatestOnly();
    #listLoad = new LatestOnly();
    #annotations = new BookAnnotations();
    #disposed = false;

    constructor(loc: Partial<PaneLocation> = {}) {
        this.id = crypto.randomUUID();
        if (loc.book) this.book = loc.book;
        if (loc.chapter) this.chapter = loc.chapter;
        if (loc.translation) this.translation = loc.translation;
    }

    /** Every annotation in the pane's book, kept current by a live query. */
    get allBookAnnotations(): Annotation[] {
        return this.#annotations.items;
    }

    // ─── Data loading ─────────────────────────────────────────

    /** Load the book and chapter lists, then the chapter, for the current location. */
    async load(): Promise<void> {
        await this.#loadNavigation();
        await this.#loadChapter();
    }

    /** Set the starting location and load it (workspace boot: restore, not navigation). */
    start(loc: PaneLocation): Promise<void> {
        this.translation = loc.translation;
        this.book = loc.book;
        this.chapter = loc.chapter;
        return this.load();
    }

    async #loadNavigation(): Promise<void> {
        const isCurrent = this.#listLoad.begin();
        const { translation, book } = this;
        const books = await getBookList(translation);
        if (!isCurrent()) return;
        this.availableBooks = books;
        const chapters = await getChapterList(translation, book);
        if (!isCurrent()) return;
        this.availableChapters = chapters;
    }

    async #loadChapter(): Promise<void> {
        if (this.#disposed) return;
        const isCurrent = this.#chapterLoad.begin();
        this.loading = true;
        this.selectedVerses = [];
        let loaded = await getChapter(this.translation, this.book, this.chapter);
        if (!isCurrent()) return;

        // Fall forward, then backward, to find a non-empty chapter
        if (loaded.length === 0) {
            for (const ch of chapterFallbackOrder(this.availableChapters, this.chapter)) {
                const tryVs = await getChapter(this.translation, this.book, ch);
                if (!isCurrent()) return;
                if (tryVs.length > 0) {
                    this.chapter = ch;
                    loaded = tryVs;
                    break;
                }
            }
        }
        this.verses = loaded;

        // The loading gate covers annotations too: resolves on the book's
        // first emission, at once when the book has not changed.
        await this.#annotations.follow(this.book);
        if (!isCurrent()) return;
        this.loading = false;
        requestAnimationFrame(() => this.scrollActiveChapterIntoView());
        await this.refreshEnrichment();
    }

    /**
     * (Re)load the chapter's people, places and events. Called at the end of
     * a chapter load, and again by the reader when those datasets finish
     * installing behind a live reader (issue #244), so the marks and the
     * Who's here panel light up without a reload. A result that lands after
     * a newer chapter load has started is dropped.
     */
    async refreshEnrichment(): Promise<void> {
        const isCurrent = this.#chapterLoad.current();
        if (this.verses.length === 0) return;
        const ent = await getEntitiesForChapter(this.verses.map((v) => v.osisId));
        if (!isCurrent()) return;
        this.enrichment = ent;
    }

    /** Tear down the live annotation subscription (pane closed or workspace destroyed). */
    dispose(): void {
        // A load still awaiting getChapter would otherwise pass its race
        // guard and resubscribe on the dead pane (issue #186)
        this.#disposed = true;
        this.#chapterLoad.cancel();
        this.#annotations.dispose();
    }

    // ─── Navigation actions ───────────────────────────────────

    async navigateToBook(bookId: string): Promise<void> {
        if (bookId === this.book) return;
        this.onBeforeNavigate?.();
        this.book = bookId;
        this.bookSelectorOpen = false;
        await this.#loadNavigation();
        this.chapter = this.availableChapters[0] ?? 1;
        await this.#loadChapter();
        this.onAfterNavigate?.();
    }

    async navigateToChapter(ch: number): Promise<void> {
        if (ch === this.chapter) return;
        this.onBeforeNavigate?.();
        this.chapter = ch;
        await this.#loadChapter();
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
                await this.#loadNavigation();
                this.chapter = this.availableChapters[this.availableChapters.length - 1] ?? 1;
            } else {
                return;
            }
        }
        await this.#loadChapter();
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
                await this.#loadNavigation();
                this.chapter = this.availableChapters[0] ?? 1;
            } else {
                return;
            }
        }
        await this.#loadChapter();
        this.onAfterNavigate?.();
    }

    /** Book and chapter in one navigation (the passage picker): one load, hooks fire once. */
    async navigateTo(bookId: string, chapter: number): Promise<void> {
        if (bookId === this.book && chapter === this.chapter) {
            this.bookSelectorOpen = false;
            return;
        }
        this.onBeforeNavigate?.();
        this.bookSelectorOpen = false;
        if (bookId !== this.book) {
            this.book = bookId;
            await this.#loadNavigation();
        }
        this.chapter = this.availableChapters.includes(chapter) ? chapter : this.availableChapters[0] ?? 1;
        await this.#loadChapter();
        this.onAfterNavigate?.();
    }

    async switchTranslation(id: string): Promise<void> {
        if (id === this.translation) return;
        this.onBeforeNavigate?.();
        this.translation = id;
        await this.#loadNavigation();
        // The new translation may not contain the current book (e.g. OEB's
        // partial canon) or chapter - fall back instead of rendering empty.
        if (!this.availableBooks.includes(this.book)) {
            this.book = this.availableBooks[0] ?? this.book;
            this.chapter = 1;
            await this.#loadNavigation();
        } else if (!this.availableChapters.includes(this.chapter)) {
            this.chapter = this.availableChapters[0] ?? 1;
        }
        await this.#loadChapter();
        this.onAfterNavigate?.();
    }

    /**
     * Go straight to a passage (cross-references, annotation links, history,
     * the URL). Unlike the moves above it always reloads, even onto the
     * chapter already on screen, and takes the chapter as given. Hooks fire
     * unless `silent`. The verse is the caller's to show.
     */
    async goTo(target: PassageTarget, opts: { silent?: boolean } = {}): Promise<void> {
        if (!opts.silent) this.onBeforeNavigate?.();
        if (target.book !== this.book) {
            this.book = target.book;
            await this.#loadNavigation();
        }
        this.chapter = target.chapter;
        await this.#loadChapter();
        if (!opts.silent) this.onAfterNavigate?.();
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
    // Split-view completion additions (issue #24) - absent in payloads
    // written before it, so every reader falls back.
    /** Flex weight per pane (divider drags). */
    weights?: number[];
    syncScroll?: boolean;
    /** Per-pane scroll position as a 0-1 fraction of scrollable height. */
    scrolls?: number[];
    /** Split toggles: inline cross-ref badges, divergence shading, map panel. */
    showRefs?: boolean;
    showDivergence?: boolean;
    mapOpen?: boolean;
    /** Layers menu: underline people, places and events in the text (issue #246). */
    showEntities?: boolean;
};

export type SplitLayout = {
    locations: PaneLocation[];
    weights: number[];
    syncScroll: boolean;
    scrolls: number[];
    showRefs: boolean;
    showDivergence: boolean;
    mapOpen: boolean;
    showEntities: boolean;
};

export function persistSplitPanes(layout: SplitLayout): void {
    const data: PersistedPanes = {
        count: layout.locations.length,
        // Locations come from toLocation() reading $state fields - plain
        // strings/numbers, safe for IndexedDB's structured clone; the
        // arrays are rebuilt fresh by the workspace on every call.
        locations: layout.locations,
        weights: layout.weights,
        syncScroll: layout.syncScroll,
        scrolls: layout.scrolls,
        showRefs: layout.showRefs,
        showDivergence: layout.showDivergence,
        mapOpen: layout.mapOpen,
        showEntities: layout.showEntities,
    };
    // Fire-and-forget: layout persistence must never block navigation.
    setKv(KV_KEY, data).catch((err) => {
        console.warn('[split] Could not persist layout:', err);
    });
}

/**
 * Returns the persisted split layout. `extraLocations` excludes pane 0 -
 * the workspace restores that from preferences - but `weights` and
 * `scrolls` are indexed over ALL panes, pane 0 included.
 */
export async function restoreSplitLayout(): Promise<{ extraLocations: PaneLocation[] } & Omit<SplitLayout, 'locations'>> {
    const empty = {
        extraLocations: [] as PaneLocation[],
        weights: [] as number[],
        syncScroll: false,
        scrolls: [] as number[],
        // Cross-reference badges are a Layers item, off by default (issue #249); a
        // persisted value from any earlier session wins.
        showRefs: false,
        showDivergence: true,
        mapOpen: false,
        showEntities: false,
    };
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

        if (!data) return empty;
        return {
            extraLocations: data.locations.slice(1, Math.min(data.count, 3)),
            weights: data.weights ?? [],
            syncScroll: data.syncScroll ?? false,
            scrolls: data.scrolls ?? [],
            showRefs: data.showRefs ?? false,
            showDivergence: data.showDivergence ?? true,
            mapOpen: data.mapOpen ?? false,
            showEntities: data.showEntities ?? false,
        };
    } catch {
        return empty;
    }
}

// ─── Reader behavior toggles (Settings surface) ───────────────
// The three split-view toggles live inside the kv 'splitPanes' record but
// read as reader preferences, so Settings exposes them too. Settings and
// the reader workspace are never mounted at once (separate routes), so
// read-merge-write here cannot race a live persistSplitPanes.

export type SplitToggles = {
    syncScroll: boolean;
    showRefs: boolean;
    showDivergence: boolean;
};

export async function getSplitToggles(): Promise<SplitToggles> {
    const { syncScroll, showRefs, showDivergence } = await restoreSplitLayout();
    return { syncScroll, showRefs, showDivergence };
}

export async function updateSplitToggles(partial: Partial<SplitToggles>): Promise<void> {
    try {
        const data = await getKv<PersistedPanes>(KV_KEY);
        // No layout persisted yet: a locations-free stub is safe - the
        // workspace restores pane 0 from preferences, not from here.
        const base: PersistedPanes = data ?? { count: 1, locations: [] };
        await setKv(KV_KEY, { ...base, ...partial });
    } catch {
        // Toggle persistence is best-effort, like persistSplitPanes.
    }
}
