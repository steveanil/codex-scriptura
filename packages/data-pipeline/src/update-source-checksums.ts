/**
 * Regenerates core/source-checksums.ts from the files currently in
 * data/texts/ (issue #30).
 *
 * Run this ONLY after deliberately accepting an upstream change: fetch the
 * new build, re-run the imports, validation, and golden tests, review the
 * diffs - then accept. Entries keep their original accepted date while the
 * hash is unchanged; files missing locally keep their previous entry.
 *
 * Run from repo root:
 *   cd packages/data-pipeline && pnpm run checksums:update
 */

import fs from 'node:fs';
import path from 'node:path';
import { dataDir } from './core/paths.js';
import { sha256File, UNPINNABLE_SOURCE_FILES } from './core/checksums.js';
import { SOURCE_CHECKSUMS, type AcceptedChecksum } from './core/source-checksums.js';

const OUTPUT = path.resolve(import.meta.dirname, 'core', 'source-checksums.ts');
const today = new Date().toISOString().slice(0, 10);

const entries: Array<[string, AcceptedChecksum]> = [];
for (const key of UNPINNABLE_SOURCE_FILES) {
    const filePath = path.join(dataDir, 'texts', key);
    const previous = SOURCE_CHECKSUMS[key];

    if (!fs.existsSync(filePath)) {
        if (previous) {
            console.warn(`[checksums:update] ${key}: not present locally - keeping entry accepted ${previous.accepted}`);
            entries.push([key, previous]);
        } else {
            console.warn(`[checksums:update] ${key}: not present locally and no previous entry - SKIPPED (fetch it first)`);
        }
        continue;
    }

    const sha256 = sha256File(filePath);
    if (previous?.sha256 === sha256) {
        console.log(`[checksums:update] ${key}: unchanged (accepted ${previous.accepted})`);
        entries.push([key, previous]);
    } else {
        console.log(`[checksums:update] ${key}: ${previous ? 'UPDATED' : 'added'} -> ${sha256}`);
        entries.push([key, { sha256, accepted: today }]);
    }
}

const body = entries
    .map(([key, e]) => `    '${key}': { sha256: '${e.sha256}', accepted: '${e.accepted}' },`)
    .join('\n');

fs.writeFileSync(
    OUTPUT,
    `/**
 * Accepted SHA-256 checksums for files fetched from UNPINNABLE hosts
 * (eBible.org, a.openbible.info - they serve only the latest build, so
 * commit pinning is impossible; issue #30). Fetch scripts refuse files
 * that do not match, making upstream changes a deliberate review step
 * instead of a silent update.
 *
 * GENERATED FILE - do not edit by hand. To accept a reviewed upstream
 * change: cd packages/data-pipeline && pnpm run checksums:update
 */

export type AcceptedChecksum = {
    /** Hex-encoded SHA-256 of the file contents. */
    sha256: string;
    /** Date (YYYY-MM-DD) the checksum was accepted after review. */
    accepted: string;
};

/** Keyed by path relative to data/texts/. */
export const SOURCE_CHECKSUMS: Record<string, AcceptedChecksum> = {
${body}
};
`,
    'utf-8'
);
console.log(`[checksums:update] Wrote ${entries.length} entries to ${OUTPUT}`);
