/**
 * Footnote extraction shared by the USFX and OSIS importers (issue #39).
 *
 * The importers delete note elements before building verse text
 * (removeElements). markElements leaves a marker where each one sat; the
 * importer's mirror walk turns marker positions into offsets in the final
 * text (settleOffsets), and parseNoteBody turns the removed element into
 * runs. Nothing here touches the verse text chain itself.
 */

import type { NoteRun, VerseNote } from '@codex-scriptura/core';

/** How a note's inner element is read: dropped, plain text, styled, upper-cased, or a link to a candidate OSIS id (undefined when the source target does not even parse). */
export type NoteTagRule = 'drop' | 'plain' | 'catch' | 'alt' | 'upper' | { ref: string | undefined };

/** A run before link resolution and whitespace clean-up. */
export type DraftRun = { t: string; s?: 'catch' | 'alt'; ref?: string | undefined; link?: boolean };

/**
 * A note as an importer collects it, before its links are checked against
 * the finished translation. `verse` is set when the note came from a verse
 * with no text and was carried to the verse before (see VerseNote.verse).
 */
export type DraftNote = { at: number; kind?: 'xref'; verse?: number; runs: DraftRun[] };

const ENTITIES: Array<[RegExp, string]> = [
    [/&amp;/g, '&'], [/&lt;/g, '<'], [/&gt;/g, '>'], [/&apos;/g, "'"], [/&quot;/g, '"'],
];

function decodeEntities(s: string): string {
    let out = s;
    for (const [re, ch] of ENTITIES) out = out.replace(re, ch);
    return out;
}

type Frame = { name: string; rule: NoteTagRule; id: number };

/**
 * Read one removed note element (outer tag included) into draft runs.
 * Elements the rule does not know keep their inner text as plain text.
 */
export function parseNoteBody(elementXml: string, rule: (name: string, attrs: string) => NoteTagRule): DraftRun[] {
    const openEnd = elementXml.indexOf('>');
    const lastClose = elementXml.lastIndexOf('</');
    const inner = elementXml
        .slice(openEnd + 1, lastClose > openEnd ? lastClose : elementXml.length)
        .replace(/<!--[\s\S]*?-->/g, '');

    const runs: DraftRun[] = [];
    const stack: Frame[] = [];
    let frames = 0;
    let lastFrameId = -1;
    const tokenRe = /<(\/?)([A-Za-z][\w:.-]*)([^>]*)>|([^<]+)/g;
    for (const m of inner.matchAll(tokenRe)) {
        if (m[4] !== undefined) {
            if (stack.some((f) => f.rule === 'drop')) continue;
            let t = decodeEntities(m[4]);
            if (stack.some((f) => f.rule === 'upper')) t = t.toUpperCase();
            const refFrame = [...stack].reverse().find((f) => typeof f.rule === 'object');
            const styled = [...stack].reverse().find((f) => f.rule === 'catch' || f.rule === 'alt');
            const run: DraftRun = refFrame
                ? { t, ref: (refFrame.rule as { ref: string | undefined }).ref, link: true }
                : styled
                    ? { t, s: styled.rule as 'catch' | 'alt' }
                    : { t };
            const frameId = refFrame?.id ?? styled?.id ?? -1;
            const last = runs[runs.length - 1];
            if (last && frameId === lastFrameId && last.s === run.s && last.link === run.link) last.t += t;
            else runs.push(run);
            lastFrameId = frameId;
            continue;
        }
        const [, closing, name, attrs] = m;
        if (closing) {
            const at = stack.map((f) => f.name).lastIndexOf(name);
            if (at !== -1) stack.length = at;
        } else if (!attrs.trimEnd().endsWith('/')) {
            stack.push({ name, rule: rule(name, attrs), id: frames++ });
        }
    }
    return runs;
}

/**
 * Turn draft runs into stored runs: links that `resolve` rejects become
 * plain text, whitespace collapses inside and across runs, adjacent plain
 * strings merge, and empty runs go. Returns null when nothing is left.
 * `resolve` returns the id to link to, or undefined.
 */
