/**
 * Error-detection oracle for the Catena Aurea import (issue #85).
 *
 * Compares the entries produced from the 1841 scans with the Dominican
 * House of Studies transcription (data/texts/catena/oracle/CA<Gospel>.htm,
 * never redistributed and never copied from): the same lemma blocks should
 * exist with the same excerpts in the same order, and each excerpt's text
 * should match closely. Every disagreement is a candidate OCR error to be
 * resolved against the page image and entered as a correction. The report
 * names the scanned page for each one.
 *
 *   pnpm run verify:catena -- data/processed/_samples/commentary-catena-aurea.sample.json
 */

import fs from 'node:fs';
import path from 'node:path';
import type { RawCommentaryEntry } from '@codex-scriptura/core';
import { sourceLocatorUrl } from '@codex-scriptura/core';
import { dataDir } from './core/paths.js';
import { sha256String } from './core/checksums.js';
import { resolveAuthor } from './importers/catena-aurea.js';

type OracleExcerpt = { author: string; text: string; citation?: string };
type OracleBlock = { chapter: number; verseStart: number; verseEnd: number; excerpts: OracleExcerpt[] };

const GOSPEL_FILE: Record<string, string> = { Matt: 'CAMatthew.htm', Mark: 'CAMark.htm', Luke: 'CALuke.htm', John: 'CAJohn.htm' };

function decodeHtml(s: string): string {
    return s.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#\d+;/g, '').replace(/\uFFFD/g, "'").replace(/\s+/g, ' ').trim();
}

const ROMAN: Record<string, number> = { I: 1, V: 5, X: 10, L: 50 };
const fromRoman = (r: string) => [...r].reduce((t, c, i, a) => t + ((ROMAN[a[i + 1]] ?? 0) > ROMAN[c] ? -ROMAN[c] : ROMAN[c]), 0);

/**
 * The transcription's blocks for one chapter. The files come in two
 * layouts: Matthew's marks chapters "Gospel of Matthew, Chapter N", lemma
 * verses in red spans and authors in blue spans followed by a colon;
 * John's marks chapters with an anchor and "CHAPTER I", lemma verses in
 * #ff0000 spans ("1a. In the beginning") and authors in bold ("<b>CHRYS</b>.").
 */
