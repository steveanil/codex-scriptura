import fs from 'node:fs';
import path from 'node:path';
import { BOOKS } from '@codex-scriptura/core';
import { recordImportRun } from '../core/import-runs.js';
import { compareOsis } from './import-cross-references.js';

/**
 * Build-time aggregates over the cross-reference dataset (issue #38).
 *
 * Rule: a result that depends only on immutable seeded data and is the
 * same for every user is computed here, once, and shipped as a small
 * dataset; the browser never re-derives it. Runtime keeps the dynamic
 * passage and entity traversal (#167).
 *
 * Both outputs are derived datasets in the manifest: their versions fold
 * in the cross-reference dataset's content hash, so a refresh of the
 * source invalidates them.
 */

type Pair = { sourceVerse: string; targetVerse: string };

const BOOK_RANK = new Map(BOOKS.map((b, i) => [b.osisId, i]));

function bookOf(osisId: string): string {
    const dot = osisId.indexOf('.');
    return dot > 0 ? osisId.slice(0, dot) : osisId;
}

function compareBooks(a: string, b: string): number {
    const ra = BOOK_RANK.get(a) ?? Number.MAX_SAFE_INTEGER;
    const rb = BOOK_RANK.get(b) ?? Number.MAX_SAFE_INTEGER;
    return ra - rb || (a < b ? -1 : a > b ? 1 : 0);
}

/**
 * The book-to-book connection matrix in the stored orientation: each pair
 * is counted once under its source book (the later book in canon order)
 * against its target book. Intra-book pairs count under from === to.
 * Sorted in canon order so identical input gives identical output.
 */
export function bookMatrix(pairs: Pair[]): Array<{ from: string; to: string; count: number }> {
    const counts = new Map<string, Map<string, number>>();
    for (const { sourceVerse, targetVerse } of pairs) {
        const from = bookOf(sourceVerse);
        const to = bookOf(targetVerse);
        let row = counts.get(from);
        if (!row) { row = new Map(); counts.set(from, row); }
        row.set(to, (row.get(to) ?? 0) + 1);
    }
    const out: Array<{ from: string; to: string; count: number }> = [];
    for (const [from, row] of counts) for (const [to, count] of row) out.push({ from, to, count });
    return out.sort((a, b) => compareBooks(a.from, b.from) || compareBooks(a.to, b.to));
}

/** How many pairs touch each verse, at either end, in canon order. */
export function verseDegrees(pairs: Pair[]): Array<{ osisId: string; degree: number }> {
    const degree = new Map<string, number>();
    for (const { sourceVerse, targetVerse } of pairs) {
        degree.set(sourceVerse, (degree.get(sourceVerse) ?? 0) + 1);
        degree.set(targetVerse, (degree.get(targetVerse) ?? 0) + 1);
    }
    return [...degree].map(([osisId, d]) => ({ osisId, degree: d })).sort((a, b) => compareOsis(a.osisId, b.osisId));
}

/**
 * Read data/processed/cross-references.json and write book-matrix.json and
 * verse-degrees.json beside it.
 */
export function aggregateCrossReferences(inputPath: string, outputDir: string): { matrixCells: number; versesWithDegree: number } {
    const pairs: Pair[] = JSON.parse(fs.readFileSync(inputPath, 'utf-8'));
    const matrix = bookMatrix(pairs);
    const degrees = verseDegrees(pairs);
    fs.mkdirSync(outputDir, { recursive: true });
    fs.writeFileSync(path.join(outputDir, 'book-matrix.json'), JSON.stringify(matrix), 'utf-8');
    fs.writeFileSync(path.join(outputDir, 'verse-degrees.json'), JSON.stringify(degrees), 'utf-8');
    recordImportRun(path.join(outputDir, '_metadata'), {
        sourceIds: ['openbible-xref'],
        inputFiles: [inputPath],
        stats: { created: matrix.length + degrees.length, updated: 0, skipped: 0, conflicts: 0 },
    });
    console.log(`[aggregate] ${pairs.length} pairs -> ${matrix.length} matrix cells, ${degrees.length} verses with a degree`);
    return { matrixCells: matrix.length, versesWithDegree: degrees.length };
}
