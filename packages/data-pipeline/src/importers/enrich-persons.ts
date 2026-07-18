import fs from 'node:fs';
import path from 'node:path';
import { parseCsv } from '../core/csv.js';
import { normalizeName, ResolutionMap } from '../core/entity-resolver.js';
import { ConflictStore } from '../core/conflict-store.js';
import { recordImportRun } from '../core/import-runs.js';
import type { SourceRef } from '../core/types.js';

/**
 * Person enrichment - BibleData name meanings for Theographic persons.
 *
 * RESOLUTION STRATEGY (domain: persons; Theographic primary, BibleData enrichment):
 *
 *   Stage 1 - Direct ID match (confidence 1.0):
 *     Theographic IDs use snake_case (e.g. "john_1"); BibleData IDs use PascalCase (e.g. "John_1").
 *     Lowercasing both sides produces an exact key match for the vast majority of persons.
 *
 *   Stage 2 - Name match, unique (confidence 0.95):
 *     Fall back to normalized-name matching, accepted only when exactly one
 *     BibleData person shares the normalized name.
 *
 *   Stage 3 - ID discriminant within name candidates (confidence 0.90):
 *     When multiple BibleData persons share a name, pick the one whose
 *     lowercased ID matches the Theographic ID.
 *
 *   Stage 4 - Proper-name label fallback (confidence 0.80):
 *     Handles name variants (e.g. Theographic "Abraham" vs BibleData "Abram")
 *     via the PersonLabel table. Accepted only when exactly one candidate exists.
 *
 *   Stage 4b - Base-name fallback (confidence 0.85):
 *     Theographic disambiguates prominent bearers with parenthetical display
 *     names - "Levi (patriarch)", "Jacob (Israel)", "Esau (Edom)" - which match
 *     nothing in BibleData verbatim. Stripping the qualifier and re-running the
 *     name/label lookups either resolves (unique candidate) or produces a
 *     candidate set for Stage 5. Without this, the most-referenced persons in
 *     the corpus land in no-match while their obscure namesakes stay ambiguous.
 *
 *   Stage 5 - Genealogy-context disambiguation (confidence 0.85):  [ITERATED]
 *     For persons still ambiguous after Stages 1–4b, Theographic family columns
 *     provide "anchor" relatives; the BibleData relationship graph then
 *     discriminates between same-named candidates. Runs to a fixed point:
 *     each resolution can unlock relatives in the next round (Isaac resolves →
 *     Jacob resolves → Levi/Judah/Benjamin resolve).
 *
 *   Truly ambiguous cases are recorded in conflicts.json and skipped.
 *
 *   Every resolved person gets a bibleDataId link (consumed by the genealogy
 *   importer's supplement pass) even when no name meaning is available. The
 *   stage confidence is persisted alongside it (bibleDataConfidence) so that
 *   downstream consumers can gate on match quality - the genealogy supplement
 *   refuses low-confidence, uncorroborated links (see import-genealogy.ts
 *   buildExactIdMap).
 */

// ─── Types ────────────────────────────────────────────────────

// Mirrors packages/core/src/types.ts Person - local copy to avoid module resolution issues.
export type Person = {
    id: string;
    name: string;
    gender?: string;
    verseRefs: string[];
    nameMeaning?: string;
    nameMeaningSource?: 'bibledata';
    bibleDataId?: string;
    /** Resolution confidence of the bibleDataId link (STAGE_CONFIDENCE tier). */
    bibleDataConfidence?: number;
    sources?: SourceRef[];
};

export type BibleDataPerson = {
    personId: string;
    personName: string;
};

export type BibleDataLabel = {
    personId: string;
    englishLabel: string;
    labelType: string;
    hebrewMeaning: string;
    greekMeaning: string;
};

export type MatchStage = 'id-direct' | 'name-unique' | 'id-discriminant' | 'label-fallback' | 'base-name' | 'genealogy-context';

export type MatchResult =
    | { resolved: true; bdPersonId: string; stage: MatchStage }
    | { resolved: false; reason: 'no-match' | 'ambiguous'; candidates: string[] };

// ─── Source parsers ───────────────────────────────────────────

