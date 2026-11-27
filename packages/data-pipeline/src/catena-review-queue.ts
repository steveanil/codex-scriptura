/**
 * The page-first review queue for the Catena Aurea corpus (issue #85): which pages to read on the image next.
 *
 * Nothing here is recorded anywhere. A page's state is worked out each time from the OCR documents, the line
 * corrections and the reader's log, so it cannot drift from them:
 *
 *   an unreadable line   a column-wide line the recogniser scored under UNREADABLE_SCORE: text that is on the page
 *                        and not in the corpus. It is corrected once a line correction replaces that reading in
 *                        the reader's line there, or, where the reader made no line of it, once a correction on the
 *                        leaf names it as the line it restores. Nothing is inferred from how much text was added.
 *   a footnote line      an unreadable line of a printed footnote. The import leaves footnotes out by design, so
 *                        this is not missing commentary. It is taken out of the count only where the reader itself
 *                        put the line among the page's footnotes and a record read from the page image names that
 *                        line, by its y and its reading. Anything else stays open.
 *   an open suggestion   a change the reader proposed and no verified record has settled.
 *   an open question     an unresolved question recorded against the leaf (a source-fidelity defect, a doubtful
 *                        attribution): the page is not done while it stands, whatever else is settled.
 *
 * A page review (catena-aurea.page-reviews.json) says a person or a model read a page on its image, whole or by
 * strips. It is a record of its own: it never makes a page done, and a done page is not thereby a reviewed one.
 *
 * Pages are ordered by open unreadable lines, then by open suggestions on scripture text or at an author token,
 * then by the other open suggestions, and last by the low-priority ones. Three things were learnt from a sample
 * read on the page images (benchmark/catena/README.md) and shape the counts, none of them settling anything:
 *
 *   a dictionary-cut-frequency suggestion is seldom a lost space; it flags a word to look at, so it is low priority;
 *   an italic-frequency suggestion on the word "wilt" is nearly always a sound word, so it is low priority;
 *   one-as-I-by-pair and lone-digit make opposite proposals about the same character, so the two are one thing to
 *   read and are counted once, each keeping its own id, rule and verdict.
 */
import type { LineCorrection } from './importers/catena-aurea.js';
import type { RapidOcrPage } from './importers/rapidocr-json.js';
import type { Transform } from './importers/transform-log.js';

export const UNREADABLE_SCORE = 0.7;
/** A line is column-wide from this share of the rendered page's width. */
const COLUMN_SHARE = 0.45;
/** A box this many times the page's usual line height is a figure or a blank, not a line. */
const TALLEST_LINE = 2.2;
/** Rules that decide where an excerpt starts and whose it is. */
const AT_AUTHOR_TOKEN = new Set(['margin-tail-before-token', 'mark-before-token', 'stroke-before-token', 'In-as-ID', 'digit-before-name', 'I-before-capital']);

export type ReaderLine = { y: number; main: string };
export type LineState = 'open' | 'unread' | 'corrected' | 'footnote';
/** A line of a printed footnote, confirmed on the page image: the leaf, the line's y and its reading as the OCR document has it. */
export type FootnoteLine = { item: string; leaf: number; y: number; reading: string; reviewed: string; note: string; issue?: number };
/** What a reading covered: the whole page, strips of it, or its margin notes only (the running text not verified). */
export type ReviewScope = 'whole page' | 'strips' | 'margin citations';
/** One reading of one page on its image. `corrections` and `verdicts` point at records kept elsewhere; nothing here changes text. */
export type PageReview = {
    item: string; leaf: number; scope: ReviewScope; reviewer: string; reviewed: string;
    /** Set to 'human' when a person read the page; any review without it is taken as an AI model's. */
    reviewerKind?: 'ai' | 'human';
    /** The page image read: the scan bundle, its accepted checksum, and the image's name in it. */
    image: { bundle: string; sha256: string; file: string };
    /** The OCR document the corpus was built from, and the commit the import ran at. */
    ocr: { document: string; sha256: string };
    revision: string;
    corrections: ({ kind: 'line'; find: string } | { kind: 'citation'; chapter: number; verseStart: number; verseEnd: number; excerpt: number })[];
    verdicts: string[];
    questions: string[];
    outcome: string;
    blockers: string[];
};
export type QueueLine = { y: number; y1: number; y2: number; score: number; text: string; state: LineState };
/** `questions` counts the open questions recorded against the leaf (catena-aurea.questions.json): while one stands the page is not done. */
/** `margin` says a reading of the margin notes alone is recorded for the leaf, whatever else was read there. */
/** `weighty`, `other` and `low` count what is left to read: a pair of opposite suggestions on one character counts once. */
export type QueuePage = { item: string; leaf: number; lines: QueueLine[]; suggestions: { weighty: number; other: number; low: number; settled: number }; questions?: number; review?: ReviewScope; margin?: boolean };
export type PageStatus = 'open' | 'partial' | 'done';

