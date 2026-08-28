import fs from 'node:fs';
import path from 'node:path';
import { OT_BOOKS, NT_BOOKS, findBook, parseOsisId, compareCanonical, type CrossReference, type CrossReferenceType } from '@codex-scriptura/core';
import { buildTypeOverlay, lookupOverlay, type TypeOverlay, type OverlayType } from './parse-typed-overlays.js';
import { repoRoot } from '../core/paths.js';
import { recordImportRun } from '../core/import-runs.js';

/**
 * OpenBible cross-references importer.
 *
 * Parses the tab-separated cross_references.txt from OpenBible.info and
 * produces a JSON array of CrossReference records for Dexie seeding.
 *
 * Input format (tab-separated, 3 columns):
 *   FromVerse\tToVerse\tVotes
 *   Gen.1.1\tJer.10.12\t72
 *   Gen.1.1\tCol.1.16-Col.1.17\t161
 *
 * The first line is a header/comment. Verse ranges in the target column
 * (e.g. "Col.1.16-Col.1.17") are normalized to the start verse only,
 * consistent with the Theographic verseRef convention.
 *
 * Votes can be negative (community downvotes). Records with votes <= 0
 * are excluded - they represent rejected cross-reference suggestions.
 *
 * A cross-reference is a symmetric relation, but the source lists ~42K
 * pairs in both directions with independent vote counts (Gen.1.1->Jer.10.12
 * at 77 votes AND Jer.10.12->Gen.1.1 at 11), and classifying each side on
 * its own votes gave the same link two different types (issue #183). Every
 * row is therefore collapsed onto one undirected pair:
 *   - orientation is canonical: sourceVerse is the later verse in canon
 *     order, targetVerse the earlier one ("the later text refers back").
 *     Quotations and allusions are only ever cross-testament, so this
 *     stores them NT -> OT, the direction those types actually mean.
 *   - votes are the max over every row that collapses onto the pair
 *     (either listing's strongest support; summing would push pairs over
 *     thresholds that were tuned on per-direction counts).
 *   - the type is classified once from the merged votes. classifyEdge is
 *     symmetric in its endpoints, so this equals the stronger side's type.
 * Readers show a pair at both ends (see getCrossReferencesForChapter).
 *
 * Classification strategy (3-tier):
 *   1. Typed overlay - consult OT-NT-Reference-Map + UBS Parallel Passages.
 *      "quotation" comes from here only: it is a claim about the text, and
 *      votes cannot make it (issue #282).
 *   2. Structural heuristics - vote-based rules for parallel/allusion/
 *      theme/keyword
 *   3. Relaxed fallback - extend heuristics to votes 1-2 instead of "unclassified"
 */

// ── OSIS ID validation ─────────────────────────────────────

/** Matches a single OSIS verse ID: Book.Chapter.Verse */
const OSIS_SINGLE = /^\w+\.\d+\.\d+$/;

/**
 * Normalize a verse reference that may be a range.
 * "Col.1.16-Col.1.17" → "Col.1.16"
 * "Gen.1.1" → "Gen.1.1"
 */
export function normalizeVerse(raw: string): string | null {
    const trimmed = raw.trim();
    if (!trimmed) return null;

    // If it's a range, take the start verse
    const candidate = trimmed.includes('-') ? trimmed.split('-')[0].trim() : trimmed;

    return OSIS_SINGLE.test(candidate) ? candidate : null;
}

// ── Classification ─────────────────────────────────────────
//
// Deterministic, rule-based type assignment for cross-reference edges.
// Rules are applied in priority order (first match wins).
//
// Design principles:
//   - prefer under-classifying over fake precision
//   - all rules are explainable and reproducible
//   - no ML / AI / embeddings - just structural + vote heuristics
//
// Rule justification (based on data analysis of ~341K edges):
//
//   Vote distribution: median=3, P75=6, P90=11, P95=19
//   Cross-testament links with votes ≥100 are strong links but not
//     quotations: the 303 such pairs with no overlay evidence are led by
//     Rom 8:29 / Jer 1:5 and Phil 4:13 / Isa 41:10 (issue #282)
//   Synoptic inter-Gospel links (~11.6K) are known parallel accounts
//   Samuel/Kings ↔ Chronicles inter-book links (~7.7K) are parallel narratives
//   Lower-vote cross-testament links are likely allusions or thematic echoes

