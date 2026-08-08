import type { ScratchPadVerseBlock } from '@codex-scriptura/core';
import { getContiguousGroups } from '$lib/utils/verse-groups';

/**
 * Scratch pad text mechanics (issue #23), kept out of the component so
 * they are unit-testable: quoted-block formatting, cursor insertion, and
 * the reference extraction behind "Convert to note".
 */

/** Render a dropped verse as a quoted block. No trailing newline. */
export function formatVerseBlock(block: ScratchPadVerseBlock): string {
    const quoted = block.text
        .trim()
        .split('\n')
        .map((line) => `> ${line}`)
        .join('\n');
    return `${quoted}\n> - ${block.reference} (${block.translationId})`;
}

/**
 * Insert verse blocks into the pad content at the caret (null = append),
 * padding with newlines so a block never glues onto surrounding text.
 * Returns the new content and the caret position after the insertion.
 */
export function insertBlocksIntoContent(
    content: string,
    blocks: ScratchPadVerseBlock[],
    cursor: number | null
): { content: string; cursor: number } {
    if (blocks.length === 0) return { content, cursor: cursor ?? content.length };

    const at = cursor === null ? content.length : Math.max(0, Math.min(cursor, content.length));
    const before = content.slice(0, at);
    const after = content.slice(at);

    const prefix = before.length === 0 || before.endsWith('\n') ? '' : '\n';
    const suffix = after.startsWith('\n') ? '' : '\n';
    const insert = prefix + blocks.map(formatVerseBlock).join('\n\n') + suffix;

    return { content: before + insert + after, cursor: at + insert.length };
}

function escapeRegExp(s: string): string {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * OSIS ids of the dropped verses whose reference label appears in the
 * given text, in order of appearance, deduped. The (?!\d) guard keeps
 * "Gen 1:1" from matching inside "Gen 1:12".
 */
export function extractAnchors(text: string, droppedVerses: ScratchPadVerseBlock[]): string[] {
    const hits: { osisId: string; index: number }[] = [];
    const seen = new Set<string>();
    for (const block of droppedVerses) {
        if (seen.has(block.osisId)) continue;
        const match = new RegExp(escapeRegExp(block.reference) + '(?!\\d)').exec(text);
        if (match) {
            seen.add(block.osisId);
            hits.push({ osisId: block.osisId, index: match.index });
        }
    }
    return hits.sort((a, b) => a.index - b.index).map((h) => h.osisId);
}

export type NoteAnchor = { book: string; chapter: number; startVerse: number; endVerse: number };

/**
 * Group anchor OSIS ids into per-chapter contiguous runs - the same
 * one-note-per-run rule the reader's note editor applies to a verse
 * selection. Malformed ids are dropped.
 */
export function groupAnchors(osisIds: string[]): NoteAnchor[] {
    const byChapter = new Map<string, number[]>();
    for (const id of osisIds) {
        const [book, chapterStr, verseStr] = id.split('.');
        const verse = parseInt(verseStr ?? '', 10);
        if (!book || !chapterStr || isNaN(verse)) continue;
        const key = `${book}.${chapterStr}`;
        const list = byChapter.get(key);
        if (list) list.push(verse);
        else byChapter.set(key, [verse]);
    }

    const anchors: NoteAnchor[] = [];
    for (const [key, verses] of byChapter) {
        const dotIdx = key.lastIndexOf('.');
        const book = key.slice(0, dotIdx);
        const chapter = parseInt(key.slice(dotIdx + 1), 10);
        const sorted = [...new Set(verses)].sort((a, b) => a - b);
        for (const group of getContiguousGroups(sorted)) {
            anchors.push({ book, chapter, startVerse: group[0], endVerse: group[group.length - 1] });
        }
    }
    return anchors;
}