const median = (xs: number[]): number => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] ?? 0;

/** The page's unreadable lines as the recogniser saved them, top to bottom. */
export function unreadableLines(page: RapidOcrPage): { y1: number; y2: number; score: number; text: string }[] {
    const usual = median(page.lines.map((l) => l.y2 - l.y1));
    return page.lines
        .filter((l) => l.score < UNREADABLE_SCORE && l.x2 - l.x1 > COLUMN_SHARE * page.rendered_width && l.y2 - l.y1 <= TALLEST_LINE * usual)
        .map((l) => ({ y1: l.y1, y2: l.y2, score: l.score, text: l.text.trim() }))
        .sort((a, b) => a.y1 - b.y1 || a.text.localeCompare(b.text));
}

/** Whether a line correction applies to this line as the reader reads it, by the importer's own rule. */
export function appliesTo(c: LineCorrection, line: ReaderLine): boolean {
    const main = line.main.trim();
    return c.y !== undefined ? c.y === line.y && main === c.find : main.includes(c.find);
}

const letters = (s: string): string => s.replace(/\s+/g, '');

/**
 * Whether a correction that applies to the reader's line replaces the unreadable reading in it, and not some
 * other part of the line: its find is that reading, holds it whole, or is the greater part of it (the rest having
 * gone to the margin). The recogniser's spacing differs from the reader's, so letters alone are compared.
 */
export function replacesReading(c: LineCorrection, reading: string): boolean {
    const find = letters(c.find), read = letters(reading);
    if (!read) return false;
    return find.includes(read) || (read.includes(find) && 2 * find.length >= read.length);
}

/**
 * Each unreadable line with its state. `lines` are the reader's lines of the leaf before any correction, top to
 * bottom, with y in scan pixels; `scale` turns the OCR document's rendered pixels into them. `footnotes` are the
 * lines the reader put among the page's footnotes, and `confirmed` the footnote lines read on the page image.
 */
export function lineStates(page: RapidOcrPage, lines: ReaderLine[], corrections: LineCorrection[], footnotes: ReaderLine[] = [], confirmed: Pick<FootnoteLine, 'y' | 'reading'>[] = []): QueueLine[] {
    const scale = page.width / page.rendered_width;
    return unreadableLines(page).map((u) => {
        const y = Math.round(u.y1 * scale);
        // The reader's line is at the OCR line's own y, or within half its height when a part read apart leads it
        const at = lines.find((l) => l.y === y) ?? lines.filter((l) => Math.abs(l.y - y) <= ((u.y2 - u.y1) * scale) / 2).sort((a, b) => Math.abs(a.y - y) - Math.abs(b.y - y))[0];
        // The reader may have settled a word of the reading on its own, so a correction of its whole line counts as well
        if (at) return { ...u, y, state: corrections.some((c) => appliesTo(c, at) && (c.find === at.main.trim() || replacesReading(c, u.text))) ? 'corrected' as const : 'open' as const };
        if (corrections.some((c) => c.restores === y)) return { ...u, y, state: 'corrected' as const };
        // A footnote line: the reader filed a line there under the footnotes, and the page image confirmed this very line
        const filed = footnotes.some((l) => Math.abs(l.y - y) <= ((u.y2 - u.y1) * scale) / 2);
        return { ...u, y, state: filed && confirmed.some((c) => c.y === y && c.reading === u.text) ? 'footnote' as const : 'unread' as const };
    });
}

