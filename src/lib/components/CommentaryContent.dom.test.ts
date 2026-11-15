// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/svelte';
import { commentaryBlockKeys } from '@codex-scriptura/core';
import CommentaryContent from './CommentaryContent.svelte';

afterEach(cleanup);

describe('CommentaryContent (issue #83)', () => {
    it('renders the supported subset as elements', () => {
        const { container } = render(CommentaryContent, { content: '## Head\n\n> a quote\n\nThe **strong** and *em* [link](https://example.org)\nnext line' });
        expect(container.querySelector('h4')?.textContent).toBe('Head');
        expect(container.querySelector('blockquote')?.textContent).toBe('a quote');
        const p = container.querySelector('p')!;
        expect(p.querySelector('strong')?.textContent).toBe('strong');
        expect(p.querySelector('em')?.textContent).toBe('em');
        const a = p.querySelector('a')!;
        expect(a.getAttribute('href')).toBe('https://example.org');
        expect(a.getAttribute('rel')).toContain('noopener');
        expect(p.querySelector('br')).not.toBeNull();
    });

    it('never turns stored text into arbitrary DOM', () => {
        const content = '<script>alert(1)</script><img src=x onerror="alert(1)"><iframe src="https://x"></iframe> [x](javascript:alert(1)) <a href="https://x">y</a>';
        const { container } = render(CommentaryContent, { content });
        for (const tag of ['script', 'img', 'iframe', 'a']) expect(container.querySelector(tag), tag).toBeNull();
        expect(container.querySelector('p')?.textContent).toBe(content);
        expect([...container.querySelectorAll('*')].map((e) => e.tagName.toLowerCase()).sort()).toEqual(['div', 'p']);
    });
});

describe('CommentaryContent excerpt provenance (issue #85)', () => {
    const content = '> In the beginning was the Word.\n\n**Chrysostom.** (*Chrys. Hom. iv.*) Because it is an especial attribute.\n\n**Bede.** As if to say.\n\n**Augustine.** (*Aug. Tr. i.*) Or thus.\n\n**Theophylact.** (*ixoAou- Dicy*) Observe the order.';
    const keys = commentaryBlockKeys(content);
    const source = { item: 'catenaaureacomme04thomuoft', leafStart: 14, leafEnd: 16 };
    const excerpts = [
        { key: keys[1], leaf: 14, citation: 'checked' as const, reviewed: '2026-11-14', reviewer: 'ai' as const },
        { key: keys[2], leaf: 14 },
        { key: keys[3], leaf: 15, citation: 'unverified' as const },
        { key: keys[4], leaf: 16, citation: 'unresolved' as const, question: 'What Greek does the margin print?', issue: 429 },
    ];

    it('says of each citation whether it was checked, is the OCR reading, or is in question', () => {
        const { container } = render(CommentaryContent, { content, excerpts, source });
        const metas = [...container.querySelectorAll('.excerpt-meta')];
        expect(metas.map((m) => m.getAttribute('data-citation'))).toEqual(['checked', 'none', 'unverified', 'unresolved']);
        expect(metas[0].textContent).toContain('Citation checked against the page');
        // An AI reading is never passed off as a person's
        expect(metas[0].textContent).toContain('by an AI reading, not yet read by a person, 2026-11-14');
        expect(metas[1].querySelector('.status')).toBeNull();
        expect(metas[2].textContent).toContain('Citation unverified (OCR reading)');
        expect(metas[3].textContent).toContain('Citation unresolved');
        expect(metas[3].textContent).toContain('Open question (#429): What Greek does the margin print?');
    });

    it('links each excerpt to its own scanned leaf and never links the citation itself', () => {
        const { container } = render(CommentaryContent, { content, excerpts, source });
        const links = [...container.querySelectorAll('a')];
        expect(links.map((a) => a.getAttribute('href'))).toEqual([14, 14, 15, 16].map((leaf) => `https://archive.org/details/catenaaureacomme04thomuoft/page/n${leaf}`));
        expect(links.every((a) => a.classList.contains('page-link') && a.getAttribute('rel')!.includes('noopener'))).toBe(true);
        // The citation is emphasis text, as stored, whatever its status
        expect([...container.querySelectorAll('p > em')].map((e) => e.textContent)).toEqual(['Chrys. Hom. iv.', 'Aug. Tr. i.', 'ixoAou- Dicy']);
        expect(container.querySelector('p a, em a')).toBeNull();
    });

    it('shows no status for a record made for another reading of the text', () => {
        const stale = [{ ...excerpts[0], key: commentaryBlockKeys(content.replace('Hom. iv.', 'Hom. v.'))[1] }];
        const { container } = render(CommentaryContent, { content, excerpts: stale, source });
        expect(container.querySelector('.excerpt-meta')).toBeNull();
        // And none at all without records: the plain renderer is unchanged
        expect(render(CommentaryContent, { content }).container.querySelector('.excerpt-meta')).toBeNull();
    });
});
