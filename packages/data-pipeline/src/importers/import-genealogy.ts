import fs from 'node:fs';
import path from 'node:path';
import { parseCsv } from '../core/csv.js';

// ── Inline types (mirrors @codex-scriptura/core Relationship) ──
type RelationshipType =
    | 'father-of'
    | 'mother-of'
    | 'spouse-of'
    | 'sibling-of'
    | 'half-sibling-same-father'
    | 'ancestor-of';

type Relationship = {
    id: string;
    personFrom: string;
    personTo: string;
    type: RelationshipType;
};

/**
 * Genealogy / Relationship Importer
 *
 * PRIMARY SOURCE — Theographic People.csv family columns:
 *   father, mother, partners, children, siblings — every value is a
 *   personLookup ID in the same ID space the app uses, so no cross-dataset
 *   name matching is needed and same-named people can never be conflated.
 *   (The previous BibleData name-matching approach collapsed unresolved
 *   names onto the most prominent same-named person, producing 215
 *   children with multiple fathers.)
 *
 * SUPPLEMENT — BibleData-PersonRelationship.csv:
 *   Only relationship types Theographic does not model: ancestor-of and
 *   half-sibling-same-father. Endpoints are admitted only when both sides
 *   resolve exactly via the bibleDataId mapping produced by enrich:persons
 *   (plus a few manual overrides). No name-based fallback.
 */

// ── Edge identity ──────────────────────────────────────────

/** Relationship types with no inherent direction — endpoints are sorted for a stable ID. */
const SYMMETRIC_TYPES: ReadonlySet<RelationshipType> = new Set([
    'spouse-of',
    'sibling-of',
    'half-sibling-same-father',
]);

function edgeId(from: string, to: string, type: RelationshipType): string {
    if (SYMMETRIC_TYPES.has(type)) {
        const [a, b] = [from, to].sort();
        return `${a}→${type}→${b}`;
    }
    return `${from}→${type}→${to}`;
}

/** Accumulates edges, deduplicating by deterministic ID. */
class EdgeSet {
    readonly records: Relationship[] = [];
    private seen = new Set<string>();
    duplicates = 0;

    add(from: string, to: string, type: RelationshipType): void {
        if (!from || !to || from === to) return;
        const id = edgeId(from, to, type);
        if (this.seen.has(id)) {
            this.duplicates++;
            return;
        }
        this.seen.add(id);
        this.records.push({ id, personFrom: from, personTo: to, type });
    }
}

// ── Primary source: Theographic family columns ─────────────

/** Split a comma-separated ID list cell ("adam,eve") into trimmed IDs. */
function splitIdList(raw: string | undefined): string[] {
    if (!raw) return [];
    return raw
        .split(',')
        .map(s => s.trim())
        .filter(Boolean);
}

export type TheographicFamilyStats = {
    persons: number;
    /** children-column entries skipped because the parent's gender is unknown */
    skippedUngenderedParent: number;
    /** family references pointing at an ID with no People.csv row */
    danglingRefs: number;
};

/**
 * Build father/mother/spouse/sibling edges from Theographic People.csv.
 *
 * Parent edges are derived from both directions — a child's father/mother
 * columns and a parent's children column (typed by the parent's gender) —
 * and deduplicated. The children column only adds an edge when the parent's
 * gender is known; ungendered parents are counted and skipped.
 */
