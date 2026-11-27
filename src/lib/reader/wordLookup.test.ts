import { describe, expect, it, vi } from 'vitest';
import type { Person, Place, BibleEvent, DictionaryEntry } from '@codex-scriptura/core';
import { normalizeWord, resolveWord, type ChapterEnrichment } from './wordLookup';

// Pinned to what ReaderPane's lookupWord did before it moved here,
// quirks included (see the "as it stands" cases).

const person = (name: string) => ({ id: `p-${name}`, name }) as Person;
const place = (name: string) => ({ id: `l-${name}`, name }) as Place;
const event = (name: string) => ({ id: `e-${name}`, name }) as BibleEvent;
const entry = (term: string) => ({ term, definition: `${term} defined` }) as DictionaryEntry;

function dictionary(terms: string[]) {
    return vi.fn(async (t: string) => (terms.includes(t) ? entry(t) : undefined));
}

describe('normalizeWord', () => {
    it('keeps lowercase letters only', () => {
        expect(normalizeWord("Isaac's")).toBe('isaac');
        expect(normalizeWord('God,')).toBe('god');
        expect(normalizeWord('42')).toBe('');
    });

    it('leaves words of three letters or fewer alone', () => {
        expect(normalizeWord('Abs')).toBe('abs');
        expect(normalizeWord('sons')).toBe('son');
    });

    it('cuts the first matching suffix in list order, once', () => {
        expect(normalizeWord('salvation')).toBe('salva');
        expect(normalizeWord('goodness')).toBe('good');
        expect(normalizeWord('commandment')).toBe('command');
        expect(normalizeWord('honourable')).toBe('honour');
        expect(normalizeWord('visible')).toBe('vis');
        expect(normalizeWord('blessing')).toBe('bless');
        expect(normalizeWord('blessed')).toBe('bless');
        expect(normalizeWord('shepherd')).toBe('shepherd');
        expect(normalizeWord('Moses')).toBe('mos');
        expect(normalizeWord('nations')).toBe('nation');
        expect(normalizeWord('blessings')).toBe('blessing');
    });

    it('needs three letters left after the cut, and tries shorter suffixes when not', () => {
        expect(normalizeWord('goes')).toBe('goe');
        expect(normalizeWord('ring')).toBe('ring');
        expect(normalizeWord('seed')).toBe('seed');
    });

    it('as it stands: cuts word endings that are not suffixes', () => {
        expect(normalizeWord('water')).toBe('wat');
        expect(normalizeWord('mention')).toBe('men');
        expect(normalizeWord('Jesus')).toBe('jesu');
    });
});

describe('resolveWord', () => {
    const chapter: ChapterEnrichment = {
        persons: [person('Abraham'), person('Sarah')],
        places: [place('Hebron'), place('Mamre')],
        events: [event('Covenant with Abraham')],
    };

    it('finds a person first, by exact, normalised or prefix match', async () => {
        const lookup = dictionary(['abraham']);
        expect(await resolveWord('Abraham', chapter, lookup)).toEqual({ kind: 'person', entity: chapter.persons[0] });
        expect(await resolveWord("Sarah's", chapter, lookup)).toEqual({ kind: 'person', entity: chapter.persons[1] });
        expect(await resolveWord('Abra', chapter, lookup)).toEqual({ kind: 'person', entity: chapter.persons[0] });
        expect(lookup).not.toHaveBeenCalled();
    });

    it('then a place, then an event by substring of the letters-only word', async () => {
        const lookup = dictionary([]);
        expect(await resolveWord('Hebron.', chapter, lookup)).toEqual({ kind: 'place', entity: chapter.places[0] });
        expect(await resolveWord('covenant', chapter, lookup)).toEqual({ kind: 'event', entity: chapter.events[0] });
    });

    it('then the dictionary by the letters-only word, then by the normalised word', async () => {
        const exact = dictionary(['blessings', 'blessing']);
        expect(await resolveWord('Blessings;', chapter, exact)).toEqual({ kind: 'dictionary', key: 'blessings', entry: entry('blessings') });
        expect(exact.mock.calls).toEqual([['blessings']]);

        const stem = dictionary(['blessing']);
        expect(await resolveWord('Blessings', chapter, stem)).toEqual({ kind: 'dictionary', key: 'blessings', entry: entry('blessing') });
        expect(stem.mock.calls).toEqual([['blessings'], ['blessing']]);
    });

    it('then nothing, keyed by the letters-only word', async () => {
        const lookup = dictionary([]);
        expect(await resolveWord('Zzzs', chapter, lookup)).toEqual({ kind: 'none', key: 'zzzs' });
        expect(lookup.mock.calls).toEqual([['zzzs'], ['zzz']]);
    });

    it('skips the entities when the chapter has no enrichment', async () => {
        expect(await resolveWord('Abraham', null, dictionary(['abraham']))).toEqual({ kind: 'dictionary', key: 'abraham', entry: entry('abraham') });
    });

    it('as it stands: asks the dictionary twice with the same word when nothing was cut', async () => {
        const lookup = dictionary([]);
        await resolveWord('Lot', null, lookup);
        expect(lookup.mock.calls).toEqual([['lot'], ['lot']]);
    });

    it('as it stands: a prefix of a name, or a stem shared with one, picks that person', async () => {
        expect(await resolveWord('Sar', chapter, dictionary([]))).toEqual({ kind: 'person', entity: chapter.persons[1] });
        // Two letters are enough to match by prefix
        expect(await resolveWord('Ab', chapter, dictionary([]))).toEqual({ kind: 'person', entity: chapter.persons[0] });
    });

    it('as it stands: a word with no letters matches the first person in the chapter', async () => {
        expect(await resolveWord('1-3', chapter, dictionary([]))).toEqual({ kind: 'person', entity: chapter.persons[0] });
        const noPeople = { ...chapter, persons: [], places: [] };
        expect(await resolveWord('--', noPeople, dictionary([]))).toEqual({ kind: 'event', entity: chapter.events[0] });
        expect(await resolveWord('42', null, dictionary([]))).toEqual({ kind: 'none', key: '' });
    });

    it('as it stands: an event matches any word its name contains, even a short one', async () => {
        const noPeople = { ...chapter, persons: [], places: [] };
        expect(await resolveWord('with', noPeople, dictionary(['with']))).toEqual({ kind: 'event', entity: chapter.events[0] });
    });
});
