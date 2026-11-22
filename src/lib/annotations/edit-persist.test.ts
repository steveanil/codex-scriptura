import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Annotation } from '@codex-scriptura/core';
import { db, getAllAnnotations, getSettings, getTags, getSavedSearches, saveAnnotation } from '@codex-scriptura/db';
import { applyBackup } from '$lib/utils/backup';
import { buildBackup, parseBackup } from '$lib/utils/backup-format';
import { editAnnotation, type AnnotationPatch } from './edit';
import { planHighlight } from './selection';

const GEN = { 1: 31, 2: 25 };

function note(): Annotation {
    return {
        id: 'note-1', type: 'note', book: 'Gen', verseStart: 'Gen.1.1', verseEnd: 'Gen.1.2',
        data: 'In the beginning', tags: ['creation'], created: 1000, modified: 1000, synced: false,
    };
}
function highlight(): Annotation {
    return {
        id: 'hl-1', type: 'highlight', book: 'Gen', verseStart: 'Gen.1.3', verseEnd: 'Gen.1.3',
        data: '', color: 'yellow', translation: 'KJV', tags: [], created: 1000, modified: 1000, synced: false,
    };
}

/** Save, edit, save again: what every edit path does. */
async function editAndSave(original: Annotation, patch: AnnotationPatch): Promise<Annotation> {
    await db.annotations.put(original);
    const r = editAnnotation(original, patch, GEN);
    if (!r.ok) throw new Error(r.error);
    await saveAnnotation(r.annotation);
    const stored = await db.annotations.get(original.id);
    if (!stored) throw new Error('record vanished');
    return stored;
}

beforeEach(async () => {
    await db.annotations.clear();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(5000);
    return () => vi.useRealTimers();
});

describe('editing keeps the record and stamps modified', () => {
    const cases: [string, () => Annotation, AnnotationPatch][] = [
        ['note body', note, { body: 'Let there be light' }],
        ['note tag added', note, { tags: ['creation', 'light'] }],
        ['note tag removed', note, { tags: [] }],
        ['note range', note, { range: { start: 'Gen.1.31', end: 'Gen.2.3' } }],
        ['highlight colour', highlight, { color: 'blue' }],
        ['highlight range', highlight, { range: { start: 'Gen.2.1', end: 'Gen.2.4' } }],
    ];

    for (const [name, make, patch] of cases) {
        it(name, async () => {
            const stored = await editAndSave(make(), patch);
            expect(stored.id).toBe(make().id);
            expect(stored.created).toBe(1000);
            expect(stored.modified).toBe(5000);
            expect(await db.annotations.count()).toBe(1);
        });
    }

    it('a toolbar recolour updates the covering highlight instead of adding one', async () => {
        await db.annotations.put(highlight());
        const records = planHighlight({ book: 'Gen', chapter: 1, verses: [3], color: 'blue', translation: 'KJV', visible: [highlight()] });
        for (const r of records) await saveAnnotation(r);
        const all = await db.annotations.toArray();
        expect(all).toHaveLength(1);
        expect(all[0]).toMatchObject({ id: 'hl-1', color: 'blue', modified: 5000, created: 1000 });
    });
});

describe('backup round trip of an edited record', () => {
    it('comes back from export and a replace import with its original id and the edited fields', async () => {
        const edited = await editAndSave(note(), {
            body: 'Edited body',
            tags: ['light'],
            range: { start: 'Gen.1.3', end: 'Gen.1.5' },
        });

        const [settings, annotations, tags, savedSearches] = await Promise.all([
            getSettings(), getAllAnnotations(), getTags(), getSavedSearches(),
        ]);
        const json = JSON.stringify(buildBackup({ app: 'test', settings, annotations, tags, savedSearches }));

        await db.annotations.clear();
        await applyBackup(parseBackup(json), 'replace');

        const back = await db.annotations.toArray();
        expect(back).toHaveLength(1);
        expect(back[0]).toEqual(edited);
        expect(back[0]).toMatchObject({
            id: 'note-1', created: 1000, modified: 5000,
            data: 'Edited body', tags: ['light'], verseStart: 'Gen.1.3', verseEnd: 'Gen.1.5',
        });
    });
});
