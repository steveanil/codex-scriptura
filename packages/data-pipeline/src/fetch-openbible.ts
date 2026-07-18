/**
 * Download OpenBible Bible Geocoding Data (ancient.jsonl) from GitHub.
 *
 * Output: data/texts/openbible/ancient.jsonl
 *
 * Source: https://github.com/openbibleinfo/Bible-Geocoding-Data
 * License: CC BY 4.0 (see data/texts/openbible/license.txt after download)
 *
 * Run from repo root:
 *   cd packages/data-pipeline && npx tsx src/fetch-openbible.ts
 */

import fs from 'node:fs';
import path from 'node:path';
import https from 'node:https';
import { dataDir } from './core/paths.js';

const outputDir = path.join(dataDir, 'texts', 'openbible');

// Pinned 2026-07-03 for reproducible fetches.
// Bump: gh api repos/openbibleinfo/Bible-Geocoding-Data/commits --jq '.[0].sha'
const GEOCODING_COMMIT = '7eb18a5ee62f27b9b93bd6689ea272d76dd23b8f';

/** Pass --force to re-download files that are already present. */
const FORCE = process.argv.includes('--force');

const FILES = [
    {
        url: `https://raw.githubusercontent.com/openbibleinfo/Bible-Geocoding-Data/${GEOCODING_COMMIT}/data/ancient.jsonl`,
        dest: 'ancient.jsonl',
    },
    {
        url: `https://raw.githubusercontent.com/openbibleinfo/Bible-Geocoding-Data/${GEOCODING_COMMIT}/license.txt`,
        dest: 'license.txt',
    },
];

function download(url: string, destPath: string): Promise<void> {
    return new Promise((resolve, reject) => {
        if (!FORCE && fs.existsSync(destPath)) {
            const kb = (fs.statSync(destPath).size / 1024).toFixed(0);
            console.log(`[fetch-openbible] Already exists: ${path.basename(destPath)} (${kb} KB) - skipping (--force to re-download)`);
            return resolve();
        }

        console.log(`[fetch-openbible] Downloading: ${path.basename(destPath)} ...`);
        const file = fs.createWriteStream(destPath);

        const request = (reqUrl: string) => {
            https.get(reqUrl, res => {
                if (res.statusCode === 301 || res.statusCode === 302) {
                    file.close();
                    request(res.headers.location!);
                    return;
                }
                if (res.statusCode !== 200) {
                    file.close();
                    fs.unlinkSync(destPath);
                    reject(new Error(`HTTP ${res.statusCode} for ${reqUrl}`));
                    return;
                }
                res.pipe(file);
                file.on('finish', () => {
                    file.close();
                    const kb = (fs.statSync(destPath).size / 1024).toFixed(0);
                    console.log(`[fetch-openbible] Saved: ${path.basename(destPath)} (${kb} KB)`);
                    resolve();
                });
            }).on('error', err => {
                file.close();
                if (fs.existsSync(destPath)) fs.unlinkSync(destPath);
                reject(err);
            });
        };

        request(url);
    });
}

async function run(): Promise<void> {
    fs.mkdirSync(outputDir, { recursive: true });
    for (const { url, dest } of FILES) {
        await download(url, path.join(outputDir, dest));
    }
    console.log('[fetch-openbible] Done.');
}

run().catch(err => {
    console.error('[fetch-openbible] ERROR:', err.message);
    process.exit(1);
});
