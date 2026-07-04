import fs from 'node:fs';
import path from 'node:path';
import { buildTypeOverlay, lookupOverlayType, type TypeOverlay, type OverlayType } from './parse-typed-overlays.js';
import { repoRoot } from '../core/paths.js';

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
 * are excluded — they represent rejected cross-reference suggestions.
 *
 * Classification strategy (3-tier):
 *   1. Typed overlay — consult OT-NT-Reference-Map + UBS Parallel Passages
 *   2. Structural heuristics — vote-based rules (same as before)
 *   3. Relaxed fallback — extend heuristics to votes 1-2 instead of "unclassified"
 */

// ── Inline type (mirrors @codex-scriptura/core CrossReference) ──

type CrossReferenceType =
    | 'quotation'
    | 'allusion'
    | 'theme'
    | 'keyword'
    | 'parallel'
    | 'unclassified';

type CrossReference = {
    id: string;
    sourceVerse: string;
    targetVerse: string;
    type: CrossReferenceType;
    votes: number;
};

// ── OSIS ID validation ─────────────────────────────────────

/** Matches a single OSIS verse ID: Book.Chapter.Verse */
const OSIS_SINGLE = /^\w+\.\d+\.\d+$/;

/**
 * Normalize a verse reference that may be a range.
 * "Col.1.16-Col.1.17" → "Col.1.16"
 * "Gen.1.1" → "Gen.1.1"
 */
