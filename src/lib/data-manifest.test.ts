import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { DatasetManifest } from '@codex-scriptura/core';
import {
    fetchDatasetRecords,
    findDataset,
    getDataManifest,
    isDatasetManifest,
    resetDataManifest,
    translationCatalog,
} from './data-manifest';

const manifest: DatasetManifest = {
    format: 1,
    datasets: [
        {
            id: 'cross-references',
            version: 'abc',
            contentHash: 'abc'.padEnd(64, '0'),
            recordCount: 3,
            files: ['cross-references-part1.json', 'cross-references-part2.json'],
        },
        {
            id: 'translation:kjv',
            version: 'def',
            contentHash: 'def'.padEnd(64, '0'),
            recordCount: 1,
            files: ['kjv-verses.json'],
            books: { Gen: 1 },
            translation: { id: 'KJV', name: 'King James Version', abbreviation: 'KJV', language: 'en', license: 'Public Domain', description: '', strongs: true, aligned: true },
        },
    ],
};

function fakeFetch(files: Record<string, unknown>): typeof fetch {
    return vi.fn(async (input: string | URL | Request) => {
        const url = String(input);
        const name = url.slice(url.lastIndexOf('/') + 1);
        if (!(name in files)) return new Response('<!doctype html>', { status: 200, headers: { 'content-type': 'text/html' } });
        return new Response(JSON.stringify(files[name]), { status: 200 });
    }) as unknown as typeof fetch;
}

beforeEach(() => {
    resetDataManifest();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
});

describe('getDataManifest', () => {
    it('fetches once and caches', async () => {
        const f = fakeFetch({ 'manifest.json': manifest });
        expect(await getDataManifest(f)).toEqual(manifest);
        expect(await getDataManifest(f)).toEqual(manifest);
        expect(f).toHaveBeenCalledTimes(1);
    });

    it('is null when the host serves the SPA page instead of the manifest', async () => {
        expect(await getDataManifest(fakeFetch({}))).toBeNull();
    });

    it('rejects a manifest with an unexpected shape', async () => {
        expect(await getDataManifest(fakeFetch({ 'manifest.json': { format: 2, datasets: [] } }))).toBeNull();
        expect(isDatasetManifest({ format: 1, datasets: [{ id: 'x' }] })).toBe(false);
        expect(isDatasetManifest(manifest)).toBe(true);
    });
});

describe('fetchDatasetRecords', () => {
    it('concatenates split parts in manifest order', async () => {
        const f = fakeFetch({ 'cross-references-part1.json': [1, 2], 'cross-references-part2.json': [3] });
        expect(await fetchDatasetRecords(findDataset(manifest, 'cross-references')!, f)).toEqual([1, 2, 3]);
    });

    it('returns null rather than a truncated dataset when a part is missing', async () => {
        const f = fakeFetch({ 'cross-references-part1.json': [1, 2] });
        expect(await fetchDatasetRecords(findDataset(manifest, 'cross-references')!, f)).toBeNull();
    });

    it('warns but still returns records when the count disagrees with the manifest', async () => {
        const f = fakeFetch({ 'kjv-verses.json': [1, 2] });
        expect(await fetchDatasetRecords(findDataset(manifest, 'translation:kjv')!, f)).toEqual([1, 2]);
        expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('manifest says 1'));
    });
});

describe('translationCatalog', () => {
    it('lists translation entries with their dataset id', () => {
        expect(translationCatalog(manifest)).toEqual([
            expect.objectContaining({ id: 'KJV', datasetId: 'translation:kjv', strongs: true, aligned: true }),
        ]);
        expect(translationCatalog(null)).toEqual([]);
    });
});
