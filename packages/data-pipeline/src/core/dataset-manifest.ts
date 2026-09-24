/**
 * Publish processed datasets to static/data/ and describe them in
 * `manifest.json` (issue #311, decision D1/D6).
 *
 * Each dataset is hashed as one logical file before it is split into parts,
 * so the hash is stable whatever the part layout. The version is derived
 * from that hash: regenerating from identical inputs yields an identical
 * manifest. The client stores id + version + contentHash as the installed
 * identity without re-hashing anything in the browser.
 */

import fs from 'node:fs';
import path from 'node:path';
import type { DatasetManifest, DatasetManifestEntry, ResourceDescriptor } from '@codex-scriptura/core';
import { DATASET_MANIFEST_FORMAT } from '@codex-scriptura/core';
import { sha256File, sha256String } from './checksums.js';
import { DATASETS, type DatasetDefinition } from './dataset-registry.js';
import { RESOURCES, describeResource, type ResourceDefinition } from './resource-registry.js';

export const MANIFEST_FILE = 'manifest.json';
export const MANIFEST_FORMAT = DATASET_MANIFEST_FORMAT;

/**
 * Cloudflare Pages rejects any file over 25 MB, so JSON arrays above the
 * threshold are split into numbered parts. The split is byte-budgeted per
 * part, not fixed-count, so it adapts as a dataset grows.
 */
export const SPLIT_THRESHOLD = 20 * 1024 * 1024;
export const PART_BUDGET = 15 * 1024 * 1024;

export type PublishOptions = {
    srcDir: string;
    destDir: string;
    datasets?: DatasetDefinition[];
    resources?: ResourceDefinition[];
    splitThreshold?: number;
    partBudget?: number;
    log?: (line: string) => void;
};

export type PublishResult = {
    manifest: DatasetManifest;
    /** Registry ids whose processed file was absent (importer not run). */
    missing: string[];
};

export function versionFromHash(contentHash: string): string {
    return contentHash.slice(0, 12);
}

/**
 * Registered datasets whose processed file is absent from `srcDir`. The
 * production copy step refuses to publish while this is non-empty: a
 * partial static/data/ with an internally valid manifest would deploy green
 * while silently dropping whatever importer failed.
 */
export function missingDatasets(srcDir: string, datasets: DatasetDefinition[] = DATASETS): DatasetDefinition[] {
    return datasets.filter((def) => !fs.existsSync(path.join(srcDir, def.file)));
}

function splitRecords(records: unknown[], partBudget: number): unknown[][] {
    const parts: unknown[][] = [];
    let current: unknown[] = [];
    let currentBytes = 0;
    for (const record of records) {
        const recordBytes = Buffer.byteLength(JSON.stringify(record)) + 1;
        if (currentBytes + recordBytes > partBudget && current.length > 0) {
            parts.push(current);
            current = [];
            currentBytes = 0;
        }
        current.push(record);
        currentBytes += recordBytes;
    }
    if (current.length > 0) parts.push(current);
    return parts;
}

function countByBook(records: unknown[]): Record<string, number> {
    const books: Record<string, number> = {};
    for (const record of records) {
        const book = (record as { book?: unknown }).book;
        if (typeof book === 'string') books[book] = (books[book] ?? 0) + 1;
    }
    return books;
}

function mb(file: string): string {
    return (fs.statSync(file).size / 1024 / 1024).toFixed(1);
}

/**
 * A resource's version folds in the identity of every dataset published
 * under it (issue #51): a translation's version changes when its verses or
 * its postings change, and cross-references' when any aggregate does.
 * Deterministic, like the dataset versions it is built from.
 */
export function resourceVersion(entries: DatasetManifestEntry[]): string {
    const identities = entries.map((e) => `${e.id}:${e.version}`).sort();
    return versionFromHash(sha256String(identities.join('\n')));
}

/**
 * One descriptor per resource that owns at least one published entry, in
 * id order. A dataset whose resource is not registered is a registry bug
 * and throws; a resource with nothing published (its importer did not
 * run) is simply absent, like its datasets.
 */
export function describeResources(entries: DatasetManifestEntry[], resources: ResourceDefinition[] = RESOURCES): ResourceDescriptor[] {
    const byResource = new Map<string, DatasetManifestEntry[]>();
    for (const entry of entries) {
        const owned = byResource.get(entry.resourceId) ?? [];
        owned.push(entry);
        byResource.set(entry.resourceId, owned);
    }
    return [...byResource.entries()]
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([id, owned]) => {
            const def = resources.find((r) => r.id === id);
            if (!def) throw new Error(`[copy] ${owned.map((e) => e.id).join(', ')} belong to unregistered resource "${id}"`);
            return describeResource(def, resourceVersion(owned));
        });
}

/**
 * Copy every registered dataset into `destDir`, splitting oversized ones,
 * then write the manifest and remove any JSON file the manifest does not
 * vouch for (a dataset that crossed the split threshold in either
 * direction, or one dropped from the registry). Throws if the result fails
 * validation.
 */
