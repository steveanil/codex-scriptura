/**
 * Corpus acceptance gate for the Catena Aurea (issue #85), separate from
 * the diagnostic oracle command. The oracle keeps producing findings as
 * the correction workflow; this gate decides whether the corpus may be
 * registered as a resource:
 *
 *   OCR documents are the pinned archive's -> parse -> corrections ->
 *   entry validation -> unique ids -> traceable locators -> two builds
 *   agree -> completeness -> comparison with the transcription
 *
 * The comparison has three parts. Blocking: structure, identity, and
 * suspected omissions (a run of words the transcription has inside an
 * excerpt and ours does not, which may be a printed line the OCR lost),
 * each to zero unresolved. Audited: the other differences in words, of
 * which a seeded sample was read on the page (benchmark/catena/README.md).
 * Reported: every such difference, counted by shape, in the gate report.
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
import { importCatena, loadProvenanceRecords, verseCountsFor } from './import-catena-aurea.js';
import type { Gospel } from './importers/catena-aurea.js';
import { verify, findingFingerprint, STRUCTURAL_KINDS, IDENTITY_KINDS, type DifferenceShape } from './verify-catena-oracle.js';
import { catenaOcrProblems, loadCatenaOcrManifest } from './core/catena-ocr-archive.js';
import { sha256String } from './core/checksums.js';
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
    /**
     * For a finding with suspected omissions: each run this review read the
     * page for and found the page does not print there, exactly as the
     * finding lists them. A review that does not name them clears none.
     */
    omissions?: string[];
    /** Who read the page, when the record says. */
    reviewer?: string;
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
 * Findings whose suspected omissions no review has cleared. Only a review
 * of that very finding which names every omitted run clears it: a page
 * read for another purpose, or a review of the finding's other
 * differences, says nothing about whether the line is on the page.
 */
export function openOmissions<T extends { id: string; kind: string; detail: string; omissions?: string[] }>(findings: T[], reviewed: ReviewedDiscrepancy[]): T[] {
    const cleared = new Map(reviewed.filter((d) => d.omissions).map((d) => [`${d.kind}:${d.id}:${d.findingFingerprint}`, JSON.stringify(d.omissions)]));
    return findings.filter((f) => f.omissions?.length && cleared.get(`${f.kind}:${f.id}:${findingFingerprint(f)}`) !== JSON.stringify(f.omissions));
}

/** Benchmark pages kept untouched to measure the pipeline: no correction or review may be written from them. */
export function heldOutLeaves(file: string = path.resolve(import.meta.dirname, '..', 'benchmark', 'catena', 'pages.json')): Set<string> {
    const pages = JSON.parse(fs.readFileSync(file, 'utf-8')) as { 'held-out': Array<{ item: string; leaf: number }> };
    return new Set(pages['held-out'].map((p) => `${p.item}#${p.leaf}`));
}

/**
 * Open omissions that cannot be read because their excerpt runs over a
 * held-out benchmark page. Such a finding is neither cleared nor waived: it
 * is deferred only while an open question names it, so the reader shows the
 * excerpt as questioned, and the gate lists it by id every time it runs.
 */
export function deferredOmissions<T extends { id: string; item?: string }>(open: T[], index: Record<string, { excerptLeaves: number[] }>, held: Set<string>, questions: Array<{ status: string; finding?: string }>): T[] {
    const asked = new Set(questions.filter((q) => q.status === 'open' && q.finding).map((q) => q.finding));
    return open.filter((f) => {
        const [entry, n] = f.id.split('#');
        const leaves = index[entry]?.excerptLeaves ?? [];
        const i = Math.min(Number(n) - 1, leaves.length - 1);
        if (i < 0 || !asked.has(f.id)) return false;
        const last = leaves[i + 1] ?? leaves[i];
        for (let leaf = leaves[i]; leaf <= last; leaf++) if (held.has(`${f.item}#${leaf}`)) return true;
        return false;
    });
}

/**
 * The gate is sequential: structure first (a text corrected against the
 * wrong oracle excerpt is wasted work), then identity (who said what, and
 * where it is from), then suspected omissions. Other differences in words
 * do not block: read on the page, about half are the transcription's own,
 * so they are counted and reported, never taken for errors or waived.
 */
export function tiers(open: Array<{ id: string; kind: string; review?: string }>, omissions: unknown[] = []): { structural: number; identity: number; omissions: number; lexical: number; blocking: string | null } {
    const structural = open.filter((f) => STRUCTURAL_KINDS.includes(f.kind)).length;
    const identity = open.filter((f) => IDENTITY_KINDS.includes(f.kind)).length;
    const lexical = open.filter((f) => f.kind === 'text' && f.review !== 'benign-ocr').length;
    return { structural, identity, omissions: omissions.length, lexical, blocking: structural ? 'structural' : identity ? 'identity' : omissions.length ? 'omission' : null };
}

/** Every lexical difference by shape, over all findings whether reviewed or not. */
export function shapeCounts(findings: Array<{ shapes?: Partial<Record<DifferenceShape, number>> }>): Record<string, number> {
    const counts: Record<string, number> = {};
    for (const f of findings) for (const [shape, n] of Object.entries(f.shapes ?? {})) counts[shape] = (counts[shape] ?? 0) + n;
    return Object.fromEntries(Object.entries(counts).sort((a, b) => b[1] - a[1]));
}

export const ACCEPTANCE_FILE = path.resolve(import.meta.dirname, '..', 'catena-aurea.acceptance.json');

