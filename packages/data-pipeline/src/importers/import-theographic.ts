import fs from 'node:fs';
import path from 'node:path';
import { parseCsv } from '../core/csv.js';
import type { SourceRef } from '../core/types.js';

// Inline types — mirrors packages/core/src/types.ts Theographic section.
// Kept local to avoid module resolution issues in the data-pipeline package.
type Person = {
    id: string;
    name: string;
    gender?: string;
    verseRefs: string[];
    description?: string;
    sources?: SourceRef[];
};

type Place = {
    id: string;
    name: string;
    lat?: number;
    lng?: number;
    confidence?: number;
    verseRefs: string[];
    description?: string;
    sources?: SourceRef[];
};

type BibleEvent = {
    id: string;
    name: string;
    date?: string;
    verseRefs: string[];
    description?: string;
    sources?: SourceRef[];
};

type DictionaryEntry = {
    id: string;
    term: string;
    definition: string;
};

/**
 * Theographic CSV importer.
 *
 * Supports the Theographic Bible Metadata dataset (viz.bible / OpenBible.info).
 *
 * Expected CSV source files (place in data/theographic/):
 *   People.csv  — columns: personId, displayTitle (or Person), verses, description?
 *   Places.csv  — columns: placeId, displayTitle (or Place), latitude, longitude, verses, description?
 *   Events.csv  — columns: eventId, displayTitle (or Title/Event), verses, date?, description?
 *   Easton.csv  — columns: word (or Term), definition (or Definition)
 *
 * The `verses` column must contain semicolon-separated OSIS IDs (e.g. "Gen.1.1;Matt.3.16").
 */

// ─── Text Cleanup ──────────────────────────────────────────

/**
 * Strip Markdown-style hyperlinks from Easton's dictText fields.
 * "[Ex. 6:20](/exod#Exod.6.20)" → "Ex. 6:20"
 * Leaves all other content intact.
 */
function stripMarkdownLinks(text: string): string {
    return text.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1');
}

// ─── Column Resolution ─────────────────────────────────────

/** Return the first matching column value, or '' if none found. */
function col(row: Record<string, string>, ...names: string[]): string {
    for (const name of names) {
        if (name in row) return row[name];
    }
    return '';
}

// ─── Verse Ref Normalization ───────────────────────────────

/**
 * Normalize a raw verse reference string from Theographic CSVs.
 *
 * Rules:
 *   - Split on commas or semicolons (Theographic uses commas; other sources may use semicolons)
 *   - Each segment must match OSIS single-verse format: Word.Number.Number
 *     (e.g. "Gen.1.1", "Matt.3.16", "1Kgs.4.7", "2Kgs.5.12")
 *   - Trim whitespace, remove empty strings
 *   - Deduplicate (preserving first-seen order)
 *
 * Ref ranges (e.g. "Gen.1.1-Gen.1.3") are not expanded — only the start
 * ref is kept. This is conservative: we'd rather miss a partial range hit
 * than index refs that aren't accurate verse-level pointers.
 */
function normalizeVerseRefs(raw: string): string[] {
    if (!raw || !raw.trim()) return [];

    const OSIS_SINGLE = /^\w+\.\d+\.\d+$/;

    const seen = new Set<string>();
    const result: string[] = [];

    for (const segment of raw.split(/[,;]/)) {
        const ref = segment.trim();
        if (!ref) continue;

        // If a range is present, take only the start ref
        const candidate = ref.includes('-') ? ref.split('-')[0].trim() : ref;

        if (OSIS_SINGLE.test(candidate) && !seen.has(candidate)) {
            seen.add(candidate);
            result.push(candidate);
        }
    }

    return result;
}

// ─── Per-type Parsers ──────────────────────────────────────

export function parsePersonsCsv(content: string): Person[] {
    const rows = parseCsv(content);
    const results: Person[] = [];

    for (const row of rows) {
        // personLookup is the slug-style unique key (e.g. "aaron_1")
        const id = col(row, 'personLookup', 'personId', 'personID', 'PersonID', 'ID', 'id').trim();
        const name = col(row, 'displayTitle', 'Person', 'Name', 'name').trim();

        if (!id || !name) continue;

        const rawRefs = col(row, 'verses', 'Verses', 'verseRefs');
        const verseRefs = normalizeVerseRefs(rawRefs);

        const rawGender = col(row, 'gender', 'Gender', 'Sex').trim();
        const gender = rawGender || undefined;

        // dictText holds the Easton's entry embedded inline for each person; strip Markdown links
        const rawDesc = col(row, 'dictText', 'description', 'Description', 'AlsoKnownAs').trim();
        const description = rawDesc ? stripMarkdownLinks(rawDesc) : undefined;

        const fields = ['id', 'name', 'verseRefs'];
        if (gender) fields.push('gender');
        if (description) fields.push('description');

        results.push({
            id,
            name,
            verseRefs,
            ...(gender ? { gender } : {}),
            ...(description ? { description } : {}),
            sources: [{ sourceId: 'theographic', externalId: id, fields }],
        });
    }

    return results;
}

