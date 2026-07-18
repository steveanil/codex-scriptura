/**
 * Downloads the OpenBible cross-references dataset.
 *
 * Source: https://www.openbible.info/labs/cross-references/
 * License: CC BY 4.0
 *
 * The dataset contains ~340,000 cross-references derived primarily from
 * the Treasury of Scripture Knowledge (public domain), supplemented with
 * community votes from OpenBible.info.
 *
 * Downloads to:
 *   data/texts/openbible/cross_references.txt
 *
 * If this script fails, download manually:
 *   curl -L -o data/texts/openbible/cross-references.zip \
 *     https://a.openbible.info/data/cross-references.zip
 *   unzip data/texts/openbible/cross-references.zip -d data/texts/openbible/
 *
 * Run from repo root:
 *   cd packages/data-pipeline && pnpm run fetch:crossrefs
 */

import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { dataDir } from './core/paths.js';

// a.openbible.info serves only the latest build - no commit pinning possible.
// The import-runs audit records when it was consumed.
const ZIP_URL = 'https://a.openbible.info/data/cross-references.zip';
const outDir = path.join(dataDir, 'texts', 'openbible');
const zipPath = path.join(outDir, 'cross-references.zip');
const txtPath = path.join(outDir, 'cross_references.txt');

/** Pass --force to re-download files that are already present. */
const FORCE = process.argv.includes('--force');

async function main(): Promise<void> {
    fs.mkdirSync(outDir, { recursive: true });

    // Skip if already extracted
    if (!FORCE && fs.existsSync(txtPath)) {
        const lines = fs.readFileSync(txtPath, 'utf-8').split('\n').length;
        console.log(`[fetch-crossrefs] Already present: cross_references.txt (${lines} lines) - skipping`);
        return;
    }

    // Download zip
    if (FORCE || !fs.existsSync(zipPath)) {
        console.log('[fetch-crossrefs] Downloading cross-references.zip ...');
        const res = await fetch(ZIP_URL);

        if (!res.ok) {
            throw new Error(
                `HTTP ${res.status} fetching ${ZIP_URL}\n` +
                `Download manually and place cross_references.txt in data/texts/openbible/`
            );
        }

        const buffer = Buffer.from(await res.arrayBuffer());
        fs.writeFileSync(zipPath, buffer);
        const kb = (buffer.length / 1024).toFixed(1);
        console.log(`[fetch-crossrefs] Saved: cross-references.zip (${kb} KB)`);
    }

    // Extract
    console.log('[fetch-crossrefs] Extracting ...');
    execSync(`unzip -o "${zipPath}" -d "${outDir}"`, { stdio: 'pipe' });

    if (!fs.existsSync(txtPath)) {
        throw new Error(
            `Expected cross_references.txt after extraction but file not found.\n` +
            `Check the zip contents and update the extraction path.`
        );
    }

    const lines = fs.readFileSync(txtPath, 'utf-8').split('\n').length;
    console.log(`[fetch-crossrefs] Extracted: cross_references.txt (${lines} lines)`);
    console.log('[fetch-crossrefs] Done.');
}

main();
