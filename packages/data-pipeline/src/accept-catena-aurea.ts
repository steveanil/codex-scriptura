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
import { importCatena, verseCountsFor, type Gospel } from './import-catena-aurea.js';
import { verify, findingFingerprint, STRUCTURAL_KINDS, IDENTITY_KINDS } from './verify-catena-oracle.js';
import type { RawCommentaryEntry } from '@codex-scriptura/core';

export type ReviewedDiscrepancy = {
    /** The finding's id, e.g. "catena-matt-3-5-6#3". */
    id: string;
    kind: string;
    /** findingFingerprint() of the finding as reviewed: the review covers that disagreement and no other. */
    findingFingerprint: string;
    /** The scan leaf whose image was read to decide it. */
    item?: string;
    leaf?: number;
    /** Why the scan text stands, in a few words. */
    note: string;
    /** YYYY-MM-DD. */
    reviewed: string;
};

/**
 * A verse the corpus does not cover because the edition's own numbering
 * differs from the canonical one on that page, recorded with the leaf that
 * shows it. A gap without such a record fails the completeness gate.
 */
export type VersificationNote = { gospel: string; chapter: number; verses: number[]; leaf: number; item: string; note: string };

export const VERSIFICATION_FILE = path.resolve(import.meta.dirname, '..', 'corrections', 'catena-aurea.versification.json');

export function loadVersificationNotes(file: string = VERSIFICATION_FILE): VersificationNote[] {
    if (!fs.existsSync(file)) return [];
    return JSON.parse(fs.readFileSync(file, 'utf-8')) as VersificationNote[];
}

const GOSPEL_CHAPTERS: Record<string, number> = { Matt: 28, Mark: 16, Luke: 24, John: 21 };

/**
 * Completeness proven from the scans themselves, not from the transcription:
 * every chapter of the four Gospels has entries, and every canonical verse no
 * entry covers (after corrections) is explained by a versification note.
 */
export function completenessProblems(entries: RawCommentaryEntry[], notes: VersificationNote[], verseCounts: (gospel: Gospel) => Record<number, number> = verseCountsFor): string[] {
    const problems: string[] = [];
    const covered = new Map<string, Set<number>>();
    for (const e of entries) {
        const [book, ch, from] = e.startRef.split('.');
        const to = Number(e.endRef.split('.')[2]);
        const key = `${book}.${ch}`;
        if (!covered.has(key)) covered.set(key, new Set());
        for (let v = Number(from); v <= to; v++) covered.get(key)!.add(v);
    }
    const explained = new Set(notes.flatMap((n) => n.verses.map((v) => `${n.gospel}.${n.chapter}.${v}`)));
    for (const [gospel, count] of Object.entries(GOSPEL_CHAPTERS)) {
        const missing = Array.from({ length: count }, (_, i) => i + 1).filter((c) => !covered.has(`${gospel}.${c}`));
        if (missing.length) problems.push(`${gospel}: no entries for chapter(s) ${missing.join(', ')}`);
        const counts = verseCounts(gospel as Gospel);
        for (let c = 1; c <= count; c++) {
            const have = covered.get(`${gospel}.${c}`);
            if (!have) continue;
            const open = Array.from({ length: counts[c] ?? 0 }, (_, i) => i + 1).filter((v) => !have.has(v) && !explained.has(`${gospel}.${c}.${v}`));
            if (open.length) problems.push(`${gospel} ${c}: verse(s) ${open.join(', ')} covered by no entry and explained by no versification note`);
        }
    }
    return problems;
}

export const DISCREPANCIES_FILE = path.resolve(import.meta.dirname, '..', 'corrections', 'catena-aurea.discrepancies.json');

export function loadDiscrepancies(file: string = DISCREPANCIES_FILE): ReviewedDiscrepancy[] {
    if (!fs.existsSync(file)) return [];
    return JSON.parse(fs.readFileSync(file, 'utf-8')) as ReviewedDiscrepancy[];
}

/** Findings the review has not resolved: everything the allowlist does not name by id, kind and fingerprint. */
export function unresolved<T extends { id: string; kind: string; detail: string }>(findings: T[], reviewed: ReviewedDiscrepancy[]): T[] {
    const allowed = new Set(reviewed.map((d) => `${d.kind}:${d.id}:${d.findingFingerprint}`));
    return findings.filter((f) => !allowed.has(`${f.kind}:${f.id}:${findingFingerprint(f)}`));
}

/** Reviewed discrepancies whose finding no longer exists in this form: a stale review is reported, never silently kept. */
export function staleDiscrepancies<T extends { id: string; kind: string; detail: string }>(findings: T[], reviewed: ReviewedDiscrepancy[]): ReviewedDiscrepancy[] {
    const present = new Set(findings.map((f) => `${f.kind}:${f.id}:${findingFingerprint(f)}`));
    return reviewed.filter((d) => !present.has(`${d.kind}:${d.id}:${d.findingFingerprint}`));
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
    const incomplete = completenessProblems(entries, loadVersificationNotes());
    if (incomplete.length) {
        for (const p of incomplete) console.log(`  ${p}`);
        console.error('[accept:catena] Corpus not accepted: the scans do not account for every Gospel chapter and verse.');
        process.exit(1);
    }
    const { findings, summary } = verify(entries, path.join(dataDir, 'texts', 'catena', 'oracle'), review);
    const reviewed = loadDiscrepancies();
    const stale = staleDiscrepancies(findings, reviewed);
    if (stale.length) {
        for (const d of stale) console.log(`  ${d.kind.padEnd(16)} ${d.id} (reviewed ${d.reviewed})`);
        console.error('[accept:catena] Corpus not accepted: these reviewed discrepancies no longer match a finding; re-review or remove them.');
        process.exit(1);
    }
    const open = unresolved(findings, reviewed);
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