export function publishDatasets(opts: PublishOptions): PublishResult {
    const {
        srcDir,
        destDir,
        datasets = DATASETS,
        resources = RESOURCES,
        splitThreshold = SPLIT_THRESHOLD,
        partBudget = PART_BUDGET,
        log = console.log,
    } = opts;

    fs.mkdirSync(destDir, { recursive: true });

    const entries: DatasetManifestEntry[] = [];
    const missing: string[] = [];
    const produced = new Set<string>();

    for (const def of datasets) {
        const src = path.join(srcDir, def.file);
        if (!fs.existsSync(src)) {
            missing.push(def.id);
            log(`[copy] Missing: ${src} - run the import scripts first`);
            continue;
        }

        const contentHash = sha256File(src);
        const records: unknown = JSON.parse(fs.readFileSync(src, 'utf-8'));
        if (!Array.isArray(records)) {
            throw new Error(`[copy] ${def.file} is not a JSON array - the manifest only describes record arrays`);
        }

        const files: string[] = [];
        if (fs.statSync(src).size > splitThreshold) {
            const base = def.file.replace(/\.json$/, '');
            splitRecords(records, partBudget).forEach((part, i) => {
                const partFile = `${base}-part${i + 1}.json`;
                fs.writeFileSync(path.join(destDir, partFile), JSON.stringify(part), 'utf-8');
                files.push(partFile);
                log(`[copy] ${def.file} → ${partFile} (${mb(path.join(destDir, partFile))} MB, ${part.length} records)`);
            });
        } else {
            fs.copyFileSync(src, path.join(destDir, def.file));
            files.push(def.file);
            log(`[copy] ${def.file} (${mb(src)} MB, ${records.length} records)`);
        }
        for (const f of files) produced.add(f);
        const bytes = files.reduce((sum, f) => sum + fs.statSync(path.join(destDir, f)).size, 0);

        // A derived dataset's identity includes its source's identity: the
        // version hashes both, so a source refresh invalidates it even when
        // the derived bytes are unchanged.
        let derivedFrom: DatasetManifestEntry['derivedFrom'];
        let version = versionFromHash(contentHash);
        if (def.derivedFrom) {
            const source = datasets.find((d) => d.id === def.derivedFrom);
            if (!source) throw new Error(`[copy] ${def.id} derives from unknown dataset ${def.derivedFrom}`);
            const sourceHash = sha256File(path.join(srcDir, source.file));
            derivedFrom = { id: source.id, contentHash: sourceHash };
            version = versionFromHash(sha256String(`${contentHash}:${sourceHash}`));
        }

        entries.push({
            id: def.id,
            version,
            contentHash,
            recordCount: records.length,
            bytes,
            files,
            ...(def.translation ? { books: countByBook(records), translation: def.translation } : {}),
            ...(derivedFrom ? { derivedFrom } : {}),
            resourceId: def.resource,
        });
    }

    entries.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    const manifest: DatasetManifest = { format: MANIFEST_FORMAT, resources: describeResources(entries, resources), datasets: entries };
    fs.writeFileSync(path.join(destDir, MANIFEST_FILE), JSON.stringify(manifest, null, 2) + '\n', 'utf-8');

    for (const f of fs.readdirSync(destDir)) {
        if (f.endsWith('.json') && f !== MANIFEST_FILE && !produced.has(f)) {
            fs.rmSync(path.join(destDir, f));
            log(`[copy] Removed stale ${f}`);
        }
    }

    const problems = validateManifest(manifest, destDir);
    if (problems.length > 0) {
        throw new Error(`[copy] Manifest validation failed:\n  ${problems.join('\n  ')}`);
    }

    return { manifest, missing };
}

/**
 * Every entry must resolve to files that exist, no file may belong to two
 * entries, every JSON file in the directory must belong to an entry, and
 * every entry and every resource must reference each other (a descriptor
 * with no content and content with no descriptor are both mistakes).
 * Returns human-readable problems; empty means valid.
 */
export function validateManifest(manifest: DatasetManifest, destDir: string): string[] {
    const problems: string[] = [];
    const ids = new Set<string>();
    const claimed = new Map<string, string>();
    const resources = new Set(manifest.resources.map((r) => r.id));
    const owned = new Set<string>();

    for (const entry of manifest.datasets) {
        if (ids.has(entry.id)) problems.push(`duplicate dataset id "${entry.id}"`);
        ids.add(entry.id);
        if (entry.files.length === 0) problems.push(`"${entry.id}" lists no files`);
        if (!resources.has(entry.resourceId)) problems.push(`"${entry.id}" belongs to resource "${entry.resourceId}", which the manifest does not describe`);
        owned.add(entry.resourceId);
        for (const file of entry.files) {
            const owner = claimed.get(file);
            if (owner) problems.push(`"${file}" belongs to both "${owner}" and "${entry.id}"`);
            claimed.set(file, entry.id);
            if (!fs.existsSync(path.join(destDir, file))) problems.push(`"${entry.id}" refers to missing file "${file}"`);
        }
    }

    for (const f of fs.readdirSync(destDir)) {
        if (f.endsWith('.json') && f !== MANIFEST_FILE && !claimed.has(f)) {
            problems.push(`"${f}" is not described by any manifest entry`);
        }
    }

    for (const resource of manifest.resources) {
        if (!owned.has(resource.id)) problems.push(`resource "${resource.id}" owns no dataset`);
        if (!resource.license?.spdx || !resource.license.name) problems.push(`resource "${resource.id}" has no license`);
        if (!resource.provenance?.length) problems.push(`resource "${resource.id}" has no provenance`);
    }

    return problems;
}

export function readManifest(destDir: string): DatasetManifest | null {
    const file = path.join(destDir, MANIFEST_FILE);
    if (!fs.existsSync(file)) return null;
    return JSON.parse(fs.readFileSync(file, 'utf-8')) as DatasetManifest;
}
