import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseVerseNotes, type RawVerse, type VerseNote } from '@codex-scriptura/core';
import { importUsfx } from './import-usfx.js';
import { importOsis } from './import-osis.js';

let tmpDir: string;

beforeAll(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-notes-test-'));
});

afterAll(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
});

function run(xml: string, importer: 'usfx' | 'osis', opts?: { notes?: boolean }): RawVerse[] {
    const id = Math.random().toString(36).slice(2);
    const inPath = path.join(tmpDir, `in-${id}.xml`);
    const outPath = path.join(tmpDir, `out-${id}.json`);
    fs.writeFileSync(inPath, xml, 'utf-8');
    // Registered translation ids - recordImportRun validates against the registry
    if (importer === 'usfx') importUsfx(inPath, 'WEB', outPath, opts);
    else importOsis(inPath, 'KJV', outPath);
    return JSON.parse(fs.readFileSync(outPath, 'utf-8'));
}

const usfx = (body: string, book = 'GEN', chapter = 1) =>
    run(`<usfx><book id="${book}"><c id="${chapter}"/>\n${body}\n</book></usfx>`, 'usfx');
const osis = (body: string) => run(`<osis><div>\n${body}\n</div></osis>`, 'osis');

const notesOf = (v: RawVerse): VerseNote[] => parseVerseNotes(v.notes);

/** The text up to each note's callout, for readable offset assertions. */
const before = (v: RawVerse) => notesOf(v).map((n) => v.text.slice(0, n.at));

