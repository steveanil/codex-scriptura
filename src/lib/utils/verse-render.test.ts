import { describe, expect, it } from 'vitest';
import type { Annotation } from '@codex-scriptura/core';
import {
    escapeHtml,
    isVerseInAnnotation,
    parseWjRanges,
    renderVerseHtml,
    verseHighlightColor,
    type EntityRef,
} from './verse-render';

/** Remove every tag: the text content of the render must always be the
    escaped verse text, no matter how marks/wj/dv nest (lossless invariant). */
function stripTags(html: string): string {
    return html.replace(/<[^>]+>/g, '');
}

/** All wj-wrapped fragments, in order. */
function wjFragments(html: string): string[] {
    return [...html.matchAll(/<span class="wj">([^<]*)<\/span>/g)].map((m) => m[1]);
}

function ann(verseStart: string, verseEnd: string): Annotation {
    return {
        id: 'a1',
        type: 'highlight',
        book: 'Gen',
        verseStart,
        verseEnd,
        data: '#fbbf24',
        tags: [],
        created: 0,
        modified: 0,
        synced: false,
    };
}

describe('renderVerseHtml entity marking', () => {
    const opts = { redLetters: false };
    const on: EntityRef = { id: 'on_1', type: 'person', name: 'On' };
    const god: EntityRef = { id: 'god_1324', type: 'person', name: 'God' };

    it('marks whole words only - person "On" must not mark every "son"', () => {
        const html = renderVerseHtml('and On, the son of Peleth, sons of Reuben', [on], undefined, opts);
        expect(html.match(/<mark/g)).toHaveLength(1);
        expect(html).toContain('>On</mark>');
        expect(html).toContain('the son of Peleth');
    });

    it('is case-sensitive - "God" must not mark "gods" or "ungodly"', () => {
        const html = renderVerseHtml('the ungodly serve their gods', [god], undefined, opts);
        expect(html).not.toContain('<mark');
    });

    it('still marks the exact capitalized name', () => {
        const html = renderVerseHtml('In the beginning God created', [god], undefined, opts);
        expect(html).toContain('>God</mark>');
    });
});

describe('escaping (the {@html} XSS surface)', () => {
    const opts = { redLetters: false };

    it('escapes & < > " in plain verse text', () => {
        expect(escapeHtml('a & b < c > d "q"')).toBe('a &amp; b &lt; c &gt; d &quot;q&quot;');
    });

    it('never emits raw markup from verse text', () => {
        const html = renderVerseHtml('so <script>alert("x")</script> it began', [], undefined, opts);
        expect(html).not.toContain('<script');
        expect(html).toBe('so &lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; it began');
    });

    it('escapes verse text in the segments around an entity mark', () => {
        const noah: EntityRef = { id: 'noah_1', type: 'person', name: 'Noah' };
        const html = renderVerseHtml('"go" & tell Noah <now>', [noah], undefined, opts);
        expect(html).toContain('&quot;go&quot; &amp; tell ');
        expect(html).toContain('>Noah</mark>');
        expect(html).toContain(' &lt;now&gt;');
        expect(stripTags(html)).toBe(escapeHtml('"go" & tell Noah <now>'));
    });

    it('escapes quotes and apostrophes in mark data attributes', () => {
        const entity: EntityRef = { id: 'a"b', type: 'person', name: "Adam's" };
        const html = renderVerseHtml("word of Adam's house", [entity], undefined, { redLetters: false });
        expect(html).toContain('data-entity-id="a&quot;b"');
        expect(html).toContain('data-entity-name="Adam&#39;s"');
        expect(html).not.toContain('data-entity-id="a"b"');
    });

    it('escapes inside wj-wrapped segments too', () => {
        const text = 'he said "<come> & see"';
        const start = text.indexOf('"<come>');
        const html = renderVerseHtml(text, [], [[start, text.length]], { redLetters: true });
        expect(html).toContain('<span class="wj">&quot;&lt;come&gt; &amp; see&quot;</span>');
        expect(stripTags(html)).toBe(escapeHtml(text));
    });
});