export function buildTheographicEdges(
    peopleCsv: string,
    edges: EdgeSet = new EdgeSet(),
): { edges: EdgeSet; stats: TheographicFamilyStats } {
    const rows = parseCsv(peopleCsv);

    const genderById = new Map<string, string>();
    const knownIds = new Set<string>();
    for (const row of rows) {
        const id = (row['personLookup'] ?? '').trim();
        if (!id) continue;
        knownIds.add(id);
        const gender = (row['gender'] ?? '').trim().toLowerCase();
        if (gender) genderById.set(id, gender);
    }

    const stats: TheographicFamilyStats = {
        persons: knownIds.size,
        skippedUngenderedParent: 0,
        danglingRefs: 0,
    };

    const checkDangling = (refs: string[]): string[] => {
        const valid: string[] = [];
        for (const ref of refs) {
            if (knownIds.has(ref)) valid.push(ref);
            else stats.danglingRefs++;
        }
        return valid;
    };

    for (const row of rows) {
        const id = (row['personLookup'] ?? '').trim();
        if (!id) continue;

        for (const father of checkDangling(splitIdList(row['father']))) {
            edges.add(father, id, 'father-of');
        }
        for (const mother of checkDangling(splitIdList(row['mother']))) {
            edges.add(mother, id, 'mother-of');
        }
        for (const partner of checkDangling(splitIdList(row['partners']))) {
            edges.add(id, partner, 'spouse-of');
        }
        for (const sibling of checkDangling(splitIdList(row['siblings']))) {
            edges.add(id, sibling, 'sibling-of');
        }

        // children column: reverse parent edge, typed by this person's gender
        const children = checkDangling(splitIdList(row['children']));
        if (children.length > 0) {
            const gender = genderById.get(id);
            const type: RelationshipType | null =
                gender === 'male' ? 'father-of'
                : gender === 'female' ? 'mother-of'
                : null;
            if (type === null) {
                stats.skippedUngenderedParent += children.length;
            } else {
                for (const child of children) {
                    edges.add(id, child, type);
                }
            }
        }
    }

    return { edges, stats };
}

// ── Supplement: BibleData exact-resolution-only edges ───────

/** Raw BibleData labels admitted from the supplement, mapped to core types. */
const SUPPLEMENT_TYPES: Record<string, RelationshipType> = {
    'ancestor': 'ancestor-of',
    'half-sibling': 'half-sibling-same-father',
    'half_sibling': 'half-sibling-same-father',
    'half sibling': 'half-sibling-same-father',
    'half-brother': 'half-sibling-same-father',
    'half-sister': 'half-sibling-same-father',
};

// Known BibleData → Theographic ID overrides for persons enrichment cannot resolve
const MANUAL_OVERRIDES: Record<string, string> = {
    'yhvh_1': 'jesus_905',     // BibleData uses YHVH_1 for Jesus in genealogy context
    'mary_1': 'mary_1938',     // Mary, Mother of Jesus (not Mary Magdalene or others)
    'joseph_6': 'joseph_1715', // Joseph, Mary's Husband (not OT Joseph son of Jacob)
};

export type SupplementStats = {
    admitted: number;
    /** rows whose type is handled by the Theographic primary source or unmapped */
    skippedType: number;
    /** rows dropped because an endpoint has no exact bibleDataId resolution */
    skippedUnresolved: number;
};

/**
 * Parse BibleData-PersonRelationship.csv, admitting only SUPPLEMENT_TYPES
 * rows where BOTH endpoints resolve exactly through idMap
 * (bibleDataId, lowercased → Theographic ID). No name-based fallback:
 * an unresolved endpoint drops the row rather than guessing.
 */
export function buildBibleDataSupplementEdges(
    relationshipCsv: string,
    idMap: Map<string, string>,
    edges: EdgeSet = new EdgeSet(),
): { edges: EdgeSet; stats: SupplementStats } {
    const stats: SupplementStats = { admitted: 0, skippedType: 0, skippedUnresolved: 0 };

    const lines = relationshipCsv.split('\n');
    for (let i = 1; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;

        const parts = line.split(',');
        if (parts.length < 5) continue;

        const source = parts[2].trim().toLowerCase();
        const rawType = parts[3].trim().toLowerCase();
        const target = parts[4].trim().toLowerCase();
        if (!source || !target || !rawType) continue;

        const type = SUPPLEMENT_TYPES[rawType];
        if (!type) {
            stats.skippedType++;
            continue;
        }

        const from = idMap.get(source);
        const to = idMap.get(target);
        if (!from || !to) {
            stats.skippedUnresolved++;
            continue;
        }

        edges.add(from, to, type);
        stats.admitted++;
    }

    return { edges, stats };
}

/** Build the BibleData → Theographic exact ID map from processed persons.json. */
export function buildExactIdMap(personsJson: string): Map<string, string> {
    const idMap = new Map<string, string>();
    const persons: Array<{ id: string; bibleDataId?: string }> = JSON.parse(personsJson);
    for (const p of persons) {
        if (p.bibleDataId) idMap.set(p.bibleDataId.toLowerCase(), p.id);
    }
    for (const [bdId, theoId] of Object.entries(MANUAL_OVERRIDES)) {
        idMap.set(bdId, theoId);
    }
    return idMap;
}

