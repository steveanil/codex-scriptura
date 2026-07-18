/**
 * CLI: regenerate the KJV per-chapter verse-count table
 * (src/core/kjv-versification.ts) from the raw KJV OSIS source.
 *
 *   pnpm run generate:versification
 *
 * The table is the reference the text validator uses to detect
 * trailing-verse omissions (known-issues #24) - gap analysis alone cannot
 * see a chapter's *last* verse(s) disappearing, because max-verse shrinks
 * instead of leaving a hole.
 *
 * Deliberately reads the raw XML verse milestones, NOT the importer's
 * output: an importer bug that drops verses must not be able to bake
 * itself into the reference table. Before writing, the counts are
 * cross-checked against independently known KJV facts (31,102 verses in
 * the 66-book canon; spot counts for famous chapters), and diffed against
 * data/processed/kjv-verses.json when present.
 *
 * Rerun only when the pinned KJV source changes; the generated table is
 * checked in so validation works without the raw sources.
 */

import fs from 'node:fs';
import path from 'node:path';
import { dataDir, repoRoot } from './core/paths.js';
import { CANONICAL_CHAPTERS, VARIANT_MAX_CHAPTER } from './core/validate-texts.js';

const XML_PATH = path.join(dataDir, 'texts', 'eng-kjv.osis.xml');
const OUT_PATH = path.join(
    repoRoot, 'packages', 'data-pipeline', 'src', 'core', 'kjv-versification.ts',
);
const PROCESSED_KJV = path.join(dataDir, 'processed', 'kjv-verses.json');

// The 66-book Protestant canon in the KJV counts exactly 31,102 verses;
// per-chapter spot checks for well-known chapter lengths.
const CANON_66_TOTAL = 31_102;
const SPOT_CHECKS: Array<[string, number, number]> = [
    ['Gen', 1, 31],
    ['Ps', 117, 2],
    ['Ps', 119, 176],
    ['Matt', 28, 20],
    ['John', 21, 25],
    ['Rev', 22, 21],
];
const APOCRYPHA = new Set([
    'Tob', 'Jdt', 'EsthGr', 'AddEsth', 'Wis', 'Sir', 'Bar', 'EpJer',
    'PrAzar', 'Sus', 'Bel', '1Macc', '2Macc', '1Esd', '2Esd', 'PrMan',
    'AddPs', '3Macc', '4Macc',
]);

if (!fs.existsSync(XML_PATH)) {
    console.error(`[versification] Missing ${XML_PATH} - run: pnpm run fetch:texts`);
    process.exit(1);
}

const xml = fs.readFileSync(XML_PATH, 'utf-8');

// book → chapter → max verse number seen
const counts = new Map<string, Map<number, number>>();
let totalMarkers = 0;

const startRe = /<verse\s+[^>]*sID="[^"]*"[^/]*\/>/g;
let m: RegExpExecArray | null;
while ((m = startRe.exec(xml)) !== null) {
    const osisMatch = /[\s]osisID="([^"]+)"/.exec(m[0]);
    if (!osisMatch) continue;
    const parts = osisMatch[1].split('.');
    if (parts.length < 3) continue;
    const book = parts[0];
    const chapter = Number(parts[1]);
    const verse = Number(parts[2]);
    if (!Number.isInteger(chapter) || !Number.isInteger(verse)) continue;
    totalMarkers++;

    let chapters = counts.get(book);
    if (!chapters) { chapters = new Map(); counts.set(book, chapters); }
    chapters.set(chapter, Math.max(chapters.get(chapter) ?? 0, verse));
}

console.log(`[versification] ${totalMarkers} verse markers across ${counts.size} books`);

// ── Sanity checks against independent knowledge ──────────
const failures: string[] = [];

for (const book of counts.keys()) {
    if (!(book in CANONICAL_CHAPTERS)) failures.push(`unknown book '${book}' in source`);
}

for (const [book, chapters] of counts) {
    const maxAllowed = VARIANT_MAX_CHAPTER[book] ?? CANONICAL_CHAPTERS[book] ?? 0;
    const maxChapter = Math.max(...chapters.keys());
    if (maxChapter > maxAllowed) {
        failures.push(`${book} has chapter ${maxChapter}, canon allows ${maxAllowed}`);
    }
}

let canonTotal = 0;
for (const [book, chapters] of counts) {
    if (APOCRYPHA.has(book)) continue;
    for (const maxVerse of chapters.values()) canonTotal += maxVerse;
}
if (canonTotal !== CANON_66_TOTAL) {
    failures.push(`66-book canon totals ${canonTotal} verses, expected ${CANON_66_TOTAL}`);
}

for (const [book, chapter, expected] of SPOT_CHECKS) {
    const got = counts.get(book)?.get(chapter);
    if (got !== expected) {
        failures.push(`${book} ${chapter} has ${got} verses, expected ${expected}`);
    }
}

// ── Diff against the processed import (when present) ─────
if (fs.existsSync(PROCESSED_KJV)) {
    const processed: Array<{ book: string; chapter: number; verse: number }> =
        JSON.parse(fs.readFileSync(PROCESSED_KJV, 'utf-8'));
    const processedMax = new Map<string, number>();
    for (const v of processed) {
        const key = `${v.book}.${v.chapter}`;
        processedMax.set(key, Math.max(processedMax.get(key) ?? 0, v.verse));
    }
    let diffs = 0;
    for (const [book, chapters] of counts) {
        for (const [chapter, maxVerse] of chapters) {
            const got = processedMax.get(`${book}.${chapter}`);
            if (got !== maxVerse) {
                console.warn(`[versification] processed KJV disagrees at ${book}.${chapter}: source ${maxVerse}, processed ${got ?? 'missing'}`);
                diffs++;
            }
        }
    }
    if (diffs > 0) failures.push(`${diffs} chapter(s) differ from processed kjv-verses.json`);
    else console.log('[versification] processed kjv-verses.json agrees for every chapter');
} else {
    console.log('[versification] processed kjv-verses.json not found - skipping diff');
}

if (failures.length > 0) {
    for (const f of failures) console.error(`[versification] FAIL: ${f}`);
    process.exit(1);
}

// ── Emit the table ────────────────────────────────────────
const books = Array.from(counts.keys()); // source order (canonical)
const lines: string[] = [];
for (const book of books) {
    const chapters = counts.get(book)!;
    const entries = Array.from(chapters.entries())
        .sort((a, b) => a[0] - b[0])
        .map(([c, n]) => `${c}: ${n}`)
        .join(', ');
    lines.push(`    '${book}': { ${entries} },`);
}

const header = `/**
 * GENERATED FILE - do not edit by hand.
 *
 * Per-chapter verse counts of the KJV (the app's reference versification),
 * derived from the raw KJV OSIS source's verse milestones by
 * src/generate-versification.ts (pnpm run generate:versification).
 *
 * Used by core/validate-texts.ts to detect trailing-verse omissions
 * (known-issues #24): a chapter whose max verse falls short of this table
 * is missing its last verse(s), which pure gap analysis cannot see.
 * Includes the KJV Apocrypha (81 books). Books absent here (e.g. WEB-only
 * Apocrypha) are skipped by the trailing check.
 */

export const KJV_VERSE_COUNTS: Record<string, Record<number, number>> = {
`;

fs.writeFileSync(OUT_PATH, header + lines.join('\n') + '\n};\n', 'utf-8');
console.log(`[versification] Written: ${OUT_PATH} (${books.length} books)`);
