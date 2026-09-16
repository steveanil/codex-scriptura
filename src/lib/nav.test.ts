import { describe, expect, it } from 'vitest';
import { MOBILE_NAV, NAV_GROUPS } from './nav';

describe('sidebar groups (issue #245)', () => {
    it('has exactly the three groups, in order', () => {
        expect(NAV_GROUPS.map((g) => g.id)).toEqual(['read', 'study', 'system']);
    });

    it('Read holds only the reader: corpora arrive as pane types, not nav items', () => {
        expect(NAV_GROUPS[0].items.map((i) => i.id)).toEqual(['read']);
    });

    it('Study holds the tools that operate on scripture', () => {
        expect(NAV_GROUPS[1].items.map((i) => i.id)).toEqual(['search', 'graph', 'themes', 'annotate']);
    });

    it('System holds the app about itself', () => {
        expect(NAV_GROUPS[2].items.map((i) => i.id)).toEqual(['whats-new', 'settings']);
    });

    it('every item has a label, an icon, and either a route or an action', () => {
        for (const g of NAV_GROUPS) {
            for (const i of g.items) {
                expect(i.label.length, i.id).toBeGreaterThan(0);
                expect(i.icon, i.id).toMatch(/^<(path|circle|line)/);
                expect(Boolean(i.href || i.action), i.id).toBe(true);
            }
        }
    });

    it('ids are unique across groups', () => {
        const ids = NAV_GROUPS.flatMap((g) => g.items.map((i) => i.id));
        expect(new Set(ids).size).toBe(ids.length);
    });

    it('the phone tab bar has five slots and no annotate mode', () => {
        expect(MOBILE_NAV).toHaveLength(5);
        expect(MOBILE_NAV.map((i) => i.id)).toEqual(['read', 'search', 'graph', 'themes', 'settings']);
        expect(MOBILE_NAV.every((i) => i.href)).toBe(true);
    });
});
