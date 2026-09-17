/**
 * Client view of the deploy's dataset manifest (issue #311).
 *
 * The pipeline writes /data/manifest.json describing every dataset it
 * published: identity (id, version, content hash), record count, the files
 * to fetch, and for translations the catalog record. Seeding reads the
 * translation list and file layout from here instead of hard-coding them.
 */

import type { DatasetManifest, DatasetManifestEntry, TranslationMeta } from '@codex-scriptura/core';

export const DATA_BASE_URL = '/data';
export const MANIFEST_FILE = 'manifest.json';

/** A translation as the manifest describes it, plus the dataset entry that holds its verses. */
export type TranslationCatalogEntry = TranslationMeta & { datasetId: string };

/**
 * Fetch a JSON data asset, tolerating broken deployments.
 *
 * Returns null (with a console warning) when the file is missing, the fetch
 * fails, or the body isn't valid JSON. The parse check matters because SPA
 * hosts serve index.html with HTTP 200 for unknown paths - `res.ok` alone
 * cannot detect a missing data file there.
 */
export async function fetchJsonAsset<T>(file: string, fetchFn: typeof fetch = fetch): Promise<T | null> {
    try {
        const res = await fetchFn(`${DATA_BASE_URL}/${file}`);
        if (!res.ok) {
            console.warn(`[seed] Data file not found: ${file} (HTTP ${res.status}) - skipping`);
            return null;
        }
        const text = await res.text();
        try {
            return JSON.parse(text) as T;
        } catch {
            console.warn(`[seed] Data file ${file} is not valid JSON (SPA fallback page?) - skipping`);
            return null;
        }
    } catch (err) {
        console.warn(`[seed] Failed to fetch ${file}:`, err);
        return null;
    }
}

export function isDatasetManifest(value: unknown): value is DatasetManifest {
    const m = value as Partial<DatasetManifest> | null;
    return (
        !!m && m.format === 1 && Array.isArray(m.datasets) &&
        m.datasets.every((d) => typeof d?.id === 'string' && typeof d.version === 'string' && Array.isArray(d.files))
    );
}

let manifestPromise: Promise<DatasetManifest | null> | null = null;

/** The deploy's manifest, fetched once per boot. Null when the deployment is broken. */
export function getDataManifest(fetchFn: typeof fetch = fetch): Promise<DatasetManifest | null> {
    manifestPromise ??= fetchJsonAsset<unknown>(MANIFEST_FILE, fetchFn).then((m) => {
        if (m !== null && !isDatasetManifest(m)) {
            console.warn('[seed] manifest.json has an unexpected shape - ignoring it');
            return null;
        }
        return m;
    });
    return manifestPromise;
}

/** Forget the cached manifest so the next call fetches again (retry after a failed boot, tests). */
export function resetDataManifest(): void {
    manifestPromise = null;
}

export function findDataset(manifest: DatasetManifest | null, id: string): DatasetManifestEntry | undefined {
    return manifest?.datasets.find((d) => d.id === id);
}

/**
 * Fetch a dataset's records, concatenating its files in manifest order.
 * A missing file is a broken deployment: return null rather than a silently
 * truncated dataset. A record count that disagrees with the manifest is
 * only warned about - counts are a sanity check, not identity.
 */
export async function fetchDatasetRecords<T>(entry: DatasetManifestEntry, fetchFn: typeof fetch = fetch): Promise<T[] | null> {
    let records: T[] = [];
    for (const file of entry.files) {
        const part = await fetchJsonAsset<T[]>(file, fetchFn);
        if (!part) {
            console.warn(`[seed] ${file} missing (${entry.files.length} expected for ${entry.id}) - skipping dataset`);
            return null;
        }
        records = records.concat(part);
    }
    if (records.length !== entry.recordCount) {
        console.warn(`[seed] ${entry.id}: fetched ${records.length} records, manifest says ${entry.recordCount}`);
    }
    return records;
}

/** The translation catalog, in manifest order. Empty when there is no manifest. */
export function translationCatalog(manifest: DatasetManifest | null): TranslationCatalogEntry[] {
    if (!manifest) return [];
    return manifest.datasets.flatMap((d) => (d.translation ? [{ ...d.translation, datasetId: d.id }] : []));
}
