import { describe, it, expect } from 'vitest';
import { unreadableLines, lineStates, suggestionCounts, suggestionGroups, isLowPriority, pageStatus, rankPages, unreadableProgress, checkPageReviews, reviewScope, reviewCoverage, type QueuePage, type PageReview } from './catena-review-queue.js';
import type { RapidOcrLine, RapidOcrPage } from './importers/rapidocr-json.js';

const ocrLine = (y1: number, text: string, score: number, o: Partial<RapidOcrLine> = {}): RapidOcrLine => ({ x1: 100, x2: 1300, y1, y2: y1 + 50, score, text, chars: [], ...o });
// Rendered 1600 wide from a 2000 wide scan: the reader's y is the OCR's times 1.25
const ocrPage = (...lines: RapidOcrLine[]): RapidOcrPage => ({ leaf: 138, width: 2000, height: 3000, rendered_width: 1600, rendered_height: 2400, lines });
const queued = (item: string, leaf: number, states: ('open' | 'unread' | 'corrected' | 'footnote')[], suggestions: Partial<QueuePage['suggestions']> = {}): QueuePage => ({
    item, leaf,
    lines: states.map((state, i) => ({ y: 100 * i, y1: 80 * i, y2: 80 * i + 50, score: 0.5, text: 'a o p', state })),
    suggestions: { weighty: 0, other: 0, low: 0, settled: 0, ...suggestions },
});

