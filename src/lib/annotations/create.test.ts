import { describe, expect, it } from 'vitest';
import type { Annotation } from '@codex-scriptura/core';
import { notesForSelection, notesForAnchors, themeTagsForSelection } from './create';

// Expected records are what the workspace's saveNote and the toolbar's
// applyTheme built inline before these builders existed.

function ids() {
    let n = 0;
    return () => `id-${++n}`;
}

describe('notesForSelection', () => {
    it('makes one note per contiguous run of the selection', () => {
        const tags = ['grace'];
        const out = notesForSelection({ book: 'Gen', chapter: 1, verses: [1, 2, 5], text: 'Light first.', tags, now: 70, newId: ids() });
        expect(out).toEqual([
            { id: 'id-1', type: 'note', book: 'Gen', verseStart: 'Gen.1.1', verseEnd: 'Gen.1.2', data: 'Light first.', tags: ['grace'], created: 70, modified: 70, synced: false },
            { id: 'id-2', type: 'note', book: 'Gen', verseStart: 'Gen.1.5', verseEnd: 'Gen.1.5', data: 'Light first.', tags: ['grace'], created: 70, modified: 70, synced: false },
        ]);
        // Each record gets its own copy of the tags
        expect(out[0].tags).not.toBe(tags);
        expect(out[0].tags).not.toBe(out[1].tags);
    });

    it('makes nothing for an empty selection', () => {
        expect(notesForSelection({ book: 'Gen', chapter: 1, verses: [], text: 'x', tags: [], now: 1, newId: ids() })).toEqual([]);
    });

    it('defaults to random ids and the current time', () => {
        const out = notesForSelection({ book: 'Ps', chapter: 23, verses: [1, 3], text: 'x', tags: [] });
        expect(new Set(out.map((a) => a.id)).size).toBe(2);
        expect(out[0].created).toBe(out[0].modified);
        expect(out[0].created).toBeGreaterThan(0);
    });
});

describe('notesForAnchors', () => {
    it('groups anchors per chapter into contiguous runs, chapters in first-seen order', () => {
        const out = notesForAnchors({ anchors: ['Ps.23.1', 'Ps.23.2', 'John.3.16', 'Ps.23.4'], text: 'From the pad', tags: ['t'], now: 9, newId: ids() });
        expect(out).toEqual([
            { id: 'id-1', type: 'note', book: 'Ps', verseStart: 'Ps.23.1', verseEnd: 'Ps.23.2', data: 'From the pad', tags: ['t'], created: 9, modified: 9, synced: false },
            { id: 'id-2', type: 'note', book: 'Ps', verseStart: 'Ps.23.4', verseEnd: 'Ps.23.4', data: 'From the pad', tags: ['t'], created: 9, modified: 9, synced: false },
            { id: 'id-3', type: 'note', book: 'John', verseStart: 'John.3.16', verseEnd: 'John.3.16', data: 'From the pad', tags: ['t'], created: 9, modified: 9, synced: false },
        ]);
    });

    it('drops malformed anchors and repeats', () => {
        const out = notesForAnchors({ anchors: ['nonsense', 'Gen.2.4', 'Gen.2.4'], text: 'x', tags: [], now: 1, newId: ids() });
        expect(out.map((a) => [a.verseStart, a.verseEnd])).toEqual([['Gen.2.4', 'Gen.2.4']]);
    });
});

describe('themeTagsForSelection', () => {
    const theme = (start: string, end: string, slug: string): Annotation => ({
        id: `t-${start}-${slug}`, type: 'theme', book: 'Gen', verseStart: start, verseEnd: end,
        data: slug, tags: [slug], created: 1, modified: 1, synced: false,
    });

    it('tags each contiguous run with the label as data and the slug as the only tag', () => {
        const out = themeTagsForSelection({ book: 'Gen', chapter: 1, verses: [1, 2, 5], label: 'Covenant', slug: 'covenant', existing: [], now: 30, newId: ids() });
        expect(out).toEqual([
            { id: 'id-1', type: 'theme', book: 'Gen', verseStart: 'Gen.1.1', verseEnd: 'Gen.1.2', data: 'Covenant', tags: ['covenant'], created: 30, modified: 30, synced: false },
            { id: 'id-2', type: 'theme', book: 'Gen', verseStart: 'Gen.1.5', verseEnd: 'Gen.1.5', data: 'Covenant', tags: ['covenant'], created: 30, modified: 30, synced: false },
        ]);
    });

    it('skips a run that already carries the same theme over exactly the same range', () => {
        const existing = [
            theme('Gen.1.5', 'Gen.1.5', 'covenant'),
            // Same range, other theme: not a duplicate
            theme('Gen.1.1', 'Gen.1.2', 'creation'),
            // Same theme, overlapping but different range: not a duplicate
            theme('Gen.1.1', 'Gen.1.3', 'covenant'),
            // Same range and slug but a note, not a theme
            { ...theme('Gen.1.1', 'Gen.1.2', 'covenant'), type: 'note' as const },
        ];
        const out = themeTagsForSelection({ book: 'Gen', chapter: 1, verses: [1, 2, 5], label: 'Covenant', slug: 'covenant', existing, now: 30, newId: ids() });
        expect(out.map((a) => [a.id, a.verseStart, a.verseEnd])).toEqual([['id-1', 'Gen.1.1', 'Gen.1.2']]);
    });

    it('returns nothing when every run is already tagged', () => {
        const out = themeTagsForSelection({ book: 'Gen', chapter: 1, verses: [5], label: 'covenant', slug: 'covenant', existing: [theme('Gen.1.5', 'Gen.1.5', 'covenant')] });
        expect(out).toEqual([]);
    });
});