// Deuterocanon is neither, so a link into it is never cross-testament -
// the source has none today anyway.
const OT_IDS = new Set(OT_BOOKS.map((b) => b.osisId));
const NT_IDS = new Set(NT_BOOKS.map((b) => b.osisId));

// ── Canonical orientation ──────────────────────────────────

/**
 * Canon order of two OSIS verse IDs (core BOOKS order: OT, deuterocanon,
 * NT). compareCanonical ranks every unknown book equally, so two unknown
 * books are ordered by name here to keep the order total and the record
 * ids deterministic.
 */
export function compareOsis(a: string, b: string): number {
    const pa = parseOsisId(a);
    const pb = parseOsisId(b);
    // Both ids passed normalizeVerse; this only guards direct callers.
    if (!pa || !pb) return a < b ? -1 : a > b ? 1 : 0;
    if (pa.book !== pb.book && !findBook(pa.book) && !findBook(pb.book)) {
        return pa.book < pb.book ? -1 : 1;
    }
    return compareCanonical(pa, pb);
}

/**
 * Canonical orientation of a pair: the later verse in canon order is the
 * source ("refers back to"), the earlier one the target. Every pair has
 * exactly one orientation, so the record id is the same whichever way the
 * source listed it.
 */
export function orientPair(a: string, b: string): { sourceVerse: string; targetVerse: string } {
    return compareOsis(a, b) > 0
        ? { sourceVerse: a, targetVerse: b }
        : { sourceVerse: b, targetVerse: a };
}

/** Synoptic Gospels - inter-book links are parallel accounts */
const SYNOPTIC_BOOKS = new Set(['Matt', 'Mark', 'Luke']);

/** Historical parallel books - Sam/Kings narratives retold in Chronicles */
const HISTORICAL_PARALLELS = new Set(['1Sam', '2Sam', '1Kgs', '2Kgs', '1Chr', '2Chr']);

function extractBook(osisId: string): string {
    return osisId.split('.')[0];
}

function extractChapter(osisId: string): number {
    return parseInt(osisId.split('.')[1], 10);
}

/**
 * A chapter-level "quotation" (OT-NT-Reference-Map knows the chapters,
 * not the verses) is inherited by every attested verse pair between
 * those chapters. Pairs the community barely voted for are unlikely to
 * be the quoted verses - Rev 18 quotes Jer 51, but not from twenty
 * different verses at one vote each - so below this floor they get
 * "allusion" instead. Same floor as the Tier 2 heuristics.
 */
const CHAPTER_QUOTATION_MIN_VOTES = 3;

/**
 * Classify a cross-reference edge using a 3-tier strategy:
 *
 * Tier 1 - TYPED OVERLAY (external datasets)
 *   Consult OT-NT-Reference-Map and UBS Parallel Passages for an
 *   authoritative type label. These are curated by scholars and cover
 *   ~980 OT-in-NT chapter pairs + ~2,193 parallel passage groups. This is
 *   the only source of "quotation": UBS word-level matches or a curated
 *   OT-NT "q" chapter pair (attested at CHAPTER_QUOTATION_MIN_VOTES).
 *
 * Tier 2 - STRUCTURAL HEURISTICS (vote ≥ 3)
 *   parallel (synoptic/historical/same-book), allusion (cross ≥30),
 *   theme (cross ≥10 / same ≥20), keyword (≥3). Votes measure how
 *   popular a link is, not whether one text quotes the other, so no
 *   vote count yields "quotation" (issue #282: the old ≥100 rule typed
 *   Rom 8:28 / Gen 50:20 as a quotation).
 *
 * Tier 3 - RELAXED FALLBACK (votes 1–2)
 *   Instead of "unclassified", extend the structural heuristics with
 *   lower thresholds so every edge gets a meaningful type:
 *   - Cross-testament → "theme" (even a 1-vote cross-testament link
 *     indicates some thematic connection)
 *   - Same-book → "parallel" (internal structural echo)
 *   - Same-testament, different book → "keyword" (weak textual link)
 */
