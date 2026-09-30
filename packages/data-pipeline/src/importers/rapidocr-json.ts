/**
 * Reader for the OCR the pipeline produces itself (issue #85): the JSON
 * that ocr/rapidocr_pages.py writes from a scan's checksum-accepted JP2
 * bundle. It yields the same OcrPage shape as the Archive's djvu XML, so
 * nothing downstream (parser, corrections, locators, oracle) knows which
 * engine read the page.
 *
 * The recogniser gives each detected line its text and its characters
 * with horizontal spans; the spans are the recogniser's own estimate and
 * run nearly evenly across the line, so words are cut where it wrote a
 * space, where a span gap shows a space it dropped, and at the printed
 * column's edges, where a margin citation set close to the text is
 * detected as part of its line ("The FatherAug. De"). Everything is scaled
 * to the scan's own pixels, so the parser's geometry (column edges, lemma
 * indent, type height) means the same for every scan. Lines that share a
 * vertical band (a margin note beside its line) are joined into one line,
 * left to right, and the page reader's column classification tells the
 * margin apart as it does for djvu.
 */

import { classifyColumns, type OcrPage, type OcrLine, type OcrWord } from './djvu-xml.js';
import type { Note, TransformLog } from './transform-log.js';

export const RAPIDOCR_FORMAT = 'rapidocr-pages/2';

/** A recognised character and its horizontal span in rendered pixels; a space is a span at its position. */
export type RapidOcrChar = [string, number, number];
/** `pass` names the recovery pass that found a line the page pass dropped ("gap:native-low"); absent for the page pass. */
export type RapidOcrLine = { x1: number; y1: number; x2: number; y2: number; score: number; text: string; chars: RapidOcrChar[]; pass?: string };
export type RapidOcrPage = { leaf: number; width: number; height: number; rendered_width: number; rendered_height: number; lines: RapidOcrLine[] };
export type RapidOcrDocument = {
    format: string;
    item: string;
    /** The JP2 bundle the pages were rendered from, and its checksum. */
    source: { file: string; sha256: string };
    engine: Record<string, string>;
    models: Record<string, string>;
    config: Record<string, unknown>;
    pages: RapidOcrPage[];
};

/** Why a document cannot be read for `item` against the accepted bundle checksum, or null. */
export function rapidOcrProblem(doc: RapidOcrDocument, item: string, acceptedSha256: string | undefined): string | null {
    if (doc.format !== RAPIDOCR_FORMAT) return `format ${doc.format}, expected ${RAPIDOCR_FORMAT}`;
    if (doc.item !== item) return `document is for ${doc.item}, not ${item}`;
    if (!acceptedSha256) return `no accepted checksum for the ${item} bundle`;
    if (doc.source.sha256 !== acceptedSha256) return `generated from bundle ${doc.source.sha256.slice(0, 12)}, but the accepted bundle is ${acceptedSha256.slice(0, 12)}: run ocr:catena`;
    if (!Array.isArray(doc.pages) || doc.pages.length === 0) return 'no pages';
    return null;
}

// A gap this many character widths wide is a space the recogniser dropped; its spans are nearly uniform, so
// only a real blank shows as one. Letter-spaced small capitals are never cut. After punctuation the print's
// space is narrower and a dropped one commoner ("RABAN.Yet").
const GAP = 1.2;
const GAP_AFTER_PUNCTUATION = 0.5;
const PUNCTUATION = /[.,;:!?]/;
const UPPER = /^[A-Z]$/;

type Span = { text: string; x1: number; x2: number; chars: RapidOcrChar[]; margin?: boolean; /** What an edge cut left inside the column. */ cut?: boolean };

// The recogniser's models are Chinese-first and sometimes give full-width punctuation ("AMBROSE；Our")
const FULL_WIDTH: Record<string, string> = { '；': ';', '，': ',', '．': '.', '：': ':', '！': '!', '？': '?', '（': '(', '）': ')', '\u3000': ' ', '~': '' };
const narrow = (c: string): string => FULL_WIDTH[c] ?? c;

/**
 * Words the edition uses, counted from the pipeline's own reading of every
 * part, for restoring the spaces this recogniser drops inside a line
 * ("receiveit", "andrequiringofthem"): a word the edition never uses that
 * is two or three words it does use is cut there, where the characters
 * show the gap. Counted raw, the reading holds the glued forms themselves,
 * so the count is settled first (settleVocabulary). The vocabulary comes
 * from checksum-accepted inputs, so the result is as reproducible as the
 * rest.
 */
export type Vocabulary = Map<string, number>;

/**
 * English words known from outside the scan: the pipeline's pinned Bible
 * texts. The vocabulary counts only what the recogniser read, so a rare
 * word it read correctly ("wilt", "tittle", "island") looks like a
 * misreading of a commoner one. A repair, cut or join that would change a
 * word this lexicon knows is withheld and logged for review, never made.
 */
export type Lexicon = ReadonlySet<string>;

const bare = (w: string) => w.toLowerCase().replace(/^[^a-z]+|[^a-z]+$/g, '');

/**
 * The words the edition uses, and beside them the pairs it prints side by
 * side ("of the", keyed with a space): a dropped space leaves a pair the
 * edition prints often, a real word's parts hardly ever stand together.
 */