export const isWeighty = (t: Transform): boolean => t.rule.startsWith('lemma:') || (t.span ?? '').includes('@lemma') || AT_AUTHOR_TOKEN.has(t.rule);

/** A flag for a word to look at more than a proposal to act on: a sampled rule that is seldom right. */
export const isLowPriority = (t: Transform): boolean => t.rule === 'dictionary-cut-frequency' || (t.rule === 'italic-frequency' && /^wilt[.,;:?!]*$/.test(t.from));

/** The two rules that read a lone 1 opposite ways: as the word I, or as a stray mark. */
const ONE_PAIR = new Set(['one-as-I-by-pair', 'lone-digit']);

/**
 * Open suggestions as things to read. The two readings of one lone 1 (same scan, leaf and span, one from each
 * rule) come as one group of two; every other suggestion is a group of its own. Order follows the log.
 */
export function suggestionGroups(transforms: Transform[]): Transform[][] {
    const open = transforms.filter((t) => !t.applied && !t.verified);
    const groups: Transform[][] = [];
    const pairs = new Map<string, Transform[]>();
    for (const t of open) {
        const key = ONE_PAIR.has(t.rule) && t.span ? `${t.item}#${t.leaf}#${t.span}` : undefined;
        const group = key ? pairs.get(key) : undefined;
        if (group && group.length === 1 && group[0].rule !== t.rule) { group.push(t); continue; }
        const made = [t];
        groups.push(made);
        if (key && !group) pairs.set(key, made);
    }
    return groups;
}

/** A page's suggestions from the reader's log: what is left to read by weight, and those a verified record has settled. */
export function suggestionCounts(transforms: Transform[]): QueuePage['suggestions'] {
    const counts = { weighty: 0, other: 0, low: 0, settled: transforms.filter((t) => t.verified).length };
    for (const group of suggestionGroups(transforms)) {
        if (group.some(isWeighty)) counts.weighty++;
        else if (group.every(isLowPriority)) counts.low++;
        else counts.other++;
    }
    return counts;
}

const isOpen = (l: QueueLine): boolean => l.state === 'open' || l.state === 'unread';
const openLines = (p: QueuePage): number => p.lines.filter(isOpen).length;
const openSuggestions = (p: QueuePage): number => p.suggestions.weighty + p.suggestions.other + p.suggestions.low;

/** done: nothing left to read; partial: some of it settled; open: none of it. */
export function pageStatus(p: QueuePage): PageStatus {
    const left = openLines(p) + openSuggestions(p);
    if (left === 0 && !p.questions) return 'done';
    // A page with nothing left but a question is read, and still not verified
    return left === 0 || p.lines.some((l) => l.state === 'corrected') || p.suggestions.settled > 0 ? 'partial' : 'open';
}

/** The pages still to read, first to last: unreadable lines, then weighty suggestions, then the rest; ties by scan and leaf. */
export function rankPages(pages: QueuePage[]): QueuePage[] {
    return pages
        .filter((p) => pageStatus(p) !== 'done')
        .sort((a, b) => openLines(b) - openLines(a) || b.suggestions.weighty - a.suggestions.weighty || b.suggestions.other - a.suggestions.other || b.suggestions.low - a.suggestions.low || a.item.localeCompare(b.item) || a.leaf - b.leaf);
}

/**
 * Progress on unreadable commentary: how many pages have such a line, and how many still have one uncorrected.
 * Confirmed footnote lines are counted apart; they are neither commentary nor corrected.
 */
export function unreadableProgress(pages: QueuePage[]): { pages: number; pagesOpen: number; lines: number; linesOpen: number; linesUnread: number; footnoteLines: number } {
    const commentary = (p: QueuePage) => p.lines.filter((l) => l.state !== 'footnote');
    const withLines = pages.filter((p) => commentary(p).length > 0);
    const all = withLines.flatMap(commentary);
    return { pages: withLines.length, pagesOpen: withLines.filter((p) => openLines(p) > 0).length, lines: all.length, linesOpen: all.filter(isOpen).length, linesUnread: all.filter((l) => l.state === 'unread').length, footnoteLines: pages.flatMap((p) => p.lines).filter((l) => l.state === 'footnote').length };
}