export function parsePlacesCsv(content: string): Place[] {
    const rows = parseCsv(content);
    const results: Place[] = [];

    for (const row of rows) {
        // placeLookup is the slug-style unique key (e.g. "egypt_362")
        const id = col(row, 'placeLookup', 'placeId', 'placeID', 'PlaceID', 'ID', 'id').trim();
        const name = col(row, 'displayTitle', 'Place', 'Name', 'name').trim();

        if (!id || !name) continue;

        const rawRefs = col(row, 'verses', 'Verses', 'verseRefs');
        const verseRefs = normalizeVerseRefs(rawRefs);

        const rawLat = col(row, 'latitude', 'Latitude', 'lat');
        const rawLng = col(row, 'longitude', 'Longitude', 'lng');
        // Theographic uses "precision" for geocoding confidence (0–1)
        const rawConf = col(row, 'precision', 'confidence', 'Confidence');
        const lat = rawLat ? parseFloat(rawLat) : undefined;
        const lng = rawLng ? parseFloat(rawLng) : undefined;
        const confidence = rawConf ? parseFloat(rawConf) : undefined;

        // dictText holds the Easton's entry embedded inline for each place; strip Markdown links
        const rawDesc = col(row, 'dictText', 'description', 'Description').trim();
        const description = rawDesc ? stripMarkdownLinks(rawDesc) : undefined;

        const fields = ['id', 'name', 'verseRefs'];
        if (lat !== undefined && !isNaN(lat)) fields.push('lat');
        if (lng !== undefined && !isNaN(lng)) fields.push('lng');
        if (confidence !== undefined && !isNaN(confidence)) fields.push('confidence');
        if (description) fields.push('description');

        results.push({
            id,
            name,
            verseRefs,
            ...(lat !== undefined && !isNaN(lat) ? { lat } : {}),
            ...(lng !== undefined && !isNaN(lng) ? { lng } : {}),
            ...(confidence !== undefined && !isNaN(confidence) ? { confidence } : {}),
            ...(description ? { description } : {}),
            sources: [{ sourceId: 'theographic', externalId: id, fields }],
        });
    }

    return results;
}

export function parseEventsCsv(content: string): BibleEvent[] {
    const rows = parseCsv(content);
    const results: BibleEvent[] = [];

    for (const row of rows) {
        // eventID is numeric (e.g. "1"), stored as a string
        const id = col(row, 'eventID', 'eventId', 'EventID', 'ID', 'id').trim();
        // Actual column is "title" (lowercase) in Theographic Events.csv
        const name = col(row, 'title', 'displayTitle', 'Title', 'Event', 'Name', 'name').trim();

        if (!id || !name) continue;

        const rawRefs = col(row, 'verses', 'Verses', 'verseRefs');
        const verseRefs = normalizeVerseRefs(rawRefs);

        // startDate is a year integer (negative = BC), e.g. "-4003", "33"
        const date = col(row, 'startDate', 'date', 'Date', 'StartDate', 'duration', 'Duration').trim() || undefined;
        const description = col(row, 'notes', 'description', 'Description').trim() || undefined;

        const fields = ['id', 'name', 'verseRefs'];
        if (date) fields.push('date');
        if (description) fields.push('description');

        results.push({
            id,
            name,
            verseRefs,
            ...(date ? { date } : {}),
            ...(description ? { description } : {}),
            sources: [{ sourceId: 'theographic', externalId: id, fields }],
        });
    }

    return results;
}

export function parseDictionaryCsv(content: string): DictionaryEntry[] {
    const rows = parseCsv(content);
    const results: DictionaryEntry[] = [];
    const seen = new Set<string>();

    for (const row of rows) {
        // Theographic Easton.csv uses "termLabel" for the display term and "dictText" for the definition
        const term = col(row, 'termLabel', 'word', 'Word', 'term', 'Term', 'Name', 'name').trim();
        const rawDef = col(row, 'dictText', 'definition', 'Definition', 'description', 'Description').trim();
        const definition = rawDef ? stripMarkdownLinks(rawDef) : '';

        if (!term || !definition) continue;

        const id = term.toLowerCase();
        if (seen.has(id)) continue;
        seen.add(id);

        results.push({ id, term, definition });
    }

    return results;
}

// ─── File-based Runner ─────────────────────────────────────

function readCsv(filePath: string): string {
    return fs.readFileSync(filePath, 'utf-8');
}

function writeJson(outputPath: string, data: unknown): void {
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, JSON.stringify(data), 'utf-8');
    console.log(`[theographic] Written: ${outputPath} (${(data as unknown[]).length} records)`);
}

export function importTheographic(
    inputDir: string,
    outputDir: string
): void {
    const files = {
        people: path.join(inputDir, 'People.csv'),
        places: path.join(inputDir, 'Places.csv'),
        events: path.join(inputDir, 'Events.csv'),
        easton: path.join(inputDir, 'Easton.csv'),
    };

    let warnedMissing = false;

    function tryImport<T>(file: string, parser: (content: string) => T[], outFile: string): void {
        if (!fs.existsSync(file)) {
            console.warn(`[theographic] Missing: ${file} — skipping`);
            warnedMissing = true;
            return;
        }
        const content = readCsv(file);
        const records = parser(content);
        writeJson(path.join(outputDir, outFile), records);
    }

    tryImport(files.people, parsePersonsCsv, 'persons.json');
    tryImport(files.places, parsePlacesCsv, 'places.json');
    tryImport(files.events, parseEventsCsv, 'events.json');
    tryImport(files.easton, parseDictionaryCsv, 'dictionary.json');

    if (warnedMissing) {
        console.warn('[theographic] Place CSV files in data/theographic/ and re-run.');
    }
}
