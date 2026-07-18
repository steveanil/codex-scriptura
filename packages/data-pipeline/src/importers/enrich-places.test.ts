import { describe, it, expect } from 'vitest';
import {
    parseOpenBibleRecord,
    normalizePlaceName,
    haversineKm,
    enrichPlacesData,
    type Place,
    type OpenBibleRow,
} from './enrich-places.js';
import { ResolutionMap } from '../core/entity-resolver.js';
import { ConflictStore } from '../core/conflict-store.js';

function obRow(over: Partial<OpenBibleRow>): OpenBibleRow {
    return {
        id: 'ob1', urlSlug: 'slug', name: 'Bethel',
        lat: 31.9, lng: 35.2, confidence: 0.5, verseRefs: [],
        ...over,
    };
}

function place(over: Partial<Place>): Place {
    return { id: 'p1', name: 'Bethel', verseRefs: [], ...over };
}

function run(places: Place[], rows: OpenBibleRow[]) {
    const resolver = new ResolutionMap();
    const conflicts = new ConflictStore();
    const stats = enrichPlacesData(places, rows, resolver, conflicts);
    return { stats, resolver, conflicts };
}

describe('parseOpenBibleRecord', () => {
    it('extracts coords (lon,lat order), normalized score, and verse refs', () => {
        const row = parseOpenBibleRecord(JSON.stringify({
            friendly_id: 'Abana',
            id: 'aea17b7',
            url_slug: 'abana',
            identifications: [{
                resolutions: [{ lonlat: '36.1,33.5' }],
                score: { time_total: 750 },
            }],
            extra: JSON.stringify({ osises: ['2Kgs.5.12'] }),
        }));
        expect(row).toEqual({
            id: 'aea17b7', urlSlug: 'abana', name: 'Abana',
            lng: 36.1, lat: 33.5, confidence: 0.75, verseRefs: ['2Kgs.5.12'],
        });
    });

    it('clamps negative scores to 0 and rejects records without a resolution', () => {
        const base = {
            friendly_id: 'X', id: 'x',
            identifications: [{ resolutions: [{ lonlat: '1,2' }], score: { time_total: -400 } }],
        };
        expect(parseOpenBibleRecord(JSON.stringify(base))!.confidence).toBe(0);
        expect(parseOpenBibleRecord(JSON.stringify({ friendly_id: 'X', identifications: [] }))).toBeNull();
        expect(parseOpenBibleRecord('not json')).toBeNull();
    });
});

describe('normalizePlaceName', () => {
    it('applies the Mount/Mt and City-of rules', () => {
        expect(normalizePlaceName('Mount Sinai')).toBe('mt sinai');
        expect(normalizePlaceName('Mt. Sinai')).toBe('mt sinai');
        expect(normalizePlaceName('City of David')).toBe('david');
        expect(normalizePlaceName("Baal-Peor")).toBe('baal peor');
    });
});

describe('enrichPlacesData merge policy', () => {
    it('applies coordinates when the place has none', () => {
        const p = place({});
        const { stats, resolver } = run([p], [obRow({})]);
        expect(stats.addedCoords).toBe(1);
        expect(p.lat).toBe(31.9);
        expect(p.source).toBe('openbible');
        expect(p.openBibleId).toBe('slug');
        expect(p.sources?.[0].sourceId).toBe('openbible-geo');
        expect(resolver.resolve('openbible-geo', 'slug')).toBe('p1');
    });

    it('protects high-confidence coordinates and records the competitor', () => {
        const p = place({ lat: 31.0, lng: 35.0, confidence: 0.9 });
        const { stats, conflicts } = run([p], [obRow({})]);
        expect(stats.protectedHighConf).toBe(1);
        expect(p.lat).toBe(31.0);
        expect(conflicts.size).toBe(1);
    });

    it('keeps coordinates whose confidence is unknown', () => {
        const p = place({ lat: 31.0, lng: 35.0 });
        const { stats } = run([p], [obRow({})]);
        expect(stats.keptUnknownConf).toBe(1);
        expect(p.lat).toBe(31.0);
    });

    it('replaces low-confidence coordinates within the drift threshold', () => {
        const p = place({ lat: 31.85, lng: 35.15, confidence: 0.3 });
        const { stats, conflicts } = run([p], [obRow({})]);
        expect(stats.replacedCoords).toBe(1);
        expect(p.lat).toBe(31.9);
        expect(p.source).toBe('merged');
        expect(conflicts.size).toBe(1); // superseded value recorded
    });

    it('skips replacement when coordinates drift more than 100 km', () => {
        const p = place({ lat: 35.0, lng: 40.0, confidence: 0.3 });
        expect(haversineKm(35.0, 40.0, 31.9, 35.2)).toBeGreaterThan(100);
        const { stats } = run([p], [obRow({})]);
        expect(stats.driftSkipped).toBe(1);
        expect(p.lat).toBe(35.0);
    });

    it('disambiguates same-named places by verse-ref overlap', () => {
        const north = place({ id: 'bethel_n', verseRefs: ['Gen.28.19'] });
        const south = place({ id: 'bethel_s', verseRefs: ['Josh.12.16'] });
        const { stats } = run([north, south], [obRow({ verseRefs: ['Gen.28.19'] })]);
        expect(stats.exactMatches).toBe(1);
        expect(north.lat).toBe(31.9);
        expect(south.lat).toBeUndefined();
    });

    it('records a conflict and skips when disambiguation fails', () => {
        const a = place({ id: 'bethel_a' });
        const b = place({ id: 'bethel_b' });
        const { stats, conflicts } = run([a, b], [obRow({ verseRefs: [] })]);
        expect(stats.ambiguousSkipped).toBe(1);
        expect(conflicts.size).toBe(1);
        expect(a.lat).toBeUndefined();
        expect(b.lat).toBeUndefined();
    });

    it('counts records with no Theographic counterpart', () => {
        const { stats } = run([place({ name: 'Jericho' })], [obRow({ name: 'Nineveh' })]);
        expect(stats.noMatchSkipped).toBe(1);
    });
});
