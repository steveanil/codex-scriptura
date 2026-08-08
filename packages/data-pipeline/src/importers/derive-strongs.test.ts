import { describe, it, expect } from 'vitest';
import {
    lemmaToStrongs,
    parseMorphhbBook,
    parseVerseMap,
    mapWlcToEnglish,
    parseByzantineBook,
    type WlcVerse,
} from './derive-strongs.js';

describe('lemmaToStrongs', () => {
    it('converts a plain numeric lemma', () => {
        expect(lemmaToStrongs('7225')).toEqual(['H7225']);
    });

    it('skips letter-only prefix particles', () => {
        expect(lemmaToStrongs('b/7225')).toEqual(['H7225']);
        expect(lemmaToStrongs('c/l')).toEqual([]);
        expect(lemmaToStrongs('m')).toEqual([]);
    });

    it('drops Augmented Strong\'s disambiguation letters', () => {
        expect(lemmaToStrongs('1254 a')).toEqual(['H1254']);
    });

    it('drops the proper-noun compound marker', () => {
        expect(lemmaToStrongs('884+')).toEqual(['H884']);
        expect(lemmaToStrongs('m/884+')).toEqual(['H884']);
    });
});

const verse = (osisId: string, body: string) =>
    `<verse osisID="${osisId}">${body}</verse>`;
const w = (lemma: string) =>
    `<w lemma="${lemma}" morph="X" id="t">א</w>`;

describe('parseMorphhbBook', () => {
    it('collects deduplicated tokens per verse', () => {
        const xml = verse('Gen.1.1', w('b/7225') + w('1254 a') + w('430') + w('853') + w('853'));
        const [v] = parseMorphhbBook(xml);
        expect(v.osisId).toBe('Gen.1.1');
        expect(v.preNote).toEqual(['H7225', 'H1254', 'H430', 'H853']);
        expect(v.segments).toEqual([]);
    });

    it('includes ketiv words and qere readings inside variant notes', () => {
        const xml = verse(
            'Gen.8.17',
            w('7126') +
            `<w type="x-ketiv" lemma="3318" morph="HVhv2ms" id="a">א</w>` +
            `<note type="variant"><catchWord>x</catchWord><rdg type="x-qere">${w('3318')}</rdg></note>`
        );
        const [v] = parseMorphhbBook(xml);
        expect(v.preNote).toEqual(['H7126', 'H3318']);
    });

    it('splits at KJV boundary notes', () => {
        const xml = verse(
            'Ps.23.1',
            w('4210') + w('l/1732') + '<note>KJV:Ps.23.1</note>' + w('3068') + w('7462 b')
        );
        const [v] = parseMorphhbBook(xml);
        expect(v.preNote).toEqual(['H4210', 'H1732']);
        expect(v.segments).toEqual([{ kjv: 'Ps.23.1', tokens: ['H3068', 'H7462'] }]);
    });

    it('strips sub-verse markers from note refs and handles multiple notes', () => {
        const xml = verse(
            'Ps.13.6',
            '<note>KJV:Ps.13.5</note>' + w('982') + '<note>KJV:Ps.13.6</note>' + w('7891')
        );
        const [v] = parseMorphhbBook(xml);
        expect(v.preNote).toEqual([]);
        expect(v.segments).toEqual([
            { kjv: 'Ps.13.5', tokens: ['H982'] },
            { kjv: 'Ps.13.6', tokens: ['H7891'] },
        ]);
    });
});

describe('parseVerseMap', () => {
    const xml = `
        <verseMap>
            <verse wlc="Gen.32.1" kjv="Gen.31.55" type="full"/>
            <verse wlc="1Kgs.18.34!a" kjv="1Kgs.18.33!b" type="partial"/>
            <verse wlc="Isa.63.19!b" kjv="Isa.64.1" type="partial"/>
        </verseMap>`;

    it('strips markers and records claimed targets', () => {
        const vm = parseVerseMap(xml);
        expect(vm.wholeVerse.get('Gen.32.1')).toEqual(['Gen.31.55']);
        expect(vm.wholeVerse.get('1Kgs.18.34')).toEqual(['1Kgs.18.33']);
        expect(vm.claimed.has('Gen.31.55')).toBe(true);
        expect(vm.claimed.has('Isa.64.1')).toBe(true);
    });

    it('records pre-note homes only for WLC-side !a entries', () => {
        const vm = parseVerseMap(xml);
        // "1Kgs.18.34!a" - the first part of WLC 18.34 belongs to 18.33.
        expect(vm.preNoteHome.get('1Kgs.18.34')).toBe('1Kgs.18.33');
        // "Isa.63.19!b" - the first part stays at 63.19 (identity default).
        expect(vm.preNoteHome.has('Isa.63.19')).toBe(false);
    });
});

