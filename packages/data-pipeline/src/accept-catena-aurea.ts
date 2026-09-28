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
import { verify, STRUCTURAL_KINDS, IDENTITY_KINDS } from './verify-catena-oracle.js';

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
export function unresolved<T extends { id: string; kind: string }>(findings: T[], reviewed: ReviewedDiscrepancy[]): T[] {
    const allowed = new Set(reviewed.map((d) => `${d.kind}:${d.id}`));
    return findings.filter((f) => !allowed.has(`${f.kind}:${f.id}`));
}

/**
 * The gate is sequential: structure first (a text corrected against the
 * wrong oracle excerpt is wasted work), then identity (who said what, and
 * where it is from), then text, where only differences in words remain
 * open; a difference the canonicalisation shows to be mechanical is
 * accepted as OCR-grade without a page check.
 */
export function tiers(open: Array<{ id: string; kind: string; review?: string }>): { structural: number; identity: number; lexical: number; blocking: string | null } {
    const structural = open.filter((f) => STRUCTURAL_KINDS.includes(f.kind)).length;
    const identity = open.filter((f) => IDENTITY_KINDS.includes(f.kind)).length;
    const lexical = open.filter((f) => f.kind === 'text' && f.review !== 'benign-ocr').length;
    return { structural, identity, lexical, blocking: structural ? 'structural' : identity ? 'identity' : lexical ? 'text' : null };
}

if (process.argv[1] && process.argv[1].endsWith('accept-catena-aurea.ts')) {
    const { entries, review } = importCatena();
    const { findings, summary } = verify(entries, path.join(dataDir, 'texts', 'catena', 'oracle'), review);
    const open = unresolved(findings, loadDiscrepancies());
    const t = tiers(open);
    console.log('[accept:catena]', JSON.stringify({ ...summary, reviewed: findings.length - open.length, unresolved: open.length, ...t }));
    if (t.blocking) {
        const shown = open.filter((f) => (t.blocking === 'structural' ? STRUCTURAL_KINDS.includes(f.kind) : t.blocking === 'identity' ? IDENTITY_KINDS.includes(f.kind) : f.kind === 'text' && f.review !== 'benign-ocr'));
        for (const f of shown.slice(0, 20)) console.log(`  ${f.kind.padEnd(16)} ${f.id}`);
        if (shown.length > 20) console.log(`  ... ${shown.length - 20} more`);
        console.error(`[accept:catena] Corpus not accepted at the ${t.blocking} tier: resolve these against the page images (corrections) or record reviewed discrepancies.`);
        process.exit(1);
    }
    console.log('[accept:catena] Corpus accepted.');
}
