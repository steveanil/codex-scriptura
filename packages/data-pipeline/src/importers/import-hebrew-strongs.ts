import fs from 'node:fs';
import path from 'node:path';
import { recordImportRun } from '../core/import-runs.js';

/**
 * BibleData HebrewStrongs.csv importer.
 *
 * Parses HebrewStrongs.csv from BradyStephenson/bible-data and produces a
 * JSON array of LexiconEntry records for Dexie seeding.
 *
 * Input CSV columns (BOM-stripped):
 *   strongs_number, word, gloss, language, part_of_speech, gender,
 *   occurrences, first_occurrence, root_word, ...
 *
 * The `gloss` field is multi-line and quoted. Format:
 *   "<transliteration> (pronunciation) pos.\n1. definition\n..."
 *
 * language column values:
 *   H = Hebrew, A = Aramaic (both mapped to 'hebrew' in LexiconEntry)
 *
 * Note: BibleData has no GreekStrongs.csv. Greek lexicon requires a separate
 * data source (e.g. OpenScriptures/strongs) - deferred to v0.5.0.
 */

import type { LexiconEntry } from '@codex-scriptura/core';
import { parseCsv } from '../core/csv.js';

// ── Gloss field parser ─────────────────────────────────────

/**
 * Extract transliteration, pronunciation, and short gloss from the
 * multi-line gloss field.
 *
 * Format: "transliteration (pronunciation) pos.\n1. definition\n..."
 * Returns { transliteration, pronunciation, gloss } where pronunciation is
 * Strong's classic respelling from the first parenthesized group ("awb",
 * "daw-baw'") and gloss is the first numbered definition line (stripped of
 * its number prefix). Later parenthesized groups are variant forms, not
 * pronunciations.
 */
export function parseGlossField(raw: string): { transliteration: string; pronunciation?: string; gloss: string } {
    const trimmed = raw.trim();
    const lines = trimmed.split('\n');
    const firstLine = lines[0].trim();

    // Transliteration: first token before space or parenthesis
    const translMatch = firstLine.match(/^([^\s(]+)/);
    const transliteration = translMatch ? translMatch[1] : '';

    // Pronunciation: first parenthesized group; collapse the source's
    // line-wrap artifacts ("ab-ee- khah'-yil" → "ab-ee-khah'-yil")
    const pronMatch = firstLine.match(/\(([^)]+)\)/);
    const pronunciation = pronMatch
        ? pronMatch[1].replace(/-\s+/g, '-').replace(/\s+/g, ' ').trim() || undefined
        : undefined;

    // Short gloss: first numbered definition, e.g. "1. father"
    const defLine = lines.find(l => /^\d+\./.test(l.trim()));
    const gloss = defLine
        ? defLine.replace(/^\d+\.\s*/, '').trim()
        : firstLine;

    return { transliteration, pronunciation, gloss };
}

// ── Parser ─────────────────────────────────────────────────

export function parseHebrewStrongs(content: string): LexiconEntry[] {
    const rows = parseCsv(content);
    if (rows.length === 0) return [];

    // Rows are keyed by the source header - resolve the columns we need
    // case-insensitively.
    const keys = Object.keys(rows[0]);
    const keyFor = (name: string) => keys.find((k) => k.toLowerCase() === name);
    const numberKey = keyFor('strongs_number');
    const wordKey   = keyFor('word');
    const glossKey  = keyFor('gloss');

    if (!numberKey || !wordKey || !glossKey) {
        throw new Error(
            `[hebrew-strongs] Unexpected CSV header: ${keys.join(', ')}\n` +
            'Expected columns: strongs_number, word, gloss'
        );
    }

    const results: LexiconEntry[] = [];

    for (const row of rows) {
        const rawNumber = row[numberKey]?.trim();
        const lemma     = row[wordKey]?.trim() ?? '';
        const rawGloss  = row[glossKey] ?? '';

        if (!rawNumber || isNaN(Number(rawNumber))) continue;

        const strongsNumber = `H${rawNumber}`;
        const { transliteration, pronunciation, gloss } = parseGlossField(rawGloss);

        results.push({
            id: strongsNumber,
            strongsNumber,
            language: 'hebrew',
            lemma,
            transliteration,
            ...(pronunciation ? { pronunciation } : {}),
            gloss,
            description: rawGloss.trim() || undefined,
        });
    }

    return results;
}


// ── File-based runner ──────────────────────────────────────

export function importHebrewStrongs(inputFile: string, outputDir: string): void {
    if (!fs.existsSync(inputFile)) {
        console.error(`[hebrew-strongs] Missing: ${inputFile}`);
        console.error('[hebrew-strongs] Run: pnpm run fetch:bibledata');
        process.exit(1);
    }

    const content = fs.readFileSync(inputFile, 'utf-8');
    const records = parseHebrewStrongs(content);

    fs.mkdirSync(outputDir, { recursive: true });
    const outputPath = path.join(outputDir, 'lexicon-hebrew.json');
    fs.writeFileSync(outputPath, JSON.stringify(records), 'utf-8');
    recordImportRun(path.join(outputDir, '_metadata'), {
        sourceIds: ['bibledata'],
        inputFiles: [inputFile],
        stats: { created: records.length, updated: 0, skipped: 0, conflicts: 0 },
    });

    const sizeKb = (fs.statSync(outputPath).size / 1024).toFixed(1);
    console.log(`[hebrew-strongs] Written: ${outputPath} (${records.length} entries, ${sizeKb} KB)`);

    // Sample log
    if (records.length > 0) {
        const sample = records.find(r => r.id === 'H430') ?? records[0];
        const spoken = sample.pronunciation ? `, say "${sample.pronunciation}"` : '';
        console.log(`[hebrew-strongs] Sample - ${sample.id}: "${sample.lemma}" (${sample.transliteration}${spoken}) = "${sample.gloss}"`);
    }
}