export function finishRuns(draft: DraftRun[], resolve: (ref: string) => string | undefined, onUnresolved: (text: string) => void): NoteRun[] | null {
    const pieces: NoteRun[] = [];
    const pushPlain = (t: string) => {
        if (!t) return;
        const last = pieces[pieces.length - 1];
        if (typeof last === 'string') pieces[pieces.length - 1] = last + t;
        else pieces.push(t);
    };
    for (const d of draft) {
        const t = d.t.replace(/\s+/g, ' ');
        let target: string | undefined;
        if (d.link) {
            target = d.ref === undefined ? undefined : resolve(d.ref);
            if (target === undefined && t.trim()) onUnresolved(`${d.ref ?? '(no canonical verse)'} "${t.trim()}"`);
        }
        if (!target && !d.s) { pushPlain(t); continue; }
        const core = t.trim();
        if (!core) { pushPlain(t); continue; }
        if (t.startsWith(' ')) pushPlain(' ');
        if (target) {
            // "14," links as "14" with the comma after it (WEB carries the
            // source's punctuation inside <ref>)
            const label = core.replace(/[,;:.]+$/, '');
            pieces.push({ t: label || core, ref: target });
            if (label && label !== core) pushPlain(core.slice(label.length));
        } else {
            pieces.push({ t: core, s: d.s! });
        }
        if (t.endsWith(' ')) pushPlain(' ');
    }
    const runs: NoteRun[] = [];
    for (const [i, p] of pieces.entries()) {
        if (typeof p !== 'string') { runs.push(p); continue; }
        let t = p.replace(/ {2,}/g, ' ');
        if (i === 0) t = t.trimStart();
        if (i === pieces.length - 1) t = t.trimEnd();
        if (t) runs.push(t);
    }
    return runs.length > 0 ? runs : null;
}

/**
 * Offsets in the final verse text for markers the mirror walk met at
 * pre-collapse positions of `out` (the walk's text before whitespace
 * collapse and trim). The offset sits right after the last non-space
 * character before the marker, so a note between "word " and the next word
 * belongs to the word before it.
 */
export function settleOffsets(out: string, text: string, positions: number[]): number[] {
    const order = positions.map((p, i) => [p, i]).sort((a, b) => a[0] - b[0]);
    const result = new Array<number>(positions.length);
    let count = 0;
    let prevSpace = true;
    let k = 0;
    for (const [p, i] of order) {
        for (; k < p; k++) {
            if (/\s/.test(out[k])) {
                if (!prevSpace) { count++; prevSpace = true; }
            } else {
                count++;
                prevSpace = false;
            }
        }
        let at = Math.min(count, text.length);
        while (at > 0 && text[at - 1] === ' ') at--;
        result[i] = at;
    }
    return result;
}

/**
 * Where a note's catch words end in the verse, for notes the source parks
 * at the verse end (CrossWire's KJV puts every study note there and names
 * the words in <catchWord>). The needle is the catch text minus a trailing
 * ellipsis and punctuation; it must match on word boundaries. The search
 * runs from `from` (the previous note's anchor, so a repeated word resolves
 * in reading order), then from the start of the verse; each pass tries the
 * exact case before ignoring case. `ambiguous` says the successful pass
 * had more than one match to choose from.
 */
export function findCatchAnchor(text: string, catchText: string, from = 0): { at: number; ambiguous: boolean } | undefined {
    const needle = catchText
        .replace(/\s+/g, ' ')
        .trim()
        .replace(/(?:…|\.\.\.)$/, '')
        .trim()
        .replace(/[,.;:!?]+$/, '')
        .trim();
    if (!needle) return undefined;
    const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    for (const start of from > 0 ? [from, 0] : [0]) {
        for (const flags of ['gu', 'giu']) {
            const re = new RegExp(`(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`, flags);
            re.lastIndex = start;
            const first = re.exec(text);
            if (!first) continue;
            const ambiguous = re.exec(text) !== null;
            return { at: first.index + first[0].length, ambiguous };
        }
    }
    return undefined;
}

/** Sort a verse's notes by offset, keeping source order on ties. */
export function sortNotes<T extends { at: number }>(notes: T[]): T[] {
    return notes.map((n, i) => [n, i] as const).sort((a, b) => a[0].at - b[0].at || a[1] - b[1]).map(([n]) => n);
}

