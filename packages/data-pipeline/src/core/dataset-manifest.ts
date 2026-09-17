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
import type { DatasetManifest, DatasetManifestEntry } from '@codex-scriptura/core';
import { sha256File } from './checksums.js';
import { DATASETS, type DatasetDefinition } from './dataset-registry.js';

export const MANIFEST_FILE = 'manifest.json';
export const MANIFEST_FORMAT = 1;

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

        entries.push({
            id: def.id,
            version: versionFromHash(contentHash),
            contentHash,
            recordCount: records.length,
            files,
            ...(def.translation ? { books: countByBook(records), translation: def.translation } : {}),
        });
    }

    entries.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    const manifest: DatasetManifest = { format: MANIFEST_FORMAT, datasets: entries };
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
 * entries, and every JSON file in the directory must belong to an entry.
 * Returns human-readable problems; empty means valid.
 */
export function validateManifest(manifest: DatasetManifest, destDir: string): string[] {
    const problems: string[] = [];
    const ids = new Set<string>();
    const claimed = new Map<string, string>();

    for (const entry of manifest.datasets) {
        if (ids.has(entry.id)) problems.push(`duplicate dataset id "${entry.id}"`);
        ids.add(entry.id);
        if (entry.files.length === 0) problems.push(`"${entry.id}" lists no files`);
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

    return problems;
}

export function readManifest(destDir: string): DatasetManifest | null {
    const file = path.join(destDir, MANIFEST_FILE);
    if (!fs.existsSync(file)) return null;
    return JSON.parse(fs.readFileSync(file, 'utf-8')) as DatasetManifest;
}