export function oracleBlocks(html: string, chapter: number): OracleBlock[] {
    // Matthew/Mark: "Gospel of Mark, Chapter 4</span>" (Mark's chapter 4 has broken markup and no closing span);
    // John: a bold "CHAPTER I"
    const heads = [...html.matchAll(/(?:Chapter (\d+)\s*<\/span>|Gospel of \w+, Chapter (\d+)(?!\d)(?!\s*<\/span>)|<span style="font-weight: bold">CHAPTER ([IVXL]+)<\/span>)/g)]
        .map((m) => ({ chapter: m[1] ? Number(m[1]) : m[2] ? Number(m[2]) : fromRoman(m[3]), index: m.index! }));
    const at = heads.findIndex((h) => h.chapter === chapter);
    if (at < 0) return [];
    const section = html.slice(heads[at].index, heads[at + 1]?.index ?? html.length);
    const paras = [...section.matchAll(/<p[^>]*>([\s\S]*?)(?=<p|<hr|$)/g)].map((m) => m[1]);
    const blocks: OracleBlock[] = [];
    let current: OracleBlock | null = null;
    let inLemma = false;
    // The transcription carries the 1841 editor's footnotes inline as "[ed. note: ...]", sometimes over several
    // paragraphs; they are not part of the chain
    let inNote = false;
    for (const p of paras) {
        let text = decodeHtml(p);
        if (inNote) { if (text.includes(']')) inNote = false; continue; }
        if (text.startsWith('[ed. note')) { if (!text.includes(']')) inNote = true; continue; }
        text = text.replace(/\[ed\. note[^\]]*\]/g, '').replace(/\s+/g, ' ').trim();
        if (!text || text.startsWith('[p.') || /^CHAPTER [IVXL]+$/.test(text) || p.includes('color:green')) continue;
        // Mark's layout has no colours: a lemma is a paragraph opening "Ver. 1:" or "3-6.", an author a leading
        // Arial span followed by ":" or ", citation:"
        const plainLemma = !p.includes('color') && /^<span[^>]*>\s*(?:Ver\.\s*)?\d+(?:-\d+)?[a-z]?\s*[.:]/.test(p.trim());
        // A lemma paragraph is red from its start; a scripture quotation set red inside an excerpt is not a lemma
        const redAt = p.search(/<span[^>]*color:\s*(?:red|#ff0000)[^>]*>/);
        const redLemma = redAt >= 0 && p.slice(0, redAt).replace(/<[^>]*>/g, '').trim() === '';
        if (redLemma || plainLemma) {
            // "Ver. 1.", "Ver. 1:", "3-6.", "1a.", or an unnumbered continuation of the previous verse
            // The dash between two verse numbers may reach us as any glyph the transcription's encoding made of it
            const n = /^(?:Ver\.\s*)?(\d+)(?:[^\d\s.:]{1,4}(\d+))?[a-z]?\s*[.:]/.exec(text);
            const from = n ? Number(n[1]) : NaN;
            const to = n ? Number(n[2] ?? n[1]) : NaN;
            if (!inLemma) {
                // An unnumbered opening lemma continues the previous block's verse, or is verse 1 at the chapter's start
                const prev = blocks[blocks.length - 1];
                const start = Number.isNaN(from) ? (prev?.verseEnd ?? 1) : from;
                current = { chapter, verseStart: start, verseEnd: Number.isNaN(to) ? start : to, excerpts: [] };
                blocks.push(current); inLemma = true;
            } else if (current && !Number.isNaN(to)) current.verseEnd = Math.max(current.verseEnd, to);
            continue;
        }
        inLemma = false;
        if (!current) continue;
        // "Chrys</span>.:", "Chrys</span>., Hom. in Matt., 44:", "Bede</span>:" all open an excerpt
        const plainAuthor = !p.includes('color') && /^<span[^>]*>\s*[A-Z][A-Za-z.\- ]{1,40}<\/span>\s*\.?\s*[,:]/.test(p.trim());
        // The transcription leaves some attributions unmarked ("Cassian, Collat. ix, 35: Also we should"): a paragraph
        // opening with a name the edition uses, then a colon, is an excerpt all the same
        const unmarkedName = /^([A-Z][A-Za-z.\- ]{1,30}?)(?:,[^:]{0,80})?:\s/.exec(text)?.[1];
        // "The Council of Ephesus: Herein we must beware": the article is the edition's, the name is the token's
        const unmarkedAuthor = !!unmarkedName && !!resolveAuthor(unmarkedName.trim().replace(/\.$/, '').replace(/^The /, '').toUpperCase());
        if (p.includes('color:blue') || plainAuthor || unmarkedAuthor) {
            // "Aug., de Cons. Evan., ii, 6: Luke describes..." - the reference after the name is kept as a verification signal
            const m = /^([^:]{1,60}?)(?:,\s*([^:]*))?:\s*(.*)$/.exec(text);
            // A blue paragraph with no label before its first colon ("I suppose that in using such language...",
            // "To which Augustine replies 8] But...") is an excerpt whose attribution the transcription dropped:
            // the page decides its author, so it is compared on its text alone (see sameAuthor)
            const label = m?.[1].trim() ?? '';
            const isLabel = !!m && label.split(/\s+/).length <= 4 && !/[[\]\d]/.test(label) && !/\b(?:is|says|replies|adds|answers|which|that|whence|the)\b/i.test(label);
            if (isLabel) current.excerpts.push({ author: label, text: m![3], ...(m![2]?.trim() ? { citation: m![2].trim() } : {}) });
            else current.excerpts.push({ author: '?', text });
        } else if (/<b>[A-Z][A-Za-z.\- ]{2,}<\/b>/.test(p)) {
            // John's layout runs several Fathers inline in one paragraph, each opened by a bold token
            const parts = p.split(/<b>([A-Z][A-Za-z.\- ]{2,})<\/b>[.;:]?/);
            if (parts[0].trim() && current.excerpts.length) current.excerpts[current.excerpts.length - 1].text += ' ' + decodeHtml(parts[0]);
            for (let k = 1; k < parts.length; k += 2) current.excerpts.push({ author: parts[k].trim(), text: decodeHtml(parts[k + 1] ?? '') });
        } else if (current.excerpts.length) {
            current.excerpts[current.excerpts.length - 1].text += ' ' + text;
        }
    }
    // The transcription sometimes runs a Father on inside the paragraph before, with only his label in capitals to show
    // it ("... nine months. GREEK EX. But since ..."): that is an excerpt of its own, and ID. is the last author's
    for (const b of blocks) b.excerpts = b.excerpts.flatMap((x, i, all) => splitInlineLabels(x, all[i - 1]?.author));
    return blocks;
}

const INLINE_LABEL = /(?<=[.;:?!,)\]"'\u201d]\s)((?:PSEUDO-)?[A-Z]{2,}(?:\.? [A-Z]{2,5})?)\.\s(?=[A-Z"'\u201c(\[])/g;

/** An oracle excerpt split at every author label the transcription left inline in capitals. */
export function splitInlineLabels(x: OracleExcerpt, previousAuthor?: string): OracleExcerpt[] {
    const out: OracleExcerpt[] = [];
    let from = 0, author = x.author, last = previousAuthor;
    for (const m of x.text.matchAll(INLINE_LABEL)) {
        const label = m[1];
        const named = label === 'ID' ? (author === '?' ? last : author) : resolveAuthor(label)?.name;
        if (!named) continue;
        out.push({ ...x, author, text: x.text.slice(from, m.index).trim() });
        last = author; author = named; from = m.index! + m[0].length;
    }
    out.push(from ? { author, text: x.text.slice(from).trim() } : x);
    return out.filter((e) => e.text);
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().split(' ').filter(Boolean);

/** Word-level similarity in [0, 1]: length of the longest common subsequence over the longer text. */
export function similarity(a: string, b: string): number {
    return similarityOfWords(norm(a), norm(b));
}

export function similarityOfWords(x: string[], y: string[]): number {
    if (x.length === 0 && y.length === 0) return 1;
    const dp = Array.from({ length: x.length + 1 }, () => new Uint16Array(y.length + 1));
    for (let i = 1; i <= x.length; i++) for (let j = 1; j <= y.length; j++) {
        dp[i][j] = x[i - 1] === y[j - 1] ? dp[i - 1][j - 1] + 1 : Math.max(dp[i - 1][j], dp[i][j - 1]);
    }
    return dp[x.length][y.length] / Math.max(x.length, y.length);
}

/** Words of `ours` that the oracle lacks and vice versa, for a quick look at what the OCR got wrong. */
function wordDiff(a: string[], b: string[]): { extra: string[]; missing: string[] } {
    const bc = new Map<string, number>(); for (const w of b) bc.set(w, (bc.get(w) ?? 0) + 1);
    const ac = new Map<string, number>(); for (const w of a) ac.set(w, (ac.get(w) ?? 0) + 1);
    const extra = a.filter((w) => { const n = bc.get(w) ?? 0; if (n > 0) { bc.set(w, n - 1); return false; } return true; });
    const missing = b.filter((w) => { const n = ac.get(w) ?? 0; if (n > 0) { ac.set(w, n - 1); return false; } return true; });
    return { extra, missing };
}

export type TextReview = 'exact' | 'benign-ocr' | 'lexical';

export type Finding = {
    id: string;
    page: string;
    kind: string;
    detail: string;
    /** Scan item and leaf the finding sits on, for page-by-page review. */
    item?: string;
    leaf?: number;
    /** For text findings: whether the difference is mechanically benign or a real difference in words. */
    review?: TextReview;
};

/**
 * What a reviewed discrepancy binds itself to: the kind, the id and the
 * disagreement itself, so that a later parser change producing a different
 * disagreement under the same id fails the gate again instead of hiding
 * behind an old review.
 */
export function findingFingerprint(f: { kind: string; id: string; detail: string }): string {
    return sha256String(`${f.kind}\n${f.id}\n${f.detail.replace(/\s+/g, ' ').trim()}`).slice(0, 16);
}

/** Where each excerpt of an entry was read, as the importer writes it beside the corpus. */
export type ReviewIndex = Record<string, { item: string; excerptLeaves: number[] }>;

// The transcription modernises Newman's English (ye -> you, hath -> has, shew -> show, honour -> honor); both
// sides are reduced to the modern form so that only a change of word counts as a lexical difference
const MODERN: Record<string, string> = {
    ye: 'you', thou: 'you', thee: 'you', thy: 'your', thine: 'your', thyself: 'yourself', hath: 'has', hast: 'have', doth: 'does', doest: 'do', dost: 'do',
    art: 'are', wast: 'were', wert: 'were', wilt: 'will', shalt: 'shall', canst: 'can', mayest: 'may', wouldest: 'would', shouldest: 'should',
    couldest: 'could', sayest: 'say', saith: 'say', says: 'say', said: 'say', spake: 'spoke', shew: 'show', shews: 'shows', shewed: 'showed',
    shewing: 'showing', shewn: 'shown', unto: 'to', whither: 'where', wherefore: 'why', yea: 'yes', nay: 'no', ere: 'before', hither: 'here',
    fulness: 'fullness', connexion: 'connection', sate: 'sat', yours: 'your', brake: 'broke', bare: 'bore', gat: 'got', spat: 'spit', strowed: 'strewed', strown: 'strewn', whence: 'where', hence: 'here', thence: 'there',
};
// Where the transcription's own reading or modernising slipped, reliably: "tile" for "the", "strewn" for "shewn", "cost" for "dost"
const ORACLE_ERRATA: Record<string, string> = { tile: 'the', strewn: 'shown', strewing: 'showing', strews: 'shows', strew: 'show', cost: 'do' };
// The edition sets these as two words or hyphenated; the transcription as one
const COMPOUNDS = ['only begotten', 'co eternal', 'co equal', 'cock crow', 'seventy two', 'anti christ', 'before hand', 'a loud', 'a new', 'a right', 'be set', 'can not', 'some time', 'mean time', 'a while', 'to day', 'to morrow', 'to night', 'for ever', 'any thing', 'every thing', 'some thing', 'no thing', 'every one', 'any one', 'some one', 'every where', 'any where', 'mean while', 'in most', 'forth with', 'may be', 'a fire', 'with out', 'him self', 'her self', 'them selves', 'it self', 'your selves', 'our selves', 'my self', 'thy self', 'to gether', 'al ready', 'al though', 'al ways', 'in deed', 'in stead', 'where fore', 'there fore', 'not withstanding', 'never theless', 'like wise', 'other wise', 'good will', 'sun rise', 'sun set', 'birth day', 'house hold', 'straight way', 'else where', 'mid night', 'noon day', 'life time', 'day time', 'life giving', 'every body', 'any body', 'no body', 'some body', 'where by', 'where in', 'where of', 'there in', 'there of', 'there by', 'here in', 'here by', 'here after', 'there after', 'after wards', 'to wards', 'up on', 'un to', 'in to', 'with in', 'through out', 'where as', 'here upon', 'there upon', 'where upon', 'over throw', 'over come', 'under stand', 'with draw', 'fore tell', 'fore told', 'fore know', 'ful fil', 'sun day', 'fire brand', 'first born', 'high priest', 'hus band', 'hus bandman'];
/**
 * Reduce a text to the words a reader would take from it, undoing only what
 * OCR and typesetting do without changing a word: case, punctuation and
 * quotes, ligatures and the long s, a word broken over a line, spacing,
 * and, on the oracle side, its page markers and bracketed editorial notes;
 * then the transcription's modernisation, on both sides.
 */
export function canonicalWords(text: string, side: 'ours' | 'oracle'): string[] {
    let t = text;
    if (side === 'oracle') {
        t = t.replace(/\[p\.\s*\d+\]/g, ' ').replace(/\[ed\. note[^\]]*\]/gi, ' ').replace(/\[[^\]]{0,80}\]/g, ' ');
        // A chapter head the transcription's layout let into an excerpt, and its footnote letters set as words
        t = t.replace(/Gospel of \w+,?(?: Chapter \d+)?/g, ' ').replace(/(^|\s)[b-hj-np-z](?=\s|$)/g, '$1');
        // The transcription's markup breaks "daughter", "Cleophas" and "congregation" around an author's abbreviation
        t = t.replace(/(?<=[a-z]) ?aug ?(?=[a-z]{2,})/gi, 'aug').replace(/\bze bede e\b/gi, 'zebedee')
            .replace(/\b(?!(?:the|and|for|but|not|his|her|him|you|all|one|who|has|had|may|can|our|two|now|see|let|yet|nor|own|way|day|man|men|god|son|are|was|its|did|out|how|any|say|thy|thou|to|of|in|is|it|as|at|by|so|no|on|or|if|be|he|we|us|an|my|me|do|up)\b)([a-z]{1,3}) (leo|greg|bede|orig|chrys|hil|remig|raban|cyril|basil|athan|euseb|ambrose) ([a-z]{1,6})\b/gi, '$1$2$3');
    }
    t = t.replace(/\uFB01/g, 'fi').replace(/\uFB02/g, 'fl').replace(/\u00E6/g, 'ae').replace(/\u0153/g, 'oe').replace(/\u017F/g, 's');
    t = t.replace(/(\w)- (\w)/g, '$1$2');
    // The transcription's encoding turned curly apostrophes into three-byte sequences; a possessive is one word either way
    t = t.replace(/(\w)[^\w\s]{1,3}s\b/g, '$1s');
    t = t.replace(/\bi\.\s?e\./gi, 'ie').replace(/\b(believ\w*) on\b/gi, '$1 in');
    t = t.toLowerCase().replace(/[^a-z0-9]+/g, ' ');
    // Modernised first, so that "canst not" meets "cannot" as the compound it is
    t = t.trim().split(' ').filter(Boolean).map((w) => MODERN[w] ?? w).join(' ');
    for (const c of COMPOUNDS) t = t.replace(new RegExp(`\\b${c}\\b`, 'g'), c.replace(' ', ''));
    const words = t.split(' ').filter(Boolean);
    return side === 'oracle' ? words.map((w) => ORACLE_ERRATA[w] ?? w) : words;
}

