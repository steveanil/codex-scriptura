import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach } from 'vitest';
import type { DatasetManifestEntry, RawCommentaryEntry } from '@codex-scriptura/core';
import { toCommentaryEntry } from '@codex-scriptura/core';
import { db, commentaryPlan, getCommentaryForChapter, installDatasetStream, removeCommentaryData, singlePart } from './index.js';

const hash = (seed: string) => seed.padEnd(64, '0');
const entry = (id: string, seed: string): DatasetManifestEntry =>
    ({ id, version: seed.padEnd(12, '0'), contentHash: hash(seed), recordCount: 1, files: [`${id}.json`], resourceId: id.replace('commentary:', ''), contentFormat: 'codex-commentary-markdown/1' });
const raw = (id: string, startRef: string, endRef: string): RawCommentaryEntry => ({ id, startRef, endRef, content: `On ${startRef}` });

async function install(resourceId: string, records: RawCommentaryEntry[], seed = 'a') {
    const e = entry(`commentary:${resourceId}`, seed);
    return installDatasetStream(e, commentaryPlan(resourceId), singlePart(records.map((r) => toCommentaryEntry(r, resourceId))), undefined, resourceId);
}

beforeEach(async () => {
    await db.commentaryEntries.clear();
    await db.datasets.clear();
});

describe('commentary (issue #83)', () => {
    it('returns every entry overlapping a chapter in canonical order, from the chapters index', async () => {
        await install('mh', [
            raw('mh-3', 'John.3.16', 'John.3.21'),
            raw('mh-1', 'John.2.23', 'John.3.2'),
            raw('mh-2', 'John.3.1', 'John.3.15'),
            raw('mh-4', 'John.4.1', 'John.4.4'),
            raw('mh-0', 'Gen.50.22', 'Exod.1.7'),
        ]);
        expect((await getCommentaryForChapter('John', 3)).map((e) => e.id)).toEqual(['mh-1', 'mh-2', 'mh-3']);
        expect((await getCommentaryForChapter('Exod', 1)).map((e) => e.id)).toEqual(['mh-0']);
        expect((await getCommentaryForChapter('John', 5))).toEqual([]);
    });

    it('keeps two commentaries on the same passage apart by resource', async () => {
        await install('mh', [raw('mh-3', 'John.3.16', 'John.3.16')], 'a');
        await install('calvin', [raw('calvin-3', 'John.3.16', 'John.3.17')], 'b');
        // Same start: the shorter range sorts first, whatever its resource
        expect((await getCommentaryForChapter('John', 3)).map((e) => `${e.resourceId}/${e.id}`)).toEqual(['mh/mh-3', 'calvin/calvin-3']);
        expect((await getCommentaryForChapter('John', 3, 'mh')).map((e) => e.id)).toEqual(['mh-3']);
        expect((await db.datasets.get('commentary:mh'))?.resourceId).toBe('mh');
    });

    it('two resources may use the same entry id for the same passage and both survive', async () => {
        await install('mh', [raw('john-3-16', 'John.3.16', 'John.3.16')], 'a');
        await install('calvin', [raw('john-3-16', 'John.3.16', 'John.3.16')], 'b');
        expect(await db.commentaryEntries.count()).toBe(2);
        expect((await getCommentaryForChapter('John', 3)).map((e) => `${e.resourceId}/${e.id}`)).toEqual(['calvin/john-3-16', 'mh/john-3-16']);
        expect((await getCommentaryForChapter('John', 3, 'calvin')).map((e) => e.content)).toEqual(['On John.3.16']);
        await removeCommentaryData('mh');
        expect((await getCommentaryForChapter('John', 3)).map((e) => e.resourceId)).toEqual(['calvin']);
    });

    it('replacing a resource clears only its own rows, and removal likewise', async () => {
        await install('mh', [raw('mh-a', 'John.3.1', 'John.3.1'), raw('mh-b', 'John.3.2', 'John.3.2')], 'a');
        await install('calvin', [raw('c-a', 'John.3.1', 'John.3.1')], 'b');
        await install('mh', [raw('mh-c', 'John.3.3', 'John.3.3')], 'c');
        expect((await getCommentaryForChapter('John', 3)).map((e) => e.id)).toEqual(['c-a', 'mh-c']);
        await removeCommentaryData('calvin');
        expect((await getCommentaryForChapter('John', 3)).map((e) => e.id)).toEqual(['mh-c']);
    });
});
