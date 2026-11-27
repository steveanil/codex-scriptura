/**
 * A report of characters in the Catena corpus that the 1841 edition does not print (issue #85).
 *
 * The edition is English with Latin, and quotes Greek and Hebrew in their own letters. The recogniser's models
 * are Chinese-first and cannot read Greek or Hebrew, so its mistakes show as East Asian characters, full-width
 * punctuation, and words that mix Latin letters with Greek ones ("xu入入ous" for a Greek word). This lists them
 * with where they are; it changes nothing and fails nothing, because what such a character stands for differs
 * from case to case and is only settled on the page image.
 *
 * It sees only what left a trace. A Greek word read wholly as Latin letters, or a Hebrew word the detector
 * skipped, is not here, so an empty report says nothing about whether the Greek and Hebrew are preserved.
 */

/** Typographic marks the edition's text legitimately carries. */
const PRINTED_MARKS = new Set([...'‘’“”\u2014\u2013·°§†‡¶']);
const LATIN = /\p{Script=Latin}/u, GREEK = /\p{Script=Greek}/u, HEBREW = /\p{Script=Hebrew}/u;
const EXAMPLES = 3;

export type Region = 'lemma' | 'running text' | 'citation';
export type Place = { entry: string; item?: string; leaf?: number; region: Region; context: string };
export type UnicodeFinding = {
    kind: 'other script' | 'symbol' | 'mixed-script word';
    /** The character, or the word for a mixed-script word. */
    text: string;
    /** U+XXXX for a character. */
    code?: string;
    script?: string;
    count: number;
    byRegion: Partial<Record<Region, number>>;
    entries: number;
    examples: Place[];
};
export type ReportEntry = { id: string; content: string; item?: string; excerptLeaves?: number[] };

const SCRIPTS = ['Han', 'Hiragana', 'Katakana', 'Hangul', 'Cyrillic', 'Arabic', 'Armenian', 'Thai'];

function scriptOf(ch: string): string {
    for (const s of SCRIPTS) if (new RegExp(`\\p{Script=${s}}`, 'u').test(ch)) return s;
    const cp = ch.codePointAt(0)!;
    if (cp >= 0x3000 && cp <= 0x303f) return 'CJK punctuation';
    if (cp >= 0xff00 && cp <= 0xffef) return 'full-width form';
    return 'other';
}

/** Whether the edition can have printed this character. */
function expected(ch: string): boolean {
    const cp = ch.codePointAt(0)!;
    return cp < 0x80 || LATIN.test(ch) || GREEK.test(ch) || HEBREW.test(ch) || PRINTED_MARKS.has(ch) || /\p{Mn}/u.test(ch);
}

/** The paragraphs of an entry with the region of each character: a lemma paragraph, an excerpt's citation, its text. */
function* regions(entry: ReportEntry): Generator<{ text: string; region: Region; leaf?: number }> {
    let excerpt = 0;
    for (const para of entry.content.split('\n\n')) {
        if (para.startsWith('>')) { yield { text: para, region: 'lemma' }; continue; }
        const leaf = entry.excerptLeaves?.[excerpt++];
        // An excerpt opens "**Author.** (*citation*) text"; the citation is the margin's
        const cite = /^(\*\*[^*]*\*\* )?\(\*(.*?)\*\) ?/s.exec(para);
        if (cite) {
            yield { text: cite[2], region: 'citation', leaf };
            yield { text: para.slice(cite[0].length), region: 'running text', leaf };
        } else yield { text: para, region: 'running text', leaf };
    }
}

/** Every unexpected character and mixed-script word in the entries, most frequent first; ties by text. */
export function unicodeAnomalies(entries: ReportEntry[]): UnicodeFinding[] {
    const found = new Map<string, UnicodeFinding & { ids: Set<string> }>();
    const add = (key: string, base: Pick<UnicodeFinding, 'kind' | 'text' | 'code' | 'script'>, place: Place) => {
        let f = found.get(key);
        if (!f) found.set(key, (f = { ...base, count: 0, byRegion: {}, entries: 0, examples: [], ids: new Set() }));
        f.count++;
        f.byRegion[place.region] = (f.byRegion[place.region] ?? 0) + 1;
        f.ids.add(place.entry);
        if (f.examples.length < EXAMPLES) f.examples.push(place);
    };
    for (const e of entries) {
        for (const { text, region, leaf } of regions(e)) {
            const place = (at: number, length: number): Place => ({ entry: e.id, ...(e.item ? { item: e.item } : {}), ...(leaf !== undefined ? { leaf } : {}), region, context: text.slice(Math.max(0, at - 30), at + length + 30) });
            for (const m of text.matchAll(/\S+/gu)) {
                const word = m[0];
                for (const ch of word) {
                    if (expected(ch)) continue;
                    const script = scriptOf(ch);
                    add(`c:${ch}`, { kind: script === 'other' ? 'symbol' : 'other script', text: ch, code: `U+${ch.codePointAt(0)!.toString(16).toUpperCase().padStart(4, '0')}`, script }, place(m.index, word.length));
                }
                // Greek letters inside a word of Latin ones: a Greek word the recogniser read as lookalikes
                if (GREEK.test(word) && LATIN.test(word.replace(/[^\p{L}]/gu, ''))) add(`w:${word}`, { kind: 'mixed-script word', text: word }, place(m.index, word.length));
            }
        }
    }
    return [...found.values()]
        .map(({ ids, ...f }) => ({ ...f, entries: ids.size }))
        .sort((a, b) => b.count - a.count || a.kind.localeCompare(b.kind) || a.text.localeCompare(b.text));
}

/** Two lines for the import's log: how much there is, and the commonest of it. */
export function unicodeSummary(findings: UnicodeFinding[]): string[] {
    const chars = findings.filter((f) => f.kind !== 'mixed-script word'), words = findings.filter((f) => f.kind === 'mixed-script word');
    const total = (fs: UnicodeFinding[]) => fs.reduce((n, f) => n + f.count, 0);
    if (!findings.length) return ['unicode report: nothing outside the edition\'s scripts'];
    return [
        `unicode report: ${total(chars)} characters outside the edition's scripts (${chars.length} different), ${total(words)} words mixing Latin and Greek letters (${words.length} different)`,
        `unicode report: commonest ${chars.slice(0, 8).map((f) => `${f.text} ${f.code} x${f.count}`).join(', ') || 'none'}; read each on the page image, nothing was changed`,
    ];
}