describe('red-letter offset mapping', () => {
    const red = { redLetters: true };

    it('parseWjRanges: valid JSON, garbage, non-array, undefined', () => {
        expect(parseWjRanges('[[0,4],[10,12]]')).toEqual([[0, 4], [10, 12]]);
        expect(parseWjRanges('{not json')).toEqual([]);
        expect(parseWjRanges('{"a":1}')).toEqual([]);
        expect(parseWjRanges(undefined)).toEqual([]);
    });

    it('wraps exactly the plain-text range in a wj span', () => {
        const text = 'And he saith, Follow me.';
        const start = text.indexOf('Follow');
        const html = renderVerseHtml(text, [], [[start, text.length]], red);
        expect(html).toBe('And he saith, <span class="wj">Follow me.</span>');
    });

    it('redLetters:false renders no wj spans even with ranges present', () => {
        const html = renderVerseHtml('Follow me.', [], [[0, 10]], { redLetters: false });
        expect(html).not.toContain('wj');
    });

    it('offsets stay aligned after escaped characters before the range', () => {
        // '&' escapes to 5 chars and '"' to 6 - a naive HTML-offset slice
        // would drift by the difference. The wj span must still cover
        // exactly 'Go forth'.
        const text = '"He said & then: Go forth now"';
        const start = text.indexOf('Go');
        const end = start + 'Go forth'.length;
        const html = renderVerseHtml(text, [], [[start, end]], red);
        expect(wjFragments(html)).toEqual(['Go forth']);
        expect(stripTags(html)).toBe(escapeHtml(text));
    });

    it('escaped characters inside the range stay inside the span', () => {
        const text = 'said: love & obey always';
        const start = text.indexOf('love');
        const end = text.indexOf(' always');
        const html = renderVerseHtml(text, [], [[start, end]], red);
        expect(wjFragments(html)).toEqual(['love &amp; obey']);
    });

    it('an entity mark fully inside a wj range gets the wj class', () => {
        const peter: EntityRef = { id: 'peter_1', type: 'person', name: 'Peter' };
        const text = 'He saith, Peter, follow me.';
        const start = text.indexOf('Peter');
        const html = renderVerseHtml(text, [peter], [[start, text.length]], red);
        expect(html).toContain('<mark class="entity wj"');
        expect(html).toContain('>Peter</mark>');
        // The segment after the mark is still wj-wrapped
        expect(wjFragments(html)).toEqual([', follow me.']);
    });

    it('a range exactly matching the mark boundaries counts as inside', () => {
        const peter: EntityRef = { id: 'peter_1', type: 'person', name: 'Peter' };
        const text = 'He saith unto Peter, arise';
        const start = text.indexOf('Peter');
        const html = renderVerseHtml(text, [peter], [[start, start + 'Peter'.length]], red);
        expect(html).toContain('<mark class="entity wj"');
    });

    it('a range only partially covering the mark leaves the mark unmarked', () => {
        const peter: EntityRef = { id: 'peter_1', type: 'person', name: 'Peter' };
        const text = 'He saith unto Peter, arise';
        const start = text.indexOf('unto');
        const end = text.indexOf('Peter') + 2; // ends mid-name
        const html = renderVerseHtml(text, [peter], [[start, end]], red);
        expect(html).toContain('<mark class="entity"');
        expect(html).not.toContain('entity wj');
        expect(wjFragments(html)).toEqual(['unto ']);
    });

    it('multiple disjoint ranges each wrap their own segment', () => {
        const text = 'Verily I say, come and see the light';
        const r1: [number, number] = [text.indexOf('Verily'), text.indexOf(' I')];
        const r2: [number, number] = [text.indexOf('come'), text.indexOf(' the')];
        const html = renderVerseHtml(text, [], [r1, r2], red);
        expect(wjFragments(html)).toEqual(['Verily', 'come and see']);
        expect(stripTags(html)).toBe(escapeHtml(text));
    });

    it('a range covering the whole verse wraps everything', () => {
        const html = renderVerseHtml('Follow me.', [], [[0, 10]], red);
        expect(html).toBe('<span class="wj">Follow me.</span>');
    });
});

