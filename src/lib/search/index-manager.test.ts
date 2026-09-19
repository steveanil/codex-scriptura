import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '@codex-scriptura/db';
import { translationDatasetId } from '@codex-scriptura/core';
import type { VerseRecord } from '@codex-scriptura/core';
import { clearSearchIndexes, getOrBuildIndex, heldIndexes, releaseIndex } from './index-manager';
import { INDEX_CONFIG_KEY } from './config';

const verse = (osisId: string, text: string, translationId = 'KJV'): VerseRecord => {
    const [book, chapter, v] = osisId.split('.');
    return { id: `${translationId}.${osisId}`, translationId, book, chapter: +chapter, verse: +v, osisId, text } as VerseRecord;
};

async function install(translationId: string, version: string, verses: VerseRecord[]) {
    await db.verses.where('translationId').equals(translationId).delete();
    await db.verses.bulkPut(verses);
    await db.datasets.put({ id: translationDatasetId(translationId), version, contentHash: `hash-${version}`, installedAt: 1, recordCount: verses.length });
}

beforeEach(async () => {
    for (const id of heldIndexes()) releaseIndex(id);
    await Promise.all([db.verses.clear(), db.datasets.clear(), db.searchIndexes.clear()]);
});

describe('getOrBuildIndex (issue #164)', () => {
    it('builds, then caches a record that holds no verse text', async () => {
        await install('KJV', 'v1', [verse('John.11.35', 'Jesus wept.')]);
        const index = await getOrBuildIndex('KJV');

        expect(index.search('wept').map((r) => r.id)).toEqual(['KJV.John.11.35']);
        const cached = await db.searchIndexes.get('minisearch:KJV');
        expect(cached?.key).toBe(`v1:hash-v1:${INDEX_CONFIG_KEY}`);
        expect(cached?.serializedIndex).not.toContain('Jesus wept');
        expect(Object.keys(index.search('wept')[0]).sort()).toEqual(['id', 'match', 'queryTerms', 'score', 'terms']);
    });

    it('loads the cached copy instead of reading the verses again', async () => {
        await install('KJV', 'v1', [verse('John.11.35', 'Jesus wept.')]);
        await getOrBuildIndex('KJV');
        releaseIndex('KJV');

        const where = vi.spyOn(db.verses, 'where');
        const index = await getOrBuildIndex('KJV');
        expect(where).not.toHaveBeenCalled();
        expect(index.search('wept')).toHaveLength(1);
        where.mockRestore();
    });

    it('rebuilds when the dataset version changes though the verse count does not', async () => {
        await install('KJV', 'v1', [verse('John.11.35', 'Jesus wept.')]);
        const before = await getOrBuildIndex('KJV');
        await install('KJV', 'v2', [verse('John.11.35', 'Jesus cried.')]);
        const after = await getOrBuildIndex('KJV');

        expect(after).not.toBe(before);
        expect(after.search('wept')).toHaveLength(0);
        expect(after.search('cried')).toHaveLength(1);
        expect((await db.searchIndexes.get('minisearch:KJV'))?.key).toContain('v2:');
    });

    it('treats a record from before the key existed as stale and sweeps old palette copies', async () => {
        await install('KJV', 'v1', [verse('John.11.35', 'Jesus wept.')]);
        await db.searchIndexes.bulkPut([
            { id: 'minisearch:KJV', translationId: 'KJV', serializedIndex: '{}', verseCount: 1, createdAt: 0 },
            { id: 'palette:KJV', translationId: 'KJV', serializedIndex: '{}', verseCount: 1, createdAt: 0 },
        ] as never);

        const index = await getOrBuildIndex('KJV');
        expect(index.search('wept')).toHaveLength(1);
        expect((await db.searchIndexes.toArray()).map((r) => r.id)).toEqual(['minisearch:KJV']);
    });

    it('shares one load between concurrent callers and hands back the held index', async () => {
        await install('KJV', 'v1', [verse('John.11.35', 'Jesus wept.')]);
        const [a, b] = await Promise.all([getOrBuildIndex('KJV'), getOrBuildIndex('KJV')]);
        expect(a).toBe(b);
        expect(await getOrBuildIndex('KJV')).toBe(a);
    });

    it('releases a translation without touching the others', async () => {
        await install('KJV', 'v1', [verse('John.11.35', 'Jesus wept.')]);
        await install('WEB', 'v1', [verse('John.11.35', 'Jesus wept.', 'WEB')]);
        await Promise.all([getOrBuildIndex('KJV'), getOrBuildIndex('WEB')]);

        releaseIndex('KJV');
        expect(heldIndexes()).toEqual(['WEB']);
    });

    it('clears cached and held indexes together, so the next call builds again', async () => {
        await install('KJV', 'v1', [verse('John.11.35', 'Jesus wept.')]);
        const before = await getOrBuildIndex('KJV');
        await clearSearchIndexes();

        expect(heldIndexes()).toEqual([]);
        expect(await db.searchIndexes.count()).toBe(0);
        expect(await getOrBuildIndex('KJV')).not.toBe(before);
    });

    it('forgets a failed load so the next call retries', async () => {
        await install('KJV', 'v1', [verse('John.11.35', 'Jesus wept.')]);
        const where = vi.spyOn(db.verses, 'where').mockImplementationOnce(() => { throw new Error('boom'); });

        await expect(getOrBuildIndex('KJV')).rejects.toThrow('boom');
        expect(heldIndexes()).toEqual([]);
        expect((await getOrBuildIndex('KJV')).search('wept')).toHaveLength(1);
        where.mockRestore();
    });

    it('does not persist an index for a translation with no dataset receipt', async () => {
        await db.verses.bulkPut([verse('John.11.35', 'Jesus wept.')]);
        expect((await getOrBuildIndex('KJV')).search('wept')).toHaveLength(1);
        expect(await db.searchIndexes.count()).toBe(0);
    });
});
