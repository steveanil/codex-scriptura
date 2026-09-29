import { describe, it, expect } from 'vitest';
import { alignExcerpts, similarity, oracleBlocks, sameAuthor, citationAgrees } from './verify-catena-oracle.js';

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

    it('checks attribution by identity, not spelling, and citations loosely', () => {
        expect(sameAuthor('Pseudo-Chrysostom', 'Pseudo-Chrys.')).toBe(true);
        expect(sameAuthor('Gloss', 'Gloss. interlin.')).toBe(true);
        expect(sameAuthor('Augustine', 'Aug. Serm.')).toBe(true);
        expect(sameAuthor('Chrysostom', 'CHRYS')).toBe(true);
        expect(sameAuthor('Remigius', 'Rabanus')).toBe(false);
        expect(sameAuthor('Chrysostom', 'Pseudo-Chrys.')).toBe(false);
        expect(citationAgrees('Aug. De Con. Evan. ii. 6.', 'de Cons. Evan., ii, 6')).toBe(true);
        expect(citationAgrees('Hom. in Matt. xi.', 'de Cons. Evan., ii, 6')).toBe(false);
        expect(citationAgrees(undefined, 'de Cons. Evan., ii, 6')).toBe(false);
        expect(citationAgrees('anything', undefined)).toBeNull();
    });

    it('reads both transcription layouts into blocks', () => {
        const matthew = `<span style="color:green">Gospel of Matthew, Chapter 3</span><p><span style="color:red">1. In those days</span><p><span style="color:red">2. And saying</span><hr><p><span style="color:blue">Pseudo-Chrys</span>.: The Sun rises.<p>More of the same.<p><span style="color:blue">Remig</span>.: Second.<p><span style="color:green">Gospel of Matthew, Chapter 4</span>`;
        expect(oracleBlocks(matthew, 3)).toEqual([{ chapter: 3, verseStart: 1, verseEnd: 2, excerpts: [{ author: 'Pseudo-Chrys.', text: 'The Sun rises. More of the same.' }, { author: 'Remig.', text: 'Second.' }] }]);
        const cited = `<span style="color:green">Gospel of Matthew, Chapter 3</span><p><span style="color:red">1. In those days</span><hr><p><span style="color:blue">Aug</span>., de Cons. Evan., ii, 6: Luke describes the time.<p>Cassian, Collat. ix, 35: Also we should observe silence.<p>Or: this is no name.`;
        expect(oracleBlocks(cited, 3)[0].excerpts).toEqual([{ author: 'Aug.', citation: 'de Cons. Evan., ii, 6', text: 'Luke describes the time.' }, { author: 'Cassian', citation: 'Collat. ix, 35', text: 'Also we should observe silence. Or: this is no name.' }]);
        const mark = `<span style="color:green">Gospel of Mark, Chapter 4</span><p><span style="font-family:Arial">1. And he began again to teach</span><hr><p><span style="font-family:Arial;mso-bidi-font-family:" times="" new="">Chrys</span>., Hom. in Matt., 44: Which we must understand.<p><span style="font-family:Arial">Chrys</span>.: For He rouses the minds.<p><span style="font-family:Arial">Bede</span>: Now this ship.`;
        expect(oracleBlocks(mark, 4)[0].excerpts).toEqual([{ author: 'Chrys.', citation: 'Hom. in Matt., 44', text: 'Which we must understand.' }, { author: 'Chrys.', text: 'For He rouses the minds.' }, { author: 'Bede', text: 'Now this ship.' }]);
        const john = `<a name="1"><p><span style="font-weight: bold">CHAPTER I</span><p><span style="color: #ff0000">1a. In the beginning was the Word,</span><hr><p><b>CHRYS</b>. While all. <b>AUG</b>. The Greek word, as he says, <span style="color: #ff0000">In the beginning</span>, is one.<p><span style="color: #ff0000">1b. and the Word</span><hr><p><b>HILARY</b>; Years pass.<p><span style="font-weight: bold">CHAPTER II</span>`;
        expect(oracleBlocks(john, 1)).toEqual([
            { chapter: 1, verseStart: 1, verseEnd: 1, excerpts: [{ author: 'CHRYS', text: 'While all.' }, { author: 'AUG', text: 'The Greek word, as he says, In the beginning, is one.' }] },
            { chapter: 1, verseStart: 1, verseEnd: 1, excerpts: [{ author: 'HILARY', text: 'Years pass.' }] },
        ]);
    });
});

describe('the transcription\'s editorial notes', () => {
    it('leaves the editor\'s notes out of the excerpts, whether a paragraph of their own or inline', () => {
        const html = `<span style="color:green">Gospel of Matthew, Chapter 1</span><p><span style="color:red">1. The book</span><hr><p>[ed. note: This passage is from a work ascribed to Hilary.]<p><span style="color:blue">Aug</span>.: Text one [ed. note: see Enchir.] more.<p>[ed. note: a long note<p>continues here.]<p><span style="color:blue">Remig</span>.: Second.`;
        expect(oracleBlocks(html, 1)[0].excerpts).toEqual([{ author: 'Aug.', text: 'Text one more.' }, { author: 'Remig.', text: 'Second.' }]);
    });
});

describe('text review classification and the page queue', () => {
    it('accepts only mechanical differences as benign', async () => {
        const { classifyText, reviewQueue } = await import('./verify-catena-oracle.js');
        expect(classifyText('In those days came John', 'In those days came John')).toBe('exact');
        expect(classifyText('the remem- brance of his mercy; and', 'the remembrance of His mercy, and')).toBe('benign-ocr');
        expect(classifyText('a ﬁre of judgment', 'a fire of judgment [p. 92]')).toBe('benign-ocr');
        // The transcription modernises the English; that is its change, not the scan's
        expect(classifyText('he shews that he sorrows', 'he shows that he sorrows')).toBe('benign-ocr');
        expect(classifyText('Ye know that He hath the Lord\u2019s word, and cometh', 'You know that He has the Lord\u00e2\u20ac\u2122s word, and comes')).toBe('benign-ocr');
        expect(classifyText('he sees that he sorrows', 'he shows that he sorrows')).toBe('lexical');
        expect(classifyText('not to them that believe', 'to them that believe')).toBe('lexical');
        expect(classifyText('the Father loves the Son', 'the Father loves the Son [ed. note: see Enchir. 68]')).toBe('benign-ocr');
        const q = reviewQueue([
            { id: 'a#1', page: '', kind: 'text', detail: 'x: similarity 0.950;', item: 'i', leaf: 5 },
            { id: 'b', page: '', kind: 'missing-excerpt', detail: '', item: 'i', leaf: 9 },
            { id: 'c#2', page: '', kind: 'text', detail: 'x: similarity 0.400;', item: 'i', leaf: 7 },
            { id: 'd#1', page: '', kind: 'author', detail: '', item: 'i', leaf: 6 },
        ]);
        expect(q.map((g) => g.leaf)).toEqual([9, 7, 6, 5]);
    });
});
