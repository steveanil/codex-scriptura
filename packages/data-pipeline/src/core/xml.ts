/**
 * Shared XML helpers for pipeline importers.
 */

// Opening/self-closing tag matcher per element name, cached because the
// importers call removeElements once per verse slice (~31K times per
// translation).
const TAG_RES = new Map<string, RegExp>();
function tagRe(tag: string): RegExp {
    let re = TAG_RES.get(tag);
    if (!re) {
        re = new RegExp(`<${tag}(?=[\\s/>])[^>]*>`, 'g');
        TAG_RES.set(tag, re);
    }
    return re;
}

/**
 * Remove elements - tags AND their content - from an XML fragment.
 *
 * Used to drop translator footnotes and cross-reference notes before verse
 * text extraction. The generic tag-stripping pass in the importers removes
 * tags but keeps inner text, which is correct for markup like <wj> or <q>
 * but wrong for notes: their content is not scripture.
 *
 * Removed elements are deleted outright (no placeholder space): notes sit
 * adjacent to existing whitespace or punctuation in practice, and inserting
 * a space would strand punctuation ("judged , there") when a note directly
 * precedes a comma or period. When a removed element is preceded by
 * whitespace AND directly followed by punctuation ("word <f>…</f>?"),
 * the whitespace is dropped too - it would otherwise strand the
 * punctuation just the same ("word ?", issue #175).
 *
 * Implemented as a depth-aware scan rather than a single regex so that
 * (a) nested same-tag notes are removed in full, and (b) self-closing
 * forms - with or without attributes (<f/>, <note n="a"/>) - are never
 * mistaken for opening tags (they carry no content and are left for the
 * generic tag stripper). An element left unclosed by the fragment boundary
 * drops the remainder of the fragment: everything after its opening tag is
 * note content, and leaking notes into scripture is the worse failure.
 */
export function removeElements(xml: string, tagNames: string[]): string {
    let result = xml;
    for (const tag of tagNames) {
        result = removeElement(result, tag);
    }
    return result;
}

function removeElement(xml: string, tag: string): string {
    const re = tagRe(tag);
    const closeTag = `</${tag}>`;
    let out = '';
    let pos = 0;
    for (;;) {
        re.lastIndex = pos;
        const m = re.exec(xml);
        if (!m) return out + xml.slice(pos);
        if (m[0].endsWith('/>')) {
            // Self-closing: no content - keep the tag for the generic stripper.
            out += xml.slice(pos, m.index + m[0].length);
            pos = m.index + m[0].length;
            continue;
        }
        out += xml.slice(pos, m.index);
        const scan = elementEnd(xml, re, closeTag, m.index + m[0].length);
        // A removed note flanked by "space before, punctuation after"
        // (BSB: "Jerubbesheth <f>…</f>?") would strand the space as
        // detached punctuation ("Jerubbesheth ?") - drop it (issue #175).
        if (/[,.;:?!]/.test(xml[scan] ?? '')) out = out.replace(/\s+$/, '');
        pos = scan;
    }
}

/** Index just past the close tag matching an opening tag that ends at `scan`, nested same-tag elements included. */
function elementEnd(xml: string, re: RegExp, closeTag: string, scan: number): number {
    let depth = 1;
    while (depth > 0) {
        re.lastIndex = scan;
        const open = re.exec(xml);
        const close = xml.indexOf(closeTag, scan);
        if (close === -1) {
            // Unclosed element: the rest of the fragment is note content.
            return xml.length;
        }
        if (open && open.index < close) {
            if (!open[0].endsWith('/>')) depth++;
            scan = open.index + open[0].length;
        } else {
            depth--;
            scan = close + closeTag.length;
        }
    }
    return scan;
}

/** How many elements removeElements would delete from `xml` (nested same-tag elements count once). */
export function countElements(xml: string, tagNames: string[]): number {
    let count = 0;
    for (const tag of tagNames) {
        const re = tagRe(tag);
        const closeTag = `</${tag}>`;
        let pos = 0;
        for (;;) {
            re.lastIndex = pos;
            const m = re.exec(xml);
            if (!m) break;
            if (m[0].endsWith('/>')) { pos = m.index + m[0].length; continue; }
            count++;
            pos = elementEnd(xml, re, closeTag, m.index + m[0].length);
        }
    }
    return count;
}

/** First private-use code point; marker i stands for removed element i. */
export const MARKER_BASE = 0xe000;
const MARKER_LIMIT = 0xf8ff - MARKER_BASE;
export const MARKER_RE = /[\ue000-\uf8ff]/g;
const MARKER_CHAR = /[\ue000-\uf8ff]/;

/**
 * removeElements, but each removed element leaves a marker character
 * behind (U+E000 + its index in `removed`) so a later walk can find where
 * it sat. With the markers deleted, `marked` is exactly what
 * removeElements returns: the #175 whitespace rule looks through markers
 * on both sides, as if the earlier removals had left nothing. Callers
 * check that equality and treat a mismatch as "position unknown".
 */
export function markElements(xml: string, tagNames: string[]): { marked: string; removed: string[] } {
    const removed: string[] = [];
    let marked = xml;
    for (const tag of tagNames) {
        const re = tagRe(tag);
        const closeTag = `</${tag}>`;
        let out = '';
        let pos = 0;
        for (;;) {
            re.lastIndex = pos;
            const m = re.exec(marked);
            if (!m) { out += marked.slice(pos); break; }
            if (m[0].endsWith('/>')) {
                out += marked.slice(pos, m.index + m[0].length);
                pos = m.index + m[0].length;
                continue;
            }
            out += marked.slice(pos, m.index);
            const scan = elementEnd(marked, re, closeTag, m.index + m[0].length);
            let next = scan;
            while (MARKER_CHAR.test(marked[next] ?? '')) next++;
            if (/[,.;:?!]/.test(marked[next] ?? '')) {
                out = out.replace(/[\s\ue000-\uf8ff]+$/, (tail) => tail.replace(/\s+/g, ''));
            }
            if (removed.length > MARKER_LIMIT) throw new Error('markElements: too many elements in one fragment');
            out += String.fromCharCode(MARKER_BASE + removed.length);
            removed.push(marked.slice(m.index, scan));
            pos = scan;
        }
        marked = out;
    }
    return { marked, removed };
}