/** What the gate accepted: the corpus by checksum, so a later build can be shown to be the accepted one. */
export type Acceptance = {
    accepted: string;
    corpus: { sha256: string; bytes: number; entries: number };
    ocrArchive: { version: string; sha256: string };
    gate: { structural: number; identity: number; omissions: number; omissionsReviewed: number; omissionsDeferred: string[]; lexicalFindings: number; lexicalReviewed: number; differencesByShape: Record<string, number>; reviewedDiscrepancies: number };
};

export function loadAcceptance(file: string = ACCEPTANCE_FILE): Acceptance | null {
    return fs.existsSync(file) ? (JSON.parse(fs.readFileSync(file, 'utf-8')) as Acceptance) : null;
}

if (process.argv[1] && process.argv[1].endsWith('accept-catena-aurea.ts')) {
    const fail = (why: string): never => {
        console.error(`[accept:catena] Corpus not accepted: ${why}`);
        process.exit(1);
    };
    // Source integrity first: a corpus built from documents nobody else can retrieve is not reproducible
    const manifest = loadCatenaOcrManifest();
    const sourceProblems = catenaOcrProblems(manifest, path.join(dataDir, 'texts', 'catena', 'ocr'));
    if (sourceProblems.length) {
        for (const p of sourceProblems) console.log(`  ${p}`);
        fail(`the OCR documents are not those of the pinned archive ${manifest.version}; pack them as a new version first.`);
    }
    const { entries, review } = importCatena();
    // Reproducibility is proven, not assumed: the same documents and correction files must build the same corpus twice
    const again = importCatena({ log: () => {} }).entries;
    const corpus = JSON.stringify(entries);
    if (JSON.stringify(again) !== corpus) fail('two builds from the same inputs differ.');
    const incomplete = completenessProblems(entries, loadVersificationNotes());
    if (incomplete.length) {
        for (const p of incomplete) console.log(`  ${p}`);
        fail('the scans do not account for every Gospel chapter and verse.');
    }
    const { findings, summary } = verify(entries, path.join(dataDir, 'texts', 'catena', 'oracle'), review);
    const reviewed = loadDiscrepancies();
    const stale = staleDiscrepancies(findings, reviewed);
    if (stale.length) {
        for (const d of stale) console.log(`  ${d.kind.padEnd(16)} ${d.id} (reviewed ${d.reviewed})`);
        fail('these reviewed discrepancies no longer match a finding; re-review or remove them.');
    }
    const open = unresolved(findings, reviewed);
    const unread = openOmissions(findings, reviewed);
    const deferred = deferredOmissions(unread, review, heldOutLeaves(), loadProvenanceRecords().questions);
    const omissions = unread.filter((f) => !deferred.includes(f));
    const t = tiers(open, omissions);
    const lexical = findings.filter((f) => f.kind === 'text' && f.review === 'lexical');
    const gate = {
        structural: t.structural,
        identity: t.identity,
        omissions: t.omissions,
        omissionsReviewed: lexical.filter((f) => f.omissions?.length).length - unread.length,
        omissionsDeferred: deferred.map((f) => f.id),
        lexicalFindings: lexical.length,
        lexicalReviewed: lexical.length - t.lexical,
        differencesByShape: shapeCounts(lexical),
        reviewedDiscrepancies: reviewed.length,
    };
    const out = path.join(dataDir, 'processed', 'commentary-catena-aurea.gate-report.json');
    fs.writeFileSync(out, JSON.stringify({ summary, gate, blocking: t.blocking, openOmissions: omissions.map((f) => ({ id: f.id, item: f.item, leaf: f.leaf, fingerprint: findingFingerprint(f), omissions: f.omissions })) }, null, 1), 'utf-8');
    console.log('[accept:catena]', JSON.stringify({ ...summary, ...gate }));
    console.log(`[accept:catena] Report: ${out}`);
    for (const f of deferred) console.log(`[accept:catena] Deferred, not cleared: ${f.id} has a suspected omission on a held-out benchmark page, which may not be read; an open question marks the excerpt.`);
    if (t.blocking) {
        const shown = t.blocking === 'omission' ? omissions : open.filter((f) => (t.blocking === 'structural' ? STRUCTURAL_KINDS : IDENTITY_KINDS).includes(f.kind));
        for (const f of shown.slice(0, 20)) console.log(`  ${f.kind.padEnd(16)} ${f.id}`);
        if (shown.length > 20) console.log(`  ... ${shown.length - 20} more`);
        fail(t.blocking === 'omission'
            ? 'the transcription has a run of words inside these excerpts that ours does not. Read each on its page image: restore a lost line with a correction, or record a review of that finding naming the runs the page does not print.'
            : `at the ${t.blocking} tier: resolve these against the page images (corrections) or record reviewed discrepancies.`);
    }
    const acceptance: Acceptance = {
        accepted: new Date().toISOString().slice(0, 10),
        corpus: { sha256: sha256String(corpus), bytes: Buffer.byteLength(corpus), entries: entries.length },
        ocrArchive: { version: manifest.version, sha256: manifest.archive.sha256 },
        gate,
    };
    const before = loadAcceptance();
    // The date moves only when what was accepted does
    if (before && JSON.stringify({ ...before, accepted: '' }) === JSON.stringify({ ...acceptance, accepted: '' })) acceptance.accepted = before.accepted;
    fs.writeFileSync(ACCEPTANCE_FILE, JSON.stringify(acceptance, null, 2) + '\n', 'utf-8');
    console.log(`[accept:catena] Corpus accepted: ${acceptance.corpus.entries} entries, sha256 ${acceptance.corpus.sha256}`);
}