export function classifyEdge(
    sourceVerse: string,
    targetVerse: string,
    votes: number,
    overlay: TypeOverlay | null,
): CrossReferenceType {
    // ── Tier 1: TYPED OVERLAY ──
    // Both orientations are tried so classification stays symmetric even
    // if a future overlay source only lists one direction.
    if (overlay) {
        const hit = lookupOverlay(overlay, sourceVerse, targetVerse)
            ?? lookupOverlay(overlay, targetVerse, sourceVerse);
        if (hit) {
            // Map overlay types to our CrossReferenceType
            switch (hit.type) {
                case 'quotation':
                    return hit.level === 'chapter' && votes < CHAPTER_QUOTATION_MIN_VOTES ? 'allusion' : 'quotation';
                case 'allusion': return 'allusion';
                case 'possible_allusion': return 'allusion'; // promote to allusion
                case 'parallel': return 'parallel';
            }
        }
    }

    // ── Tier 2: STRUCTURAL HEURISTICS ──
    const srcBook = extractBook(sourceVerse);
    const tgtBook = extractBook(targetVerse);
    const srcOT = OT_IDS.has(srcBook);
    const srcNT = NT_IDS.has(srcBook);
    const tgtOT = OT_IDS.has(tgtBook);
    const tgtNT = NT_IDS.has(tgtBook);
    const crossTestament = (srcOT && tgtNT) || (srcNT && tgtOT);

    // Rule 2: PARALLEL - known parallel narrative patterns
    if (srcBook !== tgtBook && SYNOPTIC_BOOKS.has(srcBook) && SYNOPTIC_BOOKS.has(tgtBook)) {
        return 'parallel';
    }
    if (srcBook !== tgtBook && HISTORICAL_PARALLELS.has(srcBook) && HISTORICAL_PARALLELS.has(tgtBook)) {
        return 'parallel';
    }
    if (srcBook === tgtBook && votes >= 5) {
        const chDiff = Math.abs(extractChapter(sourceVerse) - extractChapter(targetVerse));
        if (chDiff <= 5) {
            return 'parallel';
        }
    }

    // Rule 3: ALLUSION - cross-testament, moderate-high votes
    if (crossTestament && votes >= 30) {
        return 'allusion';
    }

    // Rule 4: THEME - moderate thematic connections
    if (crossTestament && votes >= 10) {
        return 'theme';
    }
    if (!crossTestament && votes >= 20) {
        return 'theme';
    }

    // Rule 5: KEYWORD - low-vote, no structural pattern
    if (votes >= 3) {
        return 'keyword';
    }

    // ── Tier 3: RELAXED FALLBACK (votes 1–2) ──
    // Instead of "unclassified", apply lower-confidence structural rules.

    // Cross-testament with any votes → thematic connection
    if (crossTestament) {
        return 'theme';
    }

    // Same book → likely internal structural parallel
    if (srcBook === tgtBook) {
        return 'parallel';
    }

    // Same testament, different book → weak keyword/textual link
    return 'keyword';
}

// ── Parser ─────────────────────────────────────────────────

export function parseCrossReferences(
    content: string,
    overlay: TypeOverlay | null = null,
): CrossReference[] {
    const lines = content.split('\n');
    // Keyed by canonical id; insertion order is the source's first mention,
    // so the output order is stable across runs.
    const pairs = new Map<string, { sourceVerse: string; targetVerse: string; votes: number }>();

    for (const line of lines) {
        // Skip empty lines and comments/headers
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('From')) continue;

        const parts = trimmed.split('\t');
        if (parts.length < 3) continue;

        const from = normalizeVerse(parts[0]);
        const to = normalizeVerse(parts[1]);
        const votes = parseInt(parts[2], 10);

        // Skip invalid entries
        if (!from || !to) continue;

        // Skip self-references
        if (from === to) continue;

        // Skip negatively-voted entries (community rejected)
        if (isNaN(votes) || votes <= 0) continue;

        const { sourceVerse, targetVerse } = orientPair(from, to);
        const id = `${sourceVerse}→${targetVerse}`;

        // Mirror rows and range-collapsed rows merge onto the pair; keep
        // the strongest support either listing received.
        const existing = pairs.get(id);
        if (existing) {
            if (votes > existing.votes) existing.votes = votes;
        } else {
            pairs.set(id, { sourceVerse, targetVerse, votes });
        }
    }

    const results: CrossReference[] = [];
    for (const [id, { sourceVerse, targetVerse, votes }] of pairs) {
        results.push({
            id,
            sourceVerse,
            targetVerse,
            type: classifyEdge(sourceVerse, targetVerse, votes, overlay),
            votes,
        });
    }
    return results;
}

