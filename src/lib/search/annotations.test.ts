import 'fake-indexeddb/auto';
import { beforeAll, describe, expect, it } from 'vitest';
import { db } from '@codex-scriptura/db';
import type { Annotation, VerseRecord } from '@codex-scriptura/core';
import { translationDatasetId } from '@codex-scriptura/core';
import {
    annotationMatches,
    annotationQueryPattern,
    loadAnnotationVerses,
    parseAnnotationQuery,
    searchAnnotations,
    type AnnotationVerses,
} from './annotations';

let n = 0;
function ann(type: Annotation['type'], verseStart: string, fields: Partial<Annotation> = {}): Annotation {
    n++;
    return {
        id: `a${n}`, type, book: verseStart.split('.')[0], verseStart, verseEnd: verseStart,
        data: '', tags: [], created: n, modified: n, synced: false, ...fields,
    };
}

const matches = (a: Annotation, query: string, verseText?: string) => annotationMatches(a, parseAnnotationQuery(query), verseText);

describe('parseAnnotationQuery', () => {
    it('splits words, keeps quoted phrases whole and lifts a leading #tag', () => {
        expect(parseAnnotationQuery('  #Prayer  "Bread  of life"  Grace ')).toEqual({ tag: 'prayer', terms: ['bread of life', 'grace'] });
    });
    it('reads an unclosed quote as a phrase', () => {
        expect(parseAnnotationQuery('"living wat')).toEqual({ tag: null, terms: ['living wat'] });
    });
    it('only a leading # is a tag', () => {
        expect(parseAnnotationQuery('grace #prayer').tag).toBeNull();
    });
});

describe('annotationMatches', () => {
    const note = ann('note', 'John.3.16', { data: 'God so LOVED the world - see Rom 5:8', tags: ['Sermon prep', 'Gospel'] });
    const theme = ann('theme', 'Gen.15.18', { data: 'Covenant', tags: ['covenant'] });
    const highlight = ann('highlight', 'Ps.23.1', { color: '#ff0', translation: 'KJV', tags: ['comfort'] });
    const psalm = 'The LORD is my shepherd; I shall not want.';

    it('finds a note by its body, case-insensitively', () => {
        expect(matches(note, 'loved')).toBe(true);
        expect(matches(note, 'World')).toBe(true);
        expect(matches(note, 'hated')).toBe(false);
    });
    it('finds a note by a tag name', () => {
        expect(matches(note, 'gospel')).toBe(true);
    });
    it('requires every word (AND)', () => {
        expect(matches(note, 'loved world')).toBe(true);
        expect(matches(note, 'loved hated')).toBe(false);
    });
    it('matches a quoted phrase as a phrase', () => {
        expect(matches(note, '"the world"')).toBe(true);
        expect(matches(note, '"world the"')).toBe(false);
        expect(matches(note, 'world the')).toBe(true);
    });
    it('a #tag restricts to annotations carrying it, matching names by slug', () => {
        expect(matches(note, '#sermon-prep')).toBe(true);
        expect(matches(note, '#GOSPEL loved')).toBe(true);
        expect(matches(note, '#gospel hated')).toBe(false);
        expect(matches(note, '#prayer')).toBe(false);
        expect(matches(theme, '#covenant')).toBe(true);
    });
    it('finds a theme tag by its label', () => {
        expect(matches(theme, 'coven')).toBe(true);
        expect(matches(theme, 'abraham')).toBe(false);
    });
    it('finds a highlight by the words of its verses and by its tags', () => {
        expect(matches(highlight, 'shepherd', psalm)).toBe(true);
        expect(matches(highlight, 'comfort', psalm)).toBe(true);
        expect(matches(highlight, 'shepherd')).toBe(false);
        expect(matches(highlight, 'still waters', psalm)).toBe(false);
    });
    it('verse text never makes a note match', () => {
        expect(matches(note, 'shepherd', psalm)).toBe(false);
    });
    it('folds curly apostrophes on both sides', () => {
        expect(matches(highlight, "lord's", 'the LORD’s portion')).toBe(true);
    });
    it('ignores bookmarks and memorization records', () => {
        expect(matches(ann('bookmark', 'Gen.1.1'), '')).toBe(false);
    });
});

describe('annotationQueryPattern', () => {
    it('marks phrases and words, longest first, across any whitespace and apostrophe', () => {
        const re = annotationQueryPattern(parseAnnotationQuery('#x "my shepherd" lord\'s'))!;
        expect('The LORD’s is my\nshepherd'.match(re)).toEqual(['LORD’s', 'my\nshepherd']);
        expect(annotationQueryPattern(parseAnnotationQuery('#only'))).toBeNull();
    });
});

