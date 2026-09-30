/**
 * An automatic change the reader made to the recognised text (issue #85):
 * a cut, a join, a repaired word, a mark taken out. Every one is recorded
 * with where it was made, so the effect of a rule across the corpus can be
 * audited instead of trusted.
 */
export type Transform = { rule: string; from: string; to: string; item?: string; leaf?: number };
export type TransformLog = (t: Transform) => void;
/** A log already bound to the page it is reading. */
export type Note = (rule: string, from: string, to: string) => void;

/** A note that also takes where in the text the change was made, so the caller can place it on its leaf. */
export type NoteAt = (rule: string, from: string, to: string, at: number) => void;

/**
 * `text.replace(re, replace)`, logging each change with the words around it
 * under `rule` (a name, or one chosen from the match). No capture group in
 * `re` may be named: the offset is read from the replacer's arguments.
 */
export function replaceLogged(text: string, re: RegExp, rule: string | ((m: string) => string), replace: (m: string, ...groups: string[]) => string, note?: NoteAt): string {
    return text.replace(re, (m: string, ...rest: unknown[]) => {
        const at = rest[rest.length - 2] as number, whole = rest[rest.length - 1] as string;
        const out = replace(m, ...(rest.slice(0, -2) as string[]));
        if (note && out !== m) {
            const span = (t: string) => t.replace(/\s+/g, ' ');
            const before = whole.slice(Math.max(0, at - 24), at), after = whole.slice(at + m.length, at + m.length + 24);
            note(typeof rule === 'string' ? rule : rule(m), span(before + m + after), span(before + out + after), at);
        }
        return out;
    });
}
