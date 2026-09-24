import { describe, it, expect } from 'vitest';
import { rankTranslationsForBook, pickSplitTranslation } from './translationSelection';

const FULL = ['Gen', 'Exod', 'Deut', 'Ruth', 'Ps', 'Matt', 'Rev'];
const OEB_BOOKS = ['Ruth', 'Ps', 'Matt', 'Rev']; // partial canon: no Pentateuch
// Catalog order is alphabetical by id, so ASV sorts before KJV
const cat = (...ids: string[]) => ids.map((id) => ({ id, books: id === 'OEB' ? OEB_BOOKS : FULL }));

describe('rankTranslationsForBook (issue #404)', () => {
    it('Genesis with OEB installed: OEB is never a candidate', () => {
        expect(rankTranslationsForBook('Gen', cat('ASV', 'KJV', 'OEB', 'WEB')).map((t) => t.id)).toEqual(['KJV', 'ASV', 'WEB']);
    });

    it('the stored preference comes first when eligible', () => {
        expect(rankTranslationsForBook('Gen', cat('ASV', 'KJV', 'WEB'), { preferredId: 'WEB' }).map((t) => t.id)).toEqual(['WEB', 'KJV', 'ASV']);
    });

    it('an ineligible preference is ignored and KJV leads', () => {
        expect(rankTranslationsForBook('Deut', cat('ASV', 'KJV', 'OEB', 'WEB'), { preferredId: 'OEB' }).map((t) => t.id)).toEqual(['KJV', 'ASV', 'WEB']);
    });

    it('KJV outranks catalog order, and the rest keep it', () => {
        expect(rankTranslationsForBook('Gen', cat('ASV', 'BSB', 'KJV', 'WEB')).map((t) => t.id)).toEqual(['KJV', 'ASV', 'BSB', 'WEB']);
    });

    it('excluded ids never appear', () => {
        expect(rankTranslationsForBook('Gen', cat('KJV', 'WEB'), { excludeIds: ['KJV'] }).map((t) => t.id)).toEqual(['WEB']);
    });

    it('a translation with no books on the device is not a candidate', () => {
        expect(rankTranslationsForBook('Gen', [{ id: 'KJV', books: [] }, { id: 'WEB', books: FULL }]).map((t) => t.id)).toEqual(['WEB']);
    });

    it('is deterministic for the same catalog order regardless of preference presence', () => {
        const a = rankTranslationsForBook('Gen', cat('WEB', 'KJV', 'ASV'), { preferredId: null }).map((t) => t.id);
        const b = rankTranslationsForBook('Gen', cat('WEB', 'KJV', 'ASV'), {}).map((t) => t.id);
        expect(a).toEqual(b);
        expect(a).toEqual(['KJV', 'WEB', 'ASV']);
    });
});

describe('pickSplitTranslation (issue #404)', () => {
    it('Genesis with OEB installed picks a translation that has Genesis, never OEB', () => {
        const pick = pickSplitTranslation('Gen', cat('KJV', 'OEB', 'WEB'), { preferredId: 'KJV', inUse: ['KJV'], sourceId: 'KJV' });
        expect(pick).toBe('WEB');
    });

    it('preferred translation eligible and unused: it is chosen', () => {
        expect(pickSplitTranslation('Gen', cat('ASV', 'KJV', 'WEB'), { preferredId: 'WEB', inUse: ['KJV'], sourceId: 'KJV' })).toBe('WEB');
    });

    it('preferred translation ineligible for the book: the next eligible candidate', () => {
        expect(pickSplitTranslation('Deut', cat('ASV', 'KJV', 'OEB', 'WEB'), { preferredId: 'OEB', inUse: ['KJV'], sourceId: 'KJV' })).toBe('ASV');
    });

    it('preferred translation already used by another pane: the next eligible candidate', () => {
        expect(pickSplitTranslation('Gen', cat('ASV', 'KJV', 'WEB'), { preferredId: 'WEB', inUse: ['WEB'], sourceId: 'WEB' })).toBe('KJV');
    });

    it('KJV fallback when nothing is preferred', () => {
        expect(pickSplitTranslation('Gen', cat('ASV', 'KJV', 'WEB'), { inUse: ['WEB'], sourceId: 'WEB' })).toBe('KJV');
    });

    it('no compatible unused translation remaining: the pane opens on a duplicate, preferring the source pane', () => {
        // Pane 0 KJV, pane 1 WEB, only KJV and WEB compatible -> pane 2 on KJV
        expect(pickSplitTranslation('Gen', cat('KJV', 'OEB', 'WEB'), { preferredId: 'KJV', inUse: ['KJV', 'WEB'], sourceId: 'KJV' })).toBe('KJV');
        expect(pickSplitTranslation('Gen', cat('KJV', 'OEB', 'WEB'), { preferredId: 'KJV', inUse: ['KJV', 'WEB'], sourceId: 'WEB' })).toBe('WEB');
    });

    it('source pane incompatible with the reference while another pane is compatible: compatibility wins over affinity', () => {
        // Pane 0 OEB (the source) cannot render Deut 7; pane 1 KJV can; nothing unused
        expect(pickSplitTranslation('Deut', cat('KJV', 'OEB'), { preferredId: 'OEB', inUse: ['OEB', 'KJV'], sourceId: 'OEB' })).toBe('KJV');
        // With WEB installed and unused, uniqueness still comes before affinity
        expect(pickSplitTranslation('Deut', cat('KJV', 'OEB', 'WEB'), { preferredId: 'OEB', inUse: ['OEB', 'KJV'], sourceId: 'OEB' })).toBe('WEB');
    });

    it('refuses only when no installed translation contains the book', () => {
        expect(pickSplitTranslation('Deut', cat('OEB'), { inUse: ['OEB'], sourceId: 'OEB' })).toBeNull();
        expect(pickSplitTranslation('Deut', [], { inUse: [] })).toBeNull();
    });
});
