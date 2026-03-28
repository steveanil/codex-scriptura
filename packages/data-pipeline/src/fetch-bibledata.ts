/**
 * Downloads BibleData CSVs from GitHub (BradyStephenson/bible-data).
 *
 * Downloads to:
 *   data/texts/bibledata/BibleData-Person.csv
 *   data/texts/bibledata/BibleData-PersonLabel.csv
 *
 * If this script fails (network error, 404), download manually:
 *   curl -L -o data/texts/bibledata/BibleData-Person.csv \
 *     https://raw.githubusercontent.com/BradyStephenson/bible-data/master/BibleData-Person.csv
 *   curl -L -o data/texts/bibledata/BibleData-PersonLabel.csv \
 *     https://raw.githubusercontent.com/BradyStephenson/bible-data/master/BibleData-PersonLabel.csv
 *
 * Run from repo root:
 *   cd packages/data-pipeline && pnpm run fetch:bibledata
 */

import fs from 'node:fs';
import path from 'node:path';

const GITHUB_RAW =
    'https://raw.githubusercontent.com/BradyStephenson/bible-data/master';

const FILES: Array<{ remote: string; local: string }> = [
    { remote: 'BibleData-Person.csv',      local: 'BibleData-Person.csv'      },
    { remote: 'BibleData-PersonLabel.csv', local: 'BibleData-PersonLabel.csv' },
];

const outDir = path.resolve(process.cwd(), '../../data/texts/bibledata');

async function download(remote: string, localPath: string): Promise<void> {
    if (fs.existsSync(localPath)) {
        console.log(`[fetch-bibledata] Already present, skipping: ${path.basename(localPath)}`);
        return;
    }

    const url = `${GITHUB_RAW}/${remote}`;
    console.log(`[fetch-bibledata] Downloading ${path.basename(localPath)} ...`);

    const res = await fetch(url);

    if (!res.ok) {
        throw new Error(
            `HTTP ${res.status} fetching ${url}\n` +
            `If the file path has changed, edit GITHUB_RAW / FILES in fetch-bibledata.ts\n` +
            `or download the CSV files manually into data/texts/bibledata/.`
        );
    }

    const text = await res.text();
    fs.writeFileSync(localPath, text, 'utf-8');
    const kb = (Buffer.byteLength(text, 'utf-8') / 1024).toFixed(1);
    console.log(`[fetch-bibledata] Saved: ${path.basename(localPath)} (${kb} KB)`);
}

async function main(): Promise<void> {
    fs.mkdirSync(outDir, { recursive: true });
    console.log(`[fetch-bibledata] Output dir: ${outDir}`);

    const errors: string[] = [];

    for (const { remote, local } of FILES) {
        try {
            await download(remote, path.join(outDir, local));
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            console.error(`[fetch-bibledata] FAILED: ${local}\n  ${msg}`);
            errors.push(local);
        }
    }

    if (errors.length > 0) {
        console.error(`\n[fetch-bibledata] ${errors.length} file(s) failed: ${errors.join(', ')}`);
        console.error('[fetch-bibledata] Place them manually in data/texts/bibledata/ and re-run enrich:persons');
        process.exit(1);
    }

    console.log('[fetch-bibledata] Done.');
}

main();
