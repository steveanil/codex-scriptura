import { describe, expect, it } from 'vitest';
import { formatVersesForCopy } from './copy-verses';

describe('formatVersesForCopy', () => {
    it('single verse: text then reference line', () => {
        expect(formatVersesForCopy('Genesis', 1, 'KJV', [{ verse: 1, text: 'In the beginning ' }])).toBe(
            'In the beginning\nGenesis 1:1 (KJV)'
        );
    });

    it('contiguous run joins text and uses a range reference', () => {
        const out = formatVersesForCopy('John', 3, 'WEB', [
            { verse: 17, text: 'For God' },
            { verse: 16, text: 'so loved' },
        ]);
        expect(out).toBe('so loved For God\nJohn 3:16-17 (WEB)');
    });

    it('separate runs become separate blocks', () => {
        const out = formatVersesForCopy('Ps', 23, 'KJV', [
            { verse: 1, text: 'a' },
            { verse: 2, text: 'b' },
            { verse: 4, text: 'd' },
        ]);
        expect(out).toBe('a b\nPs 23:1-2 (KJV)\n\nd\nPs 23:4 (KJV)');
    });
});
