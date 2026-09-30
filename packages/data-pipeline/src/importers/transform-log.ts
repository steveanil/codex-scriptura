/**
 * What the Catena reader may change in the recognised text on its own, and
 * the record of every change it makes or proposes (issue #85).
 *
 * A rule is automatic when what it changes cannot be a word of the edition:
 * a form in the hand-checked tables (corrections/catena-aurea.reader-forms.json),
 * a ligature form, a line-end hyphen, or the pieces of an author token, which
 * the attribution tier checks against the page images. Every other rule only
 * suggests: a repair guessed from the reading's counts, or a mark taken out
 * because of what character it is. A suggestion is logged and not made,
 * unless that occurrence was read on the page image and recorded in
 * corrections/catena-aurea.transforms-verified.json.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

/**
 * One change the reader made or proposes. `span` names where on the page the changed characters were read
 * (see Traced), `y` is the top of their line in scan pixels, and `id` is stable for the same change at the
 * same place across rebuilds, so a record of what the page shows can name exactly one occurrence.
 */
export type Transform = { rule: string; from: string; to: string; item?: string; leaf?: number; span?: string; y?: number; id?: string; applied?: boolean; verified?: string };
/** Records a change the reader would make and says whether to make it. */
export type TransformLog = (t: Transform) => boolean;
/** Where on the page a change was read: its leaf, the top of its line in scan pixels, and a span naming the characters. */
export type Place = { leaf: number; y: number; span: string };
/** A log already bound to the page it is reading. */
export type Note = (rule: string, from: string, to: string, place?: Place) => boolean;
/** A note that also takes the offset of the change in the text it was made in, and where the changed characters were read. */
export type NoteAt = (rule: string, from: string, to: string, at: number, place?: Place) => boolean;

/** A line the reader's text was read from: its leaf, its top in scan pixels, and whether it is margin text. */
export type Source = { leaf: number; y: number; margin?: boolean };

/**
 * Text that remembers where each of its characters was read: a line (Source) and a column in it. Joining
 * lines, slicing out an excerpt and replacing inside it keep every surviving character's origin, so a change
 * made after others have shifted the text is still placed on the leaf and line it was read from.
 */
export class Traced {
    private constructor(readonly text: string, private readonly origin: readonly number[], private readonly sources: Source[]) {}
    static plain(text: string, sources: Source[] = []): Traced { return new Traced(text, new Array<number>(text.length).fill(-1), sources); }
    /** `text` read from `source`, its first character at column `col` of that line. */
    static read(text: string, source: Source, col: number, sources: Source[]): Traced {
        const at = sources.push(source) - 1;
        return new Traced(text, Array.from(text, (_, i) => at * 65536 + col + i), sources);
    }
    get length(): number { return this.text.length; }
    concat(other: Traced | string): Traced {
        const o = typeof other === 'string' ? Traced.plain(other, this.sources) : other;
        return new Traced(this.text + o.text, [...this.origin, ...o.origin], this.sources);
    }
    slice(start: number, end?: number): Traced { return new Traced(this.text.slice(start, end), this.origin.slice(start, end), this.sources); }
    /** Where character `i` was read, or undefined for one the reader inserted. */
    sourceAt(i: number): (Source & { col: number }) | undefined {
        const o = this.origin[i];
        return o >= 0 ? { ...this.sources[Math.floor(o / 65536)], col: o % 65536 } : undefined;
    }
    /** The first origin at or before `i`, for a character the reader inserted. */
    private originAt(i: number): number { for (let k = Math.min(i, this.origin.length - 1); k >= 0; k--) if (this.origin[k] >= 0) return this.origin[k]; return -1; }
    /** Where characters start..end were read, or undefined for text with no origin. */
    place(start: number, end: number): Place | undefined {
        const a = this.originAt(start), b = this.originAt(Math.max(start, end - 1));
        if (a < 0) return undefined;
        const name = (o: number) => { const src = this.sources[Math.floor(o / 65536)]; return `${src.leaf}@${src.y}${src.margin ? 'm' : ''}:${o % 65536}`; };
        const src = this.sources[Math.floor(a / 65536)];
        return { leaf: src.leaf, y: src.y, span: `${name(a)}-${name(b)}` };
    }
    /** Every line this text was read from, including lines none of whose characters survived. */
    linesRead(): readonly Source[] { return this.sources; }
    /**
     * The text with [start, end) replaced by `out`. What the replacement keeps at either end keeps its own
     * origins; of the part it alters, a character stands for the one at its position there (a substitution),
     * and one with nothing to stand for (an insertion) has no origin.
     */
    splice(start: number, end: number, out: string): Traced {
        const was = this.text.slice(start, end), from = this.origin.slice(start, end);
        let p = 0;
        while (p < was.length && p < out.length && was[p] === out[p]) p++;
        let q = 0;
        while (q < was.length - p && q < out.length - p && was[was.length - 1 - q] === out[out.length - 1 - q]) q++;
        const altered = from.slice(p, was.length - q);
        const middle = Array.from(out.slice(p, out.length - q), (_, i) => (altered.length ? altered[Math.min(i, altered.length - 1)] : -1));
        const fill = [...from.slice(0, p), ...middle, ...from.slice(was.length - q)];
        return new Traced(this.text.slice(0, start) + out + this.text.slice(end), [...this.origin.slice(0, start), ...fill, ...this.origin.slice(end)], this.sources);
    }
}