// British and American spellings (honour, recognised, offence, Judaea) and the doubled l of "travelling" and
// "fulfil", which only a word of some length varies: "al" for "all" and "stil" for "still" are OCR drops
const spelling = (w: string): string => (w.length >= 6 ? w.replace(/ll/g, 'l') : w).replace(/our/g, 'or').replace(/ae/g, 'e').replace(/ence(s?)$/, 'ense$1').replace(/is(e[ds]?|ing|ation)$/, 'iz$1').replace(/^enquir/, 'inquir').replace(/re$/, 'er');

/**
 * Whether two canonical words are the same word in different dress: a
 * spelling variant, or the edition's third person in -eth against the
 * transcription's in -s ("cometh" and "comes"). A change of inflection
 * ("thing" and "things") or of letters ("of" and "off") is a different
 * word, which only the page can decide.
 */
export function sameWord(a: string, b: string): boolean {
    if (a === b) return true;
    const x = spelling(a), y = spelling(b);
    if (x === y) return true;
    const thirdPerson = (eth: string, s: string) => /[a-z]{2,}eth$/.test(eth) && (s === eth.slice(0, -3) + 's' || s === eth.slice(0, -3) + 'es');
    // "gavest" and "gave", "seest" and "see": the transcription drops the second person's ending
    const secondPerson = (est: string, base: string) => /[a-z]{2,}e?st$/.test(est) && (base === est.replace(/e?st$/, '') || base === est.replace(/st$/, ''));
    return thirdPerson(x, y) || thirdPerson(y, x) || secondPerson(x, y) || secondPerson(y, x);
}