describe('USFX footnotes', () => {
    it('keeps a plain <f> and places it right after the word it follows (WEB Gen 1:1 shape)', () => {
        const [v] = usfx(`<v id="1"/>In the beginning, God<f caller="+">The Hebrew word rendered &quot;God&quot; is Elohim.</f> created the heavens and the earth.<ve/>`);
        expect(v.text).toBe('In the beginning, God created the heavens and the earth.');
        expect(notesOf(v)).toEqual([{ at: 21, runs: ['The Hebrew word rendered "God" is Elohim.'] }]);
    });

    it('puts a note that follows a space after the previous word, not before the next', () => {
        const [v] = usfx(`<v id="1"/>that Yahweh’s word\n<f caller="+">A note.</f> by Jeremiah<ve/>`);
        expect(v.text).toBe('that Yahweh’s word by Jeremiah');
        expect(before(v)).toEqual(['that Yahweh’s word']);
    });

    it('drops <fr>, keeps <ft> plain and marks <fqa> as an alternative (BSB/WEB shapes)', () => {
        const [v, v2] = usfx(`<v id="3"/>And God said, “Let there be light,”<f caller="+"><fr>1:3\n</fr><ft>Cited in 2 Corinthians 4:6</ft></f> and there was light.<ve/>
<v id="4"/>He saw it<f caller="+">\n<fr>1:4\n</fr><ft>Literally,\n</ft><fqa>made light of father.</fqa></f>.<ve/>`);
        expect(notesOf(v)).toEqual([{ at: 35, runs: ['Cited in 2 Corinthians 4:6'] }]);
        expect(v.text.slice(0, 35)).toBe('And God said, “Let there be light,”');
        expect(v2.text).toBe('He saw it.');
        expect(notesOf(v2)).toEqual([{ at: 9, runs: ['Literally, ', { t: 'made light of father.', s: 'alt' }] }]);
    });

    it('reads <fq> as the quoted words and <fqa> as the alternative', () => {
        const [v] = usfx(`<v id="4"/>He saw it.<f caller="+">\n<ft>Some MSS. omit\n</ft><fq>for his sake.</fq></f><f caller="+"><ft>Or,\n</ft><fqa>him</fqa></f><ve/>`);
        expect(notesOf(v).map((n) => n.runs)).toEqual([
            ['Some MSS. omit ', { t: 'for his sake.', s: 'catch' }],
            ['Or, ', { t: 'him', s: 'alt' }],
        ]);
    });

    it('drops the space before a note flush against punctuation and puts the callout on the word (issue #175)', () => {
        const [v] = usfx(`<v id="21"/>Who struck Abimelech son of Jerubbesheth <f caller="+"><fr>11:21</fr><ft>Also known as Jerubbaal.</ft></f>? Was it not<ve/>`, '2SA', 11);
        expect(v.text).toBe('Who struck Abimelech son of Jerubbesheth? Was it not');
        expect(before(v)).toEqual(['Who struck Abimelech son of Jerubbesheth']);
    });

    it('places notes at the very start and the very end of a verse', () => {
        const [v] = usfx(`<v id="1"/><f caller="+">At the start.</f>Psalm 34 is an acrostic.<f caller="+">At the end.</f><ve/>`, 'PSA', 34);
        expect(v.text).toBe('Psalm 34 is an acrostic.');
        expect(notesOf(v).map((n) => n.at)).toEqual([0, v.text.length]);
    });

    it('keeps two notes in one verse in text order', () => {
        const [v] = usfx(`<v id="1"/>Alpha<f caller="+">one</f> beta gamma<f caller="+">two</f> delta.<ve/>`);
        expect(before(v)).toEqual(['Alpha', 'Alpha beta gamma']);
        expect(notesOf(v).map((n) => n.runs[0])).toEqual(['one', 'two']);
    });

    it('sorts by offset even when the cross-reference was removed in an earlier pass than the footnote', () => {
        const [v] = usfx(`<v id="1"/>Alpha<x caller="+"><xt><ref tgt="GEN.1.2">1:2</ref></xt></x> beta<f caller="+">foot</f>.<ve/>
<v id="2"/>Second.<ve/>`);
        expect(notesOf(v).map((n) => [n.at, n.kind])).toEqual([[5, 'xref'], [10, undefined]]);
    });

    it('keeps notes inside words-of-Jesus markup without moving the red-letter range', () => {
        const [v] = usfx(`<v id="4"/>He answered, <wj>It is written,<f caller="+"><ft>Deuteronomy 8:3</ft></f> “Man shall not live.”</wj><ve/>`, 'MAT', 4);
        expect(v.text).toBe('He answered, It is written, “Man shall not live.”');
        expect(v.wj).toBe('[[13,49]]');
        expect(before(v)).toEqual(['He answered, It is written,']);
    });

    it('shifts notes in a lettered segment by the merge offset', () => {
        const [v] = usfx(`<v id="1a"/>Segment one<f caller="+">first</f>.<ve/>
<v id="1b"/>Segment two<f caller="+">second</f>.<ve/>`, 'EST', 5);
        expect(v.text).toBe('Segment one. Segment two.');
        expect(before(v)).toEqual(['Segment one', 'Segment one. Segment two']);
    });

    it('hangs the note of an otherwise empty verse on the end of the verse before it (ASV omitted verses)', () => {
        const verses = usfx(`<v id="20"/>nothing shall be impossible unto you.<ve/>
<v id="21" bcv="MAT.17.21" /><f caller="+"><fr>17:21\n</fr><ft>Many authorities, some ancient, insert v. 21.\n</ft><fqa>But this kind goeth not out save by prayer and fasting.\n</fqa><ft>See Mrk 9:29.</ft></f><ve/>
<v id="22"/>And while they abode in Galilee,<ve/>`, 'MAT', 17);
        expect(verses.map((v) => v.osisId)).toEqual(['Matt.17.20', 'Matt.17.22']);
        expect(notesOf(verses[0])).toEqual([{
            at: verses[0].text.length,
            verse: 21,
            runs: ['Many authorities, some ancient, insert v. 21. ', { t: 'But this kind goeth not out save by prayer and fasting.', s: 'alt' }, ' See Mrk 9:29.'],
        }]);
        expect(verses[1].notes).toBeUndefined();
    });

    it('does not name an omitted verse for an empty later segment of the same verse', () => {
        const [v] = usfx(`<v id="15a"/>Segment text.<ve/>
<v id="15b"/><f caller="+">A note on the segment.</f><ve/>`, 'EST', 5);
        expect(notesOf(v)).toEqual([{ at: v.text.length, runs: ['A note on the segment.'] }]);
    });

    it('drops the note of an empty first verse when there is no earlier verse in the chapter', () => {
        const verses = run(`<usfx><book id="MAT"><c id="16"/><v id="28"/>Last verse.<ve/><c id="17"/>
<v id="1"/><f caller="+">orphan</f><ve/>
<v id="2"/>Text.<ve/></book></usfx>`, 'usfx');
        expect(verses.map((v) => [v.osisId, v.notes])).toEqual([['Matt.16.28', undefined], ['Matt.17.2', undefined]]);
    });

    it('falls back to the end of the verse when the mirror walk cannot rebuild the text', () => {
        // The chain decodes entities one after another (&amp;lt; becomes <); the walk does not.
        const [v] = usfx(`<v id="1"/>a &amp;lt; b<f caller="+">note</f> c<ve/>`);
        expect(v.text).toBe('a < b c');
        expect(notesOf(v)).toEqual([{ at: v.text.length, runs: ['note'] }]);
    });

    it('drops notes that sit outside any verse, such as in a Psalm title', () => {
        const [v] = usfx(`<d>For the Chief Musician.<f caller="+">Alamoth is a musical term.</f></d><v id="1"/>God is our refuge.<ve/>`, 'PSA', 46);
        expect(v.notes).toBeUndefined();
    });
});

