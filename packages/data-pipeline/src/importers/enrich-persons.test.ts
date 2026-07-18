import { describe, it, expect } from 'vitest';
import {
    baseNameKey,
    buildBdIndexes,
    resolvePersonMatch,
    resolveByGenealogyContext,
    selectBestMeaning,
    enrichPersonsData,
    type Person,
    type BibleDataLabel,
} from './enrich-persons.js';
import { ResolutionMap } from '../core/entity-resolver.js';
import { ConflictStore } from '../core/conflict-store.js';

function person(id: string, name: string): Person {
    return { id, name, verseRefs: [] };
}

function label(personId: string, englishLabel: string, over: Partial<BibleDataLabel> = {}): BibleDataLabel {
    return { personId, englishLabel, labelType: 'Proper Name', hebrewMeaning: '', greekMeaning: '', ...over };
}

describe('resolvePersonMatch (stages 1–4)', () => {
    const indexes = buildBdIndexes(
        [
            { personId: 'John_1', personName: 'John' },
            { personId: 'Judas_1', personName: 'Judas' },
            { personId: 'Judas_2', personName: 'Judas' },
            { personId: 'Abram_1', personName: 'Abram' },
        ],
        [label('Abram_1', 'Abraham')],
    );

    it('Stage 1: matches by case-folded ID', () => {
        expect(resolvePersonMatch(person('john_1', 'Johannes'), indexes))
            .toEqual({ resolved: true, bdPersonId: 'John_1', stage: 'id-direct' });
    });

    it('Stage 2: matches a unique normalized name', () => {
        expect(resolvePersonMatch(person('john_99', 'John'), indexes))
            .toEqual({ resolved: true, bdPersonId: 'John_1', stage: 'name-unique' });
    });

    it('resolves same-named candidates with a matching ID via Stage 1 (Stage 3 is its shadow)', () => {
        // Stage 3 (id-discriminant) can only fire when the Stage-1 index
        // misses but a name candidate's ID matches - with a complete index
        // Stage 1 always wins first. Real runs report Stage 3 = 0.
        expect(resolvePersonMatch(person('judas_2', 'Judas'), indexes))
            .toEqual({ resolved: true, bdPersonId: 'Judas_2', stage: 'id-direct' });
    });

    it('Stage 4: falls back to a unique proper-name label (Abram/Abraham)', () => {
        expect(resolvePersonMatch(person('abraham_9', 'Abraham'), indexes))
            .toEqual({ resolved: true, bdPersonId: 'Abram_1', stage: 'label-fallback' });
    });

    it('reports ambiguity with the surviving candidates', () => {
        expect(resolvePersonMatch(person('judas_9', 'Judas'), indexes))
            .toEqual({ resolved: false, reason: 'ambiguous', candidates: ['Judas_1', 'Judas_2'] });
    });

    it('reports no-match when nothing fits', () => {
        expect(resolvePersonMatch(person('melchizedek_1', 'Melchizedek'), indexes))
            .toEqual({ resolved: false, reason: 'no-match', candidates: [] });
    });

    it('Stage 4b: resolves a parenthetically-qualified name with a unique base match', () => {
        expect(resolvePersonMatch(person('john_88', 'John (the Baptist)'), indexes))
            .toEqual({ resolved: true, bdPersonId: 'John_1', stage: 'base-name' });
    });

    it('Stage 4b: surfaces base-name candidates as ambiguous for Stage 5', () => {
        expect(resolvePersonMatch(person('judas_88', 'Judas (Iscariot)'), indexes))
            .toEqual({ resolved: false, reason: 'ambiguous', candidates: ['Judas_1', 'Judas_2'] });
    });
});

describe('baseNameKey', () => {
    it('strips a parenthetical qualifier', () => {
        expect(baseNameKey('Levi (patriarch)')).toBe('levi');
        expect(baseNameKey('Jacob (Israel)')).toBe('jacob');
    });

    it('returns null without a qualifier or with nothing before it', () => {
        expect(baseNameKey('Levi')).toBeNull();
        expect(baseNameKey('(patriarch)')).toBeNull();
    });
});

describe('resolveByGenealogyContext (stage 5)', () => {
    // Two BibleData Zechariahs; only Zechariah_2 is related to the anchor Berechiah_1
    const bdNeighbors = new Map([
        ['Zechariah_1', new Set(['Jehoiada_1'])],
        ['Zechariah_2', new Set(['Berechiah_1'])],
    ]);
    const theoFamily = new Map([['zechariah_9', ['berechiah_5']]]);
    const resolvedTheoToBd = new Map([['berechiah_5', 'Berechiah_1']]);

    it('picks the candidate related to a resolved family anchor', () => {
        expect(resolveByGenealogyContext(
            'zechariah_9', ['Zechariah_1', 'Zechariah_2'], theoFamily, bdNeighbors, resolvedTheoToBd,
        )).toEqual({ resolved: true, bdPersonId: 'Zechariah_2', stage: 'genealogy-context' });
    });

    it('stays ambiguous without family anchors', () => {
        const r = resolveByGenealogyContext(
            'zechariah_9', ['Zechariah_1', 'Zechariah_2'], new Map(), bdNeighbors, resolvedTheoToBd,
        );
        expect(r.resolved).toBe(false);
    });

    it('stays ambiguous on a tied score, with a reduced candidate set', () => {
        const tied = new Map([
            ['Zechariah_1', new Set(['Berechiah_1'])],
            ['Zechariah_2', new Set(['Berechiah_1'])],
            ['Zechariah_3', new Set<string>()],
        ]);
        const r = resolveByGenealogyContext(
            'zechariah_9', ['Zechariah_1', 'Zechariah_2', 'Zechariah_3'], theoFamily, tied, resolvedTheoToBd,
        );
        expect(r).toEqual({ resolved: false, reason: 'ambiguous', candidates: ['Zechariah_1', 'Zechariah_2'] });
    });
});