describe('mapWlcToEnglish', () => {
    const vm = parseVerseMap(`
        <verseMap>
            <verse wlc="Ps.3.2" kjv="Ps.3.1" type="full"/>
            <verse wlc="Ps.51.3" kjv="Ps.51.1" type="full"/>
            <verse wlc="Ps.51.4" kjv="Ps.51.2" type="full"/>
            <verse wlc="Num.25.19" kjv="Num.26.1" type="full"/>
            <verse wlc="1Kgs.18.34!a" kjv="1Kgs.18.33!b" type="partial"/>
            <verse wlc="Isa.63.19!b" kjv="Isa.64.1" type="partial"/>
        </verseMap>`);
    const plain = (osisId: string, tokens: string[]): WlcVerse =>
        ({ osisId, preNote: tokens, segments: [] });

    it('maps aligned verses by identity', () => {
        const { verses } = mapWlcToEnglish([plain('Gen.1.1', ['H7225'])], vm);
        expect(verses.get('Gen.1.1')).toEqual(['H7225']);
    });

    it('follows explicit whole-verse mappings', () => {
        const { verses } = mapWlcToEnglish([plain('Ps.3.2', ['H3068'])], vm);
        expect(verses.get('Ps.3.1')).toEqual(['H3068']);
        expect(verses.has('Ps.3.2')).toBe(false);
    });

    it('drops separately numbered Psalm title verses (incl. two-verse titles)', () => {
        const { verses, droppedTitles } = mapWlcToEnglish(
            [plain('Ps.3.1', ['H4210']), plain('Ps.51.1', ['H5329']), plain('Ps.51.2', ['H935'])],
            vm
        );
        expect(droppedTitles).toEqual(['Ps.3.1', 'Ps.51.1', 'Ps.51.2']);
        expect(verses.size).toBe(0);
    });

    it('drops embedded superscriptions before a same-ref boundary note', () => {
        const { verses, droppedTitles } = mapWlcToEnglish(
            [{
                osisId: 'Ps.23.1',
                preNote: ['H4210', 'H1732'],
                segments: [{ kjv: 'Ps.23.1', tokens: ['H3068', 'H7462'] }],
            }],
            vm
        );
        expect(droppedTitles).toEqual(['Ps.23.1']);
        expect(verses.get('Ps.23.1')).toEqual(['H3068', 'H7462']);
    });

    it('merges an unmapped verse into a claimed identity target outside Psalms', () => {
        // English Num.26.1 combines WLC Num.25.19 and WLC Num.26.1.
        const { verses } = mapWlcToEnglish(
            [plain('Num.25.19', ['H4046']), plain('Num.26.1', ['H559', 'H3068'])],
            vm
        );
        expect(verses.get('Num.26.1')).toEqual(['H4046', 'H559', 'H3068']);
    });

    it('sends pre-note tokens to the !a home when the WLC verse starts mid-English-verse', () => {
        const { verses } = mapWlcToEnglish(
            [{
                osisId: '1Kgs.18.34',
                preNote: ['H4390'],
                segments: [{ kjv: '1Kgs.18.34', tokens: ['H8138'] }],
            }],
            vm
        );
        expect(verses.get('1Kgs.18.33')).toEqual(['H4390']);
        expect(verses.get('1Kgs.18.34')).toEqual(['H8138']);
    });

    it('keeps pre-note tokens at identity for WLC-side !b straddles', () => {
        const { verses } = mapWlcToEnglish(
            [{
                osisId: 'Isa.63.19',
                preNote: ['H1961'],
                segments: [{ kjv: 'Isa.64.1', tokens: ['H7167'] }],
            }],
            vm
        );
        expect(verses.get('Isa.63.19')).toEqual(['H1961']);
        expect(verses.get('Isa.64.1')).toEqual(['H7167']);
    });
});

describe('parseByzantineBook', () => {
    it('parses CRLF lines into per-verse Greek token sets', () => {
        const text =
            '01.01 biblos 976 {N-NSF} genesews 1078 {N-GSF} ihsou 2424 {N-GSM}\r\n' +
            '01.02 abraam 11 {N-PRI} egennhsen 1080 {V-AAI-3S} abraam 11 {N-PRI}\r\n';
        const m = parseByzantineBook(text, 'Matt');
        expect(m.get('Matt.1.1')).toEqual(['G976', 'G1078', 'G2424']);
        expect(m.get('Matt.1.2')).toEqual(['G11', 'G1080']);
    });

    it('ignores parsing braces and non-verse lines', () => {
        const m = parseByzantineBook('preamble\n02.03 kai 2532 {CONJ}\n', 'Mark');
        expect(m.size).toBe(1);
        expect(m.get('Mark.2.3')).toEqual(['G2532']);
    });
});