const AUTOMATIC = new Set([
    'ligature', 'ae-ligature', 'italic', 'dictionary-cut', 'fragment-join', 'lost-hyphen', 'dehyphen', 'spacing', 'qf-as-of', 'capital-read-apart', 'one-as-i', 'etc-sign',
    'hyphen-kept', 'broken-token-join', 'token-hyphen-join', 'pseudo-note-dropped', 'abbreviation-period', 'council-article',
]);

/** Whether a rule changes text without an image check. A lemma is running text; a citation's rules all wait for the page. */
export function isAutomatic(rule: string): boolean {
    if (rule.startsWith('citation:')) return false;
    return AUTOMATIC.has(rule.replace(/^lemma:/, ''));
}

/** Hand-checked forms the reader repairs, cuts or joins on its own. */
export type ReaderForms = { italic: Record<string, string>; cuts: Record<string, string>; joins: Record<string, string>; lostHyphen: Record<string, string> };
export const NO_FORMS: ReaderForms = { italic: {}, cuts: {}, joins: {}, lostHyphen: {} };

/** One occurrence of a suggestion, read on the page image: made (apply) or left as the recogniser read it (keep). */
export type VerifiedTransform = { id: string; rule: string; item: string; leaf: number; span: string; from: string; to: string; verdict: 'apply' | 'keep'; reviewed: string; note: string };

const CORRECTIONS = path.resolve(import.meta.dirname, '..', '..', 'corrections');
export const READER_FORMS_FILE = path.join(CORRECTIONS, 'catena-aurea.reader-forms.json');
export const VERIFIED_TRANSFORMS_FILE = path.join(CORRECTIONS, 'catena-aurea.transforms-verified.json');

export function loadReaderForms(file: string = READER_FORMS_FILE): ReaderForms {
    const { italic, cuts, joins, lostHyphen } = JSON.parse(fs.readFileSync(file, 'utf-8')) as ReaderForms;
    return { italic, cuts, joins, lostHyphen };
}

export function loadVerifiedTransforms(file: string = VERIFIED_TRANSFORMS_FILE): VerifiedTransform[] {
    return fs.existsSync(file) ? (JSON.parse(fs.readFileSync(file, 'utf-8')) as VerifiedTransform[]) : [];
}

/** A form in the tables that the English lexicon knows: the tables may hold only forms that are no words. */
export function formsProblems(forms: ReaderForms, english: ReadonlySet<string>): string[] {
    return [...Object.keys(forms.italic), ...Object.keys(forms.cuts)].filter((k) => english.has(k)).map((k) => `reader form "${k}" is a word the lexicon knows`);
}

/** What a record binds to: the rule, the scan, the span of characters on the page, and the change itself. */
const keyOf = (t: { rule: string; item?: string; span?: string; from: string; to: string }) => `${t.rule}\u0000${t.item ?? ''}\u0000${t.span ?? ''}\u0000${t.from}\u0000${t.to}`;
/** A suggestion's id: the same change at the same place keeps it across rebuilds. */
export const transformId = (t: { rule: string; item?: string; span?: string; from: string; to: string }): string => createHash('sha256').update(keyOf(t)).digest('hex').slice(0, 12);

