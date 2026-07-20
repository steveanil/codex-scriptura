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

describe('homonym suffix matching', () => {
    it('matches OpenBible "Name N" records to the plain Theographic name', () => {
        const p = place({ name: 'Jericho', lat: 31.87, lng: 35.44 });
        const { stats } = run([p], [obRow({ name: 'Jericho 1', lat: 31.871, lng: 35.444, confidence: 0.9 })]);
        expect(stats.normalizedMatches).toBe(1);
        expect(stats.corroborated).toBe(1);
        expect(p.confidence).toBe(0.9);
        expect(p.lat).toBe(31.87);
    });

    it('corroborates with the nearest of several suffixed matches', () => {
        const p = place({ name: 'Jericho', lat: 31.87, lng: 35.44 });
        const far  = obRow({ name: 'Jericho 1', urlSlug: 'jericho-1', lat: 32.05, lng: 35.44, confidence: 0.3 });
        const near = obRow({ name: 'Jericho 2', urlSlug: 'jericho-2', lat: 31.872, lng: 35.441, confidence: 0.8 });
        const { stats } = run([p], [far, near]);
        expect(stats.corroborated).toBe(1);
        expect(p.confidence).toBe(0.8);
        expect(p.sources?.find(s => s.sourceId === 'openbible-geo')?.externalId).toBe('jericho-2');
    });
});

describe('confidence corroboration pass', () => {
    it('adopts the OpenBible score when coordinates agree within the radius', () => {
        // ~1 km from the obRow default (31.9, 35.2)
        const p = place({ lat: 31.905, lng: 35.205, verseRefs: [] });
        const { stats } = run([p], [obRow({ confidence: 0.678 })]);
        expect(stats.corroborated).toBe(1);
        expect(p.confidence).toBe(0.678);
        // coordinates never move: confidence + provenance only
        expect(p.lat).toBe(31.905);
        expect(p.lng).toBe(35.205);
        const ref = p.sources?.find(s => s.sourceId === 'openbible-geo');
        expect(ref?.fields).toEqual(['confidence']);
        expect(ref?.note).toContain('corroborates');
    });

    it('records a conflict, not a low confidence, when the match disagrees beyond the radius', () => {
        // ~55 km north of the obRow default - matched by name, but not corroborating
        const p = place({ lat: 32.4, lng: 35.2 });
        const { stats, conflicts } = run([p], [obRow({})]);
        expect(stats.disagreements).toBe(1);
        expect(stats.confidenceStillUnknown).toBe(1);
        expect(p.confidence).toBeUndefined();
        expect(p.lat).toBe(32.4);
        const record = conflicts.get('place:p1:lat');
        expect(record?.claims.map(c => c.sourceId)).toEqual(['theographic', 'openbible-geo']);
    });

    it('falls back to the precision mapping when OpenBible disagrees', () => {
        const p = place({ lat: 32.4, lng: 35.2, precision: 'Rough' });
        const { stats } = run([p], [obRow({})]);
        expect(stats.disagreements).toBe(1);
        expect(stats.precisionFallback).toBe(1);
        expect(p.confidence).toBe(0.4);
        expect(p.lat).toBe(32.4);
    });

    it('maps precision categories for places OpenBible cannot corroborate at all', () => {
        const within = place({ id: 'w', name: 'Zoar', lat: 31, lng: 35, precision: 'Related-Within' });
        const surrounding = place({ id: 's', name: 'Aram', lat: 33, lng: 36, precision: 'Related-Surrounding' });
        const { stats } = run([within, surrounding], [obRow({ name: 'Nineveh' })]);
        expect(stats.precisionFallback).toBe(2);
        expect(within.confidence).toBe(0.5);
        expect(surrounding.confidence).toBe(0.3);
        const ref = within.sources?.find(s => s.sourceId === 'theographic');
        expect(ref).toBeUndefined(); // fixture has no theographic ref - mapping must not crash
    });

    it('floors Unlocated-with-coordinates at 0.1 and counts the smell', () => {
        const p = place({ lat: 31, lng: 35, precision: 'Unlocated' });
        const { stats } = run([p], []);
        expect(p.confidence).toBe(0.1);
        expect(stats.unlocatedWithCoords).toBe(1);
    });

    it('adds confidence to the theographic source ref fields when mapping precision', () => {
        const p = place({
            lat: 31, lng: 35, precision: 'Rough',
            sources: [{ sourceId: 'theographic', externalId: 'p1', fields: ['id', 'name', 'lat', 'lng', 'precision'] }],
        });
        run([p], []);
        const ref = p.sources!.find(s => s.sourceId === 'theographic')!;
        expect(ref.fields).toContain('confidence');
        expect(ref.note).toContain('Rough');
    });

    it('leaves confidence set by the coordinate merge untouched', () => {
        const p = place({ lat: 31.9, lng: 35.2, confidence: 0.9, precision: 'Rough' });
        const { stats } = run([p], [obRow({ confidence: 0.5 })]);
        expect(stats.protectedHighConf).toBe(1);
        expect(p.confidence).toBe(0.9);
        expect(stats.precisionFallback).toBe(0);
    });

    it('ignores places without coordinates', () => {
        const p = place({ name: 'Nowhere', precision: 'Rough' });
        const { stats } = run([p], []);
        expect(p.confidence).toBeUndefined();
        expect(stats.precisionFallback).toBe(0);
        expect(stats.confidenceStillUnknown).toBe(0);
    });
});