export function vocabularyOf(pages: OcrPage[]): Vocabulary {
    const v: Vocabulary = new Map();
    for (const p of pages) for (const l of p.lines) {
        let prev = '';
        for (const w of l.words) {
            const k = bare(w.text);
            if (k.length >= 1) v.set(k, (v.get(k) ?? 0) + 1);
            if (prev && k) v.set(`${prev} ${k}`, (v.get(`${prev} ${k}`) ?? 0) + 1);
            prev = k;
        }
    }
    return v;
}

const KNOWN = 5;
const MIN_PART = 2;
// Pieces the OCR of the other engine makes frequent (hyphenation fragments, inflections) but that are no word
// on their own: never a part, or "householder" comes out as "household er"
const AFFIXES = new Set(['er', 'ers', 'ing', 'ings', 'eth', 'ed', 'ness', 'ly', 'en', 'ty', 'es', 'est', 'ous', 'ment', 'ments', 'dis', 'un', 're', 'im', 'ab', 'ad', 'pro', 'de', 'ir', 'al', 'st', 'ch', 'con', 'ate', 'ful', 'fully', 'less', 'ic', 'ish', 'ism', 'ist', 'ise', 'ize', 'ent', 'ant', 'ance', 'ence', 'tion', 'sion', 'ity', 'ties', 'ive', 'ure', 'ard', 'ter', 'ter', 'ary', 'ory', 'ial', 'ual', 'ible', 'able', 'fed', 'red', 'ned', 'ted', 'sed', 'led', 'ded', 'ged', 'ked', 'ped', 'ved', 'zed', 'ies', 'ens', 'ess', 'ss', 'th', 'ns', 'll', 'nd', 'rd']);
const TWO_LETTER_WORDS = new Set(['it', 'of', 'to', 'he', 'we', 'be', 'is', 'in', 'at', 'on', 'or', 'an', 'as', 'by', 'no', 'so', 'if', 'up', 'do', 'go', 'me', 'my', 'us', 'am', 'ye', 'lo']);

/**
 * The best cut of a bare word into words the vocabulary knows, up to six
 * of them, where every two neighbours are a pair the edition prints
 * together at least three times and twice as often as the glued form
 * itself: the fewest parts, then the commonest rarest pair.
 */
function bestCut(k: string, vocab: Vocabulary): { cuts: number[]; score: number } | null {
    if (k.length < 3) return null;
    const MAX_PARTS = 6;
    const need = Math.max(3, 2 * (vocab.get(k) ?? 0));
    const part = (s: string): boolean => (s === 'a' || s === 'i' ? true : s.length === 2 ? TWO_LETTER_WORDS.has(s) && (vocab.get(s) ?? 0) >= KNOWN : !AFFIXES.has(s) && (vocab.get(s) ?? 0) >= KNOWN);
    let best: { cuts: number[]; score: number } | null = null;
    const walk = (from: number, cuts: number[], prev: string, score: number) => {
        if (cuts.length >= MAX_PARTS) return;
        for (let to = from + 1; to <= k.length; to++) {
            const s = k.slice(from, to);
            if (!part(s)) continue;
            const pair = prev ? (vocab.get(`${prev} ${s}`) ?? 0) : Infinity;
            if (pair < need) continue;
            const min = Math.min(score, pair);
            if (to === k.length) {
                if (cuts.length && (!best || cuts.length < best.cuts.length || (cuts.length === best.cuts.length && min > best.score))) best = { cuts: [...cuts], score: min };
            } else walk(to, [...cuts, to], s, min);
        }
    };
    walk(0, [], '', Infinity);
    if (best) return best;
    // A form read once or twice whose two halves are common words, one of them a small one, is a dropped space
    // too rare to show as a pair ("GREGORYThus", "wheatalso"); a real word is read oftener than that
    if ((vocab.get(k) ?? 0) <= 2) for (let i = 1; i < k.length; i++) {
        const a = k.slice(0, i), b = k.slice(i);
        const common = (s: string) => s === 'a' || s === 'i' || (part(s) && (vocab.get(s) ?? 0) >= 50);
        if (common(a) && common(b) && (SMALL_WORDS.has(a) || SMALL_WORDS.has(b))) { const score = Math.min(vocab.get(a) ?? 1000, vocab.get(b) ?? 1000); if (!best || score > best.score) best = { cuts: [i], score }; }
    }
    return best;
}

// The edition's small words, which are what a dropped space glues to a neighbour
const SMALL_WORDS = new Set(['the', 'a', 'an', 'of', 'to', 'in', 'on', 'at', 'by', 'for', 'from', 'with', 'and', 'or', 'but', 'if', 'as', 'is', 'are', 'was', 'were', 'be', 'been', 'has', 'have', 'had', 'he', 'she', 'it', 'they', 'we', 'you', 'thou', 'thee', 'thy', 'ye', 'his', 'her', 'its', 'their', 'our', 'your', 'him', 'them', 'us', 'me', 'my', 'this', 'that', 'these', 'those', 'which', 'who', 'whom', 'what', 'when', 'then', 'than', 'there', 'here', 'not', 'no', 'nor', 'yet', 'so', 'also', 'into', 'unto', 'upon', 'after', 'before', 'because', 'therefore', 'wherefore', 'hence', 'thus', 'whilst', 'while', 'will', 'shall', 'may', 'might', 'can', 'could', 'would', 'should', 'must', 'do', 'does', 'did', 'all', 'any', 'some', 'such', 'both', 'each', 'every', 'how', 'why', 'where', 'now', 'only', 'even', 'very', 'more', 'most', 'up', 'out', 'over', 'again', 'one', 'two', 'said', 'says', 'saith', 'lord', 'god', 'christ', 'jesus', 'i']);

