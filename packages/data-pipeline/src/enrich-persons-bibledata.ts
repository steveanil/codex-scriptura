/**
 * Enrich processed Theographic persons with name meanings from BibleData PersonLabel.
 *
 * Input:
 *   data/processed/persons.json                          — Theographic person records
 *   data/texts/bibledata/BibleData-Person.csv            — BibleData person list (id → name)
 *   data/texts/bibledata/BibleData-PersonLabel.csv       — BibleData name labels (meaning, etymology)
 *
 * Output:
 *   data/processed/persons.json                          — Overwritten in-place with enriched records
 *
 * HOW TO GET THE BIBLEDATA FILES:
 *   cd packages/data-pipeline && pnpm run fetch:bibledata
 *
 * MATCHING STRATEGY:
 *   1. Build index: BibleData person_name (normalized) → list of BibleData person_id values
 *   2. For each Theographic person, normalize their display name and look up in the index
 *   3. Exactly one match required — if zero or multiple BibleData persons share that normalized
 *      name, skip (no guessing)
 *   4. From that person's PersonLabel rows, pick the best meaning:
 *      a. Prefer label_type = "Proper Name" with a non-empty hebrew_label_meaning
 *      b. Fall back to any row with a non-empty hebrew_label_meaning
 *      c. Fall back to any row with a non-empty greek_label_meaning
 *   5. Attach as nameMeaning (string) and nameMeaningSource = 'bibledata'
 *
 * Run from repo root:
 *   cd packages/data-pipeline && pnpm run enrich:persons
 */

import fs from 'node:fs';
import path from 'node:path';

// ─── Paths ────────────────────────────────────────────────────

const dataDir        = path.resolve(process.cwd(), '../../data');
const PERSONS_JSON   = path.join(dataDir, 'processed', 'persons.json');
const PERSON_CSV     = path.join(dataDir, 'texts', 'bibledata', 'BibleData-Person.csv');
const LABEL_CSV      = path.join(dataDir, 'texts', 'bibledata', 'BibleData-PersonLabel.csv');

// ─── Local types (mirrors packages/core/src/types.ts) ────────

type Person = {
    id: string;
    name: string;
    gender?: string;
    verseRefs: string[];
    description?: string;
    nameMeaning?: string;
    nameMeaningSource?: 'bibledata';
};

type BibleDataPerson = {
    personId: string;   // e.g. "Moses_1"
    personName: string; // e.g. "Moses"
};

type BibleDataLabel = {
    personId: string;
    englishLabel: string;          // english_label (the name/title in English)
    labelType: string;             // e.g. "Proper Name", "Title", "Description"
    hebrewMeaning: string;         // hebrew_label_meaning
    greekMeaning: string;          // greek_label_meaning
};

// ─── Simple CSV parser ────────────────────────────────────────

/**
 * Minimal RFC-4180 CSV parser sufficient for the flat, single-line BibleData files.
 * Returns an array of row objects keyed by the header row.
 */
function parseCsv(content: string): Record<string, string>[] {
    // Strip UTF-8 BOM if present
    const text = content.startsWith('\ufeff') ? content.slice(1) : content;

    const lines = text.split(/\r?\n/);
    if (lines.length < 2) return [];

    const headers = splitCsvRow(lines[0]);
    const rows: Record<string, string>[] = [];

    for (let i = 1; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;
        const values = splitCsvRow(line);
        const row: Record<string, string> = {};
        for (let j = 0; j < headers.length; j++) {
            row[headers[j]] = values[j] ?? '';
        }
        rows.push(row);
    }

    return rows;
}

/**
 * Split a single CSV row, respecting double-quoted fields.
 * Does not handle multiline fields (not needed for BibleData CSVs).
 */
function splitCsvRow(line: string): string[] {
    const result: string[] = [];
    let i = 0;
    while (i < line.length) {
        if (line[i] === '"') {
            // Quoted field
            let field = '';
            i++; // skip opening quote
            while (i < line.length) {
                if (line[i] === '"' && line[i + 1] === '"') {
                    field += '"';
                    i += 2;
                } else if (line[i] === '"') {
                    i++; // skip closing quote
                    break;
                } else {
                    field += line[i++];
                }
            }
            result.push(field);
            if (line[i] === ',') i++; // skip delimiter
        } else {
            // Unquoted field
            const start = i;
            while (i < line.length && line[i] !== ',') i++;
            result.push(line.slice(start, i));
            if (line[i] === ',') i++;
        }
    }
    return result;
}

