import 'fake-indexeddb/auto';
import { describe, it, expect, vi } from 'vitest';
import type { Annotation } from '@codex-scriptura/core';
import { db } from './database';
import {
    themeSlug, getThemes, getThemeAnnotations, observeAnnotationsForBook, observeAllAnnotations, saveAnnotation, deleteAnnotation,
    deleteAnnotationsOfType, restoreAnnotations, observeAnnotationCounts, renameTheme, mergeThemes,
} from './annotations';

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

describe('clearing annotations by type (issue #277)', () => {
    function rec(id: string, type: Annotation['type'], over: Partial<Annotation> = {}): Annotation {
        return {
            id, type, book: 'Hag', verseStart: 'Hag.1.1', verseEnd: 'Hag.1.2',
            data: type === 'highlight' ? '#ffff00' : 'text', tags: type === 'note' ? ['temple'] : [],
            created: 100, modified: 200, synced: false, ...over,
        };
    }

    async function reset() {
        await db.annotations.clear();
        await db.tags.clear();
    }

    it('deletes only the given type and returns the removed records', async () => {
        await reset();
        await db.annotations.bulkPut([rec('h1', 'highlight'), rec('h2', 'highlight'), rec('n1', 'note'), rec('t1', 'theme'), rec('b1', 'bookmark')]);

        const removed = await deleteAnnotationsOfType('highlight');

        expect(removed.map((a) => a.id).sort()).toEqual(['h1', 'h2']);
        expect((await db.annotations.toArray()).map((a) => a.id).sort()).toEqual(['b1', 'n1', 't1']);
    });

    it('returns an empty list when there is nothing of that type', async () => {
        await reset();
        await db.annotations.put(rec('n1', 'note'));
        expect(await deleteAnnotationsOfType('theme')).toEqual([]);
        expect(await db.annotations.count()).toBe(1);
    });

    it('leaves the tag registry alone when notes are cleared', async () => {
        await reset();
        await db.tags.put({ id: 'temple', name: 'temple', color: '#888888' });
        await db.annotations.put(rec('n1', 'note'));
        await deleteAnnotationsOfType('note');
        expect(await db.annotations.count()).toBe(0);
        expect((await db.tags.toArray()).map((t) => t.id)).toEqual(['temple']);
    });

    it('restores records exactly, keeping ids and timestamps', async () => {
        await reset();
        const before = [rec('n1', 'note', { created: 11, modified: 22 }), rec('n2', 'note', { created: 33, modified: 44, verseEnd: 'Hag.2.9' })];
        await db.annotations.bulkPut(before);

        const removed = await deleteAnnotationsOfType('note');
        await restoreAnnotations(removed);

        expect(await db.annotations.where('type').equals('note').sortBy('id')).toEqual(before);
    });

    it('counts per type live, across deletes, restores and new saves', async () => {
        await reset();
        await db.annotations.bulkPut([rec('h1', 'highlight'), rec('n1', 'note'), rec('n2', 'note')]);
        const emissions: Record<'highlight' | 'note' | 'theme', number>[] = [];
        const sub = observeAnnotationCounts(['highlight', 'note', 'theme'] as const).subscribe({ next: (c) => emissions.push(c) });
        const last = () => emissions[emissions.length - 1];

        await vi.waitFor(() => expect(last()).toEqual({ highlight: 1, note: 2, theme: 0 }));
        const removed = await deleteAnnotationsOfType('note');
        await vi.waitFor(() => expect(last()).toEqual({ highlight: 1, note: 0, theme: 0 }));
        await restoreAnnotations(removed);
        await vi.waitFor(() => expect(last()).toEqual({ highlight: 1, note: 2, theme: 0 }));
        await saveAnnotation(rec('t1', 'theme'));
        await vi.waitFor(() => expect(last()).toEqual({ highlight: 1, note: 2, theme: 1 }));

        sub.unsubscribe();
    });
});

describe('theme rename and merge (issue #323)', () => {
    // Slugs no other test in this file uses, so getThemes stays predictable
    function theme(id: string, label: string, verse: number): Annotation {
        return {
            id, type: 'theme', book: 'Ps', verseStart: `Ps.23.${verse}`, verseEnd: `Ps.23.${verse}`,
            data: label, tags: [themeSlug(label)], created: 1, modified: 1, synced: false,
        };
    }
    const get = async (id: string) => (await db.annotations.get(id))!;

    it('moves the whole thread to the new slug and label, stamping modified', async () => {
        const note: Annotation = { id: 'sh-note', type: 'note', book: 'Ps', verseStart: 'Ps.23.1', verseEnd: 'Ps.23.1', data: 'n', tags: ['shepherd'], created: 1, modified: 1, synced: false };
        await db.annotations.bulkPut([theme('sh1', 'Shepherd', 1), theme('sh2', 'shepherd', 2), note]);
        const before = Date.now();
        expect(await renameTheme('shepherd', 'The Good Shepherd')).toEqual({ status: 'renamed', slug: 'the-good-shepherd', count: 2 });

        expect(await getThemeAnnotations('shepherd')).toEqual([]);
        const moved = await getThemeAnnotations('the-good-shepherd');
        expect(moved.map((a) => a.id).sort()).toEqual(['sh1', 'sh2']);
        expect(moved.every((a) => a.data === 'The Good Shepherd' && a.modified >= before)).toBe(true);
        const themes = await getThemes();
        expect(themes.find((t) => t.slug === 'the-good-shepherd')).toEqual({ slug: 'the-good-shepherd', label: 'The Good Shepherd', count: 2 });
        expect(themes.some((t) => t.slug === 'shepherd')).toBe(false);
        // A note tag with the old slug's string is not part of the thread
        expect(await get('sh-note')).toEqual(note);
    });

    it('a relabel that keeps the slug is not a collision', async () => {
        expect(await renameTheme('the-good-shepherd', 'the good shepherd!')).toMatchObject({ status: 'renamed', slug: 'the-good-shepherd' });
        expect((await get('sh1')).data).toBe('the good shepherd!');
    });

    it('reports a collision with another thread and writes nothing; merge folds them and dedupes ranges', async () => {
        await db.annotations.bulkPut([theme('rest1', 'Rest', 2), theme('rest2', 'Rest', 3), theme('still1', 'Still Waters', 2)]);
        expect(await renameTheme('still-waters', 'REST')).toEqual({ status: 'collision', collision: { slug: 'rest', label: 'Rest', count: 2 }, sourceCount: 1 });
        expect((await get('still1')).modified).toBe(1);

        expect(await mergeThemes('still-waters', 'Rest')).toEqual({ slug: 'rest', count: 2 });
        expect(await getThemeAnnotations('still-waters')).toEqual([]);
        // Ps 23:2 was in both threads; the target's record is the one kept
        expect((await getThemeAnnotations('rest')).map((a) => a.id).sort()).toEqual(['rest1', 'rest2']);
        expect(await db.annotations.get('still1')).toBeUndefined();
    });

    it('rejects a label with no slug and a thread that does not exist', async () => {
        await expect(renameTheme('rest', '!!!')).rejects.toThrow(/letter or digit/);
        await expect(renameTheme('nope', 'Something')).rejects.toThrow(/No theme thread/);
    });
});
