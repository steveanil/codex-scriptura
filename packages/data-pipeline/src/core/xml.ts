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
 * precedes a comma or period.
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
        let depth = 1;
        let scan = m.index + m[0].length;
        while (depth > 0) {
            re.lastIndex = scan;
            const open = re.exec(xml);
            const close = xml.indexOf(closeTag, scan);
            if (close === -1) {
                // Unclosed element: the rest of the fragment is note content.
                scan = xml.length;
                break;
            }
            if (open && open.index < close) {
                if (!open[0].endsWith('/>')) depth++;
                scan = open.index + open[0].length;
            } else {
                depth--;
                scan = close + closeTag.length;
            }
        }
        pos = scan;
    }
}
