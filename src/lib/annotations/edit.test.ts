import { describe, expect, it } from 'vitest';
import type { Annotation } from '@codex-scriptura/core';
import { editAnnotation, normalizeTags, noteContentError, type AnnotationPatch, type LastVerses } from './edit';

function ann(over: Partial<Annotation> = {}): Annotation {
    return {
        id: 'a1',
        type: 'note',
        book: 'Gen',
        verseStart: 'Gen.1.1',
        verseEnd: 'Gen.1.2',
        data: 'In the beginning',
        tags: ['creation'],
        created: 100,
        modified: 200,
        synced: false,
        ...over,
    };
}

const highlight = (over: Partial<Annotation> = {}) =>
    ann({ type: 'highlight', data: '', tags: [], color: 'rgba(250, 204, 21, 0.4)', translation: 'ASV', ...over });

const GEN: LastVerses = { 1: 31, 2: 25, 3: 24 };

function ok(r: ReturnType<typeof editAnnotation>) {
    if (!r.ok) throw new Error(`expected ok, got: ${r.error}`);
    return r;
}
function err(r: ReturnType<typeof editAnnotation>) {
    if (r.ok) throw new Error('expected a validation error');
    return r.error;
}

describe('normalizeTags', () => {
    it('trims, lowercases, collapses inner spaces, drops blanks and de-duplicates in first-seen order', () => {
        expect(normalizeTags([' Grace ', 'faith', 'GRACE', '', '  ', 'Faith'])).toEqual(['grace', 'faith']);
        expect(normalizeTags(['Sermon   prep', 'sermon prep'])).toEqual(['sermon prep']);
    });
});

describe('noteContentError', () => {
    it('rejects a note with no text and no tags, accepts either one', () => {
        expect(noteContentError('  ', [])).toBeTruthy();
        expect(noteContentError('', [' ', ''])).toBeTruthy();
        expect(noteContentError('x', [])).toBeNull();
        expect(noteContentError('', ['grace'])).toBeNull();
    });
});

describe('editAnnotation: notes', () => {
    it('changes the body and keeps id, type, created and the original object untouched', () => {
        const before = ann();
        const r = ok(editAnnotation(before, { body: 'Let there be light' }));
        expect(r.changed).toBe(true);
        expect(r.annotation).toMatchObject({ id: 'a1', type: 'note', created: 100, data: 'Let there be light' });
        expect(before.data).toBe('In the beginning');
    });

    it('normalises tags and counts a tag-only change as a change', () => {
        const r = ok(editAnnotation(ann(), { tags: ['creation', ' Light ', 'light'] }));
        expect(r.annotation.tags).toEqual(['creation', 'light']);
        expect(r.changed).toBe(true);
    });

    it('removes a tag', () => {
        const r = ok(editAnnotation(ann({ tags: ['creation', 'light'] }), { tags: ['light'] }));
        expect(r.annotation.tags).toEqual(['light']);
    });

    it('allows an empty body while tags remain, and rejects an empty body with no tags', () => {
        expect(ok(editAnnotation(ann(), { body: '' })).annotation.data).toBe('');
        expect(err(editAnnotation(ann(), { body: '   ', tags: [] }))).toMatch(/Write something/);
        expect(err(editAnnotation(ann({ data: '' }), { tags: [' '] }))).toMatch(/Write something/);
    });

    it('reports no change when the patch matches the record', () => {
        const r = ok(editAnnotation(ann(), { body: 'In the beginning', tags: ['Creation'] }));
        expect(r.changed).toBe(false);
    });

    it('rejects a colour', () => {
        expect(err(editAnnotation(ann(), { color: 'red' }))).toMatch(/Only highlights/);
    });

    it('ignores fields outside the patch such as id, type, created and translation', () => {
        const sneaky = { body: 'x', id: 'other', type: 'highlight', created: 1, translation: 'KJV' } as AnnotationPatch;
        const r = ok(editAnnotation(ann(), sneaky));
        expect(r.annotation).toMatchObject({ id: 'a1', type: 'note', created: 100 });
        expect(r.annotation.translation).toBeUndefined();
    });
});