/** Indices at which to cut `word` into vocabulary words, or null when it is one the edition uses or cannot be cut. */
export function dictionaryCuts(word: string, vocab: Vocabulary): number[] | null {
    const k = bare(word);
    if (k.length < 3 || (vocab.get(k) ?? 0) >= 1) return null;
    // Only letters cut: the bare key must be the word itself, so an index in one is an index in the other
    if (k !== word.toLowerCase()) return null;
    return bestCut(k, vocab)?.cuts ?? null;
}

/** The raw count of a reading without the glued forms it contains, so that they are cut rather than kept as words. */
export function settleVocabulary(raw: Vocabulary): Vocabulary {
    const settled: Vocabulary = new Map(raw);
    for (const k of raw.keys()) if (/^[a-z]+$/.test(k) && bestCut(k, raw)) settled.delete(k);
    return settled;
}

/**
 * The recogniser reads the edition's f-ligatures (fi, fl, ff, ffi, ffl: one
 * glyph each in the 1841 type) as a bare f: "fesh", "frst", "afficted". The
 * forms it makes, drawn from the reading: each is no English word, and its
 * repair is the word the edition uses. A form that is a word in its own
 * right ("fed", "fame", "four") is left to the page.
 */
export const LIGATURE_FORMS: Record<string, string> = {
    // The fl ligature read as an a
    aesh: 'flesh', faesh: 'flesh', aee: 'flee', aock: 'flock', aight: 'flight', aed: 'fled',
    afect: 'affect', afected: 'affected', afection: 'affection', affict: 'afflict', afficted: 'afflicted', afficting: 'afflicting',
    affiction: 'affliction', affictions: 'afflictions', afficts: 'afflicts', affrm: 'affirm', affrmative: 'affirmative',
    affrmatively: 'affirmatively', affrmed: 'affirmed', affrming: 'affirming', affrms: 'affirms', affxed: 'affixed', aficted: 'afflicted',
    afiction: 'affliction', afirm: 'affirm', afirmed: 'affirmed', afirming: 'affirming', afixed: 'affixed', aflict: 'afflict', aflicted: 'afflicted',
    afliction: 'affliction', aflicts: 'afflicts', afluence: 'affluence', afoat: 'afloat', afords: 'affords', baffe: 'baffle', bafled: 'baffled',
    beneft: 'benefit', benefts: 'benefits', briefy: 'briefly', bufet: 'buffet', chiefy: 'chiefly', confdence: 'confidence', confdent: 'confident',
    confdently: 'confidently', confict: 'conflict', conficting: 'conflicting', conficts: 'conflicts', confned: 'confined', confrm: 'confirm',
    confrmation: 'confirmation', confrmed: 'confirmed', confrming: 'confirming', confrms: 'confirms', crucifed: 'crucified',
    crucifxion: 'crucifixion', defcient: 'deficient', defle: 'defile', defled: 'defiled', deflement: 'defilement', deifed: 'deified',
    diferent: 'different', diffcult: 'difficult', diffculty: 'difficulty', diffdence: 'diffidence', dificult: 'difficult', dificulty: 'difficulty',
    difuse: 'diffuse', discomft: 'discomfit', disfgure: 'disfigure', fames: 'flames', faming: 'flaming', fash: 'flash', fatterer: 'flatterer',
    fatterers: 'flatterers', fattering: 'flattering', fattery: 'flattery', fctitious: 'fictitious', fdelity: 'fidelity', feece: 'fleece',
    feeing: 'fleeing', feeting: 'fleeting', feld: 'field', felds: 'fields', ferce: 'fierce', fercely: 'fiercely', fercer: 'fiercer', fery: 'fiery',
    fesh: 'flesh', feshly: 'fleshly', feshy: 'fleshy', fexible: 'flexible', ffteenth: 'fifteenth', ffth: 'fifth', ffties: 'fifties', ffty: 'fifty',
    fg: 'fig', fght: 'fight', fghting: 'fighting', fghts: 'fights', fgurative: 'figurative', fguratively: 'figuratively', fgure: 'figure',
    fgured: 'figured', fgures: 'figures', fies: 'flies', fll: 'fill', flled: 'filled', flling: 'filling', flls: 'fills', flth: 'filth',
    flthy: 'filthy', fnal: 'final', fnd: 'find', fnding: 'finding', fnds: 'finds', fne: 'fine', fnger: 'finger', fngers: 'fingers', fnish: 'finish',
    fnished: 'finished', fnite: 'finite', fock: 'flock', focked: 'flocked', focking: 'flocking', focks: 'flocks', foor: 'floor', fourish: 'flourish',
    fourished: 'flourished', fourishing: 'flourishing', fow: 'flow', fowed: 'flowed', fower: 'flower', fowers: 'flowers', fowing: 'flowing',
    fown: 'flown', fows: 'flows', fre: 'fire', fres: 'fires', frm: 'firm', frmed: 'firmed', frmly: 'firmly', frmness: 'firmness', frst: 'first',
    frstborn: 'firstborn', fshermen: 'fishermen', fshers: 'fishers', fshes: 'fishes', ftly: 'fitly', ftness: 'fitness', ftted: 'fitted',
    ftting: 'fitting', fuctuating: 'fluctuating', fuent: 'fluent', fuid: 'fluid', fuids: 'fluids', fulfl: 'fulfil', fulflled: 'fulfilled',
    fulflling: 'fulfilling', fulflment: 'fulfilment', fulfls: 'fulfils', fux: 'flux', fve: 'five', fx: 'fix', fxed: 'fixed', fxedly: 'fixedly',
    fy: 'fly', fying: 'flying', glorifed: 'glorified', glorifes: 'glorifies', infamed: 'inflamed', infated: 'inflated', infation: 'inflation',
    infdel: 'infidel', infdelity: 'infidelity', infict: 'inflict', inficted: 'inflicted', inficting: 'inflicting', infiction: 'infliction',
    inficts: 'inflicts', infnite: 'infinite', infrm: 'infirm', infrmities: 'infirmities', infrmity: 'infirmity', infuence: 'influence',
    infuenced: 'influenced', infuences: 'influences', justifcation: 'justification', justifed: 'justified', magnifcent: 'magnificent',
    magnifes: 'magnifies', mortifcation: 'mortification', ofce: 'office', ofence: 'offence', ofences: 'offences', ofending: 'offending',
    ofer: 'offer', ofered: 'offered', ofering: 'offering', ofers: 'offers', offce: 'office', offcer: 'officer', offcers: 'officers',
    offces: 'offices', ofice: 'office', oficers: 'officers', overfowing: 'overflowing', prefgured: 'prefigured', profciency: 'proficiency',
    proft: 'profit', proftable: 'profitable', profts: 'profits', prolifc: 'prolific', pufed: 'puffed', purifed: 'purified', purifes: 'purifies',
    refect: 'reflect', refection: 'reflection', refections: 'reflections', refned: 'refined', sacrifce: 'sacrifice', sacrifced: 'sacrificed',
    sanctifcation: 'sanctification', sanctifed: 'sanctified', satisfed: 'satisfied', signifcation: 'signification', signifed: 'signified',
    signifes: 'signifies', stife: 'stifle', sufer: 'suffer', sufered: 'suffered', sufering: 'suffering', suffce: 'suffice', suffcient: 'sufficient',
    suffciently: 'sufficiently', suficient: 'sufficient', superfuity: 'superfluity', superfuous: 'superfluous', terrifed: 'terrified',
    testifed: 'testified', testifes: 'testifies', transfguration: 'transfiguration', trifes: 'trifles', trifing: 'trifling', typifed: 'typified',
    unft: 'unfit', verifed: 'verified'
};

