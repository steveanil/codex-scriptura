import { describe, it, expect } from 'vitest';
import {
    NATIONS,
    PARENT,
    NAME_TO_ID,
    MATCHABLE_NAMES,
    matchPersonName,
    subtreeCount,
    relationLabel,
    ancestryPath,
    buildRailRows,
    branchColor,
} from './table-of-nations';

describe('table of nations data', () => {
    it('roots at Noah with the three patriarchal branches', () => {
        expect(NATIONS.noah.children).toEqual(['japheth', 'ham', 'shem']);
        expect(PARENT.noah).toBeUndefined();
        expect(PARENT.cush).toBe('ham');
        expect(PARENT.sheba).toBe('raamah');
    });

    it('every child id resolves and has a consistent parent link', () => {
        for (const p of Object.values(NATIONS)) {
            for (const c of p.children) {
                expect(NATIONS[c], `missing child ${c} of ${p.id}`).toBeDefined();
                expect(PARENT[c]).toBe(p.id);
            }
        }
    });

    it('maps display names for verse matching', () => {
        expect(NAME_TO_ID.get('cush')).toBe('cush');
        expect(NAME_TO_ID.get('nimrod')).toBe('nimrod');
    });

    it('matches qualified theographic display names', () => {
        expect(matchPersonName('Cush (son of Ham)')).toBe('cush');
        expect(matchPersonName('Noah')).toBe('noah');
        expect(matchPersonName('Sheba (son of Raamah)')).toBe('sheba');
        // same name, different line — must not match
        expect(matchPersonName('Sheba (son of Joktan)')).toBeUndefined();
        expect(matchPersonName('Queen of Sheba')).toBeUndefined();
        expect(matchPersonName('Moses')).toBeUndefined();
    });

    it('maps KJV spelling variants to the same people', () => {
        expect(NAME_TO_ID.get('phut')).toBe('put');
        expect(NAME_TO_ID.get('sabtechah')).toBe('sabtecha');
        expect(NAME_TO_ID.get('zidon')).toBe('sidon');
        expect(MATCHABLE_NAMES).toContain('Phut');
    });

    it('counts descendants', () => {
        expect(subtreeCount(NATIONS.noah.id)).toBe(Object.keys(NATIONS).length - 1);
        expect(subtreeCount('raamah')).toBe(2); // Sheba, Dedan
        expect(subtreeCount('nimrod')).toBe(0);
    });

    it('labels relationships by depth', () => {
        expect(relationLabel(0)).toBe('focused');
        expect(relationLabel(1)).toBe('son');
        expect(relationLabel(2)).toBe('grandson');
        expect(relationLabel(3)).toBe('great-grandson');
        expect(relationLabel(4)).toBe('2× great-grandson');
    });

    it('builds the ancestry breadcrumb from Noah down', () => {
        expect(ancestryPath('sheba').map((p) => p.id)).toEqual([
            'noah', 'ham', 'cush', 'raamah', 'sheba',
        ]);
    });
});

describe('rail rows', () => {
    it('walks two generations with the root first', () => {
        const rows = buildRailRows('cush');
        expect(rows[0]).toMatchObject({ id: 'cush', depth: 0, relation: 'focused' });
        // Cush's 6 sons + Raamah's 2 sons
        expect(rows).toHaveLength(1 + 6 + 2);
        const raamahIdx = rows.findIndex((r) => r.id === 'raamah');
        expect(rows[raamahIdx + 1]).toMatchObject({ id: 'sheba', depth: 2, relation: 'grandson' });
    });

    it('deep rows inherit the branch of their depth-1 ancestor', () => {
        const rows = buildRailRows('noah');
        const sonOfHam = rows.find((r) => r.id === 'cush');
        expect(sonOfHam?.branch).toBe('H');
        expect(branchColor(sonOfHam!.branch)).toBe('#d98a3d');
    });
});
