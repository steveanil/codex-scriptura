/**
 * Downloads two typed cross-reference overlay datasets:
 *
 * 1. OT-NT-Reference-Map (balinjdl) — BSD-2-Clause
 *    ~980 OT-in-NT links with type: quotation / allusion / possible allusion
 *    Chapter-level granularity (NT chapter → OT chapter)
 *    https://github.com/balinjdl/OT-NT-Reference-Map
 *
 * 2. UBS Parallel Passages — CC BY-SA 4.0
 *    ~2,193 parallel passage groups with verse-level precision
 *    HEB/GRK attributes distinguish OT vs NT passages
 *    https://github.com/ubsicap/ubs-open-license
 *
 * These datasets are used as "type overlays" during cross-reference import
 * to upgrade unclassified edges with authoritative type labels.
 *
 * Downloads to:
 *   data/texts/typed-crossrefs/otnt-reference-map.js
 *   data/texts/typed-crossrefs/ParallelPassages.xml
 *
 * Run from repo root:
 *   cd packages/data-pipeline && pnpm run fetch:typed-crossrefs
 */

import fs from 'node:fs';
import path from 'node:path';
import { dataDir } from './core/paths.js';

const OTNT_URL =
    'https://raw.githubusercontent.com/balinjdl/OT-NT-Reference-Map/master/js/otnt.js';
const UBS_URL =
    'https://raw.githubusercontent.com/ubsicap/ubs-open-license/master/parallel%20passages/ParallelPassages.xml';

const outDir = path.join(dataDir, 'texts', 'typed-crossrefs');
const otntPath = path.join(outDir, 'otnt-reference-map.js');
const ubsPath = path.join(outDir, 'ParallelPassages.xml');

async function download(url: string, dest: string, label: string): Promise<void> {
    if (fs.existsSync(dest)) {
        const size = (fs.statSync(dest).size / 1024).toFixed(1);
        console.log(`[fetch-typed] Already present: ${label} (${size} KB) — skipping`);
        return;
    }

    console.log(`[fetch-typed] Downloading ${label} ...`);
    const res = await fetch(url);
    if (!res.ok) {
        throw new Error(
            `HTTP ${res.status} fetching ${url}\n` +
            `Download manually and place in data/texts/typed-crossrefs/`,
        );
    }

    const text = await res.text();
    fs.writeFileSync(dest, text, 'utf-8');
    const size = (Buffer.byteLength(text) / 1024).toFixed(1);
    console.log(`[fetch-typed] Saved: ${label} (${size} KB)`);
}

async function main(): Promise<void> {
    fs.mkdirSync(outDir, { recursive: true });

    await download(OTNT_URL, otntPath, 'otnt-reference-map.js');
    await download(UBS_URL, ubsPath, 'ParallelPassages.xml');

    console.log('[fetch-typed] Done.');
}

main();