// In the edition's italic (its scripture quotations) the recogniser reads w as u, and as ci, ic, ei, ur, ir or vv, and
// v as r: "uas", "hare", "ansicered". Real words the rule would otherwise touch
// The italic's w lost altogether ("ho", "hat", "ord") reads back with the empty form; the type's common
// misreadings beside the italic's: m for n, u for n, c for e, and the rest
const ITALIC_READINGS: Array<[string, string]> = [['u', 'w'], ['ci', 'w'], ['ic', 'w'], ['ei', 'w'], ['ur', 'w'], ['ir', 'w'], ['vv', 'w'], ['e', 'w'], ['r', 'v'], ['', 'w'], ['m', 'n'], ['n', 'm'], ['u', 'n'], ['c', 'e'], ['e', 'c'], ['l', 'i'], ['i', 'l'], ['t', 'l'], ['l', 't'], ['ii', 'n'], ['m', 'rn'], ['uc', 'w']];
const ITALIC_KEPT = new Set(['noe', 'knee', 'eater', 'ere', 'sere', 'hen', 'lo', 'hat', 'ail', 'lie', 'ho', 'nay', 'bow', 'net', 'cat', 'arc', 'toss', 'tie', 'moon', 'nine', 'sum', 'meat', 'lake', 'heli', 'ill', 'hole', 'ant', 'heat', 'ash', 'east', 'ell', 'eat', 'ear', 'ax', 'age', 'all']);

/**
 * The edition's ae ligature, which the recogniser reads as a: "damons",
 * "Judaa", "Casar". Drawn from the reading as the ligature forms are.
 */