/** Classify a text disagreement: the same words after canonicalisation, word for word, is benign; any other difference is lexical and stays open. */
export function classifyText(ours: string, oracle: string): TextReview {
    if (ours === oracle) return 'exact';
    const a = canonicalWords(ours, 'ours');
    const b = canonicalWords(oracle, 'oracle');
    return a.length === b.length && a.every((w, i) => sameWord(w, b[i])) ? 'benign-ocr' : 'lexical';
}

export const STRUCTURAL_KINDS = ['block-boundaries', 'no-oracle-block', 'missing-excerpt', 'extra-excerpt'];
export const IDENTITY_KINDS = ['author', 'citation'];

export type PageGroup = { item: string; leaf: number; url: string; structural: Finding[]; author: Finding[]; citation: Finding[]; text: Finding[]; minSimilarity: number | null };

/**
 * Findings grouped by scan leaf and ordered for review: pages with
 * structural findings first, then by the lowest text similarity on the
 * page, then pages with attribution findings, then citations, then the
 * rest. One page open resolves everything on it.
 */
export function reviewQueue(findings: Finding[]): PageGroup[] {
    const groups = new Map<string, PageGroup>();
    for (const f of findings) {
        if (!f.item || f.leaf === undefined || f.leaf < 0) continue;
        const key = `${f.item}#${f.leaf}`;
        let g = groups.get(key);
        if (!g) { g = { item: f.item, leaf: f.leaf, url: `https://archive.org/details/${f.item}/page/n${f.leaf}`, structural: [], author: [], citation: [], text: [], minSimilarity: null }; groups.set(key, g); }
        if (STRUCTURAL_KINDS.includes(f.kind)) g.structural.push(f);
        else if (f.kind === 'author') g.author.push(f);
        else if (f.kind === 'citation') g.citation.push(f);
        else if (f.kind === 'text') {
            g.text.push(f);
            const s = Number(/similarity ([0-9.]+)/.exec(f.detail)?.[1] ?? '1');
            g.minSimilarity = g.minSimilarity === null ? s : Math.min(g.minSimilarity, s);
        }
    }
    // structural, then pages with a badly wrong excerpt (below 0.8), then attribution, then citations, then the rest by similarity
    const rank = (g: PageGroup): number[] => [g.structural.length ? 0 : 1, g.minSimilarity !== null && g.minSimilarity < 0.8 ? g.minSimilarity : 1, g.author.length ? 0 : 1, g.citation.length ? 0 : 1, g.minSimilarity ?? 2];
    return [...groups.values()].sort((a, b) => { const ra = rank(a), rb = rank(b); for (let i = 0; i < ra.length; i++) if (ra[i] !== rb[i]) return ra[i] - rb[i]; return a.item.localeCompare(b.item) || a.leaf - b.leaf; });
}

