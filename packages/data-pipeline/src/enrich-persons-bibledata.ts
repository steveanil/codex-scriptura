/**
 * Enrich processed Theographic persons with name meanings from BibleData PersonLabel.
 *
 * Input:
 *   data/processed/persons.json                              — Theographic person records
 *   data/texts/bibledata/BibleData-Person.csv                — BibleData person list (id → name)
 *   data/texts/bibledata/BibleData-PersonLabel.csv           — BibleData name labels (meaning, etymology)
 *   data/texts/bibledata/BibleData-PersonRelationship.csv    — BibleData genealogy edges
 *   data/theographic/People.csv                              — Theographic family columns (father/mother/partners/children/siblings)
 *
 * Output:
 *   data/processed/persons.json                          — Overwritten in-place with enriched records
 *   data/processed/_metadata/resolution-map.json         — Updated with bibledata person ID mappings
 *   data/processed/_metadata/conflicts.json              — Updated with unresolvable ambiguities
 *
 * HOW TO GET THE BIBLEDATA FILES:
 *   cd packages/data-pipeline && pnpm run fetch:bibledata
 *
 * RESOLUTION STRATEGY (domain: persons; Theographic primary, BibleData enrichment):
 *
 *   Stage 1 — Direct ID match (confidence 1.0):
 *     Theographic IDs use snake_case (e.g. "john_1"); BibleData IDs use PascalCase (e.g. "John_1").
 *     Lowercasing both sides produces an exact key match for the vast majority of persons.
 *     This is the primary signal and resolves most ambiguous-name cases.
 *
 *   Stage 2 — Name match, unique (confidence 0.95):
 *     For the minority of persons whose IDs differ between datasets, fall back to
 *     normalized-name matching. A match is only accepted when exactly one BibleData
 *     person shares the normalized name.
 *
 *   Stage 3 — ID discriminant within name candidates (confidence 0.90):
 *     When multiple BibleData persons share a name (e.g. four different "Judas" persons),
 *     try to pick the one whose lowercased ID matches the Theographic ID. This catches
 *     cases where Stage 1's direct lookup misses due to a different key format while
 *     Stage 2 would report ambiguity.
 *
 *   Stage 4 — Proper-name label fallback (confidence 0.80):
 *     For persons whose BibleData person_name uses an alternate form (e.g. "Abram" when
 *     the Theographic name is "Abraham"), search the PersonLabel table for a matching
 *     proper-name label. Only accepted when exactly one candidate is found.
 *
 *   Stage 5 — Genealogy-context disambiguation (confidence 0.85):  [TWO-PASS]
 *     After Pass 1 resolves every person it can via Stages 1–4, a second pass targets
 *     the remaining ambiguous persons. For each ambiguous person, the Theographic family
 *     columns (father, mother, partners, children, siblings) are consulted. Any relative
 *     that was already resolved in Pass 1 provides an "anchor" BibleData ID. We then
 *     check BibleData's relationship graph: among the ambiguous candidates, which one
 *     has an edge to that anchor? If exactly one candidate does, it is selected.
 *     This signal is structurally independent of name similarity.
 *
 *   Record ambiguous + skip:
 *     Truly ambiguous cases (multiple candidates, no ID discriminant available, no
 *     genealogy anchor) are written to conflicts.json for manual review.
 *
 * Run from repo root:
 *   cd packages/data-pipeline && pnpm run enrich:persons
 */

import fs from 'node:fs';
import path from 'node:path';
import { normalizeName, ResolutionMap } from './core/entity-resolver.js';
import { ConflictStore } from './core/conflict-store.js';
import { dataDir } from './core/paths.js';
import type { SourceRef } from './core/types.js';

// ─── Paths ────────────────────────────────────────────────────

const PERSONS_JSON      = path.join(dataDir, 'processed', 'persons.json');
const PERSON_CSV        = path.join(dataDir, 'texts', 'bibledata', 'BibleData-Person.csv');
const LABEL_CSV         = path.join(dataDir, 'texts', 'bibledata', 'BibleData-PersonLabel.csv');
const RELATIONSHIP_CSV  = path.join(dataDir, 'texts', 'bibledata', 'BibleData-PersonRelationship.csv');
const THEOGRAPHIC_PEOPLE_CSV = path.join(dataDir, 'theographic', 'People.csv');
const METADATA_DIR      = path.join(dataDir, 'processed', '_metadata');
const RESOLUTION_MAP    = path.join(METADATA_DIR, 'resolution-map.json');
const CONFLICTS_JSON    = path.join(METADATA_DIR, 'conflicts.json');

