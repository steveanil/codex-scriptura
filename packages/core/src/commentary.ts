/**
 * Commentary content (issue #83): Codex Commentary Markdown v1.
 *
 * A deliberately tiny, portable rich-text subset. Importers (#85) convert
 * upstream HTML or plain text into it, so an HTML source is made safe by
 * conversion rather than by preserving sanitized markup; the renderer
 * builds DOM from the tokens this parser returns and never interprets the
 * text as HTML. Anything outside the grammar is literal text, never an
 * error and never markup, so arbitrary content can only ever produce the
 * six node kinds below.
 *
 * Grammar
 *   blocks     separated by one or more blank lines
 *   heading    a single line starting with "## "
 *   quote      every line of the block starts with ">"
 *   paragraph  anything else; a single newline inside it is a line break
 *   **strong** *emphasis*  [text](https://...)   links are http(s) only
 *   \          escapes the next character among \ * [ ] ( ) > #
 *
 * No raw HTML, images, tables, code, lists or nesting of links.
 */

import type { CommentaryEntry, RawCommentaryEntry } from './types.js';
import { BOOKS } from './books.js';
import { compareCanonical, parseOsisId } from './refs.js';

/** The payload format a commentary dataset declares (DatasetManifestEntry.contentFormat). */
export const COMMENTARY_CONTENT_FORMAT = 'codex-commentary-markdown/1';

export type CommentaryInline =
    | { type: 'text'; text: string }
    | { type: 'strong'; children: CommentaryInline[] }
    | { type: 'em'; children: CommentaryInline[] }
    | { type: 'link'; href: string; children: CommentaryInline[] }
    | { type: 'break' };

export type CommentaryBlock =
    | { type: 'paragraph'; children: CommentaryInline[] }
    | { type: 'quote'; children: CommentaryInline[] }
    | { type: 'heading'; children: CommentaryInline[] };

const ESCAPABLE = new Set(['\\', '*', '[', ']', '(', ')', '>', '#']);
const LINK_HREF = /^https?:\/\/[^\s)]+$/i;

/** Index of `delim` at or after `from`, skipping escaped characters; -1 when absent. A lone `*` never matches half of a `**`. */
function findClose(s: string, from: number, delim: '*' | '**'): number {
    for (let i = from; i < s.length; i++) {
        if (s[i] === '\\') { i++; continue; }
        if (!s.startsWith(delim, i)) continue;
        if (delim === '*' && (s[i + 1] === '*' || s[i - 1] === '*')) continue;
        // "***" closes an inner *em* first, then the **strong** around it
        if (delim === '**' && s[i + 2] === '*') return i + 1;
        return i;
    }
    return -1;
}

/** `[text](href)` at `at`, or null when it is not a well-formed http(s) link; a failed match leaves the text literal. */
function matchLink(s: string, at: number): { text: string; href: string; end: number } | null {
    let i = at + 1;
    for (; i < s.length; i++) {
        if (s[i] === '\\') { i++; continue; }
        if (s[i] === '[' || s[i] === '\n') return null;
        if (s[i] === ']') break;
    }
    if (i >= s.length || s[i + 1] !== '(') return null;
    const text = s.slice(at + 1, i);
    const close = s.indexOf(')', i + 2);
    if (close < 0 || text.trim() === '') return null;
    const href = s.slice(i + 2, close).trim();
    if (!LINK_HREF.test(href)) return null;
    return { text, href, end: close + 1 };
}

function parseInline(s: string, allowLinks = true): CommentaryInline[] {
    const out: CommentaryInline[] = [];
    let text = '';
    const flush = () => { if (text) { out.push({ type: 'text', text }); text = ''; } };

    let i = 0;
    while (i < s.length) {
        const c = s[i];
        if (c === '\\' && i + 1 < s.length && ESCAPABLE.has(s[i + 1])) { text += s[i + 1]; i += 2; continue; }
        if (c === '\n') { flush(); out.push({ type: 'break' }); i++; continue; }
        if (s.startsWith('**', i)) {
            const end = findClose(s, i + 2, '**');
            if (end > i + 2) { flush(); out.push({ type: 'strong', children: parseInline(s.slice(i + 2, end), allowLinks) }); i = end + 2; continue; }
        }
        if (c === '*') {
            const end = findClose(s, i + 1, '*');
            if (end > i + 1 && s[i + 1] !== ' ' && s[end - 1] !== ' ') { flush(); out.push({ type: 'em', children: parseInline(s.slice(i + 1, end), allowLinks) }); i = end + 1; continue; }
        }
        if (c === '[' && allowLinks) {
            const link = matchLink(s, i);
            if (link) { flush(); out.push({ type: 'link', href: link.href, children: parseInline(link.text, false) }); i = link.end; continue; }
        }
        text += c;
        i++;
    }
    flush();
    return out;
}

