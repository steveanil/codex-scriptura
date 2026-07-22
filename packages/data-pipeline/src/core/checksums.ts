/**
 * SHA-256 verification for files fetched from unpinnable hosts (issue #30).
 *
 * Pinnable sources (GitHub/GitLab) are locked to commit SHAs in their fetch
 * scripts; eBible.org and a.openbible.info serve only the latest build, so
 * those downloads are verified against accepted checksums instead. A
 * mismatch is a report, never a silent update: the fetch fails loudly and
 * the checksum is only re-accepted deliberately, after reviewing what
 * changed upstream.
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import { SOURCE_CHECKSUMS, type AcceptedChecksum } from './source-checksums.js';

/**
 * Every file we consume from an unpinnable host, keyed by its path
 * relative to data/texts/. Single source of truth: the fetch scripts
 * verify these keys and update-source-checksums.ts regenerates them.
 */
export const UNPINNABLE_SOURCE_FILES = [
    'eng-web.usfx.xml',
    'eng-asv.usfx.xml',
    'eng-bsb.usfx.xml',
    'eng-ylt.usfx.xml',
    'eng-dby.usfx.xml',
    'openbible/cross_references.txt',
] as const;

/** Hex-encoded SHA-256 of a file's contents. */
export function sha256File(filePath: string): string {
    return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

/**
 * Verify a fetched (or already-present) file against its accepted checksum.
 * Throws with remediation guidance on any mismatch or missing entry.
 */
export function verifyChecksum(
    key: string,
    filePath: string,
    checksums: Record<string, AcceptedChecksum> = SOURCE_CHECKSUMS
): void {
    const entry = checksums[key];
    const actual = sha256File(filePath);

    if (!entry) {
        throw new Error(
            `[checksums] No accepted checksum for "${key}" (actual: ${actual}).\n` +
            `  Review the file, then accept it: cd packages/data-pipeline && pnpm run checksums:update`
        );
    }

    if (actual !== entry.sha256) {
        throw new Error(
            `[checksums] "${key}" does not match the checksum accepted on ${entry.accepted}.\n` +
            `  expected ${entry.sha256}\n` +
            `  actual   ${actual}\n` +
            `  The upstream host publishes new builds in place, so this usually means a new\n` +
            `  upstream release (or a corrupted local file - re-fetch with --force to rule\n` +
            `  that out). Diff the content, re-run import + validation + golden tests, then\n` +
            `  accept it: cd packages/data-pipeline && pnpm run checksums:update`
        );
    }
}