/**
 * Align our excerpts with the oracle's in order, so one missed or extra
 * token does not shift every later comparison. Standard sequence
 * alignment: a pair scores by text similarity (with a bonus when the
 * authors agree), a gap costs a little. Returns index pairs with -1 for
 * a gap on either side.
 */
/** Index pairs, with -1 for a gap on either side; a third element counts ours merged before the pair's, a fourth the oracle's paragraphs absorbed after its. */
export function alignExcerpts(ours: OracleExcerpt[], oracle: OracleExcerpt[]): Array<[number, number] | [number, number, number] | [number, number, number, number]> {
    const n = ours.length, m = oracle.length;
    const score = (i: number, j: number) => {
        const s = similarity(ours[i].text, oracle[j].text);
        const sameAuthor = norm(ours[i].author).join(' ').slice(0, 4) === norm(oracle[j].author).join(' ').slice(0, 4);
        return s * 2 - 0.6 + (sameAuthor ? 0.3 : 0);
    };
    // The transcription breaks a long excerpt into paragraphs and labels only the first; the later ones reach us
    // as author '?'. One of ours may absorb the '?' paragraph after the oracle excerpt it matches, scored on the
    // joined text, so that neither half is reported alone
    const merged = (i: number, j: number, k: number) => {
        const s = similarity(ours[i].text, oracle.slice(j, j + k + 1).map((o) => o.text).join(' '));
        const sameAuthor = norm(ours[i].author).join(' ').slice(0, 4) === norm(oracle[j].author).join(' ').slice(0, 4);
        return s * 2 - 0.6 + (sameAuthor ? 0.3 : 0);
    };
    // The reverse: the transcription runs an ID. excerpt on inside the one before, so two of ours under one Father
    // are one of the oracle's, scored on their joined text
    const mergedOurs = (i: number, k: number, j: number) => {
        for (let x = i - k; x < i; x++) if (norm(ours[x].author).join(' ') !== norm(ours[i].author).join(' ')) return -Infinity;
        const s = similarity(ours.slice(i - k, i + 1).map((o) => o.text).join(' '), oracle[j].text);
        const sameAuthor = norm(ours[i].author).join(' ').slice(0, 4) === norm(oracle[j].author).join(' ').slice(0, 4);
        return s * 2 - 0.6 + (sameAuthor ? 0.3 : 0);
    };
    const GAP = -0.25;
    const dp = Array.from({ length: n + 1 }, () => new Float64Array(m + 1));
    const back = Array.from({ length: n + 1 }, () => new Int8Array(m + 1));
    const absorbedAt = Array.from({ length: n + 1 }, () => new Int8Array(m + 1));
    for (let i = 1; i <= n; i++) { dp[i][0] = i * GAP; back[i][0] = 1; }
    for (let j = 1; j <= m; j++) { dp[0][j] = j * GAP; back[0][j] = 2; }
    for (let i = 1; i <= n; i++) for (let j = 1; j <= m; j++) {
        const diag = dp[i - 1][j - 1] + score(i - 1, j - 1);
        const up = dp[i - 1][j] + GAP;
        const left = dp[i][j - 1] + GAP;
        // Up to three unlabelled paragraphs in a row may be absorbed (the Helvidius passage in Matt 27); a labelled
        // one never is, since an author token ours lost must show as a missing excerpt
        let absorb = -Infinity, absorbed = 0;
        for (let k = 1; k <= 3 && j - k >= 1 && oracle[j - k].author === '?'; k++) {
            const v = dp[i - 1][j - k - 1] + merged(i - 1, j - k - 1, k);
            if (v > absorb) { absorb = v; absorbed = k; }
        }
        let absorbOurs = -Infinity, absorbedOurs = 0;
        for (let k = 1; k <= 2 && i - k >= 1; k++) {
            const v = dp[i - k - 1][j - 1] + mergedOurs(i - 1, k, j - 1);
            if (v > absorbOurs) { absorbOurs = v; absorbedOurs = k; }
        }
        if (absorbOurs > diag && absorbOurs > absorb && absorbOurs >= up && absorbOurs >= left) { dp[i][j] = absorbOurs; back[i][j] = 4; absorbedAt[i][j] = absorbedOurs; }
        else if (absorb > diag && absorb >= up && absorb >= left) { dp[i][j] = absorb; back[i][j] = 3; absorbedAt[i][j] = absorbed; }
        else if (diag >= up && diag >= left) { dp[i][j] = diag; back[i][j] = 0; }
        else if (up >= left) { dp[i][j] = up; back[i][j] = 1; }
        else { dp[i][j] = left; back[i][j] = 2; }
    }
    const pairs: Array<[number, number] | [number, number, number] | [number, number, number, number]> = [];
    let i = n, j = m;
    while (i > 0 || j > 0) {
        const b = i === 0 ? 2 : j === 0 ? 1 : back[i][j];
        if (b === 0) { pairs.push([i - 1, j - 1]); i--; j--; }
        else if (b === 3) { const k = absorbedAt[i][j]; pairs.push([i - 1, j - k - 1, 0, k]); i--; j -= k + 1; }
        else if (b === 4) { const k = absorbedAt[i][j]; pairs.push([i - 1, j - 1, k]); i -= k + 1; j--; }
        else if (b === 1) { pairs.push([i - 1, -1]); i--; }
        else { pairs.push([-1, j - 1]); j--; }
    }
    return pairs.reverse();
}

