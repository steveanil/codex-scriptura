// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/svelte';
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
