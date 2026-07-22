/**
 * Downloads the original-language texts used to derive Strong's tagging
 * for translations that have no tagged edition of their own (issue #134).
 *
 * Downloads to:
 *   data/texts/morphhb/<Book>.xml      - OpenScriptures Hebrew Bible (OT),
 *                                        OSIS with lemma markup, CC BY 4.0
 *   data/texts/morphhb/VerseMap.xml    - WLC <-> KJV versification mapping
 *   data/texts/byzantine/<NN_BOOK>.BP5 - Robinson-Pierpont Byzantine
 *                                        Majority Text (NT), Strong's-parsed,
 *                                        public domain
 *
 * Sources:
 *   https://github.com/openscriptures/morphhb
 *   https://github.com/byztxt/byzantine-majority-text
 *
 * Run from repo root:
 *   cd packages/data-pipeline && pnpm run fetch:originals
 */

import fs from 'node:fs';
import path from 'node:path';
import { dataDir } from './core/paths.js';
import { MORPHHB_BOOKS, BYZANTINE_FILES } from './importers/derive-strongs.js';

// Pinned 2026-07-22 for reproducible fetches.
// Bump: gh api repos/openscriptures/morphhb/commits --jq '.[0].sha'
const MORPHHB_COMMIT = '3d15126fb1ef74867fc1434be1942e837932691f';

// Bump: gh api repos/byztxt/byzantine-majority-text/commits --jq '.[0].sha'
const BYZTXT_COMMIT = '27a45ff1b7be6c17ccbfeac414f3f55732ae8e28';

const MORPHHB_RAW =
    `https://raw.githubusercontent.com/openscriptures/morphhb/${MORPHHB_COMMIT}/wlc`;
const BYZTXT_RAW =
    `https://raw.githubusercontent.com/byztxt/byzantine-majority-text/${BYZTXT_COMMIT}/source/Strongs`;

/** Pass --force to re-download files that are already present. */
const FORCE = process.argv.includes('--force');

/** Parallel downloads per batch - polite to raw.githubusercontent.com. */
const BATCH_SIZE = 8;

type FetchTask = { url: string; localPath: string; label: string };

async function fetchOne(task: FetchTask): Promise<boolean> {
    if (!FORCE && fs.existsSync(task.localPath)) return false;

    const res = await fetch(task.url);
    if (!res.ok) {
        throw new Error(
            `HTTP ${res.status} fetching ${task.url}\n` +
            `Download manually: curl -L -o ${task.localPath} ${task.url}`
        );
    }
    const text = await res.text();
    fs.writeFileSync(task.localPath, text, 'utf-8');
    return true;
}

async function fetchAll(tasks: FetchTask[]): Promise<void> {
    let downloaded = 0;
    let skipped = 0;
    for (let i = 0; i < tasks.length; i += BATCH_SIZE) {
        const batch = tasks.slice(i, i + BATCH_SIZE);
        const results = await Promise.all(batch.map(fetchOne));
        for (const fetched of results) {
            if (fetched) downloaded++;
            else skipped++;
        }
    }
    if (skipped > 0) {
        console.log(`[fetch-originals] ${skipped} file(s) already present, skipped (--force to re-download)`);
    }
    console.log(`[fetch-originals] Downloaded ${downloaded} file(s)`);
}

async function main(): Promise<void> {
    const morphhbDir = path.join(dataDir, 'texts', 'morphhb');
    const byzantineDir = path.join(dataDir, 'texts', 'byzantine');
    fs.mkdirSync(morphhbDir, { recursive: true });
    fs.mkdirSync(byzantineDir, { recursive: true });

    const tasks: FetchTask[] = [];

    for (const book of [...MORPHHB_BOOKS, 'VerseMap']) {
        tasks.push({
            url: `${MORPHHB_RAW}/${book}.xml`,
            localPath: path.join(morphhbDir, `${book}.xml`),
            label: `morphhb/${book}.xml`,
        });
    }
    for (const { file } of BYZANTINE_FILES) {
        tasks.push({
            url: `${BYZTXT_RAW}/${file}`,
            localPath: path.join(byzantineDir, file),
            label: `byzantine/${file}`,
        });
    }

    console.log(`[fetch-originals] Fetching ${tasks.length} files (OSHB morphhb + Byzantine Majority Text) ...`);
    await fetchAll(tasks);
}

main();
