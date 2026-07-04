import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '@codex-scriptura/db';
import type { Person, Relationship } from '@codex-scriptura/core';
import {
    buildFamilyGraph,
    loadFamilyGraph,
    resolveTreeRoot,
    nameFromId,
    subtreeCount,
    ancestryPath,
    hasBothLines,
    layoutTree,
    BRANCH_PALETTE,
    ROOT_COLOR,
    TREE_CARD_H,
} from './familyTree';

function rel(personFrom: string, type: Relationship['type'], personTo: string): Relationship {
    return { id: `${personFrom}→${type}→${personTo}`, personFrom, personTo, type };
}

function person(id: string, name: string): Person {
    return { id, name, verseRefs: [] };
}

// noah_1 → shem_1/ham_1/japheth_1; shem_1 → arphaxad_1 → salah_1; eve_1 also
// mothers shem_1 to exercise father/mother edge merging.
const FIXTURE: Relationship[] = [
    rel('noah_1', 'father-of', 'shem_1'),
    rel('noah_1', 'father-of', 'ham_1'),
    rel('noah_1', 'father-of', 'japheth_1'),
    rel('naamah_1', 'mother-of', 'shem_1'),
    rel('noah_1', 'spouse-of', 'naamah_1'),
    rel('shem_1', 'father-of', 'arphaxad_1'),
    rel('arphaxad_1', 'father-of', 'salah_1'),
];

describe('buildFamilyGraph', () => {
    it('merges father and mother edges without duplicating children', () => {
        const g = buildFamilyGraph(FIXTURE);
        expect(g.children.get('noah_1')).toEqual(['shem_1', 'ham_1', 'japheth_1']);
        expect(g.children.get('naamah_1')).toEqual(['shem_1']);
    });

    it('prefers the father as the breadcrumb parent', () => {
        const father = buildFamilyGraph(FIXTURE);
        expect(father.parentOf.get('shem_1')).toBe('noah_1');
        // mother-first edge order must not change the outcome
        const motherFirst = buildFamilyGraph([...FIXTURE].reverse());
        expect(motherFirst.parentOf.get('shem_1')).toBe('noah_1');
    });

    it('keeps the first father when merged people carry extra father edges', () => {
        const g = buildFamilyGraph([
            ...FIXTURE,
            rel('zelophehad_1', 'father-of', 'shem_1'), // secondary-genealogy graft
        ]);
        expect(g.parentOf.get('shem_1')).toBe('noah_1');
    });

    it('ignores spouse edges and falls back to id-derived names', () => {
        const g = buildFamilyGraph(FIXTURE);
        expect(g.children.get('naamah_1')).not.toContain('noah_1');
        expect(g.names.get('arphaxad_1')).toBe('Arphaxad');
        expect(nameFromId('queen_of_sheba_42')).toBe('Queen Of Sheba');
    });

    it('counts descendants and builds the ancestry path', () => {
        const g = buildFamilyGraph(FIXTURE);
        expect(subtreeCount(g, 'noah_1')).toBe(5);
        expect(subtreeCount(g, 'salah_1')).toBe(0);
        expect(ancestryPath(g, 'salah_1').map((p) => p.id)).toEqual([
            'noah_1', 'shem_1', 'arphaxad_1', 'salah_1',
        ]);
    });

    it('tracks father and mother separately', () => {
        const g = buildFamilyGraph(FIXTURE);
        expect(g.fatherOf.get('shem_1')).toBe('noah_1');
        expect(g.motherOf.get('shem_1')).toBe('naamah_1');
        expect(hasBothLines(g, 'shem_1')).toBe(true);
        expect(hasBothLines(g, 'ham_1')).toBe(false); // father only
    });
});

describe('paternal and maternal ancestry lines', () => {
    // Jesus-shaped fixture: father's line (Matthew 1) and mother's line
    // (Luke 3) diverge at Jesus and rejoin at David.
    const g = buildFamilyGraph([
        rel('david_1', 'father-of', 'solomon_1'),
        rel('david_1', 'father-of', 'nathan_1'),
        rel('solomon_1', 'father-of', 'jacob_1'),
        rel('jacob_1', 'father-of', 'joseph_1'),
        rel('nathan_1', 'father-of', 'heli_1'),
        rel('heli_1', 'father-of', 'mary_1'),
        rel('joseph_1', 'father-of', 'jesus_1'),
        rel('mary_1', 'mother-of', 'jesus_1'),
    ]);

    it('walks the father’s line by default', () => {
        expect(ancestryPath(g, 'jesus_1').map((p) => p.id)).toEqual([
            'david_1', 'solomon_1', 'jacob_1', 'joseph_1', 'jesus_1',
        ]);
    });

    it('walks the mother’s line on request', () => {
        expect(ancestryPath(g, 'jesus_1', 'maternal').map((p) => p.id)).toEqual([
            'david_1', 'nathan_1', 'heli_1', 'mary_1', 'jesus_1',
        ]);
    });

    it('falls through to the recorded parent above a single-parent hop', () => {
        // Above Mary only fathers are recorded — the maternal walk must not stop
        expect(ancestryPath(g, 'mary_1', 'maternal').map((p) => p.id)).toEqual([
            'david_1', 'nathan_1', 'heli_1', 'mary_1',
        ]);
        // Paternal walk through a mother-only hop keeps climbing too
        const motherOnly = buildFamilyGraph([
            rel('anna_1', 'mother-of', 'kid_1'),
            rel('gran_1', 'father-of', 'anna_1'),
        ]);
        expect(ancestryPath(motherOnly, 'kid_1').map((p) => p.id)).toEqual([
            'gran_1', 'anna_1', 'kid_1',
        ]);
    });
});