/**
 * The note side of an import: per-verse draft notes plus the counts the
 * importer reports. `finish` resolves every link against the ids the
 * translation actually contains and writes `notes` onto each verse.
 */
export class NoteCollector<V extends { osisId: string; book: string; chapter: number; verse: number; verseEnd?: number; text: string; notes?: string }> {
    readonly stats = {
        source: 0,
        imported: 0,
        outsideVerse: 0,
        attachedToPrevious: 0,
        droppedNoPrevious: 0,
        inSkippedBooks: 0,
        droppedEmpty: 0,
        offsetFallbacks: 0,
        links: 0,
        unresolvedLinks: 0,
        withCatch: 0,
        anchored: 0,
        anchorAmbiguous: 0,
        endNoCatch: 0,
        catchNotFound: 0,
    };
    readonly unresolved: string[] = [];
    private readonly drafts = new Map<V, DraftNote[]>();

    add(verse: V, notes: DraftNote[]): void {
        if (notes.length === 0) return;
        const list = this.drafts.get(verse);
        if (list) list.push(...notes);
        else this.drafts.set(verse, [...notes]);
    }

    finish(verses: V[]): void {
        // A link must land on a record this translation has; a verse inside
        // a bridge links to the bridge's record.
        const covering = new Map<string, string>();
        for (const v of verses) {
            for (let n = v.verse; n <= (v.verseEnd ?? v.verse); n++) covering.set(`${v.book}.${v.chapter}.${n}`, v.osisId);
        }
        const resolve = (ref: string) => covering.get(ref);
        for (const v of verses) {
            const drafts = this.drafts.get(v);
            if (!drafts) continue;
            this.anchorCatchWords(v.text, drafts);
            const notes: VerseNote[] = [];
            for (const d of sortNotes(drafts)) {
                const runs = finishRuns(d.runs, resolve, (what) => {
                    this.stats.unresolvedLinks++;
                    this.unresolved.push(`${v.osisId}: ${what}`);
                });
                if (!runs) { this.stats.droppedEmpty++; continue; }
                this.stats.links += runs.filter((r) => typeof r === 'object' && 'ref' in r).length;
                notes.push({ at: d.at, ...(d.kind ? { kind: d.kind } : {}), ...(d.verse !== undefined ? { verse: d.verse } : {}), runs });
            }
            this.stats.imported += notes.length;
            if (notes.length > 0) v.notes = JSON.stringify(notes);
        }
    }

    /**
     * Move notes parked at the verse end onto their catch words
     * (findCatchAnchor), in reading order. Notes the source placed inline,
     * and notes carried over from an omitted verse, keep their offset.
     */
    private anchorCatchWords(text: string, drafts: DraftNote[]): void {
        let from = 0;
        for (const d of sortNotes(drafts)) {
            const catchRun = d.runs.find((r) => r.s === 'catch');
            if (catchRun) this.stats.withCatch++;
            if (d.at !== text.length || d.verse !== undefined) {
                if (d.at < text.length) from = d.at;
                continue;
            }
            if (!catchRun) { this.stats.endNoCatch++; continue; }
            const anchor = findCatchAnchor(text, catchRun.t, from);
            if (!anchor) { this.stats.catchNotFound++; continue; }
            d.at = anchor.at;
            from = anchor.at;
            this.stats.anchored++;
            if (anchor.ambiguous) this.stats.anchorAmbiguous++;
        }
    }

    report(translationId: string): string {
        const s = this.stats;
        return `[${translationId}] Notes: ${s.imported} imported of ${s.source} in the source; ` +
            `${s.outsideVerse} outside any verse (${s.inSkippedBooks} of them in books not imported), ${s.attachedToPrevious} attached to the previous verse, ` +
            `${s.droppedNoPrevious} with no previous verse, ${s.droppedEmpty} empty; ` +
            `${s.offsetFallbacks} offset fallbacks; ${s.links} links, ${s.unresolvedLinks} unresolved targets; ` +
            `${s.withCatch} with catch words, ${s.anchored} anchored to them (${s.anchorAmbiguous} with more than one match), ` +
            `${s.endNoCatch} left at the verse end with no catch words, ${s.catchNotFound} whose catch words were not found` +
            (this.unresolved.length > 0 ? ` (${this.unresolved.slice(0, 10).join('; ')})` : '');
    }
}
