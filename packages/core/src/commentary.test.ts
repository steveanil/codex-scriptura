import { describe, it, expect } from 'vitest';
import { parseCommentaryMarkdown, commentaryEntryProblem, chaptersCovered, toCommentaryEntry, type CommentaryInline } from './commentary.js';

const text = (t: string): CommentaryInline => ({ type: 'text', text: t });
/** Every string that ends up in the tree, in order, so tests can prove no markup survives as markup. */
const flatten = (nodes: CommentaryInline[]): string => nodes.map((n) => (n.type === 'text' ? n.text : n.type === 'break' ? '\n' : flatten(n.children))).join('');

describe('Codex Commentary Markdown v1 (issue #83)', () => {
    it('splits blocks on blank lines and keeps a single newline as a line break', () => {
        const blocks = parseCommentaryMarkdown('First line\nsecond line\n\n\nAnother paragraph\r\n\r\nThird');
        expect(blocks.map((b) => b.type)).toEqual(['paragraph', 'paragraph', 'paragraph']);
        expect(blocks[0].children).toEqual([text('First line'), { type: 'break' }, text('second line')]);
        expect(blocks[2].children).toEqual([text('Third')]);
    });

    it('parses headings and quotes', () => {
        const blocks = parseCommentaryMarkdown('## On grace\n\n> Quoted\n> across lines\n\nBody');
        expect(blocks[0]).toEqual({ type: 'heading', children: [text('On grace')] });
        expect(blocks[1]).toEqual({ type: 'quote', children: [text('Quoted'), { type: 'break' }, text('across lines')] });
        expect(blocks[2].type).toBe('paragraph');
        // A heading marker that is not alone on its block is literal
        expect(parseCommentaryMarkdown('## Not a heading\nsecond line')[0].type).toBe('paragraph');
    });

    it('round-trips strong, emphasis and links, nested', () => {
        const [p] = parseCommentaryMarkdown('The **grace of *God*** is [free](https://example.org/a?b=c).');
        expect(p.children).toEqual([
            text('The '),
            { type: 'strong', children: [text('grace of '), { type: 'em', children: [text('God')] }] },
            text(' is '),
            { type: 'link', href: 'https://example.org/a?b=c', children: [text('free')] },
            text('.'),
        ]);
    });

    it('leaves unmatched or empty markers literal', () => {
        expect(parseCommentaryMarkdown('a * b ** c')[0].children).toEqual([text('a * b ** c')]);
        expect(parseCommentaryMarkdown('**')[0].children).toEqual([text('**')]);
        expect(parseCommentaryMarkdown('****')[0].children).toEqual([text('****')]);
        expect(parseCommentaryMarkdown('*not em *')[0].children).toEqual([text('*not em *')]);
        expect(parseCommentaryMarkdown('2 * 3 * 4')[0].children).toEqual([text('2 * 3 * 4')]);
    });

    it('honours backslash escapes', () => {
        expect(flatten(parseCommentaryMarkdown('\\*literal\\* and \\[not a link\\](x) and \\\\')[0].children)).toBe('*literal* and [not a link](x) and \\');
        expect(parseCommentaryMarkdown('\\*literal\\*')[0].children).toEqual([text('*literal*')]);
    });

    it('never treats raw HTML as markup', () => {
        const src = '<script>alert(1)</script> <img src=x onerror=alert(1)> <iframe></iframe> <b>bold</b> &amp;';
        const [p] = parseCommentaryMarkdown(src);
        expect(p.children).toEqual([text(src)]);
    });

    it('accepts http(s) links only and literalizes the rest', () => {
        const [js] = parseCommentaryMarkdown('[x](javascript:alert(1))');
        expect(js.children).toEqual([text('[x](javascript:alert(1))')]);
        expect(parseCommentaryMarkdown('[x](data:text/html,hi)')[0].children).toEqual([text('[x](data:text/html,hi)')]);
        expect(parseCommentaryMarkdown('[x](/relative)')[0].children).toEqual([text('[x](/relative)')]);
        expect(parseCommentaryMarkdown('[x](HTTP://Example.org)')[0].children[0].type).toBe('link');
        expect(parseCommentaryMarkdown('[](https://example.org)')[0].children).toEqual([text('[](https://example.org)')]);
        // No links inside links: the inner one is literal text
        const [nested] = parseCommentaryMarkdown('[a [b](https://x.org) c](https://y.org)');
        expect(nested.children[0]).toEqual(text('[a '));
        expect(nested.children[1]).toMatchObject({ type: 'link', href: 'https://x.org' });
        expect(nested.children[2]).toEqual(text(' c](https://y.org)'));
    });

    it('produces only the six node kinds whatever the input', () => {
        const kinds = new Set<string>();
        const walk = (nodes: CommentaryInline[]) => { for (const n of nodes) { kinds.add(n.type); if ('children' in n) walk(n.children); } };
        for (const b of parseCommentaryMarkdown('## *h*\n\n> **q** [l](https://x)\n\n<a href="x">y</a> \\* ** * [ ] ( ) # > \\')) { kinds.add(b.type); walk(b.children); }
        for (const k of kinds) expect(['paragraph', 'quote', 'heading', 'text', 'strong', 'em', 'link', 'break']).toContain(k);
    });

    it('gives no blocks for empty or whitespace content', () => {
        expect(parseCommentaryMarkdown('')).toEqual([]);
        expect(parseCommentaryMarkdown('  \n\n \t')).toEqual([]);
    });
});