describe('selectBestMeaning', () => {
    it('prefers the label matching the display name (Abraham over Abram)', () => {
        const labels = [
            label('Abram_1', 'Abram', { hebrewMeaning: 'exalted father' }),
            label('Abram_1', 'Abraham', { hebrewMeaning: 'father of many' }),
        ];
        expect(selectBestMeaning(labels, 'Abraham')).toBe('father of many');
        expect(selectBestMeaning(labels, 'Abram')).toBe('exalted father');
    });

    it('prefers Hebrew meanings over Greek', () => {
        const labels = [
            label('X_1', 'Simon', { greekMeaning: 'hearing (gk)' }),
            label('X_1', 'Simeon', { hebrewMeaning: 'hearing (heb)' }),
        ];
        expect(selectBestMeaning(labels, 'Simon')).toBe('hearing (heb)');
    });

    it('falls back to non-proper labels and returns null when nothing has a meaning', () => {
        expect(selectBestMeaning(
            [label('X_1', 'Rock', { labelType: 'Title', greekMeaning: 'rock' })], 'Peter',
        )).toBe('rock');
        expect(selectBestMeaning([label('X_1', 'Peter')], 'Peter')).toBeNull();
    });
});

describe('enrichPersonsData', () => {
    it('enriches resolved persons and records conflicts for the ambiguous', () => {
        const persons = [person('john_1', 'John'), person('judas_9', 'Judas')];
        const resolver = new ResolutionMap();
        const conflicts = new ConflictStore();

        const stats = enrichPersonsData(
            persons,
            [
                { personId: 'John_1', personName: 'John' },
                { personId: 'Judas_1', personName: 'Judas' },
                { personId: 'Judas_2', personName: 'Judas' },
            ],
            [label('John_1', 'John', { hebrewMeaning: 'Yahweh is gracious' })],
            null, null, // stage 5 disabled
            resolver, conflicts,
        );

        expect(stats.stage5Enabled).toBe(false);
        expect(stats.enriched).toBe(1);
        expect(stats.ambiguous).toBe(1);
        expect(persons[0].nameMeaning).toBe('Yahweh is gracious');
        expect(persons[0].bibleDataId).toBe('John_1');
        expect(persons[0].bibleDataConfidence).toBe(1.0); // id-direct tier
        expect(persons[0].sources).toEqual([
            { sourceId: 'bibledata', externalId: 'John_1', fields: ['nameMeaning', 'nameMeaningSource'] },
        ]);
        expect(persons[1].nameMeaning).toBeUndefined();
        expect(resolver.resolve('bibledata', 'John_1')).toBe('john_1');
        expect(conflicts.size).toBe(1);
    });

    it('stores the bibleDataId link even when no meaning text exists', () => {
        const persons = [person('john_1', 'John')];
        const resolver = new ResolutionMap();
        const stats = enrichPersonsData(
            persons,
            [{ personId: 'John_1', personName: 'John' }],
            [], // no labels → no meaning
            null, null,
            resolver, new ConflictStore(),
        );
        expect(stats.byStage['id-direct']).toBe(1);
        expect(stats.noMeaning).toBe(1);
        expect(stats.enriched).toBe(0);
        expect(persons[0].bibleDataId).toBe('John_1');
        expect(persons[0].bibleDataConfidence).toBe(1.0);
        expect(persons[0].nameMeaning).toBeUndefined();
        expect(persons[0].sources).toEqual([
            { sourceId: 'bibledata', externalId: 'John_1', fields: ['bibleDataId'] },
        ]);
        expect(resolver.resolve('bibledata', 'John_1')).toBe('john_1');
    });

    it('iterates Stage 5 so resolutions cascade through family anchors', () => {
        // Isaac resolves by name → unlocks "Jacob (Israel)" → unlocks "Levi (patriarch)".
        // levi_9 is listed before jacob_9 so a single Stage-5 pass cannot resolve it.
        const persons = [
            person('isaac_1', 'Isaac'),
            person('levi_9', 'Levi (patriarch)'),
            person('jacob_9', 'Jacob (Israel)'),
        ];
        const bdPersons = [
            { personId: 'Isaac_1', personName: 'Isaac' },
            { personId: 'Jacob_1', personName: 'Jacob' },
            { personId: 'Jacob_2', personName: 'Jacob' },
            { personId: 'Levi_1', personName: 'Levi' },
            { personId: 'Levi_2', personName: 'Levi' },
        ];
        const bdNeighbors = new Map([
            ['Jacob_1', new Set(['Isaac_1', 'Levi_1'])],
            ['Levi_1', new Set(['Jacob_1'])],
            ['Jacob_2', new Set(['Matthan_1'])],
            ['Levi_2', new Set(['Matthat_1'])],
        ]);
        const theoFamily = new Map([
            ['jacob_9', ['isaac_1', 'levi_9']],
            ['levi_9', ['jacob_9']],
        ]);

        const stats = enrichPersonsData(
            persons, bdPersons, [], bdNeighbors, theoFamily,
            new ResolutionMap(), new ConflictStore(),
        );

        expect(stats.stage5Rounds).toBeGreaterThanOrEqual(2);
        expect(stats.byStage['genealogy-context']).toBe(2);
        expect(stats.ambiguous).toBe(0);
        expect(persons.find(p => p.id === 'jacob_9')!.bibleDataId).toBe('Jacob_1');
        expect(persons.find(p => p.id === 'levi_9')!.bibleDataId).toBe('Levi_1');
        expect(persons.find(p => p.id === 'levi_9')!.bibleDataConfidence).toBe(0.85); // genealogy-context tier
    });
});
