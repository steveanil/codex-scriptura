import { describe, it, expect } from 'vitest';
import { unicodeAnomalies, unicodeSummary } from './catena-unicode-report.js';

const entry = (id: string, content: string, excerptLeaves?: number[]) => ({ id, content, item: 'scan', excerptLeaves });

describe('Catena unicode report (issue #85)', () => {
    it('finds nothing in the edition\'s own scripts and marks', () => {
        const clean = entry('a', '> 1. In the beginning was the Word.\n\n**Chrysostom.** (*Chrys. Hom. iv.*) He saith ‘Word,’ λόγος in Greek, אל in Hebrew, dæmons — and so on; § 2.');
        expect(unicodeAnomalies([clean])).toEqual([]);
        expect(unicodeSummary([])).toEqual(['unicode report: nothing outside the edition\'s scripts']);
    });

    it('reports a character of another script with its count, region and place, and never alters the text', () => {
        const content = '> 2. The same was in the beginning。\n\n**Augustine.** (*Aug。 Tr. x。*) To do so。 Therefore.\n\n**Bede.** (*Bede ubi sup.*) It follows； Now.';
        const e = entry('catena-john-1-2', content, [40, 41]);
        const found = unicodeAnomalies([e]);
        expect(e.content).toBe(content);
        expect(found.map((f) => [f.text, f.code, f.script, f.kind, f.count, f.byRegion])).toEqual([
            ['。', 'U+3002', 'CJK punctuation', 'other script', 4, { lemma: 1, citation: 2, 'running text': 1 }],
            ['；', 'U+FF1B', 'full-width form', 'other script', 1, { 'running text': 1 }],
        ]);
        expect(found[0].examples.map((x) => [x.region, x.leaf])).toEqual([['lemma', undefined], ['citation', 40], ['citation', 40]]);
        expect(found[1].examples[0]).toMatchObject({ entry: 'catena-john-1-2', item: 'scan', leaf: 41, region: 'running text' });
    });

    it('flags a word that mixes Greek letters with Latin ones, and an ideograph inside one', () => {
        const found = unicodeAnomalies([entry('a', '**Jerome.** In Greek, βaoi入sus, which is king; and κυλλοὺς is maimed.')]);
        expect(found.map((f) => [f.kind, f.text])).toEqual([['mixed-script word', 'βaoi入sus,'], ['other script', '入']]);
        expect(found[1].script).toBe('Han');
    });

    it('keeps the report short: three places a finding, findings in a fixed order', () => {
        const many = Array.from({ length: 9 }, (_, i) => entry(`e${i}`, `**Bede.** word。 and 福${i % 2 ? ' ↑' : ''}`));
        const found = unicodeAnomalies(many);
        expect(found.map((f) => [f.text, f.count, f.entries, f.examples.length])).toEqual([['。', 9, 9, 3], ['福', 9, 9, 3], ['↑', 4, 4, 3]]);
        expect(found[2].kind).toBe('symbol');
        expect(unicodeAnomalies([...many].reverse()).map((f) => f.text)).toEqual(found.map((f) => f.text));
        const lines = unicodeSummary(found);
        expect(lines).toHaveLength(2);
        expect(lines[0]).toBe('unicode report: 22 characters outside the edition\'s scripts (3 different), 0 words mixing Latin and Greek letters (0 different)');
    });
});
