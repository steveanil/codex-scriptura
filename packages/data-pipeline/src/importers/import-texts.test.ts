import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { importUsfx } from './import-usfx.js';
import { importOsis } from './import-osis.js';
import { removeElements } from '../core/xml.js';

type OutVerse = {
    translation: string;
    book: string;
    chapter: number;
    verse: number;
    verseEnd?: number;
    osisId: string;
    text: string;
    lemmas?: string;
    align?: string;
    wj?: string;
};

/** Decode an align field into [sliced surface, ids] pairs for assertions. */
function alignSurfaces(v: OutVerse): Array<[string, string]> {
    if (!v.align) return [];
    return (JSON.parse(v.align) as [number, number, string][])
        .map(([s, e, ids]) => [v.text.slice(s, e), ids]);
}

let tmpDir: string;

beforeAll(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-import-test-'));
});

afterAll(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
});

function runUsfx(xml: string): OutVerse[] {
    const inPath = path.join(tmpDir, `in-${Math.random().toString(36).slice(2)}.usfx.xml`);
    const outPath = path.join(tmpDir, `out-${Math.random().toString(36).slice(2)}.json`);
    fs.writeFileSync(inPath, xml, 'utf-8');
    // A registered translation id - recordImportRun validates against the registry
    importUsfx(inPath, 'WEB', outPath);
    return JSON.parse(fs.readFileSync(outPath, 'utf-8'));
}

function runOsis(xml: string): OutVerse[] {
    const inPath = path.join(tmpDir, `in-${Math.random().toString(36).slice(2)}.osis.xml`);
    const outPath = path.join(tmpDir, `out-${Math.random().toString(36).slice(2)}.json`);
    fs.writeFileSync(inPath, xml, 'utf-8');
    // A registered translation id - recordImportRun validates against the registry
    importOsis(inPath, 'KJV', outPath);
    return JSON.parse(fs.readFileSync(outPath, 'utf-8'));
}

describe('removeElements', () => {
    it('removes elements with their content', () => {
        expect(removeElements('a <f caller="+">note</f>b', ['f'])).toBe('a b');
    });

    it('handles multiple and consecutive elements', () => {
        const s = 'x<f a="1">one</f><f>two</f>y<x>three</x>z';
        expect(removeElements(s, ['f', 'x'])).toBe('xyz');
    });

    it('does not strand punctuation after a removed note', () => {
        expect(removeElements('judged<note placement="foot">Or, "governed"</note>, there', ['note'])).toBe('judged, there');
    });

    it('does not confuse <f> with <fe>', () => {
        const s = 'a <fe>endnote</fe> b <f>foot</f> c';
        expect(removeElements(s, ['f'])).toBe('a <fe>endnote</fe> b  c');
        expect(removeElements(s, ['f', 'fe'])).toBe('a  b  c');
    });

    it('leaves self-closing forms alone (no content to remove)', () => {
        expect(removeElements('a <f/> b', ['f'])).toBe('a <f/> b');
    });

    it('removes multiline note content', () => {
        expect(removeElements('a <note placement="foot">line1\nline2</note> b', ['note'])).toBe('a  b');
    });

    it('does not treat a self-closing tag with attributes as an opener (known-issues #18)', () => {
        // The old regex matched '<note n="a"/>' as an opening tag and deleted
        // the scripture words between it and the next real closing tag.
        expect(removeElements('foo <note n="a"/> bar <note placement="foot">fn</note> baz', ['note']))
            .toBe('foo <note n="a"/> bar  baz');
    });

    it('removes nested same-tag notes in full (known-issues #18)', () => {
        // The old non-greedy regex stopped at the first '</note>' and leaked
        // the outer note's tail text ('tail') into verse text.
        expect(removeElements('begin <note>outer <note>inner</note> tail</note> end', ['note']))
            .toBe('begin  end');
    });

    it('drops the remainder when an element is left unclosed by the fragment boundary', () => {
        expect(removeElements('kept <note>unclosed note text', ['note'])).toBe('kept ');
    });
});