export const AE_FORMS: Record<string, string> = {
    judaa: 'jud\u00e6a', damon: 'd\u00e6mon', damons: 'd\u00e6mons', damoniac: 'd\u00e6moniac', damoniacs: 'd\u00e6moniacs', casar: 'c\u00e6sar', casars: 'c\u00e6sars', casarea: 'c\u00e6sarea', neocasarea: 'neoc\u00e6sarea',
    manichaan: 'manich\u00e6an', manichaans: 'manich\u00e6ans', manichaus: 'manich\u00e6us', zacchaus: 'zacch\u00e6us', alphaus: 'alph\u00e6us', chananaan: 'chanan\u00e6an', chananaans: 'chanan\u00e6ans', chananaus: 'chanan\u00e6us',
    pratorium: 'pr\u00e6torium', prator: 'pr\u00e6tor', prators: 'pr\u00e6tors', chaldaans: 'chald\u00e6ans', chaldaan: 'chald\u00e6an', thaddaus: 'thadd\u00e6us', lebbaus: 'lebb\u00e6us', idumaa: 'idum\u00e6a', idumaan: 'idum\u00e6an', scava: 'sc\u00e6va',
    palastra: 'pal\u00e6stra', ituraa: 'itur\u00e6a', panaas: 'pan\u00e6as', bartimaus: 'bartim\u00e6us', collybista: 'collybist\u00e6', galilaans: 'galil\u00e6ans', galilaan: 'galil\u00e6an', arimathaa: 'arimath\u00e6a', praparatio: 'pr\u00e6paratio',
    dxmon: 'd\u00e6mon', dxmons: 'd\u00e6mons', judxa: 'jud\u00e6a', cxsar: 'c\u00e6sar', aneas: '\u00e6neas', phanician: 'ph\u00e6nician', phanicia: 'ph\u00e6nicia', pharisaan: 'pharis\u00e6an', sadducaan: 'sadduc\u00e6an', judaan: 'jud\u00e6an', judaans: 'jud\u00e6ans', jerusalemsa: 'jerusalems\u00e6',
};
const ITALIC_RATIO = 15;
const ITALIC_KNOWN = 50;

/**
 * A word the italic misread, repaired from the reading's own counts: one
 * substitution from the table gives a word the edition uses fifty times
 * and thirty times as often as the form itself. "uas" is "was" and "hare"
 * is "have"; "more" stays, since "move" is the rarer.
 */
export function italicRepair(k: string, vocab: Vocabulary): string | null {
    if (k.length < 3 && k !== 'ue') return null;
    if (ITALIC_KEPT.has(k)) return null;
    const own = vocab.get(k) ?? 0;
    let best: { word: string; n: number } | null = null;
    for (const [from, to] of ITALIC_READINGS) {
        // The empty form stands for a letter lost at the word's head
        if (!from) { const word = to + k; const n = vocab.get(word) ?? 0; if (n >= ITALIC_KNOWN && n >= ITALIC_RATIO * Math.max(own, 1) && (!best || n > best.n)) best = { word, n }; continue; }
        for (let at = k.indexOf(from); at >= 0; at = k.indexOf(from, at + 1)) {
            const word = k.slice(0, at) + to + k.slice(at + from.length);
            const n = vocab.get(word) ?? 0;
            if (n >= ITALIC_KNOWN && n >= ITALIC_RATIO * Math.max(own, 1) && (!best || n > best.n)) best = { word, n };
        }
    }
    return best?.word ?? null;
}

/** The repair a span's word takes and the rule that gives it, or null when it reads as it is. */
function repairOf(text: string, vocab: Vocabulary, fragment: boolean, english?: Lexicon): { word: string; rule: string } | null {
    const m = /^([^A-Za-z]*)([A-Za-z]+)([^A-Za-z]*)$/.exec(text);
    if (!m) return null;
    const core = m[2];
    // Small capitals are the author tokens, which the parser reads; only a word in lower case or capitalised is repaired
    if (!/^[A-Z]?[a-z]+$/.test(core)) return null;
    const k = core.toLowerCase();
    // A fragment either side of a line break is no word to weigh against the reading, but its ligature is still a ligature
    const found: [string | null | undefined, string][] = [[LIGATURE_FORMS[k], 'ligature'], [AE_FORMS[k] ?? AE_FORMS[k.replace(/x/g, 'a')], 'ae-ligature'], [fragment ? null : italicRepair(k, vocab), 'italic']];
    const hit = found.find(([word]) => word);
    if (!hit) return null;
    // The ligature tables hold only forms that are no words; the italic's substitution can land on one
    if (hit[1] === 'italic' && english?.has(k)) return { word: text, rule: `italic-withheld:${hit[0]}` };
    const word = hit[0]!;
    const cased = core[0] === core[0].toUpperCase() ? word[0].toUpperCase() + word.slice(1) : word;
    return { word: m[1] + cased + m[3], rule: hit[1] };
}

/** The word a span reads once its ligature form or italic misreading is repaired, or null when it reads as it is. */
export function repairedWord(text: string, vocab: Vocabulary, fragment = false): string | null {
    return repairOf(text, vocab, fragment)?.word ?? null;
}