describe('USFX cross-reference notes and links', () => {
    it('reads <x> as an xref note with a link per resolvable <ref>', () => {
        const verses = usfx(`<v id="1"/>Now in the first year of Cyrus<x caller="+">\n<xo>1:1 </xo><xt><ref tgt="GEN.1.2">Genesis 1:2</ref>, <ref tgt="GEN.1.3">3</ref>; etc.</xt></x> king of Persia,<ve/>
<v id="2"/>Two.<ve/>
<v id="3"/>Three.<ve/>`);
        expect(notesOf(verses[0])).toEqual([{
            at: 30,
            kind: 'xref',
            runs: [{ t: 'Genesis 1:2', ref: 'Gen.1.2' }, ', ', { t: '3', ref: 'Gen.1.3' }, '; etc.'],
        }]);
    });

    it('turns a target that is not a verse of this translation into plain text', () => {
        const [v] = usfx(`<v id="1"/>Text<f caller="+">perhaps rulers, see <ref tgt="LUK.25.1">25.</ref> or <ref tgt="GEN.1.9">Genesis 1:9</ref> or <ref tgt="XYZ.1.1">nowhere</ref></f>.<ve/>`);
        expect(notesOf(v)[0].runs).toEqual(['perhaps rulers, see 25. or Genesis 1:9 or nowhere']);
    });

    it('links a verse inside a bridge to the bridge record', () => {
        const verses = usfx(`<v id="1"/>Text<f caller="+">See <ref tgt="GEN.1.3">1:3</ref></f>.<ve/>
<v id="2-3"/>Bridged.<ve/>`);
        expect(notesOf(verses[0])[0].runs).toEqual(['See ', { t: '1:3', ref: 'Gen.1.2' }]);
    });

    it('imports no notes when the translation switches them off (DBY)', () => {
        const xml = `<usfx><book id="GEN"><c id="1"/><v id="1"/>In the beginning <f caller="°"><w s="H430">Elohim</w></f>God created.<ve/></book></usfx>`;
        const [v] = run(xml, 'usfx', { notes: false });
        expect(v.text).toBe('In the beginning God created.');
        expect(v.notes).toBeUndefined();
    });
});

