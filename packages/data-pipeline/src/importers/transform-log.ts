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

export type Transform = { rule: string; from: string; to: string; item?: string; leaf?: number; applied?: boolean; verified?: string };
/** Records a change the reader would make and says whether to make it. */
export type TransformLog = (t: Transform) => boolean;
/** A log already bound to the page it is reading. */
export type Note = (rule: string, from: string, to: string) => boolean;
/** A note that also takes where in the text the change was made, so the caller can place it on its leaf. */
export type NoteAt = (rule: string, from: string, to: string, at: number) => boolean;

const AUTOMATIC = new Set([
    'ligature', 'ae-ligature', 'italic', 'dictionary-cut', 'fragment-join', 'lost-hyphen', 'dehyphen', 'qf-as-of', 'capital-read-apart', 'one-as-i', 'etc-sign',
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
export type VerifiedTransform = { rule: string; item: string; leaf: number; from: string; to: string; verdict: 'apply' | 'keep'; reviewed: string; note: string };

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

const keyOf = (t: { rule: string; item?: string; leaf?: number; from: string }) => `${t.rule}\u0000${t.item ?? ''}\u0000${t.leaf ?? ''}\u0000${t.from}`;

/**
 * The reader's log for one import: automatic rules are made, a suggestion
 * only where its occurrence was verified. `unmatched` lists verified records
 * no occurrence met, which fail the import as a stale correction does.
 */
export function readerLog(verified: VerifiedTransform[] = []): { log: TransformLog; transforms: Transform[]; unmatched: () => VerifiedTransform[] } {
    const byKey = new Map(verified.map((v) => [keyOf(v), v]));
    const used = new Set<VerifiedTransform>();
    const transforms: Transform[] = [];
    const log: TransformLog = (t) => {
        if (isAutomatic(t.rule)) { transforms.push({ ...t, applied: true }); return true; }
        const v = byKey.get(keyOf(t));
        if (v && v.to === t.to) { used.add(v); transforms.push({ ...t, applied: v.verdict === 'apply', verified: v.reviewed }); return v.verdict === 'apply'; }
        transforms.push({ ...t, applied: false });
        return false;
    };
    return { log, transforms, unmatched: () => verified.filter((v) => !used.has(v)) };
}

/**
 * `text.replace(re, replace)` where each change is logged with the words
 * around it under `rule` (a name, or one chosen from the match), and made
 * only when the log says so; with no log, only an automatic rule is made.
 * No capture group in `re` may be named: the offset is read from the
 * replacer's arguments.
 */
export function replaceLogged(text: string, re: RegExp, rule: string | ((m: string) => string), replace: (m: string, ...groups: string[]) => string, note?: NoteAt): string {
    return text.replace(re, (m: string, ...rest: unknown[]) => {
        const at = rest[rest.length - 2] as number, whole = rest[rest.length - 1] as string;
        const out = replace(m, ...(rest.slice(0, -2) as string[]));
        if (out === m) return m;
        const name = typeof rule === 'string' ? rule : rule(m);
        if (!note) return isAutomatic(name) ? out : m;
        const span = (t: string) => t.replace(/\s+/g, ' ');
        const before = whole.slice(Math.max(0, at - 24), at), after = whole.slice(at + m.length, at + m.length + 24);
        return note(name, span(before + m + after), span(before + out + after), at) ? out : m;
    });
}
