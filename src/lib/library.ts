/**
 * The Library (Settings): every corpus the app can download, grouped by
 * kind. Translations come from the catalog table; the other kinds are on
 * the roadmap and show as empty categories that say when they arrive, so
 * the section's shape is set before the milestones fill them.
 */
import type { Translation } from '@codex-scriptura/core';
import { MILESTONES } from './roadmap';

export type CorpusKind = 'translation' | 'manuscript' | 'lexicon' | 'fathers';

export type LibraryCategory = {
    kind: CorpusKind;
    label: string;
    /** Milestone that fills the category; absent once it has content. */
    plannedIn?: string;
    /** What the category will hold, for the empty state. */
    blurb: string;
};

export const LIBRARY_CATEGORIES: LibraryCategory[] = [
    { kind: 'translation', label: 'Translations', blurb: 'Bible texts; the reader and search work on what is installed.' },
    { kind: 'manuscript', label: 'Manuscripts', plannedIn: MILESTONES.manuscripts, blurb: 'Transcriptions of Sinaiticus, Vaticanus and the papyri, verse-aligned.' },
    { kind: 'lexicon', label: 'Lexicons', plannedIn: MILESTONES.manuscripts, blurb: 'BDB and Abbott-Smith, feeding Word Study.' },
    { kind: 'fathers', label: 'Church Fathers', plannedIn: MILESTONES.resources, blurb: 'Patristic commentary keyed to the verses it discusses.' },
];

export type LibraryItem = {
    id: string;
    kind: CorpusKind;
    title: string;
    /** "Strong's, word-aligned · Public Domain" style metadata line, already joined. */
    meta: string;
    verseCount: number;
    installed: boolean;
    translation: Translation;
};

export type LibraryFilter = 'all' | CorpusKind | 'installed';

function taggingNote(t: Translation): string {
    if (t.aligned) return "Strong's, word-aligned";
    if (t.strongs) return "Strong's";
    return '';
}

export function libraryItems(catalog: Translation[], installed: Set<string>): LibraryItem[] {
    return catalog.map((t) => ({
        id: t.id,
        kind: 'translation',
        title: `${t.abbreviation} - ${t.name}`,
        meta: ['Translation', t.coverage, taggingNote(t), t.id === 'WEB' ? 'red letter' : '', t.license].filter(Boolean).join(' · '),
        verseCount: t.verseCount,
        installed: installed.has(t.id),
        translation: t,
    }));
}

export function filterItems(items: LibraryItem[], filter: LibraryFilter): LibraryItem[] {
    if (filter === 'all') return items;
    if (filter === 'installed') return items.filter((i) => i.installed);
    return items.filter((i) => i.kind === filter);
}

export function countFor(items: LibraryItem[], filter: LibraryFilter): number {
    return filterItems(items, filter).length;
}
