/**
 * Corpus acceptance gate for the Catena Aurea (issue #85), separate from
 * the diagnostic oracle command. The oracle keeps producing findings as
 * the correction workflow; this gate decides whether the corpus may be
 * registered as a resource:
 *
 *   fetch (checksums) -> parse -> corrections -> entry validation ->
 *   unique ids -> traceable locators -> oracle comparison ->
 *   zero unresolved findings, except reviewed discrepancies
 *
 * A reviewed discrepancy is a finding a person examined against the page
 * image and decided is not an OCR error: typically editorial material the
 * transcription carries that the 1841 page does not. It is recorded in
 * corrections/catena-aurea.discrepancies.json with a note and the date,
 * never resolved by bending the scan-derived text towards the oracle.
 *
 *   pnpm run accept:catena
 */

import fs from 'node:fs';
import path from 'node:path';
import { dataDir } from './core/paths.js';
import { importCatena } from './import-catena-aurea.js';
import { verify } from './verify-catena-oracle.js';

export type ReviewedDiscrepancy = {
    /** The finding's id, e.g. "catena-matt-3-5-6#3". */
    id: string;
    kind: string;
    /** Why the scan text stands, in a few words. */
    note: string;
    /** YYYY-MM-DD. */
    reviewed: string;
};

export const DISCREPANCIES_FILE = path.resolve(import.meta.dirname, '..', 'corrections', 'catena-aurea.discrepancies.json');

export function loadDiscrepancies(file: string = DISCREPANCIES_FILE): ReviewedDiscrepancy[] {
    if (!fs.existsSync(file)) return [];
    return JSON.parse(fs.readFileSync(file, 'utf-8')) as ReviewedDiscrepancy[];
}

/** Findings the review has not resolved: everything the allowlist does not name by id and kind. */
export function unresolved(findings: Array<{ id: string; kind: string }>, reviewed: ReviewedDiscrepancy[]): Array<{ id: string; kind: string }> {
    const allowed = new Set(reviewed.map((d) => `${d.kind}:${d.id}`));
    return findings.filter((f) => !allowed.has(`${f.kind}:${f.id}`));
}

if (process.argv[1] && process.argv[1].endsWith('accept-catena-aurea.ts')) {
    const { entries } = importCatena();
    const { findings, summary } = verify(entries, path.join(dataDir, 'texts', 'catena', 'oracle'));
    const open = unresolved(findings, loadDiscrepancies());
    console.log('[accept:catena]', JSON.stringify({ ...summary, reviewed: findings.length - open.length, unresolved: open.length }));
    if (open.length > 0) {
        for (const f of open.slice(0, 20)) console.log(`  ${f.kind.padEnd(16)} ${f.id}`);
        if (open.length > 20) console.log(`  ... ${open.length - 20} more`);
        console.error('[accept:catena] Corpus not accepted: resolve the findings against the page images (corrections) or record reviewed discrepancies.');
        process.exit(1);
    }
    console.log('[accept:catena] Corpus accepted.');
}