/** The span with its word repaired: a character the repair adds or changes takes the box of the one it stands for. */
function repairSpan<T extends Span>(w: T, vocab: Vocabulary, fragment = false, note?: Note, english?: Lexicon): T {
    const repair = repairOf(w.text, vocab, fragment, english);
    if (!repair) return w;
    if (repair.rule.startsWith('italic-withheld:')) { note?.('italic-withheld', w.text, repair.rule.slice('italic-withheld:'.length)); return w; }
    const word = repair.word;
    note?.(repair.rule, w.text, word);
    const read = w.chars;
    let d = 0;
    while (d < word.length && d < read.length && word[d] === read[d][0]) d++;
    // Positive where the repair reads fewer characters ("ci" as w), negative where it adds one (the ligature's l)
    const delta = read.length - word.length;
    const chars: RapidOcrChar[] = [];
    for (let i = 0; i < word.length; i++) {
        if (i < d) { chars.push(read[i]); continue; }
        if (i === d && delta > 0) { chars.push([word[i], read[d][1], read[d + delta][2]]); continue; }
        const r = read[Math.min(Math.max(0, i + delta), read.length - 1)];
        chars.push([word[i], r[1], r[2]]);
    }
    return { ...w, text: word, chars };
}

// The characters show no gap where the recogniser dropped a space (a fifth of a character, against a whole one at
// a space it read), so a cut stands on the vocabulary alone; the oracle comparison catches a wrong one
function cutByDictionary(w: Span, vocab: Vocabulary, note?: Note, english?: Lexicon): Span[] {
    // The letters are cut; punctuation before or after them stays with the first or last part ("ofit," is "of it,")
    const m = /^([^A-Za-z]*)([A-Za-z]+)([^A-Za-z]*)$/.exec(w.text);
    if (!m) return [w];
    const cuts = dictionaryCuts(m[2], vocab)?.map((i) => i + m[1].length);
    if (!cuts) return [w];
    if (english?.has(m[2].toLowerCase())) { note?.('dictionary-cut-withheld', w.text, [0, ...cuts].map((c, i, all) => w.text.slice(c, all[i + 1])).join(' ')); return [w]; }
    const parts: Span[] = [];
    let from = 0;
    for (const to of [...cuts, w.chars.length]) {
        const cs = w.chars.slice(from, to);
        parts.push({ text: cs.map(([c]) => c).join(''), x1: Math.min(...cs.map(([, x1]) => x1)), x2: Math.max(...cs.map(([, , x2]) => x2)), chars: cs });
        from = to;
    }
    note?.('dictionary-cut', w.text, parts.map((x) => x.text).join(' '));
    return parts;
}

/** Words of a line from its characters: cut at spaces and at gaps that are spaces the recogniser dropped. */
export function wordsOfLine(chars: RapidOcrChar[]): Span[] {
    const widths = chars.filter(([c, x1, x2]) => c !== ' ' && x2 > x1).map(([, x1, x2]) => x2 - x1).sort((a, b) => a - b);
    const median = widths.length ? widths[Math.floor(widths.length / 2)] : 0;
    const words: Span[] = [];
    let cur: Span | null = null;
    let prevX2: number | null = null;
    for (const ch of chars) {
        const [c, x1, x2] = ch;
        if (c === ' ' || c === '\u3000') { if (cur) words.push(cur); cur = null; prevX2 = x2; continue; }
        if (cur && prevX2 !== null) {
            const gap = (x1 - prevX2) / (median || 1);
            const last = cur.text[cur.text.length - 1];
            const cut = PUNCTUATION.test(last) ? gap > GAP_AFTER_PUNCTUATION : gap > GAP && !(UPPER.test(last) && UPPER.test(c));
            if (cut) { words.push(cur); cur = null; }
        }
        if (!cur) cur = { text: narrow(c), x1, x2, chars: [ch] };
        else { cur.text += narrow(c); cur.x1 = Math.min(cur.x1, x1); cur.x2 = Math.max(cur.x2, x2); cur.chars.push(ch); }
        prevX2 = x2;
    }
    if (cur) words.push(cur);
    return words.filter((w) => w.text.trim());
}

/** Lines whose vertical centres fall inside one another are one printed line. */
function joinLines(lines: RapidOcrLine[], pageWidth: number): RapidOcrLine[][] {
    const sorted = [...lines].sort((a, b) => (a.y1 + a.y2) / 2 - (b.y1 + b.y2) / 2);
    const groups: RapidOcrLine[][] = [];
    const wide = (l: RapidOcrLine) => l.x2 - l.x1 > 0.4 * pageWidth;
    const overlaps = (l: RapidOcrLine, x: RapidOcrLine) => { const c = (l.y1 + l.y2) / 2, cx = (x.y1 + x.y2) / 2; return (c >= x.y1 && c <= x.y2) || (cx >= l.y1 && cx <= l.y2); };
    for (const l of sorted) {
        // A margin note's box is tall enough to touch two lines of the text: a line joins a group by overlapping
        // one of its text lines, and only a group without any by overlapping a note
        const g = groups.find((g) => (g.some(wide) ? g.filter(wide) : g).some((x) => overlaps(l, x)));
        if (g) g.push(l); else groups.push([l]);
    }
    return groups;
}

/**
 * A word straddling a column edge is a margin note the detector joined to its line: cut it where the edge
 * falls, by character centres, when at least two characters lie beyond it (the edge is a bucketed estimate,
 * so one character is noise).
 */