// ── File-based runner ──────────────────────────────────────

export function importCrossReferences(
    inputFile: string,
    outputDir: string,
): void {
    if (!fs.existsSync(inputFile)) {
        console.error(`[cross-refs] Missing: ${inputFile}`);
        console.error('[cross-refs] Run: pnpm run fetch:crossrefs');
        process.exit(1);
    }

    // Build typed overlay from external datasets (if available)
    const otntPath = path.join(repoRoot, 'data/texts/typed-crossrefs/otnt-reference-map.js');
    const ubsPath = path.join(repoRoot, 'data/texts/typed-crossrefs/ParallelPassages.xml');
    const overlayAvailable = fs.existsSync(otntPath) || fs.existsSync(ubsPath);
    const overlay = overlayAvailable ? buildTypeOverlay(otntPath, ubsPath) : null;

    if (overlay) {
        console.log(`[cross-refs] Typed overlay loaded: ${overlay.stats.otntEntries} OTNT chapter-pairs, ${overlay.stats.ubsVersePairs} UBS verse-pairs`);
    } else {
        console.log('[cross-refs] No typed overlay datasets found - using heuristics only');
        console.log('[cross-refs] Run: pnpm run fetch:typed-crossrefs');
    }

    const content = fs.readFileSync(inputFile, 'utf-8');
    const records = parseCrossReferences(content, overlay);

    fs.mkdirSync(outputDir, { recursive: true });
    const outputPath = path.join(outputDir, 'cross-references.json');
    fs.writeFileSync(outputPath, JSON.stringify(records), 'utf-8');
    recordImportRun(path.join(outputDir, '_metadata'), {
        sourceIds: [
            'openbible-xref',
            ...(fs.existsSync(otntPath) ? ['otnt-reference-map'] : []),
            ...(fs.existsSync(ubsPath) ? ['ubs-parallel-passages'] : []),
        ],
        inputFiles: [inputFile, ...[otntPath, ubsPath].filter(p => fs.existsSync(p))],
        stats: { created: records.length, updated: 0, skipped: 0, conflicts: 0 },
    });

    const sizeMb = (fs.statSync(outputPath).size / (1024 * 1024)).toFixed(1);
    console.log(`[cross-refs] Written: ${outputPath} (${records.length} records, ${sizeMb} MB)`);

    // ── Classification breakdown ──
    const byType = new Map<string, number>();
    for (const r of records) {
        byType.set(r.type, (byType.get(r.type) ?? 0) + 1);
    }
    console.log('[cross-refs] Classification breakdown:');
    const typeOrder: CrossReferenceType[] = ['quotation', 'allusion', 'theme', 'keyword', 'parallel', 'unclassified'];
    for (const t of typeOrder) {
        const count = byType.get(t) ?? 0;
        const pct = ((count / records.length) * 100).toFixed(1);
        console.log(`  ${t.padEnd(14)} ${String(count).padStart(7)}  (${pct}%)`);
    }

    // ── Vote stats ──
    const avgVotes = records.reduce((sum, r) => sum + r.votes, 0) / records.length;
    console.log(`[cross-refs] Average votes: ${avgVotes.toFixed(1)}`);
    let maxVotes = 0;
    let minVotes = Infinity;
    for (const r of records) {
        if (r.votes > maxVotes) maxVotes = r.votes;
        if (r.votes < minVotes) minVotes = r.votes;
    }
    console.log(`[cross-refs] Max votes: ${maxVotes}`);
    console.log(`[cross-refs] Min votes (included): ${minVotes}`);
}