describe('importUsfx - footnote stripping', () => {
    it('removes <f> footnote content from verse text', () => {
        const verses = runUsfx(`<usfx><book id="GEN"><c id="1"/>
<v id="1"/>In the beginning, God<f caller="+"><fr>1:1 </fr><ft>The Hebrew word rendered "God" is Elohim.</ft></f> created the heavens and the earth.<ve/>
</book></usfx>`);
        expect(verses).toHaveLength(1);
        expect(verses[0].text).toBe('In the beginning, God created the heavens and the earth.');
    });

    it('removes <x> cross-reference note content', () => {
        const verses = runUsfx(`<usfx><book id="GEN"><c id="1"/>
<v id="2"/>The earth<x caller="+"><xt>Jer 4:23</xt></x> was formless.<ve/>
</book></usfx>`);
        expect(verses[0].text).toBe('The earth was formless.');
    });

    it('keeps words-of-Jesus offsets aligned after footnote removal', () => {
        const verses = runUsfx(`<usfx><book id="MAT"><c id="4"/>
<v id="4"/>He answered, <wj>It is written,<f caller="+"><ft>Deuteronomy 8:3</ft></f> 'Man shall not live by bread alone.'</wj><ve/>
</book></usfx>`);
        expect(verses).toHaveLength(1);
        const v = verses[0];
        expect(v.text).toContain("It is written, 'Man shall not live by bread alone.'");
        expect(v.text).not.toContain('Deuteronomy');
        expect(v.wj).toBeDefined();
        const ranges: number[][] = JSON.parse(v.wj!);
        const wjText = ranges.map(([s, e]) => v.text.slice(s, e)).join('');
        expect(wjText).toBe("It is written, 'Man shall not live by bread alone.'");
    });
});

describe('importUsfx - Strong\'s word markup (eBible <w s="...">)', () => {
    it('strips <w> wrappers without detaching punctuation', () => {
        const verses = runUsfx(`<usfx><book id="GEN"><c id="1"/>
<v id="1"/><w s="H7225">In</w> <w s="H1254">the</w> <w s="H430">beginning</w> God created <w s="H776">the earth</w>.<ve/>
</book></usfx>`);
        expect(verses[0].text).toBe('In the beginning God created the earth.');
    });

    it('extracts s= attributes into deduplicated lemma tokens', () => {
        const verses = runUsfx(`<usfx><book id="GEN"><c id="1"/>
<v id="1"/><w s="H7225">In</w> <w s="H1254">created</w> <w s="H1254">made</w> <w s="G2316">God</w>.<ve/>
</book></usfx>`);
        expect(verses[0].lemmas?.split(' ').sort()).toEqual(['G2316', 'H1254', 'H7225']);
    });

    it('still extracts OSIS-style lemma= attributes', () => {
        const verses = runUsfx(`<usfx><book id="GEN"><c id="1"/>
<v id="1"/><w lemma="strong:H7225">Beginning</w> text.<ve/>
</book></usfx>`);
        expect(verses[0].lemmas).toBe('H7225');
        expect(verses[0].text).toBe('Beginning text.');
    });

    it('keeps wj offsets aligned when w and wj markup mix', () => {
        const verses = runUsfx(`<usfx><book id="MAT"><c id="4"/>
<v id="4"/>He said, <wj><w s="G1125">It</w> <w s="G3756">is</w> written</wj>.<ve/>
</book></usfx>`);
        const [range] = JSON.parse(verses[0].wj!) as Array<[number, number]>;
        expect(verses[0].text.slice(range[0], range[1])).toBe('It is written');
    });
});

