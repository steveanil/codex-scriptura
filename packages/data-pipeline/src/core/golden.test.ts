import { describe, it, expect } from 'vitest';
import { checkGolden, type GoldenAnchor } from './golden.js';

// The WEB John 3:16 anchor and the 2026-08 upstream edition that reworded it (issue #213).
const anchor: GoldenAnchor = {
    osisId: 'John.3.16',
    text: 'For God so loved the world, that he gave his one and only Son, that whoever believes in him should not perish, but have eternal life.',
    lemmas: ['G25', 'G2316'],
    absentLemmas: ['H4210'],
    align: [{ strongs: 'G25', surface: 'loved' }],
};
const good = {
    osisId: 'John.3.16',
    text: anchor.text,
    lemmas: 'G2316 G25 G2889',
    align: '[[4,7,"G2316"],[11,16,"G25"]]',
};

describe('checkGolden (issue #213 rewording detection)', () => {
    it('holds for the pinned reading', () => {
        expect(checkGolden(good, anchor)).toEqual([]);
    });

    it('reports a reworded verse with both readings', () => {
        const reworded = { ...good, text: good.text.replace('his one and only Son', 'his only born Son') };
        const problems = checkGolden(reworded, anchor);
        expect(problems).toHaveLength(1);
        expect(problems[0]).toMatch(/text changed/);
        expect(problems[0]).toContain('one and only');
        expect(problems[0]).toContain('only born');
    });

    it('reports punctuation-only drift too', () => {
        expect(checkGolden({ ...good, text: good.text.replace('world,', 'world;') }, anchor)).toHaveLength(1);
    });

    it('reports a missing verse', () => {
        expect(checkGolden(undefined, anchor)).toEqual(['John.3.16: verse missing from the corpus']);
    });

    it('reports lost and leaked lemmas', () => {
        expect(checkGolden({ ...good, lemmas: 'G2316 G2889' }, anchor)).toEqual(['John.3.16: missing lemma G25']);
        expect(checkGolden({ ...good, align: '[[4,7,"G2316"]]' }, anchor)).toEqual(['John.3.16: no span carries G25']);
        expect(checkGolden({ ...good, lemmas: 'G2316 G25 H4210' }, anchor)).toEqual(['John.3.16: carries out-of-verse lemma H4210']);
    });

    it('reports an alignment that drifted off its English word', () => {
        const drifted = { ...good, align: '[[4,7,"G2316"],[17,20,"G25"]]' };
        expect(checkGolden(drifted, anchor)).toEqual(['John.3.16: G25 aligns to "the", expected "loved"']);
    });
});

describe('checkGolden footnote anchors (issue #39)', () => {
    const noted: GoldenAnchor = {
        osisId: 'Gen.1.1',
        text: 'In the beginning, God created.',
        notes: [{ after: 'beginning, God', text: 'Hebrew: Elohim. See Exodus 3:3.', refs: ['Exod.3.3'] }],
    };
    const verse = {
        osisId: 'Gen.1.1',
        text: noted.text,
        notes: JSON.stringify([{ at: 21, runs: ['Hebrew: ', { t: 'Elohim', s: 'alt' }, '. See ', { t: 'Exodus 3:3', ref: 'Exod.3.3' }, '.'] }]),
    };

    it('holds when position, text and links match', () => {
        expect(checkGolden(verse, noted)).toEqual([]);
    });

    it('reports a moved callout, a lost link and a missing note', () => {
        const drifted = { ...verse, notes: JSON.stringify([{ at: 30, runs: ['Hebrew: Elohim. See Exodus 3:3.'] }]) };
        expect(checkGolden(drifted, noted)).toEqual([
            'Gen.1.1: note 1 sits after "In the beginning, God created.", expected after "beginning, God"',
            'Gen.1.1: note 1 links to [], expected [Exod.3.3]',
        ]);
        expect(checkGolden({ ...verse, notes: undefined }, noted)).toEqual(['Gen.1.1: 0 notes, expected 1']);
    });
});