export function parseBibleDataPersons(csv: string): BibleDataPerson[] {
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

export function parseBibleDataLabels(csv: string): BibleDataLabel[] {
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

/**
 * Build a neighbor-set index from BibleData-PersonRelationship.csv.
 * Returns Map<bdPersonId, Set<bdPersonId>> covering all relationship types.
 * Used by Stage 5 as a fast "are these two persons related?" lookup.
 */
export function parseBdRelationships(csv: string): Map<string, Set<string>> {
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
 * Returns Map<theoId, string[]> where each value is the list of related
 * Theographic IDs (father, mother, partners, children, siblings combined).
 */
export function parseTheoFamily(csv: string): Map<string, string[]> {
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
export function selectBestMeaning(labels: BibleDataLabel[], displayName: string): string | null {
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

// ─── BibleData indexes ────────────────────────────────────────

export type BdIndexes = {
    /** Stage 1: personId.toLowerCase() → original personId */
    bdById: Map<string, string>;
    /** Stage 2/3: normalizeName(person_name) → personIds */
    bdByName: Map<string, string[]>;
    /** person_id → PersonLabel rows */
    bdLabelsByPersonId: Map<string, BibleDataLabel[]>;
    /** Stage 4: normalized proper-name label → personIds */
    bdByProperLabel: Map<string, string[]>;
};

export function buildBdIndexes(bdPersons: BibleDataPerson[], bdLabels: BibleDataLabel[]): BdIndexes {
    const bdById = new Map<string, string>();
    for (const { personId } of bdPersons) {
        bdById.set(personId.toLowerCase(), personId);
    }

    const bdByName = new Map<string, string[]>();
    for (const { personId, personName } of bdPersons) {
        const key = normalizeName(personName);
        if (!bdByName.has(key)) bdByName.set(key, []);
        bdByName.get(key)!.push(personId);
    }

    const bdLabelsByPersonId = new Map<string, BibleDataLabel[]>();
    for (const label of bdLabels) {
        if (!bdLabelsByPersonId.has(label.personId)) bdLabelsByPersonId.set(label.personId, []);
        bdLabelsByPersonId.get(label.personId)!.push(label);
    }

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

    return { bdById, bdByName, bdLabelsByPersonId, bdByProperLabel };
}

// ─── Resolvers ────────────────────────────────────────────────

/**
 * Extract the normalized base name from a parenthetically-qualified display
 * name: "Levi (patriarch)" → "levi". Returns null when there is no qualifier
 * or stripping it changes nothing.
 */
export function baseNameKey(name: string): string | null {
    const idx = name.indexOf('(');
    if (idx === -1) return null;
    const base = name.slice(0, idx).trim();
    if (!base) return null;
    const key = normalizeName(base);
    return key !== normalizeName(name) ? key : null;
}

/**
 * Attempt to resolve a Theographic person to a BibleData person_id via
 * Stages 1–4b (no cross-person context).
 */
export function resolvePersonMatch(person: Person, indexes: BdIndexes): MatchResult {
    const { bdById, bdByName, bdByProperLabel } = indexes;

    // ── Stage 1: Direct ID match ───────────────────────────────
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
    if (nameCandidates.length > 1) {
        const tgIdLower = person.id.toLowerCase();
        const idHit = nameCandidates.find(bdId => bdId.toLowerCase() === tgIdLower);
        if (idHit) {
            return { resolved: true, bdPersonId: idHit, stage: 'id-discriminant' };
        }
    }

    // ── Stage 4: Proper-name label fallback ────────────────────
    const labelCandidates = bdByProperLabel.get(key) ?? [];

    if (labelCandidates.length === 1) {
        return { resolved: true, bdPersonId: labelCandidates[0], stage: 'label-fallback' };
    }

    // ── Stage 4b: Base-name fallback (qualifier stripped) ──────
    // Only reachable for names like "Levi (patriarch)" that matched nothing
    // above; a unique base-name candidate resolves, multiple feed Stage 5.
    if (nameCandidates.length === 0 && labelCandidates.length === 0) {
        const baseKey = baseNameKey(person.name);
        if (baseKey) {
            const baseNameCands = bdByName.get(baseKey) ?? [];
            if (baseNameCands.length === 1) {
                return { resolved: true, bdPersonId: baseNameCands[0], stage: 'base-name' };
            }
            if (baseNameCands.length > 1) {
                return { resolved: false, reason: 'ambiguous', candidates: baseNameCands };
            }
            const baseLabelCands = bdByProperLabel.get(baseKey) ?? [];
            if (baseLabelCands.length === 1) {
                return { resolved: true, bdPersonId: baseLabelCands[0], stage: 'base-name' };
            }
            if (baseLabelCands.length > 1) {
                return { resolved: false, reason: 'ambiguous', candidates: baseLabelCands };
            }
        }
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
 * Theographic family columns give anchor relatives; among the ambiguous
 * BibleData candidates, the one sharing the most relationship edges with
 * those anchors wins - but only when the winner is unique.
 */
export function resolveByGenealogyContext(
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

    const anchors: string[] = [];
    for (const relTheoId of relatives) {
        const relBdId = resolvedTheoToBd.get(relTheoId);
        if (relBdId) anchors.push(relBdId);
    }

    if (anchors.length === 0) {
        return { resolved: false, reason: 'ambiguous', candidates };
    }

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

    // Still tied - still ambiguous, but with a reduced candidate set
    return { resolved: false, reason: 'ambiguous', candidates: winners };
}

// ─── Enrichment orchestrator (pure w.r.t. the filesystem) ─────

export type EnrichPersonsStats = {
    byStage: Record<MatchStage, number>;
    noMatch: number;
    ambiguous: number;
    /** resolved (bibleDataId stored) but no meaning text available */
    noMeaning: number;
    enriched: number;
    /** normalized name → candidate count, for the top-ambiguous report */
    ambigCounts: Map<string, number>;
    stage5Enabled: boolean;
    stage5Rounds: number;
};

const STAGE_CONFIDENCE: Record<MatchStage, number> = {
    'id-direct':          1.0,
    'name-unique':        0.95,
    'id-discriminant':    0.9,
    'base-name':          0.85,
    'genealogy-context':  0.85,
    'label-fallback':     0.8,
};

/**
 * Apply the five-stage resolution to `persons` (mutated in place), recording
 * mappings in `resolver` and unresolvable ambiguities in `conflicts`.
 * Stage 5 runs only when both of its inputs are non-null.
 */
export function enrichPersonsData(
    persons: Person[],
    bdPersons: BibleDataPerson[],
    bdLabels: BibleDataLabel[],
    bdNeighbors: Map<string, Set<string>> | null,
    theoFamily: Map<string, string[]> | null,
    resolver: ResolutionMap,
    conflicts: ConflictStore,
): EnrichPersonsStats {
    const indexes = buildBdIndexes(bdPersons, bdLabels);
    const stage5Enabled = bdNeighbors !== null && theoFamily !== null;

    const stats: EnrichPersonsStats = {
        byStage: {
            'id-direct':          0,
            'name-unique':        0,
            'id-discriminant':    0,
            'label-fallback':     0,
            'base-name':          0,
            'genealogy-context':  0,
        },
        noMatch: 0,
        ambiguous: 0,
        noMeaning: 0,
        enriched: 0,
        ambigCounts: new Map(),
        stage5Enabled,
        stage5Rounds: 0,
    };

    // ── Pass 1: Stages 1–4b ───────────────────────────────────
    const resolved = new Map<string, { bdPersonId: string; stage: MatchStage }>();
    let deferred: Array<{ person: Person; candidates: string[] }> = [];

    for (const person of persons) {
        const match = resolvePersonMatch(person, indexes);

        if (!match.resolved) {
            if (match.reason === 'no-match') {
                stats.noMatch++;
            } else {
                deferred.push({ person, candidates: match.candidates });
            }
            continue;
        }

        stats.byStage[match.stage]++;
        resolved.set(person.id, { bdPersonId: match.bdPersonId, stage: match.stage });
    }

    // ── Pass 2: Stage 5, iterated to a fixed point ────────────
    // Each round's resolutions become anchors for the next: resolving Isaac
    // unlocks Jacob, which unlocks Levi/Judah/Benjamin, etc.
    const resolvedTheoToBd = new Map<string, string>();
    for (const [theoId, { bdPersonId }] of resolved) {
        resolvedTheoToBd.set(theoId, bdPersonId);
    }

    if (stage5Enabled) {
        let progress = true;
        while (progress && deferred.length > 0) {
            progress = false;
            stats.stage5Rounds++;
            const still: typeof deferred = [];
            for (const { person, candidates } of deferred) {
                const match = resolveByGenealogyContext(person.id, candidates, theoFamily!, bdNeighbors!, resolvedTheoToBd);
                if (match.resolved) {
                    stats.byStage[match.stage]++;
                    resolved.set(person.id, { bdPersonId: match.bdPersonId, stage: match.stage });
                    resolvedTheoToBd.set(person.id, match.bdPersonId);
                    progress = true;
                } else {
                    still.push({ person, candidates: match.candidates });
                }
            }
            deferred = still;
        }
    }

    // ── Record what remains ambiguous ─────────────────────────
    for (const { person, candidates } of deferred) {
        const key = normalizeName(person.name);
        stats.ambigCounts.set(key, Math.max(stats.ambigCounts.get(key) ?? 0, candidates.length));
        conflicts.add({
            id: `person:${person.id}:bibledata-match`,
            entityType: 'person',
            entityId: person.id,
            field: 'bibledata-match',
            claims: candidates.map(bdId => ({
                sourceId: 'bibledata',
                value: bdId,
                note: `Ambiguous after all 5 resolution stages: name="${key}", candidates=${candidates.length}`,
            })),
        });
        stats.ambiguous++;
    }

    // ── Apply enrichment for all resolved persons ──────────────
    // The bibleDataId link is stored even without a meaning: the genealogy
    // importer's supplement pass needs it to admit ancestor/half-sibling edges.
    for (const person of persons) {
        const resolution = resolved.get(person.id);
        if (!resolution) continue;

        const { bdPersonId, stage } = resolution;
        const labels  = indexes.bdLabelsByPersonId.get(bdPersonId) ?? [];
        const meaning = selectBestMeaning(labels, person.name);

        resolver.add({
            canonicalId: person.id,
            entityType:  'person',
            externalIds: { bibledata: bdPersonId },
            method: (stage === 'id-direct' || stage === 'id-discriminant')
                ? 'id-pattern'
                : stage === 'name-unique' ? 'exact-name'
                : 'normalized-name',
            confidence: STAGE_CONFIDENCE[stage],
        });

        const existingSources: SourceRef[] = person.sources ?? [];
        const filtered = existingSources.filter(s => s.sourceId !== 'bibledata');
        person.sources = [
            ...filtered,
            {
                sourceId: 'bibledata',
                externalId: bdPersonId,
                fields: meaning ? ['nameMeaning', 'nameMeaningSource'] : ['bibleDataId'],
            },
        ];
        person.bibleDataId = bdPersonId;
        person.bibleDataConfidence = STAGE_CONFIDENCE[stage];

        if (meaning) {
            person.nameMeaning       = meaning;
            person.nameMeaningSource = 'bibledata';
            stats.enriched++;
        } else {
            stats.noMeaning++;
        }
    }

    return stats;
}

// ─── File-based runner ─────────────────────────────────────────

export type EnrichPersonsPaths = {
    personsJson: string;
    personCsv: string;
    labelCsv: string;
    relationshipCsv: string;
    theographicPeopleCsv: string;
    metadataDir: string;
};

export function runEnrichPersons(paths: EnrichPersonsPaths): void {
    for (const [label, filePath] of [
        ['persons.json', paths.personsJson],
        ['BibleData-Person.csv', paths.personCsv],
        ['BibleData-PersonLabel.csv', paths.labelCsv],
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

    // Stage 5 inputs are optional - warn but continue without them
    const hasRelationships = fs.existsSync(paths.relationshipCsv);
    const hasTheoFamily    = fs.existsSync(paths.theographicPeopleCsv);
    if (!hasRelationships) {
        console.warn(`[enrich-persons] WARNING: ${paths.relationshipCsv} not found - Stage 5 (genealogy-context) disabled`);
        console.warn('  Run: cd packages/data-pipeline && pnpm run fetch:bibledata');
    }
    if (!hasTheoFamily) {
        console.warn(`[enrich-persons] WARNING: ${paths.theographicPeopleCsv} not found - Stage 5 (genealogy-context) disabled`);
    }
    const stage5 = hasRelationships && hasTheoFamily;

    const persons: Person[] = JSON.parse(fs.readFileSync(paths.personsJson, 'utf-8'));
    const bdPersons = parseBibleDataPersons(fs.readFileSync(paths.personCsv, 'utf-8'));
    const bdLabels  = parseBibleDataLabels(fs.readFileSync(paths.labelCsv, 'utf-8'));
    const bdNeighbors = stage5 ? parseBdRelationships(fs.readFileSync(paths.relationshipCsv, 'utf-8')) : null;
    const theoFamily  = stage5 ? parseTheoFamily(fs.readFileSync(paths.theographicPeopleCsv, 'utf-8')) : null;

    console.log(`[enrich-persons] Input: ${persons.length} Theographic persons`);
    console.log(`[enrich-persons] Input: ${bdPersons.length} BibleData persons`);
    console.log(`[enrich-persons] Input: ${bdLabels.length} BibleData PersonLabel rows`);
    if (stage5) {
        console.log(`[enrich-persons] Input: ${bdNeighbors!.size} BibleData persons with relationship edges`);
        console.log(`[enrich-persons] Input: ${theoFamily!.size} Theographic persons with family columns`);
    }

    const resolutionMapPath = path.join(paths.metadataDir, 'resolution-map.json');
    const conflictsPath     = path.join(paths.metadataDir, 'conflicts.json');

    const resolver = new ResolutionMap();
    resolver.load(resolutionMapPath);
    const resolverSizeBefore = resolver.size;

    const conflicts = new ConflictStore();
    conflicts.load(conflictsPath);
    const conflictSizeBefore = conflicts.size;

    const stats = enrichPersonsData(persons, bdPersons, bdLabels, bdNeighbors, theoFamily, resolver, conflicts);

    fs.writeFileSync(paths.personsJson, JSON.stringify(persons), 'utf-8');
    fs.mkdirSync(paths.metadataDir, { recursive: true });
    resolver.save(resolutionMapPath);
    conflicts.save(conflictsPath);

    recordImportRun(paths.metadataDir, {
        sourceIds: ['bibledata'],
        inputFiles: [
            paths.personsJson, paths.personCsv, paths.labelCsv,
            ...(stage5 ? [paths.relationshipCsv, paths.theographicPeopleCsv] : []),
        ],
        stats: {
            created: 0,
            updated: stats.enriched + stats.noMeaning, // all persons that gained a bibleDataId link
            skipped: stats.noMatch + stats.ambiguous,
            conflicts: stats.ambiguous,
        },
    });

    // ── Summary ────────────────────────────────────────────────
    const resolverDelta  = resolver.size - resolverSizeBefore;
    const conflictDelta  = conflicts.size - conflictSizeBefore;
    const enrichRate     = persons.length > 0 ? ((stats.enriched / persons.length) * 100).toFixed(1) : '0';

    console.log('\n[enrich-persons] ── Resolution by stage ─────────────────────');
    console.log(`  Stage 1 - id-direct:           ${stats.byStage['id-direct']}  (confidence 1.00)`);
    console.log(`  Stage 2 - name-unique:         ${stats.byStage['name-unique']}  (confidence 0.95)`);
    console.log(`  Stage 3 - id-discriminant:     ${stats.byStage['id-discriminant']}  (confidence 0.90)`);
    console.log(`  Stage 4 - label-fallback:      ${stats.byStage['label-fallback']}  (confidence 0.80)`);
    console.log(`  Stage 4b - base-name:          ${stats.byStage['base-name']}  (confidence 0.85)`);
    console.log(`  Stage 5 - genealogy-context:   ${stats.byStage['genealogy-context']}  (confidence 0.85)${stats.stage5Enabled ? `  [${stats.stage5Rounds} rounds]` : '  [disabled - inputs missing]'}`);
    console.log(`  No BibleData match:            ${stats.noMatch}`);
    console.log(`  Ambiguous (all stages):        ${stats.ambiguous}`);
    console.log(`  Resolved, no meaning text:     ${stats.noMeaning}  (bibleDataId link stored)`);

    console.log('\n[enrich-persons] ── Enrichment results ──────────────────────');
    console.log(`  Persons enriched this run:  ${stats.enriched} / ${persons.length}  (${enrichRate}%)`);
    console.log(`  bibleDataId links stored:   ${stats.enriched + stats.noMeaning}`);

    console.log('\n[enrich-persons] ── Metadata delta ──────────────────────────');
    console.log(`  Resolution map:  +${resolverDelta} new entries  (${resolver.size} total)`);
    console.log(`  Conflicts:       +${conflictDelta} new records   (${conflicts.size} total)`);

    if (stats.ambiguous > 0) {
        const topAmbig = [...stats.ambigCounts.entries()]
            .sort((a, b) => b[1] - a[1])
            .slice(0, 10);
        console.log('\n[enrich-persons] ── Top ambiguous names (for manual review) ──');
        for (const [name, count] of topAmbig) {
            console.log(`  "${name}"  →  ${count} BibleData candidates`);
        }
        console.log(`  (Full list in ${conflictsPath})`);
    }

    console.log(`\n[enrich-persons] Written: ${paths.personsJson}`);
    console.log(`[enrich-persons] Written: ${resolutionMapPath}`);
    console.log(`[enrich-persons] Written: ${conflictsPath}`);
}