describe('Catena review queue (issue #85)', () => {
    describe('unreadable lines', () => {
        it('are column-wide lines the recogniser scored low, top to bottom', () => {
            const page = ocrPage(ocrLine(600, 'si o p os', 0.54), ocrLine(200, 'a readable line of the chain', 0.98), ocrLine(400, 'm shap au o', 0.55), ocrLine(800, 'Hom.', 0.4, { x1: 1350, x2: 1450 }));
            expect(unreadableLines(page).map((l) => l.text)).toEqual(['m shap au o', 'si o p os']);
        });

        it('leave out a box far taller than a line, which is a figure or a blank', () => {
            const page = ocrPage(ocrLine(200, 'one', 0.98), ocrLine(300, 'two', 0.98), ocrLine(400, 'three', 0.98), ocrLine(500, '日', 0.5, { y2: 950 }));
            expect(unreadableLines(page)).toEqual([]);
        });
    });

    describe('completion', () => {
        const page = ocrPage(ocrLine(200, 'titles, all of whom, he equally', 0.98), ocrLine(260, 'r', 0.5), ocrLine(320, 'selves from desiring', 0.98));
        const reader = [{ y: 250, main: 'titles, all of whom, he equally' }, { y: 325, main: 'r' }, { y: 400, main: 'selves from desiring' }];
        const fix = { item: 'item', leaf: 138, find: 'r', replace: 'forbids to practise deceit, that so by first keeping them-' };

        it('leaves a line open while no correction applies to the reader\'s line there', () => {
            expect(lineStates(page, reader, []).map((l) => l.state)).toEqual(['open']);
            expect(lineStates(page, reader, [{ ...fix, find: 'not on this leaf' }]).map((l) => l.state)).toEqual(['open']);
        });

        it('counts a line corrected by the correction the importer would apply to it', () => {
            expect(lineStates(page, reader, [{ ...fix, y: 325 }]).map((l) => l.state)).toEqual(['corrected']);
            // Placed by y, the correction is for another line: this one stays open
            expect(lineStates(page, reader, [{ ...fix, y: 400 }]).map((l) => l.state)).toEqual(['open']);
            expect(lineStates(ocrPage(ocrLine(260, 'o anq e o', 0.5)), [{ y: 325, main: 'o anq e o' }], [{ ...fix, find: 'anq e' }]).map((l) => l.state)).toEqual(['corrected']);
        });

        it('does not count a correction to another part of the reader\'s line', () => {
            const merged = [{ y: 325, main: 'continuing s a 1 1 s' }];
            const specks = ocrPage(ocrLine(260, 's a 1  1  s', 0.5));
            expect(lineStates(specks, merged, [{ item: 'item', leaf: 138, find: 'continuing', replace: 'continuing,' }]).map((l) => l.state)).toEqual(['open']);
            expect(lineStates(specks, merged, [{ item: 'item', leaf: 138, find: 'continuing s a 1 1 s', replace: 'continuing in sin. And the Lord forewarns us that He' }]).map((l) => l.state)).toEqual(['corrected']);
            // The reader read one of the specks as a word: the correction is of its whole line
            expect(lineStates(ocrPage(ocrLine(260, 'o anq e o nou yd', 0.5)), [{ y: 325, main: 'o anq e o now y d' }], [{ item: 'item', leaf: 138, find: 'o anq e o now y d', replace: 'hold out liberation' }]).map((l) => l.state)).toEqual(['corrected']);
            // The reading's first letters went to the margin: the correction holds the greater part of it
            const split = ocrPage(ocrLine(260, 'lo aqn e uedad u Adond', 0.6));
            expect(lineStates(split, [{ y: 325, main: 'n e u edad u A dond' }], [{ item: 'item', leaf: 138, find: 'n e u edad u A dond', replace: 'I am spending my own' }]).map((l) => l.state)).toEqual(['corrected']);
        });

        it('takes a line the reader dropped as restored only when a correction names it', () => {
            const dropped = reader.filter((l) => l.y !== 325);
            const longer = { item: 'item', leaf: 138, find: 'he equally', replace: 'he equally forbids to practise deceit, that so by first keeping them-' };
            expect(lineStates(page, dropped, []).map((l) => l.state)).toEqual(['unread']);
            // However much text a neighbour's correction adds, that proves nothing about this line
            expect(lineStates(page, dropped, [longer]).map((l) => l.state)).toEqual(['unread']);
            expect(lineStates(page, dropped, [{ ...longer, restores: 400 }]).map((l) => l.state)).toEqual(['unread']);
            expect(lineStates(page, dropped, [{ ...longer, restores: 325 }]).map((l) => l.state)).toEqual(['corrected']);
        });

        describe('a line of a printed footnote', () => {
            // The last line of the chain was read as nothing, and so was the middle line of the footnote under it
            const foot = ocrPage(ocrLine(200, 'He is also Zorobabel,', 0.98), ocrLine(260, '', 0.52), ocrLine(400, 'n The teacher of Babylon; Jerome;', 0.98), ocrLine(460, 'x a un shuu', 0.5), ocrLine(520, 'flowed, poured away,', 0.97));
            const main = [{ y: 250, main: 'He is also Zorobabel,' }];
            const notes = [{ y: 500, main: 'n The teacher of Babylon; Jerome;' }, { y: 575, main: 'x a un sh u u' }, { y: 650, main: 'flowed, poured away,' }];
            const seen = { y: 575, reading: 'x a un shuu' };
            const states = (...args: Parameters<typeof lineStates> extends [unknown, ...infer R] ? R : never) => lineStates(foot, ...args).map((l) => l.state);

            it('is set apart only when the reader filed it under the footnotes and the page image confirmed that line', () => {
                expect(states(main, [], notes, [seen])).toEqual(['unread', 'footnote']);
                expect(states(main, [], notes, [])).toEqual(['unread', 'unread']);
                expect(states(main, [], [], [seen])).toEqual(['unread', 'unread']);
            });

            it('never takes missing commentary beside the footnote with it', () => {
                // A record at the lost commentary line's y, or with another reading, dismisses nothing
                expect(states(main, [], notes, [seen, { y: 325, reading: '' }])).toEqual(['unread', 'footnote']);
                expect(states(main, [], notes, [{ y: 575, reading: 'x a un' }])).toEqual(['unread', 'unread']);
                expect(states(main, [], notes, [{ y: 576, reading: 'x a un shuu' }])).toEqual(['unread', 'unread']);
                // A line the reader read as text is commentary until corrected, whatever a record says
                const asText = [...main, { y: 575, main: 'x a un sh u u' }];
                expect(states(asText, [], notes.filter((l) => l.y !== 575), [seen])).toEqual(['unread', 'open']);
                expect(states(asText, [], notes, [seen])).toEqual(['unread', 'open']);
            });

            it('is counted apart from commentary, and leaves the page open while commentary is missing', () => {
                const page: QueuePage = { ...queued('a', 54, ['unread', 'footnote']) };
                expect(unreadableProgress([page])).toEqual({ pages: 1, pagesOpen: 1, lines: 1, linesOpen: 1, linesUnread: 1, footnoteLines: 1 });
                expect(pageStatus(page)).toBe('open');
                const only: QueuePage = { ...queued('a', 54, ['footnote']), questions: 1 };
                expect(unreadableProgress([only])).toEqual({ pages: 0, pagesOpen: 0, lines: 0, linesOpen: 0, linesUnread: 0, footnoteLines: 1 });
                // Its question about the footnote still stands
                expect(pageStatus(only)).toBe('partial');
                expect(rankPages([only])).toHaveLength(1);
            });
        });

        it('settles a suggestion by its verified record, whichever way it went', () => {
            const counts = suggestionCounts([
                { rule: 'dehyphen', from: 'a- b', to: 'ab', applied: true },
                { rule: 'lone-digit', from: 'x 1 y', to: 'x y', applied: true, verified: '2026-11-12' },
                { rule: 'one-as-I-by-pair', from: 'x 1 y', to: 'x I y', applied: false, verified: '2026-11-12' },
                { rule: 'lone-consonant', from: 'by y his', to: 'by his', applied: false },
                { rule: 'I-before-capital', from: 'I AUG.', to: 'AUG.', applied: false },
                { rule: 'lone-digit', from: 'x 2 y', to: 'x y', applied: false, span: '110@lemma13.18.1:130' },
            ]);
            expect(counts).toEqual({ weighty: 2, other: 1, low: 0, settled: 2 });
        });

        describe('rules a sample showed to be seldom right', () => {
            const at = (rule: string, from: string, span: string, o: object = {}) => ({ rule, from, to: 'x', applied: false, item: 'a', leaf: 7, span, ...o });

            it('are low priority, never settled: a dictionary cut, and "wilt" under italic-frequency', () => {
                const log = [at('dictionary-cut-frequency', 'uphold', '7@ocr1:x1'), at('italic-frequency', 'wilt', '7@ocr2:x1'), at('italic-frequency', 'wilt.', '7@ocr3:x1'), at('italic-frequency', 'hare', '7@ocr4:x1'), at('italic-frequency', 'wilts', '7@ocr5:x1')];
                expect(suggestionCounts(log)).toEqual({ weighty: 0, other: 2, low: 3, settled: 0 });
                expect(log.map(isLowPriority)).toEqual([true, true, true, false, false]);
                // Still open: a page of nothing but low-priority suggestions is not done and stays in the queue, last
                const low = queued('a', 7, [], { low: 3 }), other = queued('a', 8, [], { other: 1 });
                expect(pageStatus(low)).toBe('open');
                expect(rankPages([low, other]).map((p) => p.leaf)).toEqual([8, 7]);
                // In scripture text a low-priority rule is weighty all the same
                expect(suggestionCounts([at('italic-frequency', 'wilt', '7@lemma13.18.1:130')])).toEqual({ weighty: 1, other: 0, low: 0, settled: 0 });
            });

            it('count the two readings of one lone 1 once, and keep both', () => {
                const pair = [at('one-as-I-by-pair', 'said. 1 But', '7@100:5-7@100:5', { id: 'p' }), at('lone-digit', 'said. 1 But', '7@100:5-7@100:5', { id: 'd' })];
                const groups = suggestionGroups([...pair, at('lone-digit', 'own 1 body', '7@200:9-7@200:9', { id: 'e' })]);
                expect(groups.map((g) => g.map((t) => t.id))).toEqual([['p', 'd'], ['e']]);
                expect(suggestionCounts(pair)).toEqual({ weighty: 0, other: 1, low: 0, settled: 0 });
                // Not grouped: another span, another leaf, the same rule twice, or a rule outside the pair
                expect(suggestionGroups([pair[0], { ...pair[1], span: '7@100:9-7@100:9' }])).toHaveLength(2);
                expect(suggestionGroups([pair[0], { ...pair[1], leaf: 8 }])).toHaveLength(2);
                expect(suggestionGroups([pair[1], { ...pair[1], id: 'd2' }])).toHaveLength(2);
                expect(suggestionGroups([pair[0], at('lone-consonant', 'said. 1 But', '7@100:5-7@100:5')])).toHaveLength(2);
                // A verdict on one of the two settles that one only; the other is still to read
                expect(suggestionCounts([{ ...pair[0], verified: '2026-11-14' }, pair[1]])).toEqual({ weighty: 0, other: 1, low: 0, settled: 1 });
                expect(suggestionCounts(pair.map((t) => ({ ...t, verified: '2026-11-14' })))).toEqual({ weighty: 0, other: 0, low: 0, settled: 2 });
            });
        });

        it('calls a page done, partial or open from what is left on it', () => {
            expect(pageStatus(queued('a', 1, ['corrected'], { settled: 3 }))).toBe('done');
            expect(pageStatus(queued('a', 1, ['corrected', 'open']))).toBe('partial');
            expect(pageStatus(queued('a', 1, [], { other: 2, settled: 1 }))).toBe('partial');
            expect(pageStatus(queued('a', 1, ['unread'], { other: 2 }))).toBe('open');
        });

        it('never calls a page done while a question recorded against it is open', () => {
            expect(pageStatus({ ...queued('a', 1, ['corrected'], { settled: 3 }), questions: 1 })).toBe('partial');
            expect(pageStatus({ ...queued('a', 1, [], {}), questions: 1 })).toBe('partial');
            expect(pageStatus({ ...queued('a', 1, ['open'], {}), questions: 1 })).toBe('open');
            expect(pageStatus({ ...queued('a', 1, ['corrected'], { settled: 3 }), questions: 0 })).toBe('done');
            expect(rankPages([{ ...queued('a', 1, ['corrected'], {}), questions: 1 }]).map((p) => p.leaf)).toEqual([1]);
        });
    });

    describe('ordering', () => {
        const pages = [
            queued('b', 7, [], { other: 12 }),
            queued('a', 9, ['open'], {}),
            queued('a', 3, [], { weighty: 1 }),
            queued('a', 5, ['open', 'unread'], {}),
            queued('a', 2, ['corrected'], { settled: 4 }),
            queued('b', 4, ['corrected', 'open'], { other: 3 }),
            queued('a', 8, [], { other: 12 }),
        ];

        it('puts unreadable lines first, then scripture text and author tokens, then density, and drops finished pages', () => {
            expect(rankPages(pages).map((p) => `${p.item}${p.leaf}`)).toEqual(['a5', 'b4', 'a9', 'a3', 'a8', 'b7']);
        });

        it('gives the same order whatever order the pages come in', () => {
            expect(rankPages([...pages].reverse())).toEqual(rankPages(pages));
        });

        it('reports the unreadable-line pages still open, not the lines', () => {
            expect(unreadableProgress(pages)).toEqual({ pages: 4, pagesOpen: 3, lines: 6, linesOpen: 4, linesUnread: 1, footnoteLines: 0 });
        });
    });

    describe('page reviews', () => {
        const sha = 'a'.repeat(64);
        const review = (leaf: number, scope: PageReview['scope'], o: Partial<PageReview> = {}): PageReview => ({
            item: 'a', leaf, scope, reviewer: 'a reader', reviewed: '2026-11-12', image: { bundle: 'a_jp2.zip', sha256: sha, file: 'a_0146.jp2' },
            ocr: { document: 'a.rapidocr.json', sha256: sha }, revision: '6d46564', corrections: [], verdicts: [], questions: [], outcome: 'nothing further found', blockers: [], ...o,
        });

        it('are refused when they leave out who read what, from which image, against which build', () => {
            expect(checkPageReviews([review(1, 'whole page'), review(2, 'strips')])).toHaveLength(2);
            const bad = (o: object) => () => checkPageReviews([{ ...review(1, 'whole page'), ...o } as PageReview]);
            expect(bad({ scope: 'done' })).toThrow(/scope is/);
            expect(bad({ reviewer: ' ' })).toThrow(/reviewer and date/);
            expect(bad({ reviewed: 'yesterday' })).toThrow(/reviewer and date/);
            expect(bad({ image: { bundle: 'a_jp2.zip', sha256: 'abc', file: 'x' } })).toThrow(/page image/);
            expect(bad({ revision: '' })).toThrow(/OCR document and the import/);
            expect(bad({ verdicts: undefined })).toThrow(/lists its corrections/);
            expect(bad({ outcome: '' })).toThrow(/outcome/);
        });

        it('give a page its widest recorded reading, and none where none is recorded', () => {
            const log = [review(1, 'strips'), review(1, 'whole page'), review(2, 'strips'), { ...review(3, 'whole page'), item: 'b' }];
            expect([1, 2, 3].map((leaf) => reviewScope(log, 'a', leaf))).toEqual(['whole page', 'strips', undefined]);
            expect(reviewScope([...log].reverse(), 'a', 1)).toBe('whole page');
        });

        it('keep a reading of the margin notes apart from a reading of the text', () => {
            expect(checkPageReviews([review(5, 'margin citations')])).toHaveLength(1);
            expect(reviewScope([review(5, 'margin citations')], 'a', 5)).toBe('margin citations');
            // It adds nothing to a reading of the text, and never stands in for one
            expect(reviewScope([review(5, 'margin citations'), review(5, 'strips')], 'a', 5)).toBe('strips');
            expect(reviewScope([review(5, 'whole page'), review(5, 'margin citations')], 'a', 5)).toBe('whole page');
            const cited: QueuePage = { ...queued('a', 5, ['corrected']), review: 'margin citations' };
            expect(pageStatus(cited)).toBe('done');
            expect(reviewCoverage([cited])).toEqual({ whole: 0, strips: 0, citationsOnly: 1, done: 1, doneWhole: 0, doneStrips: 0, doneUnrecorded: 1, wholeNotDone: 0 });
            // And a page with open suggestions is not done because its margin was read
            expect(pageStatus({ ...queued('a', 6, [], { other: 2 }), review: 'margin citations' })).toBe('open');
        });

        it('never make a page done, and a done page is not thereby a reviewed one', () => {
            const read: QueuePage = { ...queued('a', 1, ['open'], { other: 2 }), review: 'whole page' };
            const cleared = queued('a', 2, ['corrected'], { settled: 1 });
            expect(pageStatus(read)).toBe('open');
            expect(rankPages([read, cleared]).map((p) => p.leaf)).toEqual([1]);
            expect(pageStatus(cleared)).toBe('done');
            expect(cleared.review).toBeUndefined();
            const both: QueuePage = { ...queued('a', 3, ['corrected']), review: 'whole page' };
            const strips: QueuePage = { ...queued('a', 4, ['corrected']), review: 'strips' };
            expect(reviewCoverage([read, cleared, both, strips])).toEqual({ whole: 2, strips: 1, citationsOnly: 0, done: 3, doneWhole: 1, doneStrips: 1, doneUnrecorded: 1, wholeNotDone: 1 });
            // The same pages give the same order with or without their reviews
            const bare = [read, cleared, both, strips].map(({ review: _, ...p }) => p);
            expect(rankPages(bare).map((p) => p.leaf)).toEqual(rankPages([read, cleared, both, strips]).map((p) => p.leaf));
        });
    });
});