describe('importUsfx - word alignment (issue #27)', () => {
    it('aligns each <w s="..."> element to a char span of the final text', () => {
        const verses = runUsfx(`<usfx><book id="GEN"><c id="1"/>
<v id="1"/><w s="H7225">In the beginning</w> <w s="H430">God</w> <w s="H1254">created</w> the earth.<ve/>
</book></usfx>`);
        expect(verses[0].text).toBe('In the beginning God created the earth.');
        expect(alignSurfaces(verses[0])).toEqual([
            ['In the beginning', 'H7225'],
            ['God', 'H430'],
            ['created', 'H1254'],
        ]);
    });

    it('keeps multi-ID attributes together on one span', () => {
        const verses = runUsfx(`<usfx><book id="GEN"><c id="1"/>
<v id="1"/><w s="H853 H8064">the heavens</w>.<ve/>
</book></usfx>`);
        expect(alignSurfaces(verses[0])).toEqual([['the heavens', 'H853 H8064']]);
    });

    it('keeps alignment correct after footnote removal', () => {
        const verses = runUsfx(`<usfx><book id="GEN"><c id="1"/>
<v id="1"/>In the beginning, God<f caller="+"><ft>The Hebrew word rendered "God" is Elohim.</ft></f> <w s="H1254">created</w> the heavens.<ve/>
</book></usfx>`);
        expect(alignSurfaces(verses[0])).toEqual([['created', 'H1254']]);
    });

    it('offsets alignment across merged lettered segments', () => {
        const verses = runUsfx(`<usfx><book id="EST"><c id="5"/>
<v id="1a"/><w s="H4428">The king</w> sat.<ve/>
<v id="1b"/><w s="H7200">Esther</w> stood.<ve/>
</book></usfx>`);
        expect(verses).toHaveLength(1);
        expect(verses[0].text).toBe('The king sat. Esther stood.');
        expect(alignSurfaces(verses[0])).toEqual([
            ['The king', 'H4428'],
            ['Esther', 'H7200'],
        ]);
    });

    it('coexists with words-of-Jesus markup without drifting either offset set', () => {
        const verses = runUsfx(`<usfx><book id="MAT"><c id="4"/>
<v id="4"/>He said, <wj><w s="G1125">It</w> <w s="G3756">is</w> written</wj>.<ve/>
</book></usfx>`);
        const [range] = JSON.parse(verses[0].wj!) as Array<[number, number]>;
        expect(verses[0].text.slice(range[0], range[1])).toBe('It is written');
        expect(alignSurfaces(verses[0])).toEqual([
            ['It', 'G1125'],
            ['is', 'G3756'],
        ]);
    });

    it('emits no align field for untagged verses', () => {
        const verses = runUsfx(`<usfx><book id="GEN"><c id="1"/>
<v id="1"/>Plain untagged text.<ve/>
</book></usfx>`);
        expect(verses[0].align).toBeUndefined();
    });
});

describe('importUsfx - verse bridges', () => {
    it('imports bridged verses under the first verse number with verseEnd', () => {
        const verses = runUsfx(`<usfx><book id="NEH"><c id="7"/>
<v id="1"/>First verse.<ve/>
<v id="15-16"/>Bridged verse text.<ve/>
<v id="17"/>After the bridge.<ve/>
</book></usfx>`);
        expect(verses.map(v => v.verse)).toEqual([1, 15, 17]);
        const bridge = verses[1];
        expect(bridge.text).toBe('Bridged verse text.');
        expect(bridge.verseEnd).toBe(16);
        expect(bridge.osisId).toBe('Neh.7.15');
        expect(verses[0].verseEnd).toBeUndefined();
        expect(verses[2].verseEnd).toBeUndefined();
    });

    it('ignores a degenerate bridge (end <= start)', () => {
        const verses = runUsfx(`<usfx><book id="GEN"><c id="1"/>
<v id="5-5"/>Text.<ve/>
</book></usfx>`);
        expect(verses[0].verse).toBe(5);
        expect(verses[0].verseEnd).toBeUndefined();
    });
});

describe('importUsfx - lettered verse segments (known-issues #19)', () => {
    it('imports lettered segments and merges them into one verse record', () => {
        const verses = runUsfx(`<usfx><book id="EST"><c id="5"/>
<v id="1a"/>Segment one.<ve/>
<v id="1b"/>Segment two.<ve/>
<v id="2"/>Next verse.<ve/>
</book></usfx>`);
        expect(verses.map(v => v.verse)).toEqual([1, 2]);
        expect(verses[0].text).toBe('Segment one. Segment two.');
        expect(verses[0].osisId).toBe('Esth.5.1');
        expect(verses[1].text).toBe('Next verse.');
    });

    it('keeps words-of-Jesus offsets aligned across merged segments', () => {
        const verses = runUsfx(`<usfx><book id="MAT"><c id="4"/>
<v id="4a"/>He answered,<ve/>
<v id="4b"/><wj>It is written.</wj><ve/>
</book></usfx>`);
        expect(verses).toHaveLength(1);
        const v = verses[0];
        expect(v.text).toBe('He answered, It is written.');
        const ranges: number[][] = JSON.parse(v.wj!);
        const wjText = ranges.map(([s, e]) => v.text.slice(s, e)).join('');
        expect(wjText).toBe('It is written.');
    });

    it('handles a lettered bridge id', () => {
        const verses = runUsfx(`<usfx><book id="SIR"><c id="20"/>
<v id="16a-17"/>Bridged segment text.<ve/>
</book></usfx>`);
        expect(verses[0].verse).toBe(16);
        expect(verses[0].verseEnd).toBe(17);
        expect(verses[0].text).toBe('Bridged segment text.');
    });
});