// ─── Name normalization ───────────────────────────────────────

/**
 * Normalize a person name for matching: lowercase, strip punctuation, collapse whitespace.
 * Intentionally conservative — no stemming or alias expansion.
 */
function normalizeName(name: string): string {
    return name
        .toLowerCase()
        .trim()
        .replace(/[^a-z0-9\s]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

// ─── Parsers ──────────────────────────────────────────────────

function parseBibleDataPersons(csv: string): BibleDataPerson[] {
    const rows = parseCsv(csv);
    const persons: BibleDataPerson[] = [];
    for (const row of rows) {
        const personId   = row['person_id']?.trim();
        const personName = row['person_name']?.trim();
        if (personId && personName) {
            persons.push({ personId, personName });
        }
    }
    return persons;
}

function parseBibleDataLabels(csv: string): BibleDataLabel[] {
    const rows = parseCsv(csv);
    const labels: BibleDataLabel[] = [];
    for (const row of rows) {
        const personId      = row['person_id']?.trim();
        const englishLabel  = row['english_label']?.trim() ?? '';
        const labelType     = row['label_type']?.trim() ?? '';
        const hebrewMeaning = row['hebrew_label_meaning']?.trim() ?? '';
        const greekMeaning  = row['greek_label_meaning']?.trim() ?? '';
        if (personId) {
            labels.push({ personId, englishLabel, labelType, hebrewMeaning, greekMeaning });
        }
    }
    return labels;
}

// ─── Meaning selection ────────────────────────────────────────

/**
 * Pick the best name meaning string from a person's PersonLabel rows.
 *
 * Priority:
 *   1. Proper Name label whose english_label matches the display name, with Hebrew meaning
 *   2. Proper Name label with Hebrew meaning (any)
 *   3. Any label with Hebrew meaning
 *   4. Proper Name label whose english_label matches the display name, with Greek meaning
 *   5. Proper Name label with Greek meaning (any)
 *   6. Any label with Greek meaning
 *
 * The displayName match in step 1 handles cases like Abram_1 having two proper-name
 * labels: "Abram" and "Abraham". When the Theographic person is named "Abraham" we
 * should return "father of many" (the Abraham label) rather than "exalted father"
 * (the Abram label).
 *
 * Returns null if no usable meaning is found.
 */
function selectBestMeaning(labels: BibleDataLabel[], displayName: string): string | null {
    const isProperName = (l: BibleDataLabel) =>
        l.labelType.toLowerCase().includes('proper') || l.labelType.toLowerCase().includes('name');

    const nameMatch = (l: BibleDataLabel) =>
        normalizeName(l.englishLabel) === normalizeName(displayName);

    // 1. Proper Name + name matches display name + Hebrew meaning
    const exactNameHebrew = labels.find(l => isProperName(l) && nameMatch(l) && l.hebrewMeaning);
    if (exactNameHebrew) return exactNameHebrew.hebrewMeaning;

    // 2. Any Proper Name + Hebrew meaning
    const properNameHebrew = labels.find(l => isProperName(l) && l.hebrewMeaning);
    if (properNameHebrew) return properNameHebrew.hebrewMeaning;

    // 3. Any Hebrew meaning
    const anyHebrew = labels.find(l => l.hebrewMeaning);
    if (anyHebrew) return anyHebrew.hebrewMeaning;

    // 4. Proper Name + name matches display name + Greek meaning
    const exactNameGreek = labels.find(l => isProperName(l) && nameMatch(l) && l.greekMeaning);
    if (exactNameGreek) return exactNameGreek.greekMeaning;

    // 5. Any Proper Name + Greek meaning
    const properNameGreek = labels.find(l => isProperName(l) && l.greekMeaning);
    if (properNameGreek) return properNameGreek.greekMeaning;

    // 6. Any Greek meaning
    const anyGreek = labels.find(l => l.greekMeaning);
    if (anyGreek) return anyGreek.greekMeaning;

    return null;
}

// ─── Main enrichment pass ─────────────────────────────────────

function enrich(): void {
    for (const [label, filePath] of [
        ['persons.json', PERSONS_JSON],
        ['BibleData-Person.csv', PERSON_CSV],
        ['BibleData-PersonLabel.csv', LABEL_CSV],
    ] as const) {
        if (!fs.existsSync(filePath)) {
            console.error(`[enrich-persons] ERROR: ${filePath} not found.`);
            if (label === 'persons.json') {
                console.error('  Run: cd packages/data-pipeline && pnpm run import:theographic');
            } else {
                console.error('  Run: cd packages/data-pipeline && pnpm run fetch:bibledata');
            }
            process.exit(1);
        }
    }

    const persons: Person[] = JSON.parse(fs.readFileSync(PERSONS_JSON, 'utf-8'));
    const bdPersons = parseBibleDataPersons(fs.readFileSync(PERSON_CSV, 'utf-8'));
    const bdLabels  = parseBibleDataLabels(fs.readFileSync(LABEL_CSV, 'utf-8'));

    console.log(`[enrich-persons] Loaded ${persons.length} Theographic persons`);
    console.log(`[enrich-persons] Loaded ${bdPersons.length} BibleData persons`);
    console.log(`[enrich-persons] Loaded ${bdLabels.length} BibleData PersonLabel rows`);

    // ── Build BibleData indexes ────────────────────────────────

    // normalized person_name → list of BibleData person_id values
    const bdByName = new Map<string, string[]>();
    for (const { personId, personName } of bdPersons) {
        const key = normalizeName(personName);
        if (!bdByName.has(key)) bdByName.set(key, []);
        bdByName.get(key)!.push(personId);
    }

    // person_id → list of PersonLabel rows
    const bdLabelsByPersonId = new Map<string, BibleDataLabel[]>();
    for (const label of bdLabels) {
        if (!bdLabelsByPersonId.has(label.personId)) bdLabelsByPersonId.set(label.personId, []);
        bdLabelsByPersonId.get(label.personId)!.push(label);
    }

    // Secondary index: normalized english_label (proper name type only) → person_id.
    // Used when person_name in Person.csv differs from the well-known English name
    // (e.g. "Abram" in Person.csv, but "Abraham" as a proper-name label in PersonLabel.csv).
    const bdByProperLabel = new Map<string, string[]>();
    for (const label of bdLabels) {
        if (!label.labelType.toLowerCase().includes('proper') &&
            !label.labelType.toLowerCase().includes('name')) continue;
        if (!label.englishLabel) continue;
        const key = normalizeName(label.englishLabel);
        if (!bdByProperLabel.has(key)) bdByProperLabel.set(key, []);
        // Only add if not already in the list
        if (!bdByProperLabel.get(key)!.includes(label.personId)) {
            bdByProperLabel.get(key)!.push(label.personId);
        }
    }

    // ── Counters ───────────────────────────────────────────────

    let enriched         = 0;
    let noMatch          = 0;
    let ambiguous        = 0;
    let noMeaning        = 0;
    let labelFallback    = 0;

    // ── Enrich pass ────────────────────────────────────────────

    for (const person of persons) {
        const key = normalizeName(person.name);
        let matches = bdByName.get(key);
        let usedFallback = false;

        if (!matches || matches.length === 0) {
            // Secondary: look up by proper-name label (e.g. "Abraham" when Person.csv has "Abram")
            matches = bdByProperLabel.get(key);
            usedFallback = true;
        }

        if (!matches || matches.length === 0) {
            noMatch++;
            continue;
        }

        if (matches.length > 1) {
            // Multiple distinct BibleData persons share this normalized name — skip
            ambiguous++;
            continue;
        }

        const personId = matches[0];
        const labels   = bdLabelsByPersonId.get(personId) ?? [];
        const meaning  = selectBestMeaning(labels, person.name);

        if (!meaning) {
            noMeaning++;
            continue;
        }

        person.nameMeaning       = meaning;
        person.nameMeaningSource = 'bibledata';
        enriched++;
        if (usedFallback) labelFallback++;
    }

    // ── Write output ───────────────────────────────────────────

    fs.writeFileSync(PERSONS_JSON, JSON.stringify(persons, null, 2), 'utf-8');

    // ── Summary ────────────────────────────────────────────────

    console.log('\n[enrich-persons] ── Summary ──────────────────────────────────');
    console.log(`  Theographic persons total:        ${persons.length}`);
    console.log(`  BibleData persons loaded:         ${bdPersons.length}`);
    console.log(`  Enriched (meaning attached):      ${enriched}`);
    console.log(`  No BibleData match:               ${noMatch} — skipped`);
    console.log(`  Ambiguous name (multiple matches): ${ambiguous} — skipped`);
    console.log(`  Match found but no meaning text:  ${noMeaning} — skipped`);
    console.log(`  (of which via label fallback:     ${labelFallback})`);
    console.log(`[enrich-persons] Written: ${PERSONS_JSON}`);
}

enrich();