describe('OSIS footnotes', () => {
    it('reads a KJV study note: catchWord, rdg and plain text, at the end of the verse', () => {
        const [v] = osis(`<verse osisID="Gen.1.4" sID="Gen.1.4"/><w lemma="strong:H0430">God</w> divided <w lemma="strong:H0216">the light</w> from the darkness.<note type="study"><catchWord>the light from…</catchWord>: Heb. <rdg type="x-literal">between the light and between the darkness</rdg></note><verse eID="Gen.1.4"/>`);
        expect(v.text).toBe('God divided the light from the darkness.');
        // CrossWire parks the note at the verse end; it moves onto its catch words
        expect(notesOf(v)).toEqual([{
            at: 'God divided the light from'.length,
            runs: [{ t: 'the light from…', s: 'catch' }, ': Heb. ', { t: 'between the light and between the darkness', s: 'alt' }],
        }]);
        expect(v.align).toBe('[[0,3,"H430"],[12,21,"H216"]]');
    });

    it('anchors end-of-verse notes to their catch words in reading order (KJV Gen 1:20 shape)', () => {
        const [v] = osis(`<verse osisID="Gen.1.20" sID="Gen.1.20"/>the moving creature, and the moving waters in the open firmament.<note type="study"><catchWord>moving</catchWord>: or, <rdg type="alternate">creeping</rdg></note><note type="study"><catchWord>Moving</catchWord>: again</note><note type="study"><catchWord>open…</catchWord>: Heb. <rdg type="x-literal">face of</rdg></note><note type="study"><catchWord>whale</catchWord>: not in the verse</note><note type="study">no catch words</note><verse eID="Gen.1.20"/>`);
        const t = v.text;
        expect(t).toBe('the moving creature, and the moving waters in the open firmament.');
        // the second "moving" note takes the second occurrence (found ignoring case);
        // catch words that are not in the verse, and notes without any, stay at the end
        expect(notesOf(v).map((n) => [n.at, n.runs[0]])).toEqual([
            [t.indexOf('moving') + 6, { t: 'moving', s: 'catch' }],
            [t.lastIndexOf('moving') + 6, { t: 'Moving', s: 'catch' }],
            [t.indexOf('open') + 4, { t: 'open…', s: 'catch' }],
            [t.length, { t: 'whale', s: 'catch' }],
            [t.length, 'no catch words'],
        ]);
    });

    // The four tests below use the CrossWire KJV source of the verse as it is.
    it('anchors notes whose different catch words each occur once (KJV Gen 1:20)', () => {
        const [v] = osis(`<verse osisID="Gen.1.20" sID="Gen.1.20"/><w lemma="strong:H0430">And God</w> <w morph="strongMorph:TH8799" lemma="strong:H0559">said</w>, <w lemma="strong:H04325">Let the waters</w> <w morph="strongMorph:TH8799" lemma="strong:H08317">bring forth abundantly</w> <w lemma="strong:H08318">the moving creature</w> <w lemma="strong:H05315">that hath</w> <w lemma="strong:H02416">life</w>, <w lemma="strong:H05775">and fowl</w> <transChange type="added">that</transChange> <w morph="strongMorph:TH8787" lemma="strong:H05774">may fly</w> <w lemma="strong:H05921">above</w> <w lemma="strong:H0776">the earth</w> <w lemma="strong:H06440">in the open</w> <w lemma="strong:H07549">firmament</w> <w lemma="strong:H08064">of heaven</w>.<note type="study"><catchWord>moving</catchWord>: or, <rdg type="alternate">creeping</rdg></note><note type="study"><catchWord>life</catchWord>: Heb. <rdg type="x-literal">soul</rdg></note><note type="study"><catchWord>fowl…</catchWord>: Heb. <rdg type="x-literal">let fowl fly</rdg></note><note type="study"><catchWord>open…</catchWord>: Heb. <rdg type="x-literal">face of the firmament of heaven</rdg></note><verse eID="Gen.1.20"/>`);
        expect(v.text).toBe('And God said, Let the waters bring forth abundantly the moving creature that hath life, and fowl that may fly above the earth in the open firmament of heaven.');
        const upTo = (word: string) => v.text.slice(0, v.text.indexOf(word) + word.length);
        expect(before(v)).toEqual([upTo('the moving'), upTo('hath life'), upTo('and fowl'), upTo('in the open')]);
    });

    it('leaves a note at the verse end when its catch word occurs twice (KJV Gen 27:3)', () => {
        const [v] = osis(`<verse osisID="Gen.27.3" sID="Gen.27.3"/><w morph="strongMorph:TH8798" lemma="strong:H05375">Now therefore take</w>, <w lemma="strong:H03627">I pray thee, thy weapons</w>, <w lemma="strong:H08522">thy quiver</w> <w lemma="strong:H07198">and thy bow</w>, <w morph="strongMorph:TH8798" lemma="strong:H03318">and go out</w> <w lemma="strong:H07704">to the field</w>, <w morph="strongMorph:TH8798" lemma="strong:H06679">and take</w> me <transChange type="added">some</transChange> <w morph="strongMorph:TH8675" lemma="strong:H06720 strong:H06718">venison</w>;<note type="study"><catchWord>take</catchWord>: Heb. <rdg type="x-literal">hunt</rdg></note><verse eID="Gen.27.3"/>`);
        expect(v.text).toBe('Now therefore take, I pray thee, thy weapons, thy quiver and thy bow, and go out to the field, and take me some venison;');
        expect(notesOf(v).map((n) => n.at)).toEqual([v.text.length]);
    });

    it('pairs two notes on the same word with its two occurrences in order (KJV Dan 12:5)', () => {
        const [v] = osis(`<verse osisID="Dan.12.5" sID="Dan.12.5"/><milestone type="x-p" marker="¶"/><w lemma="strong:H01840">Then I Daniel</w> <w morph="strongMorph:TH8804" lemma="strong:H07200">looked</w>, <w morph="strongMorph:TH8802" lemma="strong:H05975">and, behold, there stood</w> <w lemma="strong:H0312">other</w> <w lemma="strong:H08147">two</w>, <w lemma="strong:H0259">the one</w> <w lemma="strong:H02008">on this side</w> <w lemma="strong:H08193">of the bank</w> <w lemma="strong:H02975">of the river</w>, <w lemma="strong:H0259">and the other</w> <w lemma="strong:H08193">on that side of the bank</w> <w lemma="strong:H02975">of the river</w>.<note type="study"><catchWord>bank</catchWord>: Heb. <rdg type="x-literal">lip</rdg></note><note type="study"><catchWord>bank</catchWord>: Heb. <rdg type="x-literal">lip</rdg></note><verse eID="Dan.12.5"/>`);
        expect(v.text).toBe('Then I Daniel looked, and, behold, there stood other two, the one on this side of the bank of the river, and the other on that side of the bank of the river.');
        expect(notesOf(v).map((n) => n.at)).toEqual([v.text.indexOf('bank') + 4, v.text.lastIndexOf('bank') + 4]);
    });

    it('puts the callout after a possessive, not inside it (KJV 2 Sam 6:6)', () => {
        const [v] = osis(`<verse osisID="2Sam.6.6" sID="2Sam.6.6"/><milestone type="x-p" marker="¶"/><w morph="strongMorph:TH8799" lemma="strong:H0935">And when they came</w> <w lemma="strong:H05225">to Nachon’s</w> <w lemma="strong:H01637">threshingfloor</w>, <w lemma="strong:H05798">Uzzah</w> <w morph="strongMorph:TH8799" lemma="strong:H07971">put forth</w> <transChange type="added">his hand</transChange> <w lemma="strong:H0727">to the ark</w> <w lemma="strong:H0430">of God</w>, <w morph="strongMorph:TH8799" lemma="strong:H0270">and took hold</w> <w lemma="strong:H01241">of it; for the oxen</w> <w morph="strongMorph:TH8804" lemma="strong:H08058">shook</w> <transChange type="added">it</transChange>.<note type="study"><catchWord>Nachon</catchWord>: also called <rdg type="x-identity">Chidon</rdg></note><note type="study"><catchWord>shook it</catchWord>: or, <rdg type="alternate">stumbled</rdg></note><verse eID="2Sam.6.6"/>`);
        expect(v.text).toBe('And when they came to Nachon’s threshingfloor, Uzzah put forth his hand to the ark of God, and took hold of it; for the oxen shook it.');
        expect(before(v)).toEqual(['And when they came to Nachon’s', 'And when they came to Nachon’s threshingfloor, Uzzah put forth his hand to the ark of God, and took hold of it; for the oxen shook it']);
    });

    it('upper-cases divineName inside a note and keeps transChange and abbr text', () => {
        const [v] = osis(`<verse osisID="Gen.2.4" sID="Gen.2.4"/>the day.<note type="study"><catchWord>the <divineName>Lord</divineName></catchWord>: <abbr expansion="Hebrew">Heb.</abbr> <rdg type="alternate"><transChange type="added">the</transChange> Jehovah</rdg><!-- an editor's comment --></note><verse eID="Gen.2.4"/>`);
        expect(notesOf(v)[0].runs).toEqual([{ t: 'the LORD', s: 'catch' }, ': Heb. ', { t: 'the Jehovah', s: 'alt' }]);
    });

    it('drops the OEB annotateRef origin reference and places the note after the word', () => {
        const [v] = osis(`<verse sID="Ruth.1.20" osisID="Ruth.1.20" n="20" />“call me Mara<note placement="foot"><reference type="annotateRef">1:20 </reference>In Hebrew “Naomi” means “pleasant.”</note>, for the Almighty.\n<verse eID="Ruth.1.20" />`);
        expect(v.text).toBe('“call me Mara, for the Almighty.');
        expect(notesOf(v)).toEqual([{ at: 13, runs: ['In Hebrew “Naomi” means “pleasant.”'] }]);
    });

    it('hangs the note of an empty verse on the verse before it, in document order', () => {
        const verses = osis(`<verse sID="Matt.17.20" osisID="Matt.17.20"/>impossible to you.<verse eID="Matt.17.20"/>
<verse sID="Matt.17.21" osisID="Matt.17.21"/><note placement="foot"><reference type="annotateRef">17:21 </reference>Some later manuscripts add: But this kind.</note>
<verse eID="Matt.17.21"/>`);
        expect(verses.map((v) => v.osisId)).toEqual(['Matt.17.20']);
        expect(notesOf(verses[0])).toEqual([{ at: 18, verse: 21, runs: ['Some later manuscripts add: But this kind.'] }]);
    });

    it('keeps container-style verses and skips "…" placeholders as before', () => {
        const verses = osis(`<verse osisID="AddEsth.10.3" sID="AddEsth.10.3"/>…<note type="study">dropped</note><verse eID="AddEsth.10.3"/>
<verse osisID="Sir.1.7">Unto whom<note type="study">a note</note> hath it been made manifest?</verse>`);
        expect(verses.map((v) => v.osisId)).toEqual(['Sir.1.7']);
        expect(verses[0].text).toBe('Unto whom hath it been made manifest?');
        expect(notesOf(verses[0])).toEqual([{ at: 9, runs: ['a note'] }]);
    });
});
