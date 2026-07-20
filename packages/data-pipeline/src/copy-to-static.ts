import fs from 'node:fs';
import path from 'node:path';
import { dataDir, staticDataDir } from './core/paths.js';

/**
 * Copies processed JSON files from data/processed/ → static/data/
 * so SvelteKit can serve them at /data/*.json for runtime seeding.
 *
 * Includes both Bible verse data and Theographic entity data.
 *
 * Run from repo root:
 *   cd packages/data-pipeline && npx tsx src/copy-to-static.ts
 */

const srcDir  = path.join(dataDir, 'processed');
const destDir = staticDataDir;

const FILES = [
    'persons.json',
    'places.json',
    'events.json',
    'dictionary.json',
    'cross-references.json',
    'genealogy.json',
    'lexicon-hebrew.json',
    'lexicon-greek.json',
    'kjv-verses.json',
    'oeb-verses.json',
    'web-verses.json',
    'asv-verses.json',
    'bsb-verses.json',
    'ylt-verses.json',
    'dby-verses.json',
];

/**
 * Cloudflare Pages rejects any file over 25 MB, so JSON arrays above the
 * threshold are split into numbered parts plus a tiny `<base>.parts.json`
 * manifest ({ parts: N }) that seed.ts reads to fetch them back in order.
 * The split is byte-budgeted per part, not fixed-count, so it adapts as
 * the dataset grows.
 */
const SPLIT_THRESHOLD = 20 * 1024 * 1024;
const PART_BUDGET     = 15 * 1024 * 1024;

/** Remove stale outputs from a previous copy that used the other layout. */
function removeStale(base: string, staleLayout: 'parts' | 'monolith'): void {
    const isStale = (f: string) =>
        staleLayout === 'parts'
            ? f === `${base}.parts.json` || new RegExp(`^${base}-part\\d+\\.json$`).test(f)
            : f === `${base}.json`;
    for (const f of fs.readdirSync(destDir).filter(isStale)) {
        fs.rmSync(path.join(destDir, f));
    }
}

function splitCopy(file: string, src: string): void {
    const base = file.replace(/\.json$/, '');
    const records: unknown[] = JSON.parse(fs.readFileSync(src, 'utf-8'));

    const parts: unknown[][] = [];
    let current: unknown[] = [];
    let currentBytes = 0;
    for (const record of records) {
        const recordBytes = Buffer.byteLength(JSON.stringify(record)) + 1;
        if (currentBytes + recordBytes > PART_BUDGET && current.length > 0) {
            parts.push(current);
            current = [];
            currentBytes = 0;
        }
        current.push(record);
        currentBytes += recordBytes;
    }
    if (current.length > 0) parts.push(current);

    removeStale(base, 'monolith');
    parts.forEach((part, i) => {
        const partFile = `${base}-part${i + 1}.json`;
        fs.writeFileSync(path.join(destDir, partFile), JSON.stringify(part), 'utf-8');
        const mb = (fs.statSync(path.join(destDir, partFile)).size / 1024 / 1024).toFixed(1);
        console.log(`[copy] ${file} → static/data/${partFile} (${mb} MB, ${part.length} records)`);
    });
    fs.writeFileSync(path.join(destDir, `${base}.parts.json`), JSON.stringify({ parts: parts.length }), 'utf-8');
    console.log(`[copy] ${file} → static/data/${base}.parts.json (manifest, ${parts.length} parts)`);
}

fs.mkdirSync(destDir, { recursive: true });

let copied = 0;
for (const file of FILES) {
    const src  = path.join(srcDir, file);
    const dest = path.join(destDir, file);

    if (!fs.existsSync(src)) {
        console.warn(`[copy] Missing: ${src} - run the import scripts first`);
        continue;
    }

    if (fs.statSync(src).size > SPLIT_THRESHOLD) {
        splitCopy(file, src);
        copied++;
        continue;
    }

    removeStale(file.replace(/\.json$/, ''), 'parts');
    fs.copyFileSync(src, dest);
    const kb = (fs.statSync(dest).size / 1024).toFixed(1);
    console.log(`[copy] ${file} → static/data/ (${kb} KB)`);
    copied++;
}

if (copied === 0) {
    console.error('[copy] No files copied. Run the import scripts first.');
    process.exit(1);
}

console.log(`[copy] Done - ${copied}/${FILES.length} files ready in static/data/.`);
