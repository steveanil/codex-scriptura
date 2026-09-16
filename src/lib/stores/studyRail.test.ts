import { describe, expect, it } from 'vitest';
import { RAIL_MAX_RESIDENT, RAIL_MAX_WIDTH, RAIL_MIN_WIDTH, StudyRailState, clampRailWidth } from './studyRail.svelte';

const tab = (id: string, kind: 'entities' | 'entity' | 'lookup' | 'lineage' | 'plugin' = 'entity') => ({ id, kind, title: id });

describe('StudyRailState residency (issue #243)', () => {
    it('starts closed and empty', () => {
        const r = new StudyRailState();
        expect(r.open).toBe(false);
        expect(r.tabs).toEqual([]);
        expect(r.active).toBeNull();
    });

    it('show adds, activates and opens', () => {
        const r = new StudyRailState();
        r.show(tab('a'));
        expect(r.open).toBe(true);
        expect(r.active?.id).toBe('a');
    });

    it('re-showing an id updates in place without duplicating', () => {
        const r = new StudyRailState();
        r.show({ ...tab('a'), title: 'first' });
        r.show(tab('b'));
        r.show({ ...tab('a'), title: 'second', badge: 3 });
        expect(r.tabs.map((t) => t.id)).toEqual(['a', 'b']);
        expect(r.active?.title).toBe('second');
        expect(r.active?.badge).toBe(3);
    });

    it('keeps at most four resident tabs and evicts the least recently used', () => {
        const r = new StudyRailState();
        for (const id of ['a', 'b', 'c', 'd']) r.show(tab(id));
        r.activate('a'); // a is now fresher than b
        r.show(tab('e'));
        expect(r.tabs).toHaveLength(RAIL_MAX_RESIDENT);
        expect(r.tabs.map((t) => t.id)).toEqual(['a', 'c', 'd', 'e']);
        expect(r.active?.id).toBe('e');
    });

    it('the tab just shown is never the eviction victim', () => {
        const r = new StudyRailState();
        for (const id of ['a', 'b', 'c', 'd', 'e']) r.show(tab(id));
        expect(r.has('e')).toBe(true);
        expect(r.has('a')).toBe(false);
    });

    it('closing the active tab hands over to the most recently used remaining tab', () => {
        const r = new StudyRailState();
        r.show(tab('a'));
        r.show(tab('b'));
        r.show(tab('c'));
        r.activate('a');
        r.activate('c');
        r.close('c');
        expect(r.active?.id).toBe('a');
        expect(r.open).toBe(true);
    });

    it('closing a background tab keeps the active one', () => {
        const r = new StudyRailState();
        r.show(tab('a'));
        r.show(tab('b'));
        r.close('a');
        expect(r.active?.id).toBe('b');
    });

    it('closing the last tab closes the rail', () => {
        const r = new StudyRailState();
        r.show(tab('a'));
        r.close('a');
        expect(r.tabs).toEqual([]);
        expect(r.active).toBeNull();
        expect(r.open).toBe(false);
    });

    it('hide keeps tabs resident and toggle brings the same tab back', () => {
        const r = new StudyRailState();
        r.show(tab('a'));
        r.show(tab('b'));
        r.hide();
        expect(r.open).toBe(false);
        expect(r.tabs).toHaveLength(2);
        r.toggle();
        expect(r.open).toBe(true);
        expect(r.active?.id).toBe('b');
    });

    it('toggle with no tabs opens the empty state', () => {
        const r = new StudyRailState();
        r.toggle();
        expect(r.open).toBe(true);
        expect(r.active).toBeNull();
    });

    it('closeOthers and closeAll', () => {
        const r = new StudyRailState();
        r.show(tab('a'));
        r.show(tab('b'));
        r.show(tab('c'));
        r.closeOthers('b');
        expect(r.tabs.map((t) => t.id)).toEqual(['b']);
        expect(r.active?.id).toBe('b');
        r.closeAll();
        expect(r.tabs).toEqual([]);
        expect(r.open).toBe(false);
    });

    it('update patches a tab without changing the active one', () => {
        const r = new StudyRailState();
        r.show(tab('a'));
        r.show(tab('b'));
        r.update('a', { badge: 9, qualifier: 'Gen 1' });
        expect(r.tabs[0].badge).toBe(9);
        expect(r.active?.id).toBe('b');
        r.update('zzz', { badge: 1 });
        expect(r.tabs).toHaveLength(2);
    });
});

describe('clampRailWidth', () => {
    it('clamps to 320..520 and rounds', () => {
        expect(clampRailWidth(100)).toBe(RAIL_MIN_WIDTH);
        expect(clampRailWidth(9999)).toBe(RAIL_MAX_WIDTH);
        expect(clampRailWidth(400.6)).toBe(401);
    });
    it('falls back to the default for garbage', () => {
        expect(clampRailWidth(NaN)).toBe(360);
    });
});
