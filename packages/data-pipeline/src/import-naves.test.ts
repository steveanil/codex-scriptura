import { describe, it, expect } from 'vitest';
import { parseEntry, topicSlug } from './import-naves';

const SAMPLE = `<entryFree n="FORGIVENESS">
<def>
<lb/>OF ENEMIES <ref osisRef="Exod.23.4">Ex 23:4</ref>,<ref osisRef="Exod.23.5">5</ref>; <ref osisRef="Matt.5.43-Matt.5.48">Mt 5:43-48</ref>
<lb/>INSTANCES OF Esau forgives Jacob <ref osisRef="Gen.33.4">Ge 33:4</ref>
<lb/>OF SINS See <ref target="Nave:SIN">SIN</ref>
<lb/>→ See <ref target="Nave:ENEMY">ENEMY</ref></def>
</entryFree>`;

describe('parseEntry', () => {
    const record = parseEntry(SAMPLE)!;

    it('extracts slug, display name, and sections', () => {
        expect(record.id).toBe('forgiveness');
        expect(record.name).toBe('Forgiveness');
        expect(record.sections[0].heading).toBe('OF ENEMIES');
        expect(record.sections[0].refs).toEqual([
            { osis: 'Exod.23.4', label: 'Ex 23:4' },
            { osis: 'Exod.23.5', label: '5' },
            { osis: 'Matt.5.43-Matt.5.48', label: 'Mt 5:43-48' },
        ]);
        expect(record.sections[1].heading).toBe('INSTANCES OF Esau forgives Jacob');
        expect(record.refCount).toBe(4);
    });

    it('collects cross-topic pointers as seeAlso slugs, not sections', () => {
        expect(record.seeAlso.sort()).toEqual(['enemy', 'sin']);
        // The bare "→ See X" pointer line must not become an empty section
        expect(record.sections.every((s) => s.refs.length > 0 || s.heading)).toBe(true);
        expect(record.sections.some((s) => /^see$/i.test(s.heading))).toBe(false);
    });

    it('keeps ref-less headed sections but strips their trailing See', () => {
        const ofSins = record.sections.find((s) => s.heading.startsWith('OF SINS'));
        expect(ofSins?.heading).toBe('OF SINS');
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