describe('importOsis - word alignment (issue #27)', () => {
    it('aligns <w lemma="strong:..."> content, normalizing zero-padding', () => {
        const verses = runOsis(`<osis><div>
<verse osisID="Gen.1.1" sID="Gen.1.1"/><w lemma="strong:H07225">In the beginning</w> <w lemma="strong:H0430">God</w> <w lemma="strong:H1254 strong:H853">created</w> the earth.<verse eID="Gen.1.1"/>
</div></osis>`);
        expect(verses[0].text).toBe('In the beginning God created the earth.');
        expect(alignSurfaces(verses[0])).toEqual([
            ['In the beginning', 'H7225'],
            ['God', 'H430'],
            ['created', 'H1254 H853'],
        ]);
    });

    it('keeps alignment through divineName small-caps materialisation', () => {
        const verses = runOsis(`<osis><div>
<verse osisID="Gen.2.4" sID="Gen.2.4"/>the day that the <w lemma="strong:H3068"><divineName>Lord</divineName></w> <w lemma="strong:H0430">God</w> made the earth.<verse eID="Gen.2.4"/>
</div></osis>`);
        expect(verses[0].text).toBe('the day that the LORD God made the earth.');
        expect(alignSurfaces(verses[0])).toEqual([
            ['LORD', 'H3068'],
            ['God', 'H430'],
        ]);
    });

    it('excludes transChange (translator-supplied) words from spans', () => {
        const verses = runOsis(`<osis><div>
<verse osisID="Gen.1.10" sID="Gen.1.10"/><w lemma="strong:H430">God</w> saw that <transChange type="added">it was</transChange> <w lemma="strong:H2896">good</w>.<verse eID="Gen.1.10"/>
</div></osis>`);
        expect(verses[0].text).toBe('God saw that it was good.');
        expect(alignSurfaces(verses[0])).toEqual([
            ['God', 'H430'],
            ['good', 'H2896'],
        ]);
    });

    it('keeps alignment correct after note removal', () => {
        const verses = runOsis(`<osis><div>
<verse osisID="Ruth.1.1" sID="Ruth.1.1"/>when the judges <w lemma="strong:H8199">judged</w><note placement="foot">Or, "governed"</note>, there was a famine.<verse eID="Ruth.1.1"/>
</div></osis>`);
        expect(verses[0].text).toBe('when the judges judged, there was a famine.');
        expect(alignSurfaces(verses[0])).toEqual([['judged', 'H8199']]);
    });

    it('emits no align field for untagged verses', () => {
        const verses = runOsis(`<osis><div>
<verse osisID="Gen.1.1" sID="Gen.1.1"/>In the beginning God created the heaven and the earth.<verse eID="Gen.1.1"/>
</div></osis>`);
        expect(verses[0].align).toBeUndefined();
    });
});

describe('importOsis - note stripping', () => {
    it('removes <note> content from verse text without stranding punctuation', () => {
        const verses = runOsis(`<osis><div>
<verse osisID="Ruth.1.1" sID="Ruth.1.1"/>In the days when the judges judged<note placement="foot">Or, "governed"</note>, there was a famine.<verse eID="Ruth.1.1"/>
</div></osis>`);
        expect(verses).toHaveLength(1);
        expect(verses[0].text).toBe('In the days when the judges judged, there was a famine.');
    });

    it('keeps normal verse text intact', () => {
        const verses = runOsis(`<osis><div>
<verse osisID="Gen.1.1" sID="Gen.1.1"/>In the beginning God created the heaven and the earth.<verse eID="Gen.1.1"/>
</div></osis>`);
        expect(verses[0].text).toBe('In the beginning God created the heaven and the earth.');
        expect(verses[0].book).toBe('Gen');
        expect(verses[0].chapter).toBe(1);
        expect(verses[0].verse).toBe(1);
    });
});
