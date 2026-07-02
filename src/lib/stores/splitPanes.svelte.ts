import type { VerseRecord, Annotation, Person, Place, BibleEvent } from '@codex-scriptura/core';
import {
    getChapter,
    getBookList,
    getChapterList,
    getAnnotationsForBook,
    getEntitiesForChapter,
} from '@codex-scriptura/db';

// ─── Per-pane navigable location (persisted to localStorage) ─
export type PaneLocation = {
    book: string;
    chapter: number;
    translation: string;
};

const STORAGE_KEY = 'codex:splitPanes';

// ─── PaneState ────────────────────────────────────────────────
// Self-contained reactive state + loading logic for one reader pane.
// The primary pane (index 0) uses workspace-owned state; extra panes
// each get a PaneState instance.
export class PaneState {
    readonly id: string;

    // Navigation
    book = $state('Gen');
    chapter = $state(1);
    translation = $state('KJV');

    // Data
    verses = $state<VerseRecord[]>([]);
    loading = $state(false);
    availableChapters = $state<number[]>([]);
    availableBooks = $state<string[]>([]);
    enrichment = $state<{ persons: Person[]; places: Place[]; events: BibleEvent[] } | null>(null);
    allBookAnnotations = $state<Annotation[]>([]);

    // Pane UI state
    selectedVerses = $state<number[]>([]);
    panelMode = $state<'none' | 'detail' | 'list'>('none');
    bookSelectorOpen = $state(false);

    // DOM ref for chapter pills — bound from the template
    chapterPillsEl: HTMLDivElement | undefined = $state();

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
        this.loading = true;
        this.selectedVerses = [];
        this.panelMode = 'none';
        this.verses = await getChapter(this.translation, this.book, this.chapter);

        // Fall forward to find a non-empty chapter
        if (this.verses.length === 0 && this.availableChapters.length > 0) {
            const curIdx = this.availableChapters.indexOf(this.chapter);
            for (let i = curIdx + 1; i < this.availableChapters.length; i++) {
                const tryVs = await getChapter(this.translation, this.book, this.availableChapters[i]);
                if (tryVs.length > 0) {
                    this.chapter = this.availableChapters[i];
                    this.verses = tryVs;
                    break;
                }
            }
        }

        this.allBookAnnotations = await getAnnotationsForBook(this.book);
        this.loading = false;
        requestAnimationFrame(() => this.scrollActiveChapterIntoView());
        const osisIds = this.verses.map((v) => v.osisId);
        this.enrichment = await getEntitiesForChapter(osisIds);
    }

    // ─── Navigation actions ───────────────────────────────────

    async navigateToBook(bookId: string): Promise<void> {
        if (bookId === this.book) return;
        this.book = bookId;
        this.bookSelectorOpen = false;
        await this.loadNavigation();
        this.chapter = this.availableChapters[0] ?? 1;
        await this.loadChapter();
    }

    async navigateToChapter(ch: number): Promise<void> {
        if (ch === this.chapter) return;
        this.chapter = ch;
        await this.loadChapter();
    }

    async prevChapter(): Promise<void> {
        const curIdx = this.availableChapters.indexOf(this.chapter);
        if (curIdx > 0) {
            this.chapter = this.availableChapters[curIdx - 1];
        } else {
            const bookIdx = this.availableBooks.indexOf(this.book);
            if (bookIdx > 0) {
                this.book = this.availableBooks[bookIdx - 1];
                await this.loadNavigation();
                this.chapter = this.availableChapters[this.availableChapters.length - 1] ?? 1;
            } else {
                return;
            }
        }
        await this.loadChapter();
    }

    async nextChapter(): Promise<void> {
        const curIdx = this.availableChapters.indexOf(this.chapter);
        if (curIdx < this.availableChapters.length - 1) {
            this.chapter = this.availableChapters[curIdx + 1];
        } else {
            const bookIdx = this.availableBooks.indexOf(this.book);
            if (bookIdx < this.availableBooks.length - 1) {
                this.book = this.availableBooks[bookIdx + 1];
                await this.loadNavigation();
                this.chapter = this.availableChapters[0] ?? 1;
            } else {
                return;
            }
        }
        await this.loadChapter();
    }

    async switchTranslation(id: string): Promise<void> {
        this.translation = id;
        await this.loadNavigation();
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

// ─── localStorage persistence ─────────────────────────────────

type PersistedPanes = {
    count: number;
    locations: PaneLocation[];
};

export function persistSplitPanes(locations: PaneLocation[]): void {
    const data: PersistedPanes = {
        count: locations.length,
        locations,
    };
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch {
        // storage unavailable — silently ignore
    }
}

/** Returns persisted extra-pane locations (does NOT include pane 0 — that is managed by workspace). */
export function restoreExtraPaneLocations(defaultTranslation: string): PaneLocation[] {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return [];
        const { count, locations } = JSON.parse(raw) as PersistedPanes;
        // locations[0] is the primary pane — workspace restores it from preferences.
        // We only return the extra ones (indexes 1+).
        return locations.slice(1, Math.min(count, 3));
    } catch {
        return [];
    }
}