describe('editAnnotation: ranges', () => {
    it('moves a note to a new range across chapters, normalising the ids', () => {
        const r = ok(editAnnotation(ann(), { range: { start: 'Gen.1.31', end: 'Gen.02.3' } }, GEN));
        expect(r.annotation).toMatchObject({ book: 'Gen', verseStart: 'Gen.1.31', verseEnd: 'Gen.2.3' });
        expect(r.changed).toBe(true);
    });

    it('accepts a single-verse range', () => {
        const r = ok(editAnnotation(ann(), { range: { start: 'Gen.3.24', end: 'Gen.3.24' } }, GEN));
        expect(r.annotation.verseEnd).toBe('Gen.3.24');
    });

    it('rejects a range that leaves the book', () => {
        expect(err(editAnnotation(ann(), { range: { start: 'Gen.1.1', end: 'Exod.1.1' } }, GEN))).toMatch(/stay in Genesis/);
        expect(err(editAnnotation(ann(), { range: { start: 'Exod.1.1', end: 'Exod.1.2' } }, GEN))).toMatch(/stay in Genesis/);
    });

    it('rejects ids that are not strict OSIS verse ids', () => {
        expect(err(editAnnotation(ann(), { range: { start: 'Gen.1', end: 'Gen.1.2' } }, GEN))).toMatch(/start and an end/);
        expect(err(editAnnotation(ann(), { range: { start: 'Gen.1.1a', end: 'Gen.1.2' } }, GEN))).toMatch(/start and an end/);
        expect(err(editAnnotation(ann(), { range: { start: '', end: '' } }, GEN))).toMatch(/start and an end/);
    });

    it('rejects chapters and verses the book does not have', () => {
        expect(err(editAnnotation(ann(), { range: { start: 'Gen.4.1', end: 'Gen.4.2' } }, GEN))).toMatch(/no chapter 4/);
        expect(err(editAnnotation(ann(), { range: { start: 'Gen.1.1', end: 'Gen.1.32' } }, GEN))).toMatch(/Genesis 1 has no verse 32/);
        expect(err(editAnnotation(ann(), { range: { start: 'Gen.1.0', end: 'Gen.1.2' } }, GEN))).toMatch(/no verse 0/);
    });

    it('rejects a start after the end, within and across chapters', () => {
        expect(err(editAnnotation(ann(), { range: { start: 'Gen.1.5', end: 'Gen.1.4' } }, GEN))).toMatch(/comes after/);
        expect(err(editAnnotation(ann(), { range: { start: 'Gen.2.1', end: 'Gen.1.31' } }, GEN))).toMatch(/comes after/);
    });

    it('needs the verse numbers to check a range', () => {
        expect(err(editAnnotation(ann(), { range: { start: 'Gen.1.1', end: 'Gen.1.3' } }))).toMatch(/not loaded/);
    });

    it('moves a highlight and keeps its translation', () => {
        const r = ok(editAnnotation(highlight(), { range: { start: 'Gen.2.4', end: 'Gen.2.7' } }, GEN));
        expect(r.annotation).toMatchObject({ verseStart: 'Gen.2.4', verseEnd: 'Gen.2.7', translation: 'ASV', id: 'a1' });
    });
});

describe('editAnnotation: highlights', () => {
    it('changes the colour in place and keeps the translation', () => {
        const r = ok(editAnnotation(highlight(), { color: 'rgba(96, 165, 250, 0.4)' }));
        expect(r.annotation).toMatchObject({ id: 'a1', color: 'rgba(96, 165, 250, 0.4)', translation: 'ASV', created: 100 });
        expect(r.changed).toBe(true);
    });

    it('reports no change for the same colour', () => {
        expect(ok(editAnnotation(highlight(), { color: 'rgba(250, 204, 21, 0.4)' })).changed).toBe(false);
    });

    it('rejects an empty colour, text and tags', () => {
        expect(err(editAnnotation(highlight(), { color: ' ' }))).toMatch(/Pick a colour/);
        expect(err(editAnnotation(highlight(), { body: 'x' }))).toMatch(/Only notes have text/);
        expect(err(editAnnotation(highlight(), { tags: ['x'] }))).toMatch(/Only notes carry tags/);
    });
});

describe('editAnnotation: themes and other types', () => {
    const theme = ann({ type: 'theme', data: 'Covenant', tags: ['covenant'] });

    it('refuses every edit of a theme, keeping its anchors', () => {
        expect(err(editAnnotation(theme, { range: { start: 'Gen.1.1', end: 'Gen.1.3' } }, GEN))).toMatch(/Theme tags keep their verses/);
        expect(err(editAnnotation(theme, { tags: ['grace'] }))).toMatch(/Theme tags/);
    });

    it('refuses bookmark and memorization records, which have no UI', () => {
        expect(err(editAnnotation(ann({ type: 'bookmark' }), { body: 'x' }))).toMatch(/can not be edited/);
    });
});