/** Our excerpts as (author, citation, text) read back from the Markdown we emit. */
function ourExcerpts(entry: RawCommentaryEntry): OracleExcerpt[] {
    return entry.content.split('\n\n').filter((p) => p.startsWith('**')).map((p) => {
        const m = /^\*\*(.+?)\.\*\*(?: \(\*(.*?)\*\))? (.*)$/s.exec(p);
        return { author: m ? m[1] : '?', text: m ? m[3] : p, ...(m?.[2] ? { citation: m[2].replace(/\\(.)/g, '$1') } : {}) };
    });
}

/**
 * Whether two author labels name the same Father. The oracle abbreviates
 * ("Pseudo-Chrys.", "Gloss. interlin.", "Aug. Serm."); ours is the
 * display name. Both are reduced through the same token table, so the
 * comparison is on identity, not spelling.
 */
export function sameAuthor(ours: string, oracle: string): boolean {
    if (oracle === '?') return true;
    // The whole label first ("GREG. NYSS", "ISIDORE PELEUS", "Pseudo-Chrys."), then its first word
    const whole = oracle.replace(/[,;].*$/, '').replace(/\.$/, '').replace(/^The /, '').trim().toUpperCase();
    const head = oracle.replace(/[.,;].*$/, '').replace(/^The /, '').trim();
    const resolved = resolveAuthor(whole)?.name ?? resolveAuthor(head.toUpperCase() + '.')?.name ?? resolveAuthor(head.toUpperCase())?.name;
    const target = resolved ?? head;
    // The edition prints a bare ISIDORE for both Isidores; the transcription names the one it means
    if (ours === 'Isidore' && /^isidore/.test(norm(target).join(' '))) return true;
    return norm(ours).join(' ') === norm(target).join(' ');
}