// ── File-based runner ──────────────────────────────────────

export type ImportGenealogyOptions = {
    /** data/theographic/People.csv — primary edge source */
    theographicPeopleCsv: string;
    /** data/texts/bibledata/BibleData-PersonRelationship.csv — supplement */
    bibleDataRelationshipCsv: string;
    /** data/processed/persons.json — provides bibleDataId → Theographic ID map */
    personsJson: string;
    /** data/processed — genealogy.json is written here */
    outputDir: string;
};

export function importGenealogy(opts: ImportGenealogyOptions): void {
    const outputPath = path.join(opts.outputDir, 'genealogy.json');
    fs.mkdirSync(opts.outputDir, { recursive: true });

    if (!fs.existsSync(opts.theographicPeopleCsv)) {
        console.warn(`[genealogy] Missing primary source: ${opts.theographicPeopleCsv}`);
        console.warn('[genealogy] Run: pnpm run fetch:theographic');
        console.warn('[genealogy] Emitting empty relationship dataset to unblock pipeline.');
        fs.writeFileSync(outputPath, JSON.stringify([]), 'utf-8');
        return;
    }

    // ── Primary: Theographic family columns ──
    const { edges, stats: theoStats } = buildTheographicEdges(
        fs.readFileSync(opts.theographicPeopleCsv, 'utf-8'),
    );
    const theoEdgeCount = edges.records.length;
    console.log(`[genealogy] Theographic: ${theoEdgeCount} edges from ${theoStats.persons} persons` +
        ` (${edges.duplicates} bidirectional duplicates merged)`);
    if (theoStats.danglingRefs > 0) {
        console.warn(`[genealogy] WARNING: ${theoStats.danglingRefs} family refs point at unknown person IDs — skipped`);
    }
    if (theoStats.skippedUngenderedParent > 0) {
        console.log(`[genealogy] Skipped ${theoStats.skippedUngenderedParent} children-column entries (parent gender unknown)`);
    }

    // ── Supplement: BibleData ancestor / half-sibling edges (exact resolution only) ──
    if (!fs.existsSync(opts.bibleDataRelationshipCsv)) {
        console.warn(`[genealogy] Supplement missing: ${opts.bibleDataRelationshipCsv} — skipping BibleData edges`);
        console.warn('[genealogy] Run: pnpm run fetch:bibledata');
    } else if (!fs.existsSync(opts.personsJson)) {
        console.warn(`[genealogy] ${opts.personsJson} not found — cannot resolve BibleData IDs; skipping supplement`);
        console.warn('[genealogy] Run: pnpm run import:theographic && pnpm run enrich:persons');
    } else {
        const idMap = buildExactIdMap(fs.readFileSync(opts.personsJson, 'utf-8'));
        const { stats } = buildBibleDataSupplementEdges(
            fs.readFileSync(opts.bibleDataRelationshipCsv, 'utf-8'),
            idMap,
            edges,
        );
        console.log(`[genealogy] BibleData supplement: ${edges.records.length - theoEdgeCount} edges added` +
            ` (${stats.admitted} admitted, ${stats.skippedUnresolved} dropped — unresolved endpoint, ${stats.skippedType} other-type rows)`);
    }

    const records = edges.records;
    fs.writeFileSync(outputPath, JSON.stringify(records), 'utf-8');

    const sizeKb = (fs.statSync(outputPath).size / 1024).toFixed(1);
    console.log(`[genealogy] Written: ${outputPath} (${records.length} edges, ${sizeKb} KB)`);

    // ── Breakdown + integrity check ──
    const byType = new Map<string, number>();
    for (const r of records) {
        byType.set(r.type, (byType.get(r.type) ?? 0) + 1);
    }
    console.log('[genealogy] Type breakdown:');
    for (const [t, count] of byType) {
        console.log(`  ${t}: ${count}`);
    }

    const fathers = new Map<string, number>();
    for (const r of records) {
        if (r.type === 'father-of') fathers.set(r.personTo, (fathers.get(r.personTo) ?? 0) + 1);
    }
    const multiFather = [...fathers.values()].filter(n => n > 1).length;
    console.log(`[genealogy] Integrity: ${multiFather} children with >1 father`);
}
