import { describe, it, expect } from 'vitest';
import { parseEntry, topicSlug } from './import-naves';

// Mirrors the real module's FORGIVENESS entry: a headed section with its own
// refs plus an in-section "See" list, an "Instances of" section whose refs
// all live in labeled <item>s, a section that is only a "See" pointer, and
// a bare pointer line attached to no section.
const SAMPLE = `<entryFree n="FORGIVENESS">
<def>
<lb/>→ OF ENEMIES <ref osisRef="Exod.23.4">Ex 23:4</ref>,<ref osisRef="Exod.23.5">5</ref>; <ref osisRef="Matt.5.43-Matt.5.48">Mt 5:43-48</ref>
<list>
<item>See <ref target="Nave:ENEMY">ENEMY</ref></item>
</list>
<lb/>→ INSTANCES OF
<list>
<item>Esau forgives Jacob <ref osisRef="Gen.33.4">Ge 33:4</ref>,<ref osisRef="Gen.33.11">11</ref></item>
<item>Joseph forgives his brothers <ref osisRef="Gen.45.5-Gen.45.15">Ge 45:5-15</ref></item>
</list>
<lb/>→ OF SINS
<list>
<item>See <ref target="Nave:SIN">SIN</ref>, FORGIVENESS OF</item>
</list>
<lb/>→ See <ref target="Nave:PARDON">PARDON</ref></def>
</entryFree>`;

describe('parseEntry', () => {
    const record = parseEntry(SAMPLE)!;

    it('extracts slug, display name, and headed sections', () => {
        expect(record.id).toBe('forgiveness');
        expect(record.name).toBe('Forgiveness');
        expect(record.sections.map((s) => s.heading)).toEqual(['OF ENEMIES', 'INSTANCES OF', 'OF SINS']);
        expect(record.refCount).toBe(6);
    });

    it('keeps refs printed under the heading as one unlabeled entry', () => {
        const [ofEnemies] = record.sections;
        expect(ofEnemies.entries).toEqual([
            {
                label: '',
                refs: [
                    { osis: 'Exod.23.4', label: 'Ex 23:4' },
                    { osis: 'Exod.23.5', label: '5' },
                    { osis: 'Matt.5.43-Matt.5.48', label: 'Mt 5:43-48' },
                ],
            },
        ]);
        expect(ofEnemies.seeAlso).toEqual(['enemy']);
    });

    it('turns list items into labeled entries under their section heading', () => {
        const instances = record.sections[1];
        expect(instances.heading).toBe('INSTANCES OF');
        expect(instances.entries).toEqual([
            {
                label: 'Esau forgives Jacob',
                refs: [
                    { osis: 'Gen.33.4', label: 'Ge 33:4' },
                    { osis: 'Gen.33.11', label: '11' },
                ],
            },
            {
                label: 'Joseph forgives his brothers',
                refs: [{ osis: 'Gen.45.5-Gen.45.15', label: 'Ge 45:5-15' }],
            },
        ]);
        expect(instances.seeAlso).toEqual([]);
    });

    it('keeps pointer-only sections as a heading plus section see-also, with no entries', () => {
        const ofSins = record.sections[2];
        expect(ofSins.heading).toBe('OF SINS');
        expect(ofSins.entries).toEqual([]);
        expect(ofSins.seeAlso).toEqual(['sin']);
    });

    it('collects every cross-topic pointer into the topic-level seeAlso union', () => {
        expect(record.seeAlso.sort()).toEqual(['enemy', 'pardon', 'sin']);
        // The bare "→ See PARDON" line must not become an empty section
        expect(record.sections.every((s) => s.entries.length > 0 || s.heading)).toBe(true);
        expect(record.sections.some((s) => /^see$/i.test(s.heading))).toBe(false);
    });

    it('returns null for non-entry content', () => {
        expect(parseEntry('<div>not an entry</div>')).toBeNull();
    });
});

describe('topicSlug', () => {
    it('normalizes keys the same way regardless of punctuation and case', () => {
        expect(topicSlug('ABEL-BETH-MAACHAH')).toBe('abel-beth-maachah');
        expect(topicSlug("NAME (Person's)")).toBe('name-person-s');
        expect(topicSlug('FORGIVENESS')).toBe('forgiveness');
    });
});