describe('searchAnnotations', () => {
    const rev = ann('note', 'Rev.22.21', { data: 'grace at the end', modified: 300 });
    const gen = ann('note', 'Gen.6.8', { data: 'Noah found grace', modified: 100 });
    const hl = ann('highlight', 'Eph.2.8', { modified: 200 });
    const bookmark = ann('bookmark', 'Gen.1.1');
    const all = [rev, hl, gen, bookmark];
    const verses = new Map<string, AnnotationVerses>([[hl.id, { text: 'For by grace are ye saved', translationId: 'KJV' }]]);

    it('lists every searchable annotation for an empty query, in Bible order', () => {
        expect(searchAnnotations(all, verses, '').map((h) => h.annotation.id)).toEqual([gen.id, hl.id, rev.id]);
    });
    it('orders by most recently modified on request', () => {
        expect(searchAnnotations(all, verses, 'grace', { order: 'recent' }).map((h) => h.annotation.id)).toEqual([rev.id, hl.id, gen.id]);
    });
    it('carries the kind, and verse text only for highlights and themes', () => {
        const hits = searchAnnotations(all, verses, 'saved');
        expect(hits).toHaveLength(1);
        expect(hits[0]).toMatchObject({ kind: 'highlight', verses: { text: 'For by grace are ye saved' } });
        expect(searchAnnotations(all, verses, 'noah')[0].verses).toBeNull();
    });
    it('applies the testament filter', () => {
        expect(searchAnnotations(all, verses, 'grace', { testament: 'OT' }).map((h) => h.annotation.id)).toEqual([gen.id]);
    });
});

describe('loadAnnotationVerses', () => {
    const verse = (translationId: string, osisId: string, text: string, verseEnd?: number): VerseRecord => {
        const [book, chapter, v] = osisId.split('.');
        return { id: `${translationId}.${osisId}`, translationId, book, chapter: +chapter, verse: +v, verseEnd, osisId, text } as VerseRecord;
    };

    beforeAll(async () => {
        await db.verses.clear();
        await db.verses.bulkPut([
            verse('KJV', 'Ps.23.1', 'The LORD is my shepherd;'),
            verse('KJV', 'Ps.23.2', 'He maketh me to lie down'),
            verse('WEB', 'Ps.23.1', 'Yahweh is my shepherd:'),
            verse('KJV', 'Neh.7.15', 'The bridged text', 16),
        ]);
        await db.translations.bulkPut([
            { id: 'KJV', name: 'King James', abbreviation: 'KJV' },
            { id: 'WEB', name: 'World English', abbreviation: 'WEB' },
        ] as never);
        await db.datasets.bulkPut([{ id: translationDatasetId('KJV') }, { id: translationDatasetId('WEB') }] as never);
    });

    it('reads a range in the highlight\'s own translation', async () => {
        const a = ann('highlight', 'Ps.23.1', { verseEnd: 'Ps.23.2', translation: 'KJV' });
        const b = ann('highlight', 'Ps.23.1', { translation: 'WEB' });
        const texts = await loadAnnotationVerses([a, b], 'KJV');
        expect(texts.get(a.id)).toEqual({ text: 'The LORD is my shepherd; He maketh me to lie down', translationId: 'KJV' });
        expect(texts.get(b.id)).toEqual({ text: 'Yahweh is my shepherd:', translationId: 'WEB' });
    });

    it('falls back to the active translation when the highlight\'s is not installed, and for themes', async () => {
        const a = ann('highlight', 'Ps.23.1', { translation: 'ASV' });
        const t = ann('theme', 'Ps.23.1', { data: 'Shepherd', tags: ['shepherd'] });
        const texts = await loadAnnotationVerses([a, t], 'WEB');
        expect(texts.get(a.id)?.translationId).toBe('WEB');
        expect(texts.get(t.id)?.text).toBe('Yahweh is my shepherd:');
    });

    it('resolves a verse inside a bridged record once, and skips notes', async () => {
        const a = ann('highlight', 'Neh.7.15', { verseEnd: 'Neh.7.16', translation: 'KJV' });
        const note = ann('note', 'Neh.7.16', { data: 'x' });
        const texts = await loadAnnotationVerses([a, note], 'KJV');
        expect(texts.get(a.id)?.text).toBe('The bridged text');
        expect(texts.has(note.id)).toBe(false);
    });
});
