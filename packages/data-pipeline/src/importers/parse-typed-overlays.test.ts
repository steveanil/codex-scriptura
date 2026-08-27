import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildTypeOverlay, lookupOverlay, lookupOverlayType, matchProfile, ubsCrossTestamentType, type TypeOverlay } from './parse-typed-overlays.js';

// Fixtures mirror the real source formats:
//   OT-NT-Reference-Map: links.push({ "linkID": "OTNT1", "bkSource": "NTMt", ... })
//   UBS: <Passage><Verse HEB="...">GEN 1:27</Verse>...</Passage>

const OTNT_FIXTURE = `
links.push({ "linkID": "OTNT1", "bkSource": "NTMt", "chpSource": 4, "bkTarget": "OTDeu", "chpTarget": 8, "type": "q" })
links.push({ "linkID": "OTNT2", "bkSource": "NTRo", "chpSource": 9, "bkTarget": "OTIsa", "chpTarget": 10, "type": "p" })
links.push({ "linkID": "OTNT3", "bkSource": "NTHeb", "chpSource": 1, "bkTarget": "OTPsa", "chpTarget": 2 })
links.push({ "linkID": "OTNT4", "bkSource": "NTXX", "chpSource": 1, "bkTarget": "OTGen", "chpTarget": 1, "type": "q" })
links.push({ "linkID": "OTNT5", "bkSource": "NTMt", "chpSource": 4, "bkTarget": "OTDeu", "chpTarget": 8, "type": "a" })
`;

const UBS_FIXTURE = `<?xml version="1.0"?>
<Passages>
  <Passage>
    <Verse HEB="0001">DEU 8:3</Verse>
    <Verse GRK="0002">MAT 4:4</Verse>
  </Passage>
  <Passage>
    <Verse HEB="0003">GEN 1:27</Verse>
    <Verse HEB="0004">GEN 5:2</Verse>
  </Passage>
  <Passage>
    <Verse GRK="0005">MAT 19:4-5</Verse>
    <Verse GRK="0006">MRK 10:6</Verse>
  </Passage>
  <Passage>
    <Verse HEB="22225222225200000522222">ISA 61:1</Verse>
    <Verse GRK="2222522222525222223000">LUK 4:18</Verse>
  </Passage>
  <Passage>
    <Verse HEB="0000003000052222">GEN 1:27</Verse>
    <Verse GRK="0000300012252222">MAT 19:4</Verse>
    <Verse GRK="0000000000000000">MRK 10:6</Verse>
  </Passage>
</Passages>
`;

let tmpDir: string;
let overlay: TypeOverlay;

beforeAll(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'typed-overlays-test-'));
    fs.writeFileSync(path.join(tmpDir, 'otnt.js'), OTNT_FIXTURE);
    fs.writeFileSync(path.join(tmpDir, 'ubs.xml'), UBS_FIXTURE);
    overlay = buildTypeOverlay(path.join(tmpDir, 'otnt.js'), path.join(tmpDir, 'ubs.xml'));
});