/**
 * The reader's log for one import: automatic rules are made, a suggestion
 * only where its occurrence was verified. A record binds to one span on
 * one page; two occurrences with the same key, or a record no occurrence
 * meets, are reported by `problems` and fail the import, so one record can
 * never approve more than the occurrence that was read.
 */
export function readerLog(verified: VerifiedTransform[] = []): { log: TransformLog; transforms: Transform[]; problems: () => string[] } {
    const byKey = new Map(verified.map((v) => [keyOf(v), v]));
    const seen = new Map<string, number>();
    const used = new Set<VerifiedTransform>();
    const transforms: Transform[] = [];
    const log: TransformLog = (t) => {
        const key = keyOf(t);
        seen.set(key, (seen.get(key) ?? 0) + 1);
        const id = transformId(t);
        if (isAutomatic(t.rule)) { transforms.push({ ...t, id, applied: true }); return true; }
        const v = byKey.get(key);
        if (v) { used.add(v); transforms.push({ ...t, id, applied: v.verdict === 'apply', verified: v.reviewed }); return v.verdict === 'apply'; }
        transforms.push({ ...t, id, applied: false });
        return false;
    };
    const problems = () => [
        ...verified.filter((v) => !used.has(v)).map((v) => `verified ${v.id} (${v.rule} ${v.item} leaf ${v.leaf} ${v.span}) matches no occurrence`),
        ...verified.filter((v) => (seen.get(keyOf(v)) ?? 0) > 1).map((v) => `verified ${v.id} (${v.rule} ${v.item} leaf ${v.leaf}) matches ${seen.get(keyOf(v))} occurrences`),
    ];
    return { log, transforms, problems };
}

/**
 * `re` replaced in traced text, each change logged with the words around it
 * under `rule` (a name, or one chosen from the match) and where it was read,
 * and made only when the log says so; with no log, only an automatic rule is
 * made. `re` must be global, and none of its groups named.
 */
export function replaceTraced(t: Traced, re: RegExp, rule: string | ((m: string) => string), replace: (m: string, ...groups: string[]) => string, note?: NoteAt): Traced {
    const whole = t.text;
    const edits: { start: number; end: number; out: string }[] = [];
    re.lastIndex = 0;
    for (let m = re.exec(whole); m; m = re.exec(whole)) {
        if (m[0] === '') { re.lastIndex++; continue; }
        const at = m.index, len = m[0].length;
        const out = replace(m[0], ...(m.slice(1) as string[]));
        if (out === m[0]) continue;
        const name = typeof rule === 'string' ? rule : rule(m[0]);
        let make: boolean;
        if (!note) make = isAutomatic(name);
        else {
            const span = (x: string) => x.replace(/\s+/g, ' ');
            const before = whole.slice(Math.max(0, at - 24), at), after = whole.slice(at + len, at + len + 24);
            // Placed by the characters the change alters, not the ones it keeps: a match that opens with the space
            // joining two lines would otherwise be placed on the line before
            let p = 0;
            while (p < len && p < out.length && m[0][p] === out[p]) p++;
            let q = 0;
            while (q < len - p && q < out.length - p && m[0][len - 1 - q] === out[out.length - 1 - q]) q++;
            make = note(name, span(before + m[0] + after), span(before + out + after), at, t.place(at + p, Math.max(at + p + 1, at + len - q)));
        }
        if (make) edits.push({ start: at, end: at + len, out });
    }
    let r = t;
    for (const e of edits.reverse()) r = r.splice(e.start, e.end, e.out);
    return r;
}

/** `text.replace(re, replace)` with each change logged and made as replaceTraced decides, for text with no traced origin. */
export function replaceLogged(text: string, re: RegExp, rule: string | ((m: string) => string), replace: (m: string, ...groups: string[]) => string, note?: NoteAt): string {
    return replaceTraced(Traced.plain(text), re, rule, replace, note).text;
}