/** Parse content into blocks. Never throws: unsupported syntax is literal text. Empty or whitespace input gives no blocks. */
export function parseCommentaryMarkdown(content: string): CommentaryBlock[] {
    const blocks: CommentaryBlock[] = [];
    for (const raw of content.replace(/\r\n?/g, '\n').split(/\n[ \t]*\n+/)) {
        const lines = raw.split('\n').filter((l, idx, all) => l.trim() !== '' || (idx > 0 && idx < all.length - 1));
        if (lines.length === 0) continue;
        if (lines.length === 1 && lines[0].startsWith('## ')) {
            blocks.push({ type: 'heading', children: parseInline(lines[0].slice(3).trim()) });
        } else if (lines.every((l) => l.startsWith('>'))) {
            blocks.push({ type: 'quote', children: parseInline(lines.map((l) => l.replace(/^> ?/, '')).join('\n').trim()) });
        } else {
            blocks.push({ type: 'paragraph', children: parseInline(lines.join('\n').trim()) });
        }
    }
    return blocks;
}

/**
 * Every chapter id a verse range touches, in canonical order: the chapters
 * between the endpoints within a book, and across books via the canon's
 * chapter counts. Both refs must be strict OSIS ids of known books with
 * start no later than end; validate first with commentaryEntryProblem.
 */
export function chaptersCovered(startRef: string, endRef: string): string[] {
    const start = parseOsisId(startRef)!;
    const end = parseOsisId(endRef)!;
    const from = BOOKS.findIndex((b) => b.osisId === start.book);
    const to = BOOKS.findIndex((b) => b.osisId === end.book);
    const chapters: string[] = [];
    for (let bi = from; bi <= to; bi++) {
        const book = BOOKS[bi];
        const first = bi === from ? start.chapter : 1;
        const last = bi === to ? end.chapter : book.chapters;
        for (let c = first; c <= last; c++) chapters.push(`${book.osisId}.${c}`);
    }
    return chapters;
}

const nonEmptyString = (v: unknown): v is string => typeof v === 'string' && v.trim() !== '';

/**
 * Why a wire record is not a valid commentary entry, or null when it is.
 * Refs must be strict OSIS verse ids naming a book by its exact OSIS id
 * (not a name or abbreviation, which the user-facing lookup accepts) with
 * a chapter the book has, the start no later than the end, and the content
 * must parse to at least one block. Verse maxima vary by text, so they are
 * checked against the source at import (#85), not here.
 */
export function commentaryEntryProblem(value: unknown): string | null {
    const r = value as Partial<RawCommentaryEntry> | null;
    if (!r || typeof r !== 'object') return 'not an object';
    if (!nonEmptyString(r.id)) return 'missing id';
    for (const key of ['startRef', 'endRef'] as const) {
        const ref = r[key];
        if (!nonEmptyString(ref)) return `${r.id}: missing ${key}`;
        const parsed = parseOsisId(ref);
        if (!parsed) return `${r.id}: ${key} "${ref}" is not a strict OSIS verse id`;
        const book = BOOKS.find((b) => b.osisId === parsed.book);
        if (!book) return `${r.id}: ${key} "${ref}" does not name a book by its OSIS id`;
        if (parsed.chapter < 1 || parsed.chapter > book.chapters) return `${r.id}: ${key} "${ref}" names a chapter ${book.osisId} does not have (1 to ${book.chapters})`;
        if (parsed.verse < 1) return `${r.id}: ${key} "${ref}" names verse 0`;
    }
    if (compareCanonical(parseOsisId(r.startRef!)!, parseOsisId(r.endRef!)!) > 0) return `${r.id}: startRef ${r.startRef} is after endRef ${r.endRef}`;
    if (r.heading !== undefined && !nonEmptyString(r.heading)) return `${r.id}: heading must be non-empty text when present`;
    if (!nonEmptyString(r.content)) return `${r.id}: empty content`;
    if (parseCommentaryMarkdown(r.content).length === 0) return `${r.id}: content has no blocks`;
    return null;
}

/** The stored record for a wire entry of `resourceId`; throws the problem for an invalid one so a bad deploy never seeds. */
export function toCommentaryEntry(raw: RawCommentaryEntry, resourceId: string): CommentaryEntry {
    const problem = commentaryEntryProblem(raw);
    if (problem) throw new Error(`Invalid commentary entry: ${problem}`);
    return {
        id: raw.id,
        resourceId,
        startRef: raw.startRef,
        endRef: raw.endRef,
        ...(raw.heading ? { heading: raw.heading } : {}),
        content: raw.content,
        chapters: chaptersCovered(raw.startRef, raw.endRef),
    };
}
