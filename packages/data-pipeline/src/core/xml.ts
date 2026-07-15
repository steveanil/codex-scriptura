/**
 * Shared XML helpers for pipeline importers.
 */

/**
 * Remove elements — tags AND their content — from an XML fragment.
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
 * Matching is non-greedy per element and repeats until stable, so
 * consecutive notes and (unlikely) nested same-tag notes are both handled.
 * Self-closing forms (e.g. <f/>) carry no content and are left for the
 * generic tag stripper.
 */
export function removeElements(xml: string, tagNames: string[]): string {
    let result = xml;
    for (const tag of tagNames) {
        const re = new RegExp(`<${tag}(?=[\\s>])[^>]*>[\\s\\S]*?</${tag}>`, 'g');
        let prev;
        do {
            prev = result;
            result = result.replace(re, '');
        } while (result !== prev);
    }
    return result;
}
