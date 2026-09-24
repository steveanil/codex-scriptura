import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { DatasetManifestEntry } from '@codex-scriptura/core';
import { manifestSource, mapParts, hasShape, DatasetPartError } from './dataset-stream';

const entry: DatasetManifestEntry = {
    id: 'cross-references',
    version: 'abc',
    contentHash: 'abc'.padEnd(64, '0'),
    recordCount: 3,
    files: ['cross-references-part1.json', 'cross-references-part2.json'],
    resourceId: 'cross-references',
};

function fakeFetch(files: Record<string, unknown>, log: string[] = []): typeof fetch {
    return vi.fn(async (input: string | URL | Request) => {
        const url = String(input);
        const name = url.slice(url.lastIndexOf('/') + 1);
        log.push(name);
        if (!(name in files)) return new Response('<!doctype html>', { status: 200, headers: { 'content-type': 'text/html' } });
        return new Response(JSON.stringify(files[name]), { status: 200 });
    }) as unknown as typeof fetch;
}

async function collect<T>(parts: AsyncIterable<T>): Promise<T[]> {
    const out: T[] = [];
    for await (const p of parts) out.push(p);
    return out;
}

beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
});

describe('manifestSource', () => {
    it('yields parts in manifest order with their position, never concatenating', async () => {
        const f = fakeFetch({ 'cross-references-part1.json': [1, 2], 'cross-references-part2.json': [3] });
        const parts = await collect(manifestSource<number>(entry, { fetchFn: f }));
        expect(parts).toEqual([
            { records: [1, 2], index: 0, count: 2 },
            { records: [3], index: 1, count: 2 },
        ]);
    });

    it('prefetches the next part while the current one is being consumed', async () => {
        const log: string[] = [];
        const f = fakeFetch({ 'cross-references-part1.json': [1, 2], 'cross-references-part2.json': [3] }, log);
        const gen = manifestSource<number>(entry, { fetchFn: f });
        await gen.next();
        expect(log).toEqual(['cross-references-part1.json', 'cross-references-part2.json']);
    });

    it('throws rather than yielding a truncated dataset when a part is missing', async () => {
        const f = fakeFetch({ 'cross-references-part1.json': [1, 2] });
        const gen = manifestSource<number>(entry, { fetchFn: f });
        await expect(gen.next()).resolves.toMatchObject({ value: { index: 0 } });
        await expect(gen.next()).rejects.toBeInstanceOf(DatasetPartError);
    });

    it('throws when a part is not a record array', async () => {
        const f = fakeFetch({ 'cross-references-part1.json': { not: 'array' }, 'cross-references-part2.json': [3] });
        await expect(collect(manifestSource(entry, { fetchFn: f }))).rejects.toThrow(/not a record array/);
    });

    it('spot-checks the shape of each part\'s first record', async () => {
        const f = fakeFetch({ 'cross-references-part1.json': [{ id: 'a', sourceVerse: 'x', targetVerse: 'y' }], 'cross-references-part2.json': [{ id: 'b' }] });
        const gen = manifestSource(entry, { fetchFn: f, shape: ['id', 'sourceVerse', 'targetVerse'] });
        await gen.next();
        await expect(gen.next()).rejects.toThrow(/lack the expected keys/);
    });

    it('warns but completes when the total disagrees with the manifest count', async () => {
        const f = fakeFetch({ 'cross-references-part1.json': [1], 'cross-references-part2.json': [3] });
        await collect(manifestSource(entry, { fetchFn: f }));
        expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('manifest says 3'));
    });

    it('yields nothing for an entry with no files', async () => {
        expect(await collect(manifestSource({ ...entry, files: [], recordCount: 0 }, { fetchFn: fakeFetch({}) }))).toEqual([]);
    });
});

describe('mapParts', () => {
    it('transforms records and keeps part positions', async () => {
        const f = fakeFetch({ 'cross-references-part1.json': [1, 2], 'cross-references-part2.json': [3] });
        const mapped = await collect(mapParts(manifestSource<number>(entry, { fetchFn: f }), (n) => n * 10));
        expect(mapped).toEqual([
            { records: [10, 20], index: 0, count: 2 },
            { records: [30], index: 1, count: 2 },
        ]);
    });
});

describe('hasShape', () => {
    it('requires an object carrying every key', () => {
        expect(hasShape({ id: 1, name: 'x' }, ['id', 'name'])).toBe(true);
        expect(hasShape({ id: 1 }, ['id', 'name'])).toBe(false);
        expect(hasShape('nope', ['id'])).toBe(false);
        expect(hasShape(null, [])).toBe(false);
    });
});
