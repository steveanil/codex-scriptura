/**
 * Resource descriptors (issue #51, decision D2).
 *
 * One `resources` row per resource the deploy catalogues: what it is,
 * where it came from, under which license, at which version. Content
 * lives in the per-type tables; whether a resource is installed is read
 * from the `datasets` receipts that carry its id.
 */

import type { DatasetManifest, ResourceDescriptor } from '@codex-scriptura/core';
import { db } from './database.js';

/**
 * Bring the catalog in line with the deploy's manifest: every descriptor
 * it ships is written, and a descriptor it no longer ships is dropped
 * unless a receipt still names it (the content is still on the device, so
 * its license and provenance must stay readable). Receipts written before
 * descriptors existed, or under a dataset that moved between resources,
 * are stamped with the resource the manifest now assigns them, so
 * installed-ness can be answered offline from the receipts alone.
 */
export async function syncResourceCatalog(manifest: DatasetManifest): Promise<void> {
    await db.transaction('rw', [db.resources, db.datasets], async () => {
        const receipts = await db.datasets.toArray();
        const receiptOf = new Map(receipts.map((r) => [r.id, r]));
        for (const entry of manifest.datasets) {
            const receipt = receiptOf.get(entry.id);
            if (receipt && receipt.resourceId !== entry.resourceId) {
                await db.datasets.update(entry.id, { resourceId: entry.resourceId });
                receipt.resourceId = entry.resourceId;
            }
        }

        const shipped = new Set(manifest.resources.map((r) => r.id));
        const stillInstalled = new Set(receipts.flatMap((r) => (r.resourceId ? [r.resourceId] : [])));
        const stale = (await db.resources.toCollection().primaryKeys()).filter((id) => !shipped.has(id) && !stillInstalled.has(id));
        if (stale.length > 0) await db.resources.bulkDelete(stale);
        await db.resources.bulkPut(manifest.resources);
    });
}

export async function getResources(): Promise<ResourceDescriptor[]> {
    return db.resources.toArray();
}

export async function getResource(id: string): Promise<ResourceDescriptor | undefined> {
    return db.resources.get(id);
}

/** Resources with at least one installed dataset, read from the receipts so it works offline. */
export async function getInstalledResourceIds(): Promise<Set<string>> {
    const receipts = await db.datasets.toArray();
    return new Set(receipts.flatMap((r) => (r.resourceId ? [r.resourceId] : [])));
}