function cutAtEdges(w: Span, left: number, right: number): Span[] {
    const centre = ([, x1, x2]: RapidOcrChar) => (x1 + x2) / 2;
    let before = w.chars.filter((c) => centre(c) < left);
    let after = w.chars.filter((c) => centre(c) > right);
    if (before.length < 2) before = [];
    if (after.length < 2) after = [];
    if (!before.length && !after.length) return [w];
    const inside = w.chars.filter((c) => !before.includes(c) && !after.includes(c));
    const span = (cs: RapidOcrChar[], margin: boolean): Span | null => cs.length ? { text: cs.map(([c]) => c).join(''), x1: Math.min(...cs.map(([, x1]) => x1)), x2: Math.max(...cs.map(([, , x2]) => x2)), chars: cs, margin } : null;
    const kept = span(inside, false);
    return [span(before, true), kept ? { ...kept, cut: true } : null, span(after, true)].filter((s): s is Span => !!s && !!s.text.trim());
}

/**
 * The recovery passes re-read regions that can hold text the page pass already found: a margin note ("De Don."
 * beside "De Don."), or the right half of a line whose left half the page pass lost ("the justice of God is
 * injustice. Therefore Paul says, Who" over "Therefore Paul says, Who"). A recovered line keeps only the
 * characters the page pass did not read on its row, and goes when nothing is left.
 */
export function withoutRereads(lines: RapidOcrLine[]): RapidOcrLine[] {
    const page = lines.filter((l) => !l.pass || l.pass === 'page');
    const sameRow = (a: RapidOcrLine, b: RapidOcrLine) => Math.min(a.y2, b.y2) - Math.max(a.y1, b.y1) > 0.5 * Math.min(a.y2 - a.y1, b.y2 - b.y1);
    const out: RapidOcrLine[] = [];
    for (const l of lines) {
        if (!l.pass || l.pass === 'page') { out.push(l); continue; }
        const over = page.filter((b) => sameRow(l, b) && Math.min(l.x2, b.x2) > Math.max(l.x1, b.x1));
        if (!over.length) { out.push(l); continue; }
        // A character is a repeat where the page pass read the same letter in the same place; the boxes are padded,
        // so the line's box alone would take the letter either side of the join too
        const seen = over.flatMap((b) => b.chars.filter(([c]) => c.trim()));
        const repeat = ([c, x1, x2]: RapidOcrChar) => !!c.trim() && seen.some(([d, y1, y2]) => d.toLowerCase() === c.toLowerCase() && Math.abs((x1 + x2) / 2 - (y1 + y2) / 2) <= Math.max(6, 0.6 * (x2 - x1)));
        const chars = l.chars.filter((ch) => !repeat(ch));
        const kept = chars.filter(([c]) => c.trim());
        if (kept.length < 2) continue;
        out.push({ ...l, chars, text: chars.map(([c]) => c).join('').trim(), x1: Math.min(...kept.map(([, x1]) => x1)), x2: Math.max(...kept.map(([, , x2]) => x2)) });
    }
    return out;
}

/**
 * The detected lines of one printed line, left to right; but two margin notes stacked in the same place
 * ("Chryso-" over "logus", "Aug." over "Serm.") read top to bottom, not word by word across each other.
 */
export function inReadingOrder(lines: RapidOcrLine[], pageWidth: number): RapidOcrLine[] {
    // Only notes stack: a speck or footnote mark inside a text line's span keeps its place across the line
    const narrow = (l: RapidOcrLine) => l.x2 - l.x1 <= 0.4 * pageWidth;
    const stacked = (a: RapidOcrLine, b: RapidOcrLine) => narrow(a) && narrow(b) && Math.min(a.x2, b.x2) - Math.max(a.x1, b.x1) > 0.5 * Math.min(a.x2 - a.x1, b.x2 - b.x1);
    const out: RapidOcrLine[] = [];
    for (const l of [...lines].sort((a, b) => a.x1 - b.x1)) {
        // Insert after every line it must follow: those left of it, and those stacked above it
        let at = out.length;
        while (at > 0 && stacked(out[at - 1], l) && out[at - 1].y1 > l.y1) at--;
        out.splice(at, 0, l);
    }
    return out;
}

// Marks the edition sets inside a word (a dagger to its footnote, "sum†mit") and specks, as the recogniser reads them
const SPECKS = new Set(['t', 'f', 'j', 'l', 'i', '1', '*', "'", '\u2019', '\u2020', '\u2021']);