/** Citations are compared loosely: the same author-work-place tokens in any spelling, ignoring punctuation and case. */
export function citationAgrees(ours: string | undefined, oracle: string | undefined): boolean | null {
    if (!oracle) return null;
    if (!ours) return false;
    const a = new Set(norm(ours).filter((w) => w.length > 1));
    const b = norm(oracle).filter((w) => w.length > 1);
    if (b.length === 0) return null;
    const hit = b.filter((w) => a.has(w)).length;
    if (hit / b.length >= 0.5) return true;
    // The two set spaces and line-end hyphens differently ("nonocc." / "non occ.", "Chryso- logus" / "Chrys ologus"):
    // the transcription's letters read unbroken inside ours are the same reference
    const compact = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (compact(oracle).length >= 5 && compact(ours).includes(compact(oracle))) return true;
    // The transcription expands and modernises the references ("City of God, book xx, ch. 5" for "Civ. Dei xx. 5"):
    // the numbers, in either numeral, are what the two must share
    const na = citationNumbers(ours), nb = citationNumbers(oracle);
    return nb.size > 0 && [...nb].filter((n) => na.has(n)).length / nb.size >= 0.5;
}

const ROMAN_DIGIT: Record<string, number> = { i: 1, v: 5, x: 10, l: 50, c: 100, d: 500, m: 1000 };
function citationNumbers(s: string): Set<number> {
    const out = new Set<number>();
    for (const m of s.toLowerCase().matchAll(/(?<![a-z])([ivxlcdm]{1,7})(?![a-z])/g)) {
        let t = 0; const r = m[1];
        for (let i = 0; i < r.length; i++) { const v = ROMAN_DIGIT[r[i]]; if (i + 1 < r.length && ROMAN_DIGIT[r[i + 1]] > v) t -= v; else t += v; }
        if (t > 0) out.add(t);
    }
    for (const m of s.matchAll(/\d+/g)) out.add(Number(m[0]));
    return out;
}

