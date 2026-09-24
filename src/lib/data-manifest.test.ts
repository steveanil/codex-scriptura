import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { DatasetManifest, ResourceDescriptor } from '@codex-scriptura/core';
import {
    findDataset,
    getDataManifest,
    isDatasetManifest,
    isDatasetManifestEntry,
    isResourceDescriptor,
    resetDataManifest,
    translationCatalog,
} from './data-manifest';

const resource = (id: string, type: ResourceDescriptor['type'], title: string): ResourceDescriptor => ({
    id,
    type,
    title,
    license: { spdx: 'public-domain', name: 'Public domain' },
    provenance: [{ sourceId: `${id}-source`, name: title, url: `https://example.org/${id}`, license: 'public-domain' }],
    version: 'r1',
});

const manifest: DatasetManifest = {
    format: 2,
    resources: [resource('cross-references', 'cross-references', 'Cross-references'), resource('kjv', 'translation', 'King James Version')],
    datasets: [
        {
            id: 'cross-references',
            version: 'abc',
            contentHash: 'abc'.padEnd(64, '0'),
            recordCount: 3,
            files: ['cross-references-part1.json', 'cross-references-part2.json'],
            resourceId: 'cross-references',
        },
        {
            id: 'translation:kjv',
            version: 'def',
            contentHash: 'def'.padEnd(64, '0'),
            recordCount: 1,
            files: ['kjv-verses.json'],
            books: { Gen: 1 },
            translation: { id: 'KJV', name: 'King James Version', abbreviation: 'KJV', language: 'en', license: 'Public domain', description: '', strongs: true, aligned: true },
            resourceId: 'kjv',
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
        expect(await getDataManifest(fakeFetch({ 'manifest.json': { format: 1, datasets: [] } }))).toBeNull();
        expect(isDatasetManifest({ format: 2, resources: [], datasets: [{ id: 'x' }] })).toBe(false);
        expect(isDatasetManifest({ format: 2, resources: [], datasets: 'nope' })).toBe(false);
        expect(isDatasetManifest({ format: 2, datasets: [] })).toBe(false);
        expect(isDatasetManifest(null)).toBe(false);
        expect(isDatasetManifest(manifest)).toBe(true);
    });

    it('rejects a manifest whose datasets name a resource it does not describe, or whose descriptor is incomplete (issue #51)', () => {
        expect(isDatasetManifest({ ...manifest, resources: [manifest.resources[0]] })).toBe(false);
        expect(isDatasetManifest({ ...manifest, resources: [...manifest.resources, { id: 'broken' }] })).toBe(false);
    });
});

describe('isResourceDescriptor', () => {
    const good = manifest.resources[1];

    it('accepts a complete descriptor', () => {
        expect(isResourceDescriptor(good)).toBe(true);
        expect(isResourceDescriptor({ ...good, author: 'x', publisher: 'y', description: 'z', language: 'en' })).toBe(true);
    });

    it('requires id, type, title, version, a license with spdx and name, and at least one full provenance source', () => {
        for (const key of ['id', 'type', 'title', 'version', 'license', 'provenance'] as const) {
            const copy: Record<string, unknown> = { ...good };
            delete copy[key];
            expect(isResourceDescriptor(copy), `missing ${key}`).toBe(false);
        }
        expect(isResourceDescriptor({ ...good, license: { spdx: 'public-domain' } })).toBe(false);
        expect(isResourceDescriptor({ ...good, license: 'Public domain' })).toBe(false);
        expect(isResourceDescriptor({ ...good, provenance: [] })).toBe(false);
        expect(isResourceDescriptor({ ...good, provenance: [{ sourceId: 'x', name: 'x', url: '' , license: 'public-domain' }] })).toBe(false);
        expect(isResourceDescriptor({ ...good, provenance: [{ sourceId: 'x', name: 'x', url: 'https://x' }] })).toBe(false);
    });
});

describe('isDatasetManifestEntry', () => {
    const good = manifest.datasets[0];
    const without = (key: string) => {
        const copy: Record<string, unknown> = { ...good };
        delete copy[key];
        return copy;
    };

    it('accepts a complete entry', () => {
        expect(isDatasetManifestEntry(good)).toBe(true);
        expect(isDatasetManifestEntry(manifest.datasets[1])).toBe(true);
    });

    it('requires every identity field', () => {
        for (const key of ['id', 'version', 'contentHash', 'recordCount', 'files', 'resourceId']) {
            expect(isDatasetManifestEntry(without(key)), `missing ${key}`).toBe(false);
        }
        expect(isDatasetManifestEntry({ ...good, id: '' })).toBe(false);
        expect(isDatasetManifestEntry({ ...good, version: '' })).toBe(false);
    });

    it('requires a 64-character SHA-256 hex hash', () => {
        expect(isDatasetManifestEntry({ ...good, contentHash: 'abc' })).toBe(false);
        expect(isDatasetManifestEntry({ ...good, contentHash: 'G'.repeat(64) })).toBe(false);
        expect(isDatasetManifestEntry({ ...good, contentHash: 'ABC'.padEnd(64, '0') })).toBe(false);
    });

    it('requires a non-negative integer record count', () => {
        expect(isDatasetManifestEntry({ ...good, recordCount: -1 })).toBe(false);
        expect(isDatasetManifestEntry({ ...good, recordCount: 1.5 })).toBe(false);
        expect(isDatasetManifestEntry({ ...good, recordCount: '3' })).toBe(false);
        expect(isDatasetManifestEntry({ ...good, recordCount: 0 })).toBe(true);
    });

    it('accepts an absent or non-negative integer byte count only', () => {
        expect(isDatasetManifestEntry({ ...good, bytes: 1024 })).toBe(true);
        expect(isDatasetManifestEntry({ ...good, bytes: -1 })).toBe(false);
        expect(isDatasetManifestEntry({ ...good, bytes: '1024' })).toBe(false);
    });

    it('requires a non-empty list of non-empty file names', () => {
        expect(isDatasetManifestEntry({ ...good, files: [] })).toBe(false);
        expect(isDatasetManifestEntry({ ...good, files: ['a.json', ''] })).toBe(false);
        expect(isDatasetManifestEntry({ ...good, files: [1] })).toBe(false);
    });

    it('requires a derivedFrom block, when present, to carry the source id and a full hash', () => {
        expect(isDatasetManifestEntry({ ...good, derivedFrom: { id: 'cross-references', contentHash: 'c'.repeat(64) } })).toBe(true);
        expect(isDatasetManifestEntry({ ...good, derivedFrom: { id: '', contentHash: 'c'.repeat(64) } })).toBe(false);
        expect(isDatasetManifestEntry({ ...good, derivedFrom: { id: 'cross-references', contentHash: 'short' } })).toBe(false);
    });

    it('requires a translation block, when present, to carry an id', () => {
        expect(isDatasetManifestEntry({ ...good, translation: {} })).toBe(false);
        expect(isDatasetManifestEntry({ ...good, translation: { id: 'KJV' } })).toBe(true);
    });
});

describe('translationCatalog', () => {
    it('lists translation entries with their dataset id', () => {
        expect(translationCatalog(manifest)).toEqual([
            expect.objectContaining({ id: 'KJV', datasetId: 'translation:kjv', resourceId: 'kjv', strongs: true, aligned: true }),
        ]);
        expect(translationCatalog(null)).toEqual([]);
    });
});