describe('divergence-span composition', () => {
    const opts = { redLetters: false };

    it('no spans renders the same as the plain call', () => {
        const text = 'In the beginning God created';
        expect(renderVerseHtml(text, [], undefined, opts, [])).toBe(
            renderVerseHtml(text, [], undefined, opts)
        );
        expect(renderVerseHtml(text, [], undefined, opts, undefined)).toBe(
            renderVerseHtml(text, [], undefined, opts)
        );
    });

    it('wraps a divergent slice with its original char offsets', () => {
        const text = 'In the beginning God created';
        const s = text.indexOf('beginning');
        const e = s + 'beginning'.length;
        const html = renderVerseHtml(text, [], undefined, opts, [[s, e]]);
        expect(html).toBe(
            `In the <span class="dv" data-dv-start="${s}" data-dv-end="${e}">beginning</span> God created`
        );
    });

    it('is lossless: stripped output equals the escaped verse for any span layout', () => {
        const text = 'the "light" & dark <divided> he them';
        const layouts: [number, number][][] = [
            [[0, 3]],
            [[4, 11], [14, 18]],
            [[0, text.length]],
            [[0, 9], [9, 13]], // adjacent spans, shared boundary
        ];
        for (const spans of layouts) {
            const html = renderVerseHtml(text, [], undefined, opts, spans);
            expect(stripTags(html)).toBe(escapeHtml(text));
        }
    });

    it('adjacent spans produce two dv wrappers without duplicating text', () => {
        const text = 'and God saw the light';
        const html = renderVerseHtml(text, [], undefined, opts, [[4, 7], [7, 11]]);
        expect(html.match(/<span class="dv"/g)).toHaveLength(2);
        expect(stripTags(html)).toBe(escapeHtml(text));
    });

    it('clips wj ranges to each slice - a range straddling a dv boundary stays covered', () => {
        const text = 'He said, go and tell them all';
        const wjStart = text.indexOf('go');
        const wj: number[][] = [[wjStart, text.length]];
        const dvStart = text.indexOf('tell');
        const dvEnd = dvStart + 'tell them'.length;
        const html = renderVerseHtml(text, [], wj, { redLetters: true }, [[dvStart, dvEnd]]);
        // wj text is split across the plain slice, the dv slice, and the tail,
        // but joined together it must cover the full range
        expect(wjFragments(html).join('')).toBe(escapeHtml(text.slice(wjStart)));
        expect(stripTags(html)).toBe(escapeHtml(text));
    });

    it('marks an entity fully inside a divergent slice', () => {
        const noah: EntityRef = { id: 'noah_1', type: 'person', name: 'Noah' };
        const text = 'and Noah builded an altar';
        const s = text.indexOf('Noah');
        const e = s + 'Noah'.length;
        const html = renderVerseHtml(text, [noah], undefined, opts, [[s, e]]);
        expect(html).toContain('data-entity-id="noah_1"');
        expect(html).toContain(`<span class="dv" data-dv-start="${s}" data-dv-end="${e}">`);
    });

    it('keeps the mark when a divergence span covers only part of a multi-word name (#184)', () => {
        const simonPeter: EntityRef = { id: 'simon_peter', type: 'person', name: 'Simon Peter' };
        const text = 'And Simon Peter answered him';
        const html = renderVerseHtml(text, [simonPeter], undefined, opts, [[4, 9]]);
        expect(html).toBe(
            'And <mark class="entity" data-entity-id="simon_peter" data-entity-type="person" data-entity-name="Simon Peter">' +
                '<span class="dv" data-dv-start="4" data-dv-end="9">Simon</span> Peter</mark> answered him'
        );
    });

    it('a divergence span crossing a mark boundary is cut at the mark and keeps its offsets', () => {
        const simonPeter: EntityRef = { id: 'simon_peter', type: 'person', name: 'Simon Peter' };
        const text = 'And Simon Peter answered him';
        // "And Simon" is divergent: half outside the mark, half inside it
        const html = renderVerseHtml(text, [simonPeter], undefined, opts, [[0, 9]]);
        expect(html.match(/<mark/g)).toHaveLength(1);
        expect(html).toContain('><span class="dv" data-dv-start="0" data-dv-end="9">Simon</span> Peter</mark>');
        expect(html.startsWith('<span class="dv" data-dv-start="0" data-dv-end="9">And </span><mark')).toBe(true);
        expect(stripTags(html)).toBe(escapeHtml(text));
    });

    it('a multi-word name straddling a span still gets the wj class and inner shading together', () => {
        const simonPeter: EntityRef = { id: 'simon_peter', type: 'person', name: 'Simon Peter' };
        const text = 'Simon Peter said unto him';
        const html = renderVerseHtml(text, [simonPeter], [[0, text.length]], { redLetters: true }, [[6, 11]]);
        expect(html).toContain('<mark class="entity wj"');
        expect(html).toContain('Simon <span class="dv" data-dv-start="6" data-dv-end="11">Peter</span></mark>');
        expect(wjFragments(html)).toEqual([' said unto him']);
        expect(stripTags(html)).toBe(escapeHtml(text));
    });

    it('combined: entity + red letters + divergence in one verse', () => {
        const peter: EntityRef = { id: 'peter_1', type: 'person', name: 'Peter' };
        const text = 'He saith to Peter, "come & follow me" always';
        const wjStart = text.indexOf('"come');
        const wjEnd = text.indexOf(' always');
        const dvStart = text.indexOf('follow');
        const dvEnd = dvStart + 'follow me'.length;
        const html = renderVerseHtml(
            text, [peter], [[wjStart, wjEnd]], { redLetters: true }, [[dvStart, dvEnd]]
        );
        expect(html).toContain('>Peter</mark>');
        expect(html).toContain(`<span class="dv" data-dv-start="${dvStart}" data-dv-end="${dvEnd}">`);
        expect(wjFragments(html).join('')).toBe(escapeHtml(text.slice(wjStart, wjEnd)));
        expect(stripTags(html)).toBe(escapeHtml(text));
    });
});

