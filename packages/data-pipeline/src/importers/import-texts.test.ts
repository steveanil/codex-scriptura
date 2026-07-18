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
    wj?: string;
};

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