function toPage(p: RapidOcrPage, split: (w: Span) => Span[], vocab?: Vocabulary, note?: Note, english?: Lexicon): OcrPage {
    const s = p.width / p.rendered_width;
    const lines: OcrLine[] = [];
    // Whether the line before ended in a hyphen: its continuation at this line's head is a fragment, not a word to repair
    let broken = false;
    for (const group of joinLines(withoutRereads(p.lines), p.rendered_width)) {
        const spans = inReadingOrder(group, p.rendered_width)
            .flatMap((l) => wordsOfLine(l.chars).flatMap(split).map((w) => ({ ...w, y1: l.y1, y2: l.y2 })).sort((a, b) => a.x1 - b.x1));
        // A note's box reaching into the column takes the text's first letter with it ("2 Kings" beside "ite's" read as
        // "2Kings1"): one character left inside the edge, on a spot another line of the row already read, is that letter twice
        const centre = ([, x1, x2]: RapidOcrChar) => (x1 + x2) / 2;
        const twice = (w: Span) => {
            const glyphs = w.chars.filter(([c]) => c.trim());
            return !!w.cut && glyphs.length === 1 && spans.some((o) => o !== w && !o.cut && o.chars.some((c) => Math.abs(centre(c) - centre(glyphs[0])) <= (c[2] - c[1]) / 2));
        };
        // A mark set inside a word cuts it in two at the recogniser: the halves either side of a one-character span
        // are one word where the vocabulary knows their join ("sum", "t", "mit")
        const joined: typeof spans = [];
        for (let i = 0; i < spans.length; i++) {
            const w = spans[i], prev = joined[joined.length - 1], next = spans[i + 1];
            const whole = prev && next ? bare(prev.text + next.text) : '';
            if (vocab && prev && next && !prev.margin && !next.margin && SPECKS.has(w.text.trim()) && whole.length >= 5 && whole === (prev.text + next.text).toLowerCase() && (vocab.get(whole) ?? 0) >= KNOWN) {
                const chars = [...prev.chars, ...next.chars];
                note?.('speck-join', `${prev.text} ${w.text} ${next.text}`, prev.text + next.text);
                joined[joined.length - 1] = { ...prev, text: prev.text + next.text, x2: next.x2, chars };
                i++;
                continue;
            }
            joined.push(w);
        }
        // Two fragments that are no words, side by side, whose join the edition uses far oftener than the pair
        // ("im" "mediately"): a hyphen or a space the recogniser mistook inside the word
        const fused: typeof joined = [];
        for (let i = 0; i < joined.length; i++) {
            const w = joined[i], next = joined[i + 1];
            if (vocab && next && !w.margin && !next.margin && /^[A-Za-z]+$/.test(w.text) && /^[a-z]+[^A-Za-z]*$/.test(next.text)) {
                const a = w.text.toLowerCase(), b = bare(next.text), whole = vocab.get(a + b) ?? 0;
                const fragments = whole >= KNOWN && (vocab.get(a) ?? 0) < 500 && (vocab.get(b) ?? 0) < 50 && whole >= 2 * (vocab.get(`${a} ${b}`) ?? 0);
                // Two words the lexicon knows are two words, however often the edition prints their join ("wine press")
                if (fragments && english?.has(a) && english.has(b)) note?.('fragment-join-withheld', `${w.text} ${next.text}`, w.text + next.text);
                else if (fragments) {
                    note?.('fragment-join', `${w.text} ${next.text}`, w.text + next.text);
                    fused.push({ ...w, text: w.text + next.text, x2: next.x2, chars: [...w.chars, ...next.chars] });
                    i++;
                    continue;
                }
            }
            fused.push(w);
        }
        const kept = fused.filter((w) => !twice(w));
        // A word is repaired whole: not a fragment either side of a line break
        const firstText = kept.findIndex((w) => !w.margin);
        const repaired = vocab ? kept.map((w, i) => (w.margin ? w : repairSpan(w, vocab, (broken && i === firstText) || w.text.endsWith('-'), note, english))) : kept;
        const lastText = [...kept].reverse().find((w) => !w.margin);
        broken = !!lastText && lastText.text.endsWith('-');
        const words: OcrWord[] = repaired
            .map((w) => ({ text: w.text.trim(), x1: Math.round(w.x1 * s), x2: Math.round(w.x2 * s), y1: Math.round(w.y1 * s), y2: Math.round(w.y2 * s), margin: false, ...(w.margin ? { forcedMargin: true } : {}) }));
        if (words.length) lines.push({ words });
    }
    return { leaf: p.leaf, width: p.width, height: p.height, lines };
}

export function parseRapidOcrPages(doc: RapidOcrDocument, vocab?: Vocabulary, log?: TransformLog, english?: Lexicon): OcrPage[] {
    // The text column's width across the scan, for pages whose own estimate a dense margin pulls out
    const provisionals = doc.pages.map((p) => toPage(p, (w) => [w]));
    const widths = provisionals.filter((p) => p.lines.length >= 12).map((p) => { const { left, right } = classifyColumns(p); return right - left; }).sort((a, b) => a - b);
    const columnWidth = widths.length ? widths[Math.floor(widths.length / 2)] : undefined;
    return doc.pages.map((p, i) => {
        // First the words as the recogniser cut them, which fixes the column; then cut again at its edges,
        // and where the edition's vocabulary shows a dropped space
        const provisional = provisionals[i];
        const { left, right } = classifyColumns(provisional, columnWidth);
        const s = p.width / p.rendered_width;
        const note: Note | undefined = log && ((rule, from, to) => log({ rule, from, to, item: doc.item, leaf: p.leaf }));
        return toPage(p, (w) => cutAtEdges(w, left / s, right / s).flatMap((x) => (vocab && !x.margin ? cutByDictionary(x, vocab, note, english) : [x])), vocab, note, english);
    });
}