describe('verseHighlightColor', () => {
    function hl(color: string, modified: number): Annotation {
        return { ...ann('Gen.1.1', 'Gen.1.3'), id: color, type: 'highlight', color, modified };
    }

    it('returns the most recently modified covering highlight', () => {
        expect(verseHighlightColor(1, 2, [hl('#old', 1), hl('#new', 2)])).toBe('#new');
    });

    it('ignores non-covering and non-highlight annotations', () => {
        const note = { ...ann('Gen.1.1', 'Gen.1.3'), type: 'note' as const };
        expect(verseHighlightColor(1, 9, [hl('#a', 1)])).toBe(null);
        expect(verseHighlightColor(1, 2, [note])).toBe(null);
    });
});

describe('isVerseInAnnotation', () => {
    it('matches verses inside a single-chapter range', () => {
        const a = ann('Gen.1.3', 'Gen.1.5');
        expect(isVerseInAnnotation(1, 2, a)).toBe(false);
        expect(isVerseInAnnotation(1, 3, a)).toBe(true);
        expect(isVerseInAnnotation(1, 5, a)).toBe(true);
        expect(isVerseInAnnotation(1, 6, a)).toBe(false);
        expect(isVerseInAnnotation(2, 4, a)).toBe(false);
    });

    it('matches verses across a chapter boundary', () => {
        const a = ann('Gen.1.30', 'Gen.2.2');
        expect(isVerseInAnnotation(1, 29, a)).toBe(false);
        expect(isVerseInAnnotation(1, 31, a)).toBe(true);
        expect(isVerseInAnnotation(2, 1, a)).toBe(true);
        expect(isVerseInAnnotation(2, 3, a)).toBe(false);
    });

    it('rejects refs with too few parts', () => {
        expect(isVerseInAnnotation(1, 1, ann('Gen.1', 'Gen.1.5'))).toBe(false);
    });

    it('rejects non-numeric parts instead of matching every verse', () => {
        // Sub-verse suffixes can arrive via import/sync paths
        expect(isVerseInAnnotation(1, 1, ann('Gen.1.1a', 'Gen.1.5'))).toBe(false);
        expect(isVerseInAnnotation(1, 1, ann('Gen.1.1', 'Gen.1.5b'))).toBe(false);
        expect(isVerseInAnnotation(1, 1, ann('Gen.x.1', 'Gen.1.5'))).toBe(false);
    });
});
