import 'fake-indexeddb/auto';
import { describe, it, expect, vi } from 'vitest';
import type { Annotation } from '@codex-scriptura/core';
import { db } from './database';
import { themeSlug, getThemes, getThemeAnnotations, observeAnnotationsForBook, observeAllAnnotations, saveAnnotation, deleteAnnotation } from './annotations';

describe('theme threading', () => {
    function theme(over: Partial<Annotation>): Annotation {
        return {
            id: crypto.randomUUID(),
            type: 'theme',
            book: 'Gen',
            verseStart: 'Gen.1.1',
            verseEnd: 'Gen.1.1',
            data: 'Covenant',
            tags: ['covenant'],
            created: 1,
            modified: 1,
            synced: false,
            ...over,
        };
    }

    it('themeSlug normalizes labels to a shared thread identity', () => {
        expect(themeSlug('Covenant')).toBe('covenant');
        expect(themeSlug("God's Covenant")).toBe('gods-covenant');
        expect(themeSlug('  Kingdom of God! ')).toBe('kingdom-of-god');
        expect(themeSlug('!!!')).toBe('');
        expect(themeSlug('---Grace---')).toBe('grace');
    });

    it('getThemes groups by slug, counts ranges, and prefers the latest label', async () => {
        await db.annotations.bulkPut([
            theme({ modified: 1 }),
            theme({ verseStart: 'Exod.19.5', verseEnd: 'Exod.19.6', book: 'Exod', data: 'covenant', modified: 5 }),
            theme({ data: 'Faith', tags: ['faith'] }),
            // Non-theme annotations with matching tags must not leak in
            { id: 'n1', type: 'note', book: 'Gen', verseStart: 'Gen.2.1', verseEnd: 'Gen.2.1', data: 'note', tags: ['covenant'], created: 1, modified: 1, synced: false },
        ]);
        const themes = await getThemes();
        const covenant = themes.find(t => t.slug === 'covenant');
        expect(covenant).toEqual({ slug: 'covenant', label: 'covenant', count: 2 });
        expect(themes.find(t => t.slug === 'faith')?.count).toBe(1);
    });

    it('getThemeAnnotations resolves via the tags index and excludes other types', async () => {
        const anns = await getThemeAnnotations('covenant');
        expect(anns).toHaveLength(2);
        expect(anns.every(a => a.type === 'theme')).toBe(true);
    });
});

describe('observeAnnotationsForBook (issue #31)', () => {
    // Uses a book no other test touches so emissions are deterministic.
    const ann: Annotation = {
        id: 'live1',
        type: 'highlight',
        book: 'Rom',
        verseStart: 'Rom.8.1',
        verseEnd: 'Rom.8.1',
        data: '#ffff00',
        tags: [],
        created: 1,
        modified: 1,
        synced: false,
    };

    it('emits the current set, then re-emits on save and delete without a manual reload', async () => {
        const emissions: Annotation[][] = [];
        const sub = observeAnnotationsForBook('Rom').subscribe({
            next: (anns) => emissions.push(anns),
        });

        await vi.waitFor(() => expect(emissions.length).toBeGreaterThanOrEqual(1));
        expect(emissions[emissions.length - 1]).toEqual([]);

        await saveAnnotation({ ...ann });
        await vi.waitFor(() =>
            expect(emissions[emissions.length - 1].map((a) => a.id)).toEqual(['live1'])
        );

        await deleteAnnotation('live1');
        await vi.waitFor(() => expect(emissions[emissions.length - 1]).toEqual([]));

        sub.unsubscribe();
    });

    it('does not re-emit for writes to other books', async () => {
        const emissions: Annotation[][] = [];
        const sub = observeAnnotationsForBook('Rom').subscribe({
            next: (anns) => emissions.push(anns),
        });
        await vi.waitFor(() => expect(emissions.length).toBeGreaterThanOrEqual(1));
        const before = emissions.length;

        await saveAnnotation({ ...ann, id: 'live2', book: 'Phil', verseStart: 'Phil.1.1', verseEnd: 'Phil.1.1' });
        // Give the observability engine a beat to (not) fire.
        await new Promise((r) => setTimeout(r, 50));
        expect(emissions.length).toBe(before);

        sub.unsubscribe();
        await deleteAnnotation('live2');
    });
});

describe('observeAllAnnotations (issue #185)', () => {
    // The All tab regression: a delete in a book other than the one the
    // per-book query watches must still reach subscribers.
    const ann: Annotation = {
        id: 'all1',
        type: 'note',
        book: 'Jude',
        verseStart: 'Jude.1.3',
        verseEnd: 'Jude.1.3',
        data: 'contend for the faith',
        tags: [],
        created: 1,
        modified: 1,
        synced: false,
    };

    it('re-emits on save and delete regardless of book', async () => {
        const emissions: Annotation[][] = [];
        const sub = observeAllAnnotations().subscribe({
            next: (anns) => emissions.push(anns),
        });
        await vi.waitFor(() => expect(emissions.length).toBeGreaterThanOrEqual(1));

        await saveAnnotation({ ...ann });
        await vi.waitFor(() =>
            expect(emissions[emissions.length - 1].map((a) => a.id)).toContain('all1')
        );

        await deleteAnnotation('all1');
        await vi.waitFor(() =>
            expect(emissions[emissions.length - 1].map((a) => a.id)).not.toContain('all1')
        );

        sub.unsubscribe();
    });
});
