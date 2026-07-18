import { describe, it, expect } from 'vitest';
import { buildTheographicEdges, buildBibleDataSupplementEdges, buildExactIdMap, excludeDivineEdges } from './import-genealogy.js';

const PEOPLE_CSV = [
    'personLookup,displayTitle,gender,father,mother,partners,children,siblings',
    'adam_1,Adam,Male,,,eve_2,"cain_4,abel_5",',
    'eve_2,Eve,Female,,,adam_1,"cain_4,abel_5",',
    'cain_4,Cain,Male,adam_1,eve_2,,,abel_5',
    'abel_5,Abel,Male,adam_1,eve_2,,,cain_4',
    // gender unknown → children column must be skipped, not guessed
    'pat_9,Pat,,,,,"kid_10",',
    'kid_10,Kid,Male,,,,,',
    // dangling ref: father points at an ID with no row
    'orphan_11,Orphan,Male,ghost_99,,,,',
].join('\n');

describe('buildTheographicEdges', () => {
    const { edges, stats } = buildTheographicEdges(PEOPLE_CSV);
    const ids = edges.records.map(r => r.id);

    it('creates father-of and mother-of edges from child rows', () => {
        expect(ids).toContain('adam_1→father-of→cain_4');
        expect(ids).toContain('eve_2→mother-of→abel_5');
    });

    it('derives the same parent edges from the children column without duplicates', () => {
        // adam's children column and cain/abel's father columns describe the
        // same edges; each must appear exactly once
        expect(ids.filter(id => id === 'adam_1→father-of→cain_4')).toHaveLength(1);
        expect(edges.records.filter(r => r.type === 'father-of')).toHaveLength(2);
        expect(edges.records.filter(r => r.type === 'mother-of')).toHaveLength(2);
    });

    it('emits one spouse edge for a bidirectional partnership', () => {
        expect(edges.records.filter(r => r.type === 'spouse-of')).toHaveLength(1);
        expect(ids).toContain('adam_1→spouse-of→eve_2');
    });

    it('emits one sibling edge per pair', () => {
        expect(edges.records.filter(r => r.type === 'sibling-of')).toHaveLength(1);
        expect(ids).toContain('abel_5→sibling-of→cain_4');
    });

    it('skips children-column entries when the parent gender is unknown', () => {
        expect(stats.skippedUngenderedParent).toBe(1);
        expect(ids.some(id => id.startsWith('pat_9→'))).toBe(false);
    });

    it('skips family refs pointing at unknown person IDs', () => {
        expect(stats.danglingRefs).toBe(1);
        expect(ids.some(id => id.includes('ghost_99'))).toBe(false);
    });
});

describe('excludeDivineEdges', () => {
    it('drops edges touching God, keeps human edges', () => {
        // Theographic encodes Luke 3:38 as god_1324 father-of adam/eve
        const records = [
            { id: 'god_1324→father-of→adam_78', personFrom: 'god_1324', personTo: 'adam_78', type: 'father-of' as const },
            { id: 'god_1324→father-of→eve_1231', personFrom: 'god_1324', personTo: 'eve_1231', type: 'father-of' as const },
            { id: 'adam_78→father-of→cain_4', personFrom: 'adam_78', personTo: 'cain_4', type: 'father-of' as const },
            { id: 'joseph_1715→father-of→jesus_905', personFrom: 'joseph_1715', personTo: 'jesus_905', type: 'father-of' as const },
        ];
        const kept = excludeDivineEdges(records);
        expect(kept.map(r => r.id)).toEqual([
            'adam_78→father-of→cain_4',
            'joseph_1715→father-of→jesus_905',
        ]);
    });
});

const RELATIONSHIP_CSV = [
    'relationship_id,ref,person_id_1,relationship_type,person_id_2,notes',
    'r1,GEN 1:1,Abraham_1,ancestor,David_1,',
    'r2,GEN 1:2,Ishmael_1,half-brother,Isaac_1,',
    // father rows come from Theographic now - must be ignored
    'r3,GEN 1:3,Abraham_1,father,Isaac_1,',
    // unresolved endpoint (no idMap entry) - must be dropped, never guessed
    'r4,GEN 1:4,Zechariah_14,ancestor,David_1,',
].join('\n');

describe('buildBibleDataSupplementEdges', () => {
    const idMap = new Map([
        ['abraham_1', 'abraham_9'],
        ['david_1', 'david_88'],
        ['ishmael_1', 'ishmael_3'],
        ['isaac_1', 'isaac_4'],
    ]);
    const { edges, stats } = buildBibleDataSupplementEdges(RELATIONSHIP_CSV, idMap);
    const ids = edges.records.map(r => r.id);

    it('admits ancestor and half-sibling rows with exact resolution', () => {
        expect(ids).toContain('abraham_9→ancestor-of→david_88');
        expect(ids).toContain('isaac_4→half-sibling-same-father→ishmael_3');
        expect(stats.admitted).toBe(2);
    });

    it('ignores relationship types covered by the Theographic primary source', () => {
        expect(ids.some(id => id.includes('father-of'))).toBe(false);
        expect(stats.skippedType).toBe(1);
    });

    it('drops rows with an unresolved endpoint instead of name-guessing', () => {
        expect(stats.skippedUnresolved).toBe(1);
        expect(ids.some(id => id.includes('zechariah'))).toBe(false);
    });
});

describe('buildExactIdMap', () => {
    it('maps lowercased bibleDataId to Theographic ID and applies overrides', () => {
        const { idMap } = buildExactIdMap(JSON.stringify([
            { id: 'aaron_1', bibleDataId: 'Aaron_1', bibleDataConfidence: 1.0 },
            { id: 'zerah_1', name: 'Zerah' }, // no bibleDataId → absent
        ]));
        expect(idMap.get('aaron_1')).toBe('aaron_1');
        expect(idMap.has('zerah_1')).toBe(false);
        expect(idMap.get('yhvh_1')).toBe('jesus_905'); // manual override
    });

    it('excludes low-confidence uncorroborated links (known-issues #20)', () => {
        const { idMap, lowConfidenceDropped } = buildExactIdMap(JSON.stringify([
            // label-fallback tier without a meaning → a wrong unique-label
            // match must not gain ancestor/half-sibling edges
            { id: 'epaphras_1', bibleDataId: 'Epaphroditus_1', bibleDataConfidence: 0.8 },
            // same tier but meaning-corroborated → admitted (old-script guard)
            { id: 'abraham_9', bibleDataId: 'Abram_1', bibleDataConfidence: 0.8, nameMeaningSource: 'bibledata' },
            // at/above the threshold → admitted regardless of meaning
            { id: 'levi_1', bibleDataId: 'Levi_1', bibleDataConfidence: 0.85 },
        ]));
        expect(idMap.has('epaphroditus_1')).toBe(false);
        expect(idMap.get('abram_1')).toBe('abraham_9');
        expect(idMap.get('levi_1')).toBe('levi_1');
        expect(lowConfidenceDropped).toBe(1);
    });

    it('treats a missing confidence (stale persons.json) as low, not trusted', () => {
        const { idMap, lowConfidenceDropped } = buildExactIdMap(JSON.stringify([
            { id: 'a_1', bibleDataId: 'A_1' },
            { id: 'b_1', bibleDataId: 'B_1', nameMeaningSource: 'bibledata' },
        ]));
        expect(idMap.has('a_1')).toBe(false);
        expect(idMap.get('b_1')).toBe('b_1');
        expect(lowConfidenceDropped).toBe(1);
    });
});
