import { describe, it, expect } from 'vitest';
import { parsePlacesCsv } from './import-theographic.js';

describe('parsePlacesCsv', () => {
    it('carries the categorical precision column through without treating it as numeric confidence', () => {
        const csv = [
            'placeLookup,displayTitle,latitude,longitude,precision,verses',
            'jericho_1,Jericho,31.87,35.44,Rough,Josh.6.1',
            'salem_2,Salem,31.77,35.23,,Gen.14.18',
        ].join('\n');

        const [jericho, salem] = parsePlacesCsv(csv);

        expect(jericho.precision).toBe('Rough');
        expect(jericho.confidence).toBeUndefined();
        expect(jericho.sources?.[0].fields).toContain('precision');

        expect(salem.precision).toBeUndefined();
        expect(salem.sources?.[0].fields).not.toContain('precision');
    });

    it('still parses a numeric confidence column when one exists', () => {
        const csv = [
            'placeLookup,displayTitle,latitude,longitude,confidence,verses',
            'bethel_1,Bethel,31.93,35.22,0.75,Gen.28.19',
        ].join('\n');

        const [bethel] = parsePlacesCsv(csv);
        expect(bethel.confidence).toBe(0.75);
    });
});
