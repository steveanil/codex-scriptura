import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach } from 'vitest';
import type { DatasetManifest, DatasetManifestEntry, ResourceDescriptor } from '@codex-scriptura/core';
import { db, getInstalledResourceIds, getResource, getResources, syncResourceCatalog } from './index.js';

const hash = (seed: string) => seed.padEnd(64, '0');
const entry = (id: string, resourceId: string): DatasetManifestEntry =>
    ({ id, version: 'v1', contentHash: hash('a'), recordCount: 1, files: [`${id}.json`], resourceId });
const resource = (id: string, version = 'r1'): ResourceDescriptor => ({
    id,
    type: 'translation',
    title: id.toUpperCase(),
    license: { spdx: 'public-domain', name: 'Public domain' },
    provenance: [{ sourceId: `${id}-text`, name: id, url: `https://example.org/${id}`, license: 'public-domain' }],
    version,
});

const manifest = (resources: ResourceDescriptor[], datasets: DatasetManifestEntry[]): DatasetManifest => ({ format: 2, resources, datasets });

beforeEach(async () => {
    await db.resources.clear();
    await db.datasets.clear();
});

describe('syncResourceCatalog (issue #51)', () => {
    it('writes every shipped descriptor and stamps receipts with their resource', async () => {
        // A receipt from before descriptors existed, and one already stamped
        await db.datasets.bulkPut([
            { id: 'translation:kjv', version: 'v1', contentHash: hash('a'), installedAt: 1, recordCount: 1 },
            { id: 'strongs-index:kjv', version: 'v1', contentHash: hash('b'), installedAt: 1, recordCount: 1, resourceId: 'kjv' },
        ]);
        await syncResourceCatalog(manifest([resource('kjv'), resource('web')], [entry('translation:kjv', 'kjv'), entry('strongs-index:kjv', 'kjv'), entry('translation:web', 'web')]));

        expect((await getResources()).map((r) => r.id).sort()).toEqual(['kjv', 'web']);
        expect((await db.datasets.get('translation:kjv'))?.resourceId).toBe('kjv');
        expect((await db.datasets.get('strongs-index:kjv'))?.resourceId).toBe('kjv');
        expect(await db.datasets.get('translation:web')).toBeUndefined();
    });

    it('reports installed resources from the receipts that name them', async () => {
        await db.datasets.bulkPut([
            { id: 'translation:kjv', version: 'v1', contentHash: hash('a'), installedAt: 1, recordCount: 1, resourceId: 'kjv' },
            { id: 'strongs-index:kjv', version: 'v1', contentHash: hash('b'), installedAt: 1, recordCount: 1, resourceId: 'kjv' },
            { id: 'persons', version: 'v1', contentHash: hash('c'), installedAt: 1, recordCount: 1 },
        ]);
        expect([...(await getInstalledResourceIds())]).toEqual(['kjv']);
    });

    it('replaces a descriptor whose version moved', async () => {
        await syncResourceCatalog(manifest([resource('kjv', 'r1')], [entry('translation:kjv', 'kjv')]));
        await syncResourceCatalog(manifest([resource('kjv', 'r2')], [entry('translation:kjv', 'kjv')]));
        expect((await getResource('kjv'))?.version).toBe('r2');
    });

    it('drops a descriptor the deploy no longer ships, unless its content is still installed', async () => {
        await db.datasets.put({ id: 'translation:web', version: 'v1', contentHash: hash('c'), installedAt: 1, recordCount: 1, resourceId: 'web' });
        await syncResourceCatalog(manifest([resource('kjv'), resource('web'), resource('oeb')], [entry('translation:kjv', 'kjv'), entry('translation:web', 'web'), entry('translation:oeb', 'oeb')]));
        expect((await getResources()).map((r) => r.id).sort()).toEqual(['kjv', 'oeb', 'web']);

        await syncResourceCatalog(manifest([resource('kjv')], [entry('translation:kjv', 'kjv')]));
        expect((await getResources()).map((r) => r.id).sort()).toEqual(['kjv', 'web']);
    });
});
