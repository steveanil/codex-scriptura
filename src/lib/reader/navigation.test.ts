import { describe, expect, it } from 'vitest';
import { targetFromUrl } from './navigation';

const here = { book: 'Gen', chapter: 4 };
const url = (s: string) => new URL(s, 'https://example.test');

describe('targetFromUrl', () => {
    it('reads book, chapter and a #verse- hash', () => {
        expect(targetFromUrl(url('/read?book=John&chapter=3#verse-16'), here))
            .toEqual({ book: 'John', chapter: 3, verse: '16' });
    });

    it('is null when the URL names neither a book nor a chapter', () => {
        expect(targetFromUrl(url('/read'), here)).toBeNull();
        expect(targetFromUrl(url('/read#verse-5'), here)).toBeNull();
        expect(targetFromUrl(url('/read?book=&chapter='), here)).toBeNull();
    });

    it('a book alone keeps the current chapter', () => {
        expect(targetFromUrl(url('/read?book=Exod'), here)).toEqual({ book: 'Exod', chapter: 4 });
    });

    it('a chapter alone keeps the current book', () => {
        expect(targetFromUrl(url('/read?chapter=7'), here)).toEqual({ book: 'Gen', chapter: 7 });
    });

    it('an unparseable or zero chapter reads as chapter 1', () => {
        expect(targetFromUrl(url('/read?book=Ps&chapter=abc'), here)?.chapter).toBe(1);
        expect(targetFromUrl(url('/read?book=Ps&chapter=0'), here)?.chapter).toBe(1);
    });

    it('ignores a hash that is not a verse anchor', () => {
        expect(targetFromUrl(url('/read?book=Ps&chapter=23#top'), here)).toEqual({ book: 'Ps', chapter: 23 });
    });
});