afterAll(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('OT-NT-Reference-Map parsing', () => {
    it('maps type codes onto overlay types and stores both directions', () => {
        expect(overlay.chapterPairs.get('Matt.4→Deut.8')).toBe('quotation');
        expect(overlay.chapterPairs.get('Deut.8→Matt.4')).toBe('quotation');
        expect(overlay.chapterPairs.get('Rom.9→Isa.10')).toBe('possible_allusion');
    });

    it('treats untyped entries as allusion', () => {
        expect(overlay.chapterPairs.get('Heb.1→Ps.2')).toBe('allusion');
    });

    it('skips entries with unknown book codes', () => {
        for (const key of overlay.chapterPairs.keys()) {
            expect(key).not.toContain('NTXX');
        }
    });

    it('never downgrades a stronger type with a weaker duplicate', () => {
        // OTNT5 re-asserts Matt.4→Deut.8 as allusion; quotation must win
        expect(overlay.chapterPairs.get('Matt.4→Deut.8')).toBe('quotation');
    });
});

describe('UBS word-match scoring (issue #282)', () => {
    it('decodes the per-word digits: level = digit mod 3, runs of full matches', () => {
        expect(matchProfile('2222522222525222223000')).toEqual({ words: 22, full: 18, longestRun: 18 });
        expect(matchProfile('0000300012252222')).toEqual({ words: 16, full: 7, longestRun: 7 });
        expect(matchProfile('02000005221222230000000')).toEqual({ words: 23, full: 8, longestRun: 4 });
        expect(matchProfile('')).toEqual({ words: 0, full: 0, longestRun: 0 });
    });

    it('types verbatim reuse as quotation, by fraction or by a five-word run', () => {
        expect(ubsCrossTestamentType('2222522222525222223000')).toBe('quotation'); // Luke 4:18
        expect(ubsCrossTestamentType('0000300012252222')).toBe('quotation');       // Matt 19:4: 7/16 but a 7-word clause
        expect(ubsCrossTestamentType('2222000000')).toBe('allusion');              // 4/10, run 4
        expect(ubsCrossTestamentType('02000005221222230000000')).toBe('allusion'); // Heb 11:5
        expect(ubsCrossTestamentType('000000000000000000')).toBe('allusion');      // Matt 8:17
        expect(ubsCrossTestamentType('')).toBe('allusion');
    });
});

describe('UBS Parallel Passages parsing', () => {
    it('types cross-testament groups from the NT verse word matches, in both directions', () => {
        expect(overlay.versePairs.get('Deut.8.3→Matt.4.4')).toBe('allusion');
        expect(overlay.versePairs.get('Matt.4.4→Deut.8.3')).toBe('allusion');
        expect(overlay.versePairs.get('Luke.4.18→Isa.61.1')).toBe('quotation');
        expect(overlay.versePairs.get('Isa.61.1→Luke.4.18')).toBe('quotation');
    });

    it('types each NT verse of a group by its own matches', () => {
        expect(overlay.versePairs.get('Matt.19.4→Gen.1.27')).toBe('quotation');
        expect(overlay.versePairs.get('Mark.10.6→Gen.1.27')).toBe('allusion');
    });

    it('types same-testament groups as parallel', () => {
        expect(overlay.versePairs.get('Gen.1.27→Gen.5.2')).toBe('parallel');
        expect(overlay.versePairs.get('Matt.19.4→Mark.10.6')).toBe('parallel');
    });

    it('uses the first verse of a range reference', () => {
        // "MAT 19:4-5" must key on Matt.19.4
        expect(overlay.versePairs.has('Matt.19.4→Mark.10.6')).toBe(true);
        expect(overlay.versePairs.has('Matt.19.5→Mark.10.6')).toBe(false);
    });
});

describe('lookupOverlayType', () => {
    it('prefers the chapter-pair quotation over a UBS verse-pair allusion (v13 regression)', () => {
        // The bug that forced the Dexie v13 re-seed: Matt.4.4→Deut.8.3 matched
        // a UBS "allusion" verse pair, which shadowed the curated OT-NT
        // "quotation" for the same chapter pair.
        expect(lookupOverlayType(overlay, 'Matt.4.4', 'Deut.8.3')).toBe('quotation');
    });

    it('falls back to the chapter pair when no verse pair matches', () => {
        expect(lookupOverlayType(overlay, 'Matt.4.10', 'Deut.8.19')).toBe('quotation');
        expect(lookupOverlayType(overlay, 'Rom.9.20', 'Isa.10.15')).toBe('possible_allusion');
    });

    it('uses the verse pair when no chapter pair matches', () => {
        expect(lookupOverlayType(overlay, 'Gen.1.27', 'Gen.5.2')).toBe('parallel');
    });

    it('returns null when neither source matches', () => {
        expect(lookupOverlayType(overlay, 'Gen.2.1', 'Rev.22.21')).toBeNull();
    });

    it('lookupOverlay reports which level decided', () => {
        expect(lookupOverlay(overlay, 'Matt.4.4', 'Deut.8.3')).toEqual({ type: 'quotation', level: 'chapter' });
        expect(lookupOverlay(overlay, 'Luke.4.18', 'Isa.61.1')).toEqual({ type: 'quotation', level: 'verse' });
        expect(lookupOverlay(overlay, 'Gen.1.27', 'Gen.5.2')).toEqual({ type: 'parallel', level: 'verse' });
        expect(lookupOverlay(overlay, 'Gen.2.1', 'Rev.22.21')).toBeNull();
    });
});
