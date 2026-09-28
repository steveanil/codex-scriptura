import { describe, it, expect } from 'vitest';
import { alignExcerpts, similarity, oracleBlocks } from './verify-catena-oracle.js';

describe('Catena oracle comparison (issue #85)', () => {
    it('measures word-level similarity', () => {
        expect(similarity('In those days came John', 'In those days came John')).toBe(1);
        expect(similarity('In those days came John', 'In those days carne John')).toBeCloseTo(0.8, 2);
        expect(similarity('', '')).toBe(1);
    });

    it('aligns excerpt sequences so one missed token does not shift every later comparison', () => {
        const ours = [
            { author: 'Pseudo-Chrys.', text: 'The Sun as he approaches the horizon sends out his rays' },
            { author: 'Remig.', text: 'In these words we have time place and person. Aug. Luke describes the time by the reigning sovereigns' },
            { author: 'Chrys.', text: 'But why must John thus go before Christ' },
        ];
        const oracle = [
            { author: 'Pseudo-Chrys.', text: 'The Sun as he approaches the horizon sends out his rays' },
            { author: 'Remig.', text: 'In these words we have time place and person' },
            { author: 'Aug.', text: 'Luke describes the time by the reigning sovereigns' },
            { author: 'Chrys.', text: 'But why must John thus go before Christ' },
        ];
        expect(alignExcerpts(ours, oracle)).toEqual([[0, 0], [1, 1], [-1, 2], [2, 3]]);
    });

    it('reads both transcription layouts into blocks', () => {
        const matthew = `<span style="color:green">Gospel of Matthew, Chapter 3</span><p><span style="color:red">1. In those days</span><p><span style="color:red">2. And saying</span><hr><p><span style="color:blue">Pseudo-Chrys</span>.: The Sun rises.<p>More of the same.<p><span style="color:blue">Remig</span>.: Second.<p><span style="color:green">Gospel of Matthew, Chapter 4</span>`;
        expect(oracleBlocks(matthew, 3)).toEqual([{ chapter: 3, verseStart: 1, verseEnd: 2, excerpts: [{ author: 'Pseudo-Chrys.', text: 'The Sun rises. More of the same.' }, { author: 'Remig.', text: 'Second.' }] }]);
        const john = `<a name="1"><p><span style="font-weight: bold">CHAPTER I</span><p><span style="color: #ff0000">1a. In the beginning was the Word,</span><hr><p><b>CHRYS</b>. While all. <b>AUG</b>. The Greek word.<p><span style="color: #ff0000">1b. and the Word</span><hr><p><b>HILARY</b>; Years pass.<p><span style="font-weight: bold">CHAPTER II</span>`;
        expect(oracleBlocks(john, 1)).toEqual([
            { chapter: 1, verseStart: 1, verseEnd: 1, excerpts: [{ author: 'CHRYS', text: 'While all.' }, { author: 'AUG', text: 'The Greek word.' }] },
            { chapter: 1, verseStart: 1, verseEnd: 1, excerpts: [{ author: 'HILARY', text: 'Years pass.' }] },
        ]);
    });
});