const DATE = /^\d{4}-\d{2}-\d{2}$/, SHA = /^[0-9a-f]{64}$/;

/** Refuses a review log that leaves out what a review must say. */
export function checkPageReviews(reviews: PageReview[]): PageReview[] {
    for (const r of reviews) {
        const where = `[catena] page review of ${r.item} ${r.leaf}`;
        if (!r.item || !Number.isInteger(r.leaf)) throw new Error(`${where}: names no scan and leaf`);
        if (r.scope !== 'whole page' && r.scope !== 'strips' && r.scope !== 'margin citations') throw new Error(`${where}: scope is "whole page", "strips" or "margin citations", not "${r.scope}"`);
        if (!r.reviewer?.trim() || !DATE.test(r.reviewed ?? '')) throw new Error(`${where}: names no reviewer and date`);
        if (!r.image?.bundle || !SHA.test(r.image?.sha256 ?? '') || !r.image?.file) throw new Error(`${where}: does not identify the page image it was read from`);
        if (!r.ocr?.document || !SHA.test(r.ocr?.sha256 ?? '') || !/^[0-9a-f]{7,40}$/.test(r.revision ?? '')) throw new Error(`${where}: does not identify the OCR document and the import's revision`);
        if (!Array.isArray(r.corrections) || !Array.isArray(r.verdicts) || !Array.isArray(r.questions) || !Array.isArray(r.blockers)) throw new Error(`${where}: lists its corrections, verdicts, questions and blockers, empty where there are none`);
        if (!r.outcome?.trim()) throw new Error(`${where}: states no outcome`);
    }
    return reviews;
}

/** How a page's text has been read: whole if any review of it was of the whole page, by strips if one was, else not at all. A reading of the margin notes alone says nothing of the text, and is the answer only when it is all there is. */
export function reviewScope(reviews: PageReview[], item: string, leaf: number): ReviewScope | undefined {
    const of = reviews.filter((r) => r.item === item && r.leaf === leaf);
    return of.some((r) => r.scope === 'whole page') ? 'whole page' : of.some((r) => r.scope === 'strips') ? 'strips' : of.length ? 'margin citations' : undefined;
}

/** Whether a margin-notes reading is recorded for the leaf, apart from any reading of its text. */
export function marginRead(reviews: PageReview[], item: string, leaf: number): boolean {
    return reviews.some((r) => r.item === item && r.leaf === leaf && r.scope === 'margin citations');
}

/** Whether the OCR queue ever held anything for the page: an unreadable line, a suggestion open or settled, or an open question. A review record alone does not put a page in the queue. */
export function everQueued(p: QueuePage): boolean {
    return p.lines.length > 0 || !!p.questions || openSuggestions(p) + p.suggestions.settled > 0;
}

/** Queue clearance and review side by side; neither is worked out from the other. Done counts queue pages only; the review counts take every page. */
export function reviewCoverage(pages: QueuePage[]): { whole: number; strips: number; margin: number; marginOnly: number; done: number; doneWhole: number; doneStrips: number; doneUnrecorded: number; wholeNotDone: number } {
    const done = pages.filter((p) => everQueued(p) && pageStatus(p) === 'done');
    const whole = pages.filter((p) => p.review === 'whole page');
    return {
        whole: whole.length, strips: pages.filter((p) => p.review === 'strips').length, margin: pages.filter((p) => p.margin).length, marginOnly: pages.filter((p) => p.review === 'margin citations').length, done: done.length,
        doneWhole: done.filter((p) => p.review === 'whole page').length, doneStrips: done.filter((p) => p.review === 'strips').length,
        doneUnrecorded: done.filter((p) => !p.review || p.review === 'margin citations').length, wholeNotDone: whole.filter((p) => everQueued(p) && pageStatus(p) !== 'done').length,
    };
}
