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

// ── Inline type (mirrors @codex-scriptura/core LexiconEntry) ──

type LexiconEntry = {
    id: string;
    strongsNumber: string;
    language: 'hebrew' | 'greek';
    lemma: string;
    transliteration: string;
    pronunciation?: string;
    gloss: string;
    description?: string;
};

// ── Minimal CSV parser (handles multi-line quoted fields) ─────

/**
 * Parse a CSV string into rows of string fields.
 * Handles RFC 4180 quoted fields with embedded commas, newlines, and
 * escaped double-quotes ("").
 */
function parseCSV(content: string): string[][] {
    const rows: string[][] = [];
    let currentRow: string[] = [];
    let currentField = '';
    let inQuotes = false;
    let i = 0;

    // Strip UTF-8 BOM if present
    if (content.charCodeAt(0) === 0xFEFF) {
        i = 1;
    }

    while (i < content.length) {
        const ch = content[i];

        if (inQuotes) {
            if (ch === '"') {
                if (content[i + 1] === '"') {
                    // Escaped double-quote
                    currentField += '"';
                    i += 2;
                } else {
                    inQuotes = false;
                    i++;
                }
            } else {
                currentField += ch;
                i++;
            }
        } else {
            if (ch === '"') {
                inQuotes = true;
                i++;
            } else if (ch === ',') {
                currentRow.push(currentField);
                currentField = '';
                i++;
            } else if (ch === '\r') {
                i++; // skip CR, handle LF below or standalone
            } else if (ch === '\n') {
                currentRow.push(currentField);
                rows.push(currentRow);
                currentRow = [];
                currentField = '';
                i++;
            } else {
                currentField += ch;
                i++;
            }
        }
    }

    // Flush last field/row if file doesn't end with newline
    if (currentField || currentRow.length > 0) {
        currentRow.push(currentField);
        rows.push(currentRow);
    }

    return rows;
}

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
    const rows = parseCSV(content);
    if (rows.length < 2) return [];

    // First row is the header - find column indices
    const header = rows[0].map(h => h.trim().toLowerCase());
    const idxNumber = header.indexOf('strongs_number');
    const idxWord   = header.indexOf('word');
    const idxGloss  = header.indexOf('gloss');

    if (idxNumber < 0 || idxWord < 0 || idxGloss < 0) {
        throw new Error(
            `[hebrew-strongs] Unexpected CSV header: ${rows[0].join(', ')}\n` +
            'Expected columns: strongs_number, word, gloss'
        );
    }

    const results: LexiconEntry[] = [];

    for (let r = 1; r < rows.length; r++) {
        const row = rows[r];
        if (!row || row.length < 3) continue;

        const rawNumber = row[idxNumber]?.trim();
        const lemma     = row[idxWord]?.trim() ?? '';
        const rawGloss  = row[idxGloss] ?? '';

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