describe('tree layout', () => {
    const g = buildFamilyGraph(FIXTURE, [['noah_1', 'Noah'], ['shem_1', 'Shem']]);

    it('places one column per generation and centers parents on children', () => {
        const { nodes } = layoutTree(g, 'noah_1', 2);
        const noah = nodes.find((n) => n.id === 'noah_1')!;
        const shem = nodes.find((n) => n.id === 'shem_1')!;
        const japheth = nodes.find((n) => n.id === 'japheth_1')!;
        expect(shem.x - noah.x).toBe(238);
        expect(noah.y).toBeCloseTo((shem.y + japheth.y) / 2);
    });

    it('colors branches per direct child of the root', () => {
        const { nodes, branches } = layoutTree(g, 'noah_1', 2);
        expect(nodes.find((n) => n.id === 'noah_1')!.color).toBe(ROOT_COLOR);
        expect(nodes.find((n) => n.id === 'shem_1')!.color).toBe(BRANCH_PALETTE[0]);
        expect(nodes.find((n) => n.id === 'ham_1')!.color).toBe(BRANCH_PALETTE[1]);
        // grandchildren inherit their depth-1 ancestor's color
        expect(nodes.find((n) => n.id === 'arphaxad_1')!.color).toBe(BRANCH_PALETTE[0]);
        expect(branches.map((b) => b.name)).toEqual(['Shem', 'Ham', 'Japheth']);
    });

    it('marks collapsed branches at the depth cap', () => {
        const { nodes } = layoutTree(g, 'noah_1', 1);
        const shem = nodes.find((n) => n.id === 'shem_1')!;
        expect(shem.more).toBe(2); // arphaxad + salah hidden
        expect(nodes.every((n) => n.depth <= 1)).toBe(true);
    });

    it('draws one elbow connector per visible parent-child pair', () => {
        const { nodes, edges } = layoutTree(g, 'noah_1', 3);
        expect(edges).toHaveLength(nodes.length - 1);
        expect(edges[0].d).toMatch(/^M [\d.]+ [\d.]+ L /);
    });

    it('sizes the canvas so every card fits', () => {
        const full = layoutTree(g, 'noah_1', 3);
        for (const n of full.nodes) {
            expect(n.y + TREE_CARD_H).toBeLessThanOrEqual(full.height);
        }
        expect(layoutTree(g, 'salah_1', 2).height).toBe(480); // clamps to minimum
    });

    it('places a child recorded under two visible parents exactly once', () => {
        // tamar-style merge: daughter of the root AND of the root's son
        const merged = buildFamilyGraph([
            rel('david_1', 'father-of', 'absalom_1'),
            rel('david_1', 'father-of', 'tamar_1'),
            rel('absalom_1', 'father-of', 'tamar_1'),
        ]);
        const { nodes } = layoutTree(merged, 'david_1', 2);
        expect(nodes.filter((n) => n.id === 'tamar_1')).toHaveLength(1);
        const ids = nodes.map((n) => n.id);
        expect(new Set(ids).size).toBe(ids.length);
    });

    it('lays out a person with no recorded children as a single card', () => {
        const solo = layoutTree(g, 'salah_1', 2);
        expect(solo.nodes).toHaveLength(1);
        expect(solo.edges).toHaveLength(0);
        expect(solo.branches).toHaveLength(0);
    });
});

describe('loadFamilyGraph / resolveTreeRoot (Dexie)', () => {
    beforeEach(async () => {
        await db.relationships.clear();
        await db.persons.clear();
        await db.relationships.bulkAdd(FIXTURE);
        await db.persons.bulkAdd([
            person('noah_1', 'Noah'),
            person('shem_1', 'Shem'),
            person('melchizedek_1', 'Melchizedek'), // no relationships
        ]);
    });

    it('loads names from the persons table with id fallback', async () => {
        const g = await loadFamilyGraph();
        expect(g.names.get('noah_1')).toBe('Noah');
        expect(g.names.get('ham_1')).toBe('Ham'); // no person record → derived
        expect(g.children.get('noah_1')).toHaveLength(3);
    });

    it('resolves ids, display names, and relation-less people', async () => {
        const g = await loadFamilyGraph();
        expect(await resolveTreeRoot(g, 'shem_1')).toBe('shem_1');
        expect(await resolveTreeRoot(g, 'Noah')).toBe('noah_1');
        expect(await resolveTreeRoot(g, 'melchizedek_1')).toBe('melchizedek_1');
        expect(await resolveTreeRoot(g, 'Melchizedek')).toBe('melchizedek_1');
        expect(await resolveTreeRoot(g, 'nobody')).toBeUndefined();
    });
});