describe('chaptersCovered', () => {
    it('expands a range to every chapter it touches, within and across books', () => {
        expect(chaptersCovered('John.3.16', 'John.3.16')).toEqual(['John.3']);
        expect(chaptersCovered('Gen.1.5', 'Gen.3.2')).toEqual(['Gen.1', 'Gen.2', 'Gen.3']);
        expect(chaptersCovered('Gen.50.20', 'Exod.2.1')).toEqual(['Gen.50', 'Exod.1', 'Exod.2']);
        expect(chaptersCovered('Obad.1.1', 'Jonah.1.1')).toEqual(['Obad.1', 'Jonah.1']);
    });
});

describe('commentaryEntryProblem and toCommentaryEntry', () => {
    const good = { id: 'mh-john-3-16', startRef: 'John.3.16', endRef: 'John.3.18', heading: 'God so loved', content: 'Herein is **love**.' };

    it('accepts a well-formed entry and derives the stored record', () => {
        expect(commentaryEntryProblem(good)).toBeNull();
        expect(toCommentaryEntry(good, 'matthew-henry')).toEqual({ ...good, resourceId: 'matthew-henry', chapters: ['John.3'] });
        const { heading: _h, ...noHeading } = good;
        expect(toCommentaryEntry(noHeading, 'mh')).not.toHaveProperty('heading');
    });

    it('rejects malformed or non-canonical refs and reversed ranges', () => {
        expect(commentaryEntryProblem({ ...good, startRef: 'John.3' })).toMatch(/not a strict OSIS verse id/);
        expect(commentaryEntryProblem({ ...good, endRef: 'John 3:16' })).toMatch(/not a strict OSIS verse id/);
        expect(commentaryEntryProblem({ ...good, startRef: 'Jn.3.16' })).toMatch(/not a canonical reference/);
        expect(commentaryEntryProblem({ ...good, startRef: 'John.0.16' })).toMatch(/not a canonical reference/);
        expect(commentaryEntryProblem({ ...good, startRef: 'John.4.1' })).toMatch(/after endRef/);
        expect(commentaryEntryProblem({ ...good, startRef: 'Acts.1.1' })).toMatch(/after endRef/);
        expect(commentaryEntryProblem({ ...good, endRef: undefined })).toMatch(/missing endRef/);
    });

    it('rejects empty content, empty headings and non-objects', () => {
        expect(commentaryEntryProblem({ ...good, content: '  \n ' })).toMatch(/empty content/);
        expect(commentaryEntryProblem({ ...good, content: 42 })).toMatch(/empty content/);
        expect(commentaryEntryProblem({ ...good, heading: '' })).toMatch(/heading/);
        expect(commentaryEntryProblem({ ...good, id: '' })).toMatch(/missing id/);
        expect(commentaryEntryProblem(null)).toMatch(/not an object/);
        expect(() => toCommentaryEntry({ ...good, content: '' }, 'mh')).toThrow(/Invalid commentary entry/);
    });
});
