import { getContiguousGroups } from '$lib/utils/verse-groups';

/**
 * Clipboard text for a verse selection: each contiguous run is its text
 * followed by a "Book C:V-V (TRANSLATION)" line, runs separated by a
 * blank line. The reference used to be omitted entirely (issue #169).
 */
export function formatVersesForCopy(
    bookName: string,
    chapter: number,
    translationId: string,
    verses: { verse: number; text: string }[]
): string {
    const byNum = new Map(verses.map((v) => [v.verse, v.text.trim()]));
    const nums = [...byNum.keys()].sort((a, b) => a - b);
    return getContiguousGroups(nums)
        .map((group) => {
            const text = group.map((v) => byNum.get(v)).join(' ');
            const first = group[0];
            const last = group[group.length - 1];
            const ref = first === last ? `${chapter}:${first}` : `${chapter}:${first}-${last}`;
            return `${text}\n${bookName} ${ref} (${translationId})`;
        })
        .join('\n\n');
}