// ─── Local types ──────────────────────────────────────────────

type Person = {
    id: string;
    name: string;
    gender?: string;
    verseRefs: string[];
    nameMeaning?: string;
    nameMeaningSource?: 'bibledata';
    bibleDataId?: string;
    sources?: SourceRef[];
};

type BibleDataPerson = {
    personId: string;
    personName: string;
};

type BibleDataLabel = {
    personId: string;
    englishLabel: string;
    labelType: string;
    hebrewMeaning: string;
    greekMeaning: string;
};

// ─── Resolution result ────────────────────────────────────────

type MatchStage = 'id-direct' | 'name-unique' | 'id-discriminant' | 'label-fallback' | 'genealogy-context';

type MatchResult =
    | { resolved: true; bdPersonId: string; stage: MatchStage }
    | { resolved: false; reason: 'no-match' | 'ambiguous'; candidates: string[] };

// ─── Simple CSV parser ────────────────────────────────────────

function parseCsv(content: string): Record<string, string>[] {
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

function splitCsvRow(line: string): string[] {
    const result: string[] = [];
    let i = 0;
    while (i < line.length) {
        if (line[i] === '"') {
            let field = '';
            i++;
            while (i < line.length) {
                if (line[i] === '"' && line[i + 1] === '"') {
                    field += '"';
                    i += 2;
                } else if (line[i] === '"') {
                    i++;
                    break;
                } else {
                    field += line[i++];
                }
            }
            result.push(field);
            if (line[i] === ',') i++;
        } else {
            const start = i;
            while (i < line.length && line[i] !== ',') i++;
            result.push(line.slice(start, i));
            if (line[i] === ',') i++;
        }
    }
    return result;
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

// ─── Relationship / family parsers ───────────────────────────

/**
 * Build a neighbor-set index from BibleData-PersonRelationship.csv.
 * Returns Map<bdPersonId, Set<bdPersonId>> covering all relationship types.
 * Used by Stage 5 as a fast "are these two persons related?" lookup.
 */
function parseBdRelationships(csv: string): Map<string, Set<string>> {
    const neighbors = new Map<string, Set<string>>();

    const addEdge = (a: string, b: string) => {
        if (!neighbors.has(a)) neighbors.set(a, new Set());
        neighbors.get(a)!.add(b);
    };

    const rows = parseCsv(csv);
    for (const row of rows) {
        const id1 = row['person_id_1']?.trim();
        const id2 = row['person_id_2']?.trim();
        if (id1 && id2) {
            addEdge(id1, id2);
            addEdge(id2, id1);
        }
    }
    return neighbors;
}

/**
 * Parse Theographic People.csv for the family columns only.
 * Returns Map<theoId, string[]> where each value is the list of related Theographic IDs
 * (from father, mother, partners, children, siblings columns combined).
 *
 * Note: The RFC-4180 CSV parser in import-theographic.ts handles multi-line quoted fields
 * correctly. Here we use the simpler parseCsv (which splits on \r?\n lines) because
 * the family columns never contain embedded newlines — they're comma-separated ID lists.
 */
function parseTheoFamily(csv: string): Map<string, string[]> {
    const rows = parseCsv(csv);
    const result = new Map<string, string[]>();

    for (const row of rows) {
        const id = (row['personLookup'] ?? '').trim();
        if (!id) continue;

        const relatives: string[] = [];
        for (const col of ['father', 'mother', 'partners', 'children', 'siblings']) {
            const raw = (row[col] ?? '').trim();
            if (!raw) continue;
            for (const rel of raw.split(',')) {
                const relId = rel.trim();
                if (relId) relatives.push(relId);
            }
        }
        result.set(id, relatives);
    }
    return result;
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
 * should return "father of many" not "exalted father".
 */
function selectBestMeaning(labels: BibleDataLabel[], displayName: string): string | null {
    const isProperName = (l: BibleDataLabel) =>
        l.labelType.toLowerCase().includes('proper') || l.labelType.toLowerCase().includes('name');
    const nameMatch = (l: BibleDataLabel) =>
        normalizeName(l.englishLabel) === normalizeName(displayName);

    const exactNameHebrew  = labels.find(l => isProperName(l) && nameMatch(l) && l.hebrewMeaning);
    if (exactNameHebrew) return exactNameHebrew.hebrewMeaning;

    const properNameHebrew = labels.find(l => isProperName(l) && l.hebrewMeaning);
    if (properNameHebrew) return properNameHebrew.hebrewMeaning;

    const anyHebrew        = labels.find(l => l.hebrewMeaning);
    if (anyHebrew) return anyHebrew.hebrewMeaning;

    const exactNameGreek   = labels.find(l => isProperName(l) && nameMatch(l) && l.greekMeaning);
    if (exactNameGreek) return exactNameGreek.greekMeaning;

    const properNameGreek  = labels.find(l => isProperName(l) && l.greekMeaning);
    if (properNameGreek) return properNameGreek.greekMeaning;

    const anyGreek         = labels.find(l => l.greekMeaning);
    if (anyGreek) return anyGreek.greekMeaning;

    return null;
}

// ─── Resolver ─────────────────────────────────────────────────

/**
 * Attempt to resolve a Theographic person to a BibleData person_id.
 *
 * Applies the four-stage resolution strategy documented at the top of this file.
 * Returns a typed MatchResult so the caller knows exactly which stage succeeded or failed.
 */
function resolvePersonMatch(
    person: Person,
    bdById: Map<string, string>,
    bdByName: Map<string, string[]>,
    bdByProperLabel: Map<string, string[]>,
): MatchResult {
    // ── Stage 1: Direct ID match ───────────────────────────────
    // Theographic: "john_1" — BibleData: "John_1"
    // A case-fold is sufficient for the vast majority of persons.
    const idDirect = bdById.get(person.id.toLowerCase());
    if (idDirect) {
        return { resolved: true, bdPersonId: idDirect, stage: 'id-direct' };
    }

    // ── Stage 2: Name match (unique) ───────────────────────────
    const key = normalizeName(person.name);
    const nameCandidates = bdByName.get(key) ?? [];

    if (nameCandidates.length === 1) {
        return { resolved: true, bdPersonId: nameCandidates[0], stage: 'name-unique' };
    }

    // ── Stage 3: ID discriminant within name candidates ────────
    // Multiple BibleData persons share this name. Try to pick the one
    // whose lowercased ID matches the Theographic ID.
    if (nameCandidates.length > 1) {
        const tgIdLower = person.id.toLowerCase();
        const idHit = nameCandidates.find(bdId => bdId.toLowerCase() === tgIdLower);
        if (idHit) {
            return { resolved: true, bdPersonId: idHit, stage: 'id-discriminant' };
        }
    }

    // ── Stage 4: Proper-name label fallback ────────────────────
    // Handles name variants (e.g. Theographic "Abraham" vs BibleData person_name "Abram").
    const labelCandidates = bdByProperLabel.get(key) ?? [];

    if (labelCandidates.length === 1) {
        return { resolved: true, bdPersonId: labelCandidates[0], stage: 'label-fallback' };
    }

    // ── Unresolvable ───────────────────────────────────────────
    const allCandidates = nameCandidates.length > 0 ? nameCandidates : labelCandidates;
    if (allCandidates.length === 0) {
        return { resolved: false, reason: 'no-match', candidates: [] };
    }

    return { resolved: false, reason: 'ambiguous', candidates: allCandidates };
}

/**
 * Stage 5: Genealogy-context disambiguation.
 *
 * For a person that was ambiguous after Stages 1–4, use Theographic family columns
 * (father, mother, partners, children, siblings) as anchors. Any relative that was
 * already resolved in Pass 1 gives us an anchor BibleData ID. We then check the
 * BibleData relationship graph: among the ambiguous candidates, which one has an
 * edge to that anchor? If exactly one candidate does, return it.
 *
 * This signal is structurally independent of name similarity — it works for persons
 * who share a common name (e.g. "Zechariah") but are distinguished by their family.
 */
function resolveByGenealogyContext(
    theoId: string,
    candidates: string[],
    theoFamily: Map<string, string[]>,
    bdNeighbors: Map<string, Set<string>>,
    resolvedTheoToBd: Map<string, string>,
): MatchResult {
    const relatives = theoFamily.get(theoId) ?? [];
    if (relatives.length === 0) {
        return { resolved: false, reason: 'ambiguous', candidates };
    }

    // Collect all anchor BibleData IDs from relatives already resolved in Pass 1
    const anchors: string[] = [];
    for (const relTheoId of relatives) {
        const relBdId = resolvedTheoToBd.get(relTheoId);
        if (relBdId) anchors.push(relBdId);
    }

    if (anchors.length === 0) {
        return { resolved: false, reason: 'ambiguous', candidates };
    }

    // Score each candidate: how many anchors does it share an edge with?
    const scores = new Map<string, number>();
    for (const candidate of candidates) {
        const neighborSet = bdNeighbors.get(candidate) ?? new Set();
        let score = 0;
        for (const anchor of anchors) {
            if (neighborSet.has(anchor)) score++;
        }
        scores.set(candidate, score);
    }

    const maxScore = Math.max(...scores.values());
    if (maxScore === 0) {
        return { resolved: false, reason: 'ambiguous', candidates };
    }

    const winners = candidates.filter(c => (scores.get(c) ?? 0) === maxScore);
    if (winners.length === 1) {
        return { resolved: true, bdPersonId: winners[0], stage: 'genealogy-context' };
    }

    // Still tied — still ambiguous, but with a reduced candidate set
    return { resolved: false, reason: 'ambiguous', candidates: winners };
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

    // Stage 5 inputs are optional — warn but continue without them
    const hasRelationships = fs.existsSync(RELATIONSHIP_CSV);
    const hasTheoFamily    = fs.existsSync(THEOGRAPHIC_PEOPLE_CSV);
    if (!hasRelationships) {
        console.warn(`[enrich-persons] WARNING: ${RELATIONSHIP_CSV} not found — Stage 5 (genealogy-context) disabled`);
        console.warn('  Run: cd packages/data-pipeline && pnpm run fetch:bibledata');
    }
    if (!hasTheoFamily) {
        console.warn(`[enrich-persons] WARNING: ${THEOGRAPHIC_PEOPLE_CSV} not found — Stage 5 (genealogy-context) disabled`);
    }

    const persons: Person[] = JSON.parse(fs.readFileSync(PERSONS_JSON, 'utf-8'));
    const bdPersons = parseBibleDataPersons(fs.readFileSync(PERSON_CSV, 'utf-8'));
    const bdLabels  = parseBibleDataLabels(fs.readFileSync(LABEL_CSV, 'utf-8'));

    console.log(`[enrich-persons] Input: ${persons.length} Theographic persons`);
    console.log(`[enrich-persons] Input: ${bdPersons.length} BibleData persons`);
    console.log(`[enrich-persons] Input: ${bdLabels.length} BibleData PersonLabel rows`);

    // ── Initialize pipeline infrastructure ────────────────────

    const resolver = new ResolutionMap();
    resolver.load(RESOLUTION_MAP);
    const resolverSizeBefore = resolver.size;

    const conflicts = new ConflictStore();
    conflicts.load(CONFLICTS_JSON);
    const conflictSizeBefore = conflicts.size;

    // ── Build BibleData indexes (Stages 1–4) ──────────────────

    // Stage 1 index: personId.toLowerCase() → original personId (direct ID match)
    const bdById = new Map<string, string>();
    for (const { personId } of bdPersons) {
        bdById.set(personId.toLowerCase(), personId);
    }

    // Stage 2/3 index: normalizeName(person_name) → list of personIds (name match)
    const bdByName = new Map<string, string[]>();
    for (const { personId, personName } of bdPersons) {
        const key = normalizeName(personName);
        if (!bdByName.has(key)) bdByName.set(key, []);
        bdByName.get(key)!.push(personId);
    }

    // person_id → PersonLabel rows
    const bdLabelsByPersonId = new Map<string, BibleDataLabel[]>();
    for (const label of bdLabels) {
        if (!bdLabelsByPersonId.has(label.personId)) bdLabelsByPersonId.set(label.personId, []);
        bdLabelsByPersonId.get(label.personId)!.push(label);
    }

    // Stage 4 index: normalized proper-name label → personId (label fallback)
    const bdByProperLabel = new Map<string, string[]>();
    for (const label of bdLabels) {
        if (!label.labelType.toLowerCase().includes('proper') &&
            !label.labelType.toLowerCase().includes('name')) continue;
        if (!label.englishLabel) continue;
        const key = normalizeName(label.englishLabel);
        if (!bdByProperLabel.has(key)) bdByProperLabel.set(key, []);
        if (!bdByProperLabel.get(key)!.includes(label.personId)) {
            bdByProperLabel.get(key)!.push(label.personId);
        }
    }

    // ── Build Stage 5 indexes (genealogy-context) ─────────────

    const bdNeighbors = (hasRelationships)
        ? parseBdRelationships(fs.readFileSync(RELATIONSHIP_CSV, 'utf-8'))
        : new Map<string, Set<string>>();

    const theoFamily = (hasTheoFamily)
        ? parseTheoFamily(fs.readFileSync(THEOGRAPHIC_PEOPLE_CSV, 'utf-8'))
        : new Map<string, string[]>();

    if (hasRelationships && hasTheoFamily) {
        console.log(`[enrich-persons] Input: ${bdNeighbors.size} BibleData persons with relationship edges`);
        console.log(`[enrich-persons] Input: ${theoFamily.size} Theographic persons with family columns`);
    }

    // ── Stage-local counters ───────────────────────────────────

    const byStage: Record<MatchStage, number> = {
        'id-direct':          0,
        'name-unique':        0,
        'id-discriminant':    0,
        'label-fallback':     0,
        'genealogy-context':  0,
    };
    let noMatch       = 0;
    let ambiguous     = 0;
    let noMeaning     = 0;
    let enriched      = 0;

    // For ambiguity diagnostics: track candidate counts per ambiguous name
    const ambigCounts = new Map<string, number>(); // normalized name → candidate count

    // ── Pass 1: Stages 1–4 ────────────────────────────────────
    // Resolve every person we can without cross-person context.
    // Collect: resolved theoId → bdId (for Stage 5 anchors)
    //          deferred: persons that were ambiguous, with their candidates

    // theoId → { bdPersonId, stage } for all persons resolved in either pass
    const resolved = new Map<string, { bdPersonId: string; stage: MatchStage }>();

    type Deferred = { person: Person; candidates: string[] };
    const deferred: Deferred[] = [];

    for (const person of persons) {
        const match = resolvePersonMatch(person, bdById, bdByName, bdByProperLabel);

        if (!match.resolved) {
            if (match.reason === 'no-match') {
                noMatch++;
            } else {
                deferred.push({ person, candidates: match.candidates });
            }
            continue;
        }

        byStage[match.stage]++;
        resolved.set(person.id, { bdPersonId: match.bdPersonId, stage: match.stage });
    }

    // ── Pass 2: Stage 5 for deferred ambiguous persons ────────

    // Build the theoId → bdId anchor map from Pass 1 results
    const resolvedTheoToBd = new Map<string, string>();
    for (const [theoId, { bdPersonId }] of resolved) {
        resolvedTheoToBd.set(theoId, bdPersonId);
    }

    for (const { person, candidates } of deferred) {
        let finalMatch: MatchResult;

        if (hasRelationships && hasTheoFamily) {
            finalMatch = resolveByGenealogyContext(
                person.id, candidates, theoFamily, bdNeighbors, resolvedTheoToBd,
            );
        } else {
            finalMatch = { resolved: false, reason: 'ambiguous', candidates };
        }

        if (finalMatch.resolved) {
            byStage[finalMatch.stage]++;
            resolved.set(person.id, { bdPersonId: finalMatch.bdPersonId, stage: finalMatch.stage });
        } else {
            // Still ambiguous after all stages — record conflict
            const key = normalizeName(person.name);
            ambigCounts.set(key, Math.max(ambigCounts.get(key) ?? 0, finalMatch.candidates.length));
            conflicts.add({
                id: `person:${person.id}:bibledata-match`,
                entityType: 'person',
                entityId: person.id,
                field: 'bibledata-match',
                claims: finalMatch.candidates.map(bdId => ({
                    sourceId: 'bibledata',
                    value: bdId,
                    note: `Ambiguous after all 5 resolution stages: name="${key}", candidates=${finalMatch.candidates.length}`,
                })),
            });
            ambiguous++;
        }
    }

    // ── Apply enrichment for all resolved persons ──────────────

    for (const person of persons) {
        const resolution = resolved.get(person.id);
        if (!resolution) continue;

        const { bdPersonId, stage } = resolution;
        const labels  = bdLabelsByPersonId.get(bdPersonId) ?? [];
        const meaning = selectBestMeaning(labels, person.name);

        if (!meaning) {
            noMeaning++;
            continue;
        }

        // ── Record resolution mapping ──────────────────────────

        resolver.add({
            canonicalId: person.id,
            entityType:  'person',
            externalIds: { bibledata: bdPersonId },
            method: (stage === 'id-direct' || stage === 'id-discriminant')
                ? 'id-pattern'
                : stage === 'name-unique' ? 'exact-name'
                : 'normalized-name',
            confidence: stage === 'id-direct'         ? 1.0
                : stage === 'id-discriminant'          ? 0.9
                : stage === 'name-unique'              ? 0.95
                : stage === 'genealogy-context'        ? 0.85
                : 0.8, // label-fallback
        });

        // ── Build SourceRef array ──────────────────────────────

        const existingSources: SourceRef[] = person.sources ?? [];
        const filtered = existingSources.filter(s => s.sourceId !== 'bibledata');
        const updatedSources: SourceRef[] = [
            ...filtered,
            { sourceId: 'bibledata', externalId: bdPersonId, fields: ['nameMeaning', 'nameMeaningSource'] },
        ];

        // ── Apply enrichment ───────────────────────────────────

        person.nameMeaning       = meaning;
        person.nameMeaningSource = 'bibledata';
        person.bibleDataId       = bdPersonId;
        person.sources           = updatedSources;
        enriched++;
    }

    // ── Write output ───────────────────────────────────────────

    fs.writeFileSync(PERSONS_JSON, JSON.stringify(persons), 'utf-8');

    if (!fs.existsSync(METADATA_DIR)) {
        fs.mkdirSync(METADATA_DIR, { recursive: true });
    }
    resolver.save(RESOLUTION_MAP);
    conflicts.save(CONFLICTS_JSON);

    // ── Summary ────────────────────────────────────────────────

    const resolverDelta  = resolver.size - resolverSizeBefore;
    const conflictDelta  = conflicts.size - conflictSizeBefore;
    const enrichRate     = persons.length > 0 ? ((enriched / persons.length) * 100).toFixed(1) : '0';

    console.log('\n[enrich-persons] ── Resolution by stage ─────────────────────');
    console.log(`  Stage 1 — id-direct:           ${byStage['id-direct']}  (confidence 1.00)`);
    console.log(`  Stage 2 — name-unique:         ${byStage['name-unique']}  (confidence 0.95)`);
    console.log(`  Stage 3 — id-discriminant:     ${byStage['id-discriminant']}  (confidence 0.90)`);
    console.log(`  Stage 4 — label-fallback:      ${byStage['label-fallback']}  (confidence 0.80)`);
    console.log(`  Stage 5 — genealogy-context:   ${byStage['genealogy-context']}  (confidence 0.85)${hasRelationships && hasTheoFamily ? '' : '  [disabled — inputs missing]'}`);
    console.log(`  No BibleData match:            ${noMatch}`);
    console.log(`  Ambiguous (all stages):        ${ambiguous}`);
    console.log(`  Resolved but no meaning:    ${noMeaning}`);

    console.log('\n[enrich-persons] ── Enrichment results ──────────────────────');
    console.log(`  Persons enriched this run:  ${enriched} / ${persons.length}  (${enrichRate}%)`);

    console.log('\n[enrich-persons] ── Metadata delta ──────────────────────────');
    console.log(`  Resolution map:  +${resolverDelta} new entries  (${resolver.size} total)`);
    console.log(`  Conflicts:       +${conflictDelta} new records   (${conflicts.size} total)`);

    if (ambiguous > 0) {
        // Show top-10 ambiguous names sorted by candidate count (most contested first)
        const topAmbig = [...ambigCounts.entries()]
            .sort((a, b) => b[1] - a[1])
            .slice(0, 10);
        console.log('\n[enrich-persons] ── Top ambiguous names (for manual review) ──');
        for (const [name, count] of topAmbig) {
            console.log(`  "${name}"  →  ${count} BibleData candidates`);
        }
        console.log(`  (Full list in ${CONFLICTS_JSON})`);
    }

    console.log(`\n[enrich-persons] Written: ${PERSONS_JSON}`);
    console.log(`[enrich-persons] Written: ${RESOLUTION_MAP}`);
    console.log(`[enrich-persons] Written: ${CONFLICTS_JSON}`);
}

enrich();
