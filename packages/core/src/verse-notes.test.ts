import { describe, expect, it } from 'vitest';
import { parseVerseNotes } from './verse-notes.js';

describe('parseVerseNotes', () => {
    it('parses every run shape', () => {
        const notes = [
            { at: 3, runs: ['plain ', { t: 'word', s: 'catch' }, ': or, ', { t: 'other', s: 'alt' }] },
            { at: 9, kind: 'xref', runs: [{ t: 'Exodus 30:12', ref: 'Exod.30.12' }] },
            { at: 12, verse: 21, runs: ['Many authorities insert v. 21.'] },
        ];
        expect(parseVerseNotes(JSON.stringify(notes))).toEqual(notes);
    });

    it('gives [] for missing, empty, malformed or non-array input', () => {
        expect(parseVerseNotes(undefined)).toEqual([]);
        expect(parseVerseNotes('')).toEqual([]);
        expect(parseVerseNotes('{not json')).toEqual([]);
        expect(parseVerseNotes('{"at":1}')).toEqual([]);
    });

    it('skips malformed notes and keeps the good ones', () => {
        const good = { at: 0, runs: ['ok'] };
        const json = JSON.stringify([
            good,
            { at: -1, runs: ['negative'] },
            { at: 1.5, runs: ['fractional'] },
            { at: 2, runs: [] },
            { at: 2, runs: [''] },
            { at: 2, kind: 'other', runs: ['bad kind'] },
            { at: 2, runs: [{ t: 'x', s: 'bold' }] },
            { at: 2, runs: [{ t: 'x', ref: '' }] },
            { at: 2, runs: [{ t: '', ref: 'Gen.1.1' }] },
            { at: 2, verse: 0, runs: ['verse zero'] },
            { at: 2, verse: 2.5, runs: ['fractional verse'] },
            { at: 2, verse: '21', runs: ['verse as text'] },
            null,
            'text',
        ]);
        expect(parseVerseNotes(json)).toEqual([good]);
    });
});