export function verify(entries: RawCommentaryEntry[], oracleDir: string, review: ReviewIndex = {}): { findings: Finding[]; summary: Record<string, unknown> } {
    const findings: Finding[] = [];
    let compared = 0, close = 0, benign = 0, lexical = 0;
    const where = (e: RawCommentaryEntry, excerpt?: number) => ({
        ...(e.source ? { item: e.source.item, leaf: excerpt !== undefined ? (review[e.id]?.excerptLeaves[excerpt] ?? e.source.leafStart) : e.source.leafStart } : {}),
    });
    const byGospel = new Map<string, RawCommentaryEntry[]>();
    for (const e of entries) { const g = e.startRef.split('.')[0]; byGospel.set(g, [...(byGospel.get(g) ?? []), e]); }
    for (const [gospel, ours] of byGospel) {
        const html = fs.readFileSync(path.join(oracleDir, GOSPEL_FILE[gospel]), 'latin1');
        const chapters = new Set(ours.map((e) => Number(e.startRef.split('.')[1])));
        for (const ch of chapters) {
            const oracle = oracleBlocks(html, ch);
            // Where the edition numbers both halves of a split verse (John 1:14 twice), ours are two entries and the
            // transcription one block or two; both sides are compared as one range
            const raw = ours.filter((e) => Number(e.startRef.split('.')[1]) === ch);
            const mine: RawCommentaryEntry[] = [];
            for (const e of raw) {
                const last = mine[mine.length - 1];
                if (last && last.startRef === e.startRef && last.endRef === e.endRef) mine[mine.length - 1] = { ...last, content: `${last.content}\n\n${e.content}` };
                else mine.push(e);
            }
            const oracleRanges = oracle.map((b) => `${b.verseStart}-${b.verseEnd}`).filter((r, i, all) => i === 0 || all[i - 1] !== r);
            const mineRanges = mine.map((e) => `${e.startRef.split('.')[2]}-${e.endRef.split('.')[2]}`);
            if (oracleRanges.join(' ') !== mineRanges.join(' ')) {
                const first = mine[0];
                findings.push({ id: `${gospel}.${ch}`, page: '', kind: 'block-boundaries', detail: `ours ${mineRanges.join(' ')} | oracle ${oracleRanges.join(' ')}`, ...(first ? where(first) : {}) });
            }
            // The transcription sometimes splits one verse range over consecutive blocks; ours keep such a range in
            // one entry, so the oracle's consecutive same-range blocks are merged before pairing
            const merged: OracleBlock[] = [];
            for (const b of oracle) {
                const last = merged[merged.length - 1];
                if (last && last.verseStart === b.verseStart && last.verseEnd === b.verseEnd) last.excerpts.push(...b.excerpts);
                else merged.push({ ...b, excerpts: [...b.excerpts] });
            }
            const pending = new Map<string, OracleBlock[]>();
            for (const b of merged) { const k = `${b.verseStart}-${b.verseEnd}`; pending.set(k, [...(pending.get(k) ?? []), b]); }
            for (const e of mine) {
                const range = `${e.startRef.split('.')[2]}-${e.endRef.split('.')[2]}`;
                const ob = pending.get(range)?.shift();
                const page = e.source ? `${sourceLocatorUrl(e.source)} (p. ${e.source.pageStart ?? '?'}-${e.source.pageEnd ?? '?'})` : '';
                if (!ob) { findings.push({ id: e.id, page, kind: 'no-oracle-block', detail: '', ...where(e) }); continue; }
                const oe = ourExcerpts(e);
                const pairs = alignExcerpts(oe, ob.excerpts);
                for (const [last, j, merged = 0, absorbed = 0] of pairs) {
                    if (last < 0) { findings.push({ id: `${e.id}#oracle${j + 1}`, page, kind: 'missing-excerpt', detail: `oracle has ${ob.excerpts[j].author}: ${ob.excerpts[j].text.slice(0, 90)}`, ...where(e) }); continue; }
                    if (j < 0) { findings.push({ id: `${e.id}#${last + 1}`, page, kind: 'extra-excerpt', detail: `ours has ${oe[last].author}: ${oe[last].text.slice(0, 90)}`, ...where(e, last) }); continue; }
                    // Two of ours the transcription ran together are compared as one, under the first's number; and the
                    // paragraphs the transcription split off an excerpt are compared as part of it
                    const i = last - merged;
                    const mine = merged ? { ...oe[i], text: oe.slice(i, last + 1).map((x) => x.text).join(' ') } : oe[i];
                    const theirs = absorbed ? { ...ob.excerpts[j], text: ob.excerpts.slice(j, j + absorbed + 1).map((x) => x.text).join(' ') } : ob.excerpts[j];
                    compared++;
                    // Attribution is checked on its own: a perfect text under the wrong Father is the worse error
                    if (!sameAuthor(oe[i].author, theirs.author)) {
                        findings.push({ id: `${e.id}#${i + 1}`, page, kind: 'author', detail: `ours ${oe[i].author} | oracle ${theirs.author}`, ...where(e, i) });
                    }
                    const cite = citationAgrees(oe[i].citation, theirs.citation);
                    if (cite === false) findings.push({ id: `${e.id}#${i + 1}`, page, kind: 'citation', detail: `ours ${oe[i].citation ?? '(none)'} | oracle ${theirs.citation}`, ...where(e, i) });
                    const kind = classifyText(mine.text, theirs.text);
                    if (kind === 'exact') { close++; continue; }
                    if (kind === 'benign-ocr') { benign++; continue; }
                    lexical++;
                    // Measured on the canonical words, so the transcription's markers and modernised forms do not count against ours
                    const a = canonicalWords(mine.text, 'ours'), b = canonicalWords(theirs.text, 'oracle');
                    const s = similarityOfWords(a, b);
                    const d = wordDiff(a, b);
                    findings.push({ id: `${e.id}#${i + 1}`, page, kind: 'text', review: kind, detail: `${oe[i].author} vs ${theirs.author}: similarity ${s.toFixed(3)}; extra [${d.extra.slice(0, 12).join(' ')}] missing [${d.missing.slice(0, 12).join(' ')}]`, ...where(e, i) });
                }
            }
        }
    }
    return { findings, summary: { entries: entries.length, excerptsCompared: compared, exact: close, benignOcr: benign, lexical, findings: findings.length } };
}

if (process.argv[1] && process.argv[1].endsWith('verify-catena-oracle.ts')) {
    const file = process.argv[2] ?? path.join(dataDir, 'processed', 'commentary-catena-aurea.json');
    const entries = JSON.parse(fs.readFileSync(file, 'utf-8')) as RawCommentaryEntry[];
    const indexFile = file.replace(/\.json$/, '.review-index.json');
    const review = fs.existsSync(indexFile) ? (JSON.parse(fs.readFileSync(indexFile, 'utf-8')) as ReviewIndex) : {};
    const { findings, summary } = verify(entries, path.join(dataDir, 'texts', 'catena', 'oracle'), review);
    const out = file.replace(/\.json$/, '.oracle-report.json');
    fs.writeFileSync(out, JSON.stringify({ summary, findings }, null, 2), 'utf-8');
    const queue = reviewQueue(findings);
    fs.writeFileSync(file.replace(/\.json$/, '.review-queue.json'), JSON.stringify(queue, null, 1), 'utf-8');
    console.log('[catena-oracle]', JSON.stringify(summary), `| ${queue.length} pages to review`);
    for (const g of queue.slice(0, 15)) console.log(`  ${g.item.padEnd(28)} leaf ${String(g.leaf).padEnd(4)} structural ${String(g.structural.length).padEnd(3)} text ${String(g.text.length).padEnd(3)} (min ${g.minSimilarity?.toFixed(2) ?? '-'}) author ${String(g.author.length).padEnd(3)} citation ${g.citation.length}`);
    if (queue.length > 15) console.log(`  ... ${queue.length - 15} more pages in the review queue`);
}