function normalizeVerse(raw: string): string | null {
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
//   - no ML / AI / embeddings — just structural + vote heuristics
//
// Rule justification (based on data analysis of ~341K edges):
//
//   Vote distribution: median=3, P75=6, P90=11, P95=19
//   Cross-testament links with votes ≥100 are almost certainly quotations
//     (191 NT→OT, 167 OT→NT at that threshold)
//   Synoptic inter-Gospel links (~11.6K) are known parallel accounts
//   Samuel/Kings ↔ Chronicles inter-book links (~7.7K) are parallel narratives
//   Lower-vote cross-testament links are likely allusions or thematic echoes

/** OT books by OSIS ID */
const OT_BOOKS = new Set([
    'Gen','Exod','Lev','Num','Deut','Josh','Judg','Ruth',
    '1Sam','2Sam','1Kgs','2Kgs','1Chr','2Chr','Ezra','Neh','Esth',
    'Job','Ps','Prov','Eccl','Song',
    'Isa','Jer','Lam','Ezek','Dan',
    'Hos','Joel','Amos','Obad','Jonah','Mic','Nah','Hab','Zeph','Hag','Zech','Mal',
]);

/** NT books by OSIS ID */
const NT_BOOKS = new Set([
    'Matt','Mark','Luke','John','Acts',
    'Rom','1Cor','2Cor','Gal','Eph','Phil','Col',
    '1Thess','2Thess','1Tim','2Tim','Titus','Phlm',
    'Heb','Jas','1Pet','2Pet','1John','2John','3John','Jude','Rev',
]);

/** Synoptic Gospels — inter-book links are parallel accounts */
const SYNOPTIC_BOOKS = new Set(['Matt', 'Mark', 'Luke']);

/** Historical parallel books — Sam/Kings narratives retold in Chronicles */
const HISTORICAL_PARALLELS = new Set(['1Sam', '2Sam', '1Kgs', '2Kgs', '1Chr', '2Chr']);

function extractBook(osisId: string): string {
    return osisId.split('.')[0];
}

function extractChapter(osisId: string): number {
    return parseInt(osisId.split('.')[1], 10);
}

/**
 * Classify a cross-reference edge using a 3-tier strategy:
 *
 * Tier 1 — TYPED OVERLAY (external datasets)
 *   Consult OT-NT-Reference-Map and UBS Parallel Passages for an
 *   authoritative type label. These are curated by scholars and cover
 *   ~980 OT-in-NT chapter pairs + ~2,193 parallel passage groups.
 *
 * Tier 2 — STRUCTURAL HEURISTICS (vote ≥ 3)
 *   Same rules as before: quotation (cross-testament ≥100 votes),
 *   parallel (synoptic/historical/same-book), allusion (cross ≥30),
 *   theme (cross ≥10 / same ≥20), keyword (≥3).
 *
 * Tier 3 — RELAXED FALLBACK (votes 1–2)
 *   Instead of "unclassified", extend the structural heuristics with
 *   lower thresholds so every edge gets a meaningful type:
 *   - Cross-testament → "theme" (even a 1-vote cross-testament link
 *     indicates some thematic connection)
 *   - Same-book → "parallel" (internal structural echo)
 *   - Same-testament, different book → "keyword" (weak textual link)
 */
function classifyEdge(
    sourceVerse: string,
    targetVerse: string,
    votes: number,
    overlay: TypeOverlay | null,
): CrossReferenceType {
    // ── Tier 1: TYPED OVERLAY ──
    if (overlay) {
        const overlayType = lookupOverlayType(overlay, sourceVerse, targetVerse);
        if (overlayType) {
            // Map overlay types to our CrossReferenceType
            switch (overlayType) {
                case 'quotation': return 'quotation';
                case 'allusion': return 'allusion';
                case 'possible_allusion': return 'allusion'; // promote to allusion
                case 'parallel': return 'parallel';
            }
        }
    }

    // ── Tier 2: STRUCTURAL HEURISTICS (same rules as before) ──
    const srcBook = extractBook(sourceVerse);
    const tgtBook = extractBook(targetVerse);
    const srcOT = OT_BOOKS.has(srcBook);
    const srcNT = NT_BOOKS.has(srcBook);
    const tgtOT = OT_BOOKS.has(tgtBook);
    const tgtNT = NT_BOOKS.has(tgtBook);
    const crossTestament = (srcOT && tgtNT) || (srcNT && tgtOT);

    // Rule 1: QUOTATION — cross-testament, very high confidence
    if (crossTestament && votes >= 100) {
        return 'quotation';
    }

    // Rule 2: PARALLEL — known parallel narrative patterns
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

    // Rule 3: ALLUSION — cross-testament, moderate-high votes
    if (crossTestament && votes >= 30) {
        return 'allusion';
    }

    // Rule 4: THEME — moderate thematic connections
    if (crossTestament && votes >= 10) {
        return 'theme';
    }
    if (!crossTestament && votes >= 20) {
        return 'theme';
    }

    // Rule 5: KEYWORD — low-vote, no structural pattern
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
    const results: CrossReference[] = [];
    const seen = new Set<string>();

    for (const line of lines) {
        // Skip empty lines and comments/headers
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('From')) continue;

        const parts = trimmed.split('\t');
        if (parts.length < 3) continue;

        const sourceVerse = normalizeVerse(parts[0]);
        const targetVerse = normalizeVerse(parts[1]);
        const votes = parseInt(parts[2], 10);

        // Skip invalid entries
        if (!sourceVerse || !targetVerse) continue;

        // Skip self-references
        if (sourceVerse === targetVerse) continue;

        // Skip negatively-voted entries (community rejected)
        if (isNaN(votes) || votes <= 0) continue;

        // Deterministic ID for deduplication
        const id = `${sourceVerse}→${targetVerse}`;

        // Skip duplicates
        if (seen.has(id)) continue;
        seen.add(id);

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
        console.log('[cross-refs] No typed overlay datasets found — using heuristics only');
        console.log('[cross-refs] Run: pnpm run fetch:typed-crossrefs');
    }

    const content = fs.readFileSync(inputFile, 'utf-8');
    const records = parseCrossReferences(content, overlay);

    fs.mkdirSync(outputDir, { recursive: true });
    const outputPath = path.join(outputDir, 'cross-references.json');
    fs.writeFileSync(outputPath, JSON.stringify(records), 'utf-8');

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

