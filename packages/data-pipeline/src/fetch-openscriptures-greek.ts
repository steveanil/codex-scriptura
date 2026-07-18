/**
 * Downloads the Greek Strong's dictionary from OpenScriptures/strongs on GitHub.
 *
 * Downloads to:
 *   data/texts/openscriptures/strongs-greek-dictionary.js
 *
 * Source: https://github.com/openscriptures/strongs
 * License: Creative Commons Attribution-ShareAlike 3.0 Unported (CC BY-SA 3.0)
 *
 * Run from repo root:
 *   cd packages/data-pipeline && pnpm run fetch:greek-strongs
 */

import fs from 'node:fs';
import path from 'node:path';
import { dataDir } from './core/paths.js';

// Pinned 2026-07-03 for reproducible fetches.
// Bump: gh api repos/openscriptures/strongs/commits --jq '.[0].sha'
const STRONGS_COMMIT = '0acd2f251c2d35ff8db2dece4e0593979d3ac223';

const GITHUB_RAW =
    `https://raw.githubusercontent.com/openscriptures/strongs/${STRONGS_COMMIT}`;

/** Pass --force to re-download files that are already present. */
const FORCE = process.argv.includes('--force');

const FILE = {
    remote: 'greek/strongs-greek-dictionary.js',
    local: 'strongs-greek-dictionary.js',
};

const outDir = path.join(dataDir, 'texts', 'openscriptures');

async function main(): Promise<void> {
    fs.mkdirSync(outDir, { recursive: true });

    const localPath = path.join(outDir, FILE.local);

    if (!FORCE && fs.existsSync(localPath)) {
        console.log(`[fetch-greek-strongs] Already present, skipping: ${FILE.local} (--force to re-download)`);
        return;
    }

    const url = `${GITHUB_RAW}/${FILE.remote}`;
    console.log(`[fetch-greek-strongs] Downloading ${FILE.local} ...`);

    const res = await fetch(url);

    if (!res.ok) {
        throw new Error(
            `HTTP ${res.status} fetching ${url}\n` +
            `Download manually: curl -L -o ${localPath} ${url}`
        );
    }

    const text = await res.text();
    fs.writeFileSync(localPath, text, 'utf-8');
    const kb = (Buffer.byteLength(text, 'utf-8') / 1024).toFixed(1);
    console.log(`[fetch-greek-strongs] Saved: ${FILE.local} (${kb} KB)`);
}

main();
