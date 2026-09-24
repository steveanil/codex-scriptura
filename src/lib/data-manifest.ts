/**
 * Client view of the deploy's dataset manifest (issue #311).
 *
 * The pipeline writes /data/manifest.json describing every dataset it
 * published: identity (id, version, content hash), record count, the files
 * to fetch, and for translations the catalog record. Seeding reads the
 * translation list and file layout from here instead of hard-coding them.
 */

import type { DatasetManifest, DatasetManifestEntry, ProvenanceSource, ResourceDescriptor, TranslationMeta } from '@codex-scriptura/core';
import { DATASET_MANIFEST_FORMAT, RESOURCE_TYPES } from '@codex-scriptura/core';

export const DATA_BASE_URL = '/data';
export const MANIFEST_FILE = 'manifest.json';

/** A translation as the manifest describes it, plus the dataset entry that holds its verses and the resource it belongs to. */
export type TranslationCatalogEntry = TranslationMeta & { datasetId: string; resourceId: string };

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

const SHA256_HEX = /^[0-9a-f]{64}$/;

const nonEmptyString = (v: unknown): v is string => typeof v === 'string' && v.length > 0;

/**
 * Boundary guard for the manifest. Identity is id + version + contentHash
 * (#310 stores exactly that as the installed identity), so an entry that
 * cannot carry a full identity is rejected rather than half-trusted.
 */
export function isDatasetManifestEntry(value: unknown): value is DatasetManifestEntry {
    const d = value as Partial<DatasetManifestEntry> | null;
    if (!d || typeof d !== 'object') return false;
    if (!nonEmptyString(d.id) || !nonEmptyString(d.version)) return false;
    if (typeof d.contentHash !== 'string' || !SHA256_HEX.test(d.contentHash)) return false;
    if (!Number.isInteger(d.recordCount) || (d.recordCount as number) < 0) return false;
    if (d.bytes !== undefined && (!Number.isInteger(d.bytes) || (d.bytes as number) < 0)) return false;
    if (!Array.isArray(d.files) || d.files.length === 0 || !d.files.every(nonEmptyString)) return false;
    if (d.translation !== undefined && !nonEmptyString((d.translation as Partial<TranslationMeta>)?.id)) return false;
    if (d.derivedFrom !== undefined && (!nonEmptyString(d.derivedFrom?.id) || typeof d.derivedFrom.contentHash !== 'string' || !SHA256_HEX.test(d.derivedFrom.contentHash))) return false;
    if (!nonEmptyString(d.resourceId)) return false;
    if (d.contentFormat !== undefined && !nonEmptyString(d.contentFormat)) return false;
    return true;
}

const isProvenanceSource = (value: unknown): value is ProvenanceSource => {
    const p = value as Partial<ProvenanceSource> | null;
    if (!p || typeof p !== 'object') return false;
    if (!nonEmptyString(p.sourceId) || !nonEmptyString(p.name) || !nonEmptyString(p.url) || !nonEmptyString(p.license)) return false;
    if (p.attribution !== undefined && !nonEmptyString(p.attribution)) return false;
    return p.licenseNotice === undefined || nonEmptyString(p.licenseNotice);
};

const isResourceType = (value: unknown): value is ResourceDescriptor['type'] =>
    typeof value === 'string' && (RESOURCE_TYPES as readonly string[]).includes(value);

/**
 * A descriptor is trusted only whole: the credits screen shows its license
 * and provenance as fact, so one without them is rejected rather than
 * displayed with blanks.
 */
export function isResourceDescriptor(value: unknown): value is ResourceDescriptor {
    const r = value as Partial<ResourceDescriptor> | null;
    if (!r || typeof r !== 'object') return false;
    if (!nonEmptyString(r.id) || !isResourceType(r.type) || !nonEmptyString(r.title) || !nonEmptyString(r.version)) return false;
    if (!r.license || typeof r.license !== 'object' || !nonEmptyString(r.license.spdx) || !nonEmptyString(r.license.name)) return false;
    if (!Array.isArray(r.provenance) || r.provenance.length === 0 || !r.provenance.every(isProvenanceSource)) return false;
    return true;
}

/** Format 2 (issue #51): descriptors present and complete, and every dataset's resource among them. */
export function isDatasetManifest(value: unknown): value is DatasetManifest {
    const m = value as Partial<DatasetManifest> | null;
    if (!m || typeof m !== 'object' || m.format !== DATASET_MANIFEST_FORMAT) return false;
    if (!Array.isArray(m.resources) || !m.resources.every(isResourceDescriptor)) return false;
    if (!Array.isArray(m.datasets) || !m.datasets.every(isDatasetManifestEntry)) return false;
    const resources = new Set(m.resources.map((r) => r.id));
    return m.datasets.every((d) => resources.has(d.resourceId));
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

/** A commentary dataset as the manifest describes it: its entry and the resource whose content it is. */
export type CommentaryCatalogEntry = { entry: DatasetManifestEntry; resource: ResourceDescriptor };

/** Every dataset whose resource is a commentary (issue #83), in manifest order. */
export function commentaryCatalog(manifest: DatasetManifest | null): CommentaryCatalogEntry[] {
    if (!manifest) return [];
    const resources = new Map(manifest.resources.map((r) => [r.id, r]));
    return manifest.datasets.flatMap((entry) => {
        const resource = resources.get(entry.resourceId);
        return resource?.type === 'commentary' ? [{ entry, resource }] : [];
    });
}

/** The translation catalog, in manifest order. Empty when there is no manifest. */
export function translationCatalog(manifest: DatasetManifest | null): TranslationCatalogEntry[] {
    if (!manifest) return [];
    return manifest.datasets.flatMap((d) => (d.translation ? [{ ...d.translation, datasetId: d.id, resourceId: d.resourceId }] : []));
}
