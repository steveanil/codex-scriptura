# Catena review tools

Page-by-page review of the Catena Aurea oracle findings (issue #85). They read the built corpus and the oracle report, render page strips from the checksum-accepted JP2 bundles, and write only to `data/scratch/catena-review/` (gitignored), except `record.py`, which appends to the correction files in `corrections/`.

The usual round, from `packages/data-pipeline`:

1. `pnpm run import:catena && pnpm run verify:catena`, then `pnpm exec tsx tools/catena-review/pairs.ts`
2. `python3 tools/catena-review/review.py queue` for the pages to read, worst first
3. `python3 tools/catena-review/review.py page <item> <leaf>` for the differences on a page and an image of their lines; `review.py at` and `page.py` for any other part of the page
4. Read the image, then record what it shows with `record.py` (a line or excerpt correction, or a reviewed discrepancy with a note). `pend.py` holds reviews that must wait for a correction's rebuild.

The classifier's accepted word pairs come from `pairs.json`, so a difference these tools hide is one the oracle comparison hides too. A review binds to the fingerprint in the oracle report, so record reviews only against a report built from the current corpus (`record.py` refuses an older one).

The reader changes text on its own only through the hand-checked forms in `corrections/catena-aurea.reader-forms.json` and a few mechanical rules (see `src/importers/transform-log.ts`). Everything else it would change is a suggestion, logged in `data/processed/commentary-catena-aurea.transforms.json` and not made. Each suggestion has an id fixed by its rule, its scan, the place on the page its characters were read (leaf, line and column, traced through every join and replacement) and the change itself. `suggestions.py` lists suggestions by id (`list --rule --item --leaf`), renders strips of their lines labelled by id (`sheet`, or `pick ID ...`), and records what the page shows (`record apply|keep ID ...`) in `corrections/catena-aurea.transforms-verified.json`. A record names exactly one occurrence: the import fails when a record meets none or more than one. Record only what the strip shows; `keep` is as good a verdict as `apply`.

`linecheck.ts` shows lines as the parser reads them (and any line correction that does not apply exactly once); `block.ts` puts one entry beside the oracle's block. Python needs Pillow.

## Page-first review

Reading the corpus page by page against the scan, most damaged first. The order is worked out, never stored: `queue.ts` reads the OCR documents, the line corrections and the reader's log from the last import each time, so a page leaves the queue when its records are in and the corpus is rebuilt, and for no other reason.

1. `pnpm run import:catena`, then `pnpm exec tsx tools/catena-review/queue.ts [count]` for the pages to read and the counts. Pages come in this order: unreadable lines still uncorrected (a column-wide line the recogniser scored under 0.7: text on the page that is not in the corpus), then open suggestions on scripture text or at an author token, then the other open suggestions. The first line of the output is the one to watch: how many pages still have an uncorrected line of unreadable commentary.
2. `python3 tools/catena-review/sheet.py <item-prefix> <leaf> [...]` for one image a page, a strip for each uncorrected unreadable line and each open suggestion's line. `queue.ts <item> <leaf>` gives the reader's own lines there, with their y.
3. Read the image and record what it prints: a line correction for an unreadable line (`record.py`), `apply` or `keep` for a suggestion (`suggestions.py record`). Rebuild, and the page is done when `queue.ts <item> <leaf>` says so.

An unreadable line counts as corrected when a line correction replaces that reading in the reader's line at its place. Where the reader made no line of it, the text is put back by extending the line before or after, and that correction must name the lost line in `restores` (its y as `queue.ts` prints it); until one does, the line stays open, however much text its neighbours gained. The queue never infers a restoration. Pages on the benchmark's held-out split are never queued, and only leaves the corpus places in a chain are read. The import and the tests passing show the records are consistent; only the page image shows the text is what was printed.

A line correction's `find` must occur once on the leaf. A line read as a letter or two ("r") cannot be named that way: give its `y` as `queue.ts` or `linecheck.ts` prints it, with the whole line as read for `find` and the whole printed line for `replace`. The importer takes the line at exactly that y, refuses it when it reads otherwise, and never takes a nearby one.

A line correction may remove a line only when it is not commentary at all: its `replace` is empty and `removes` says which kind, `footnote` (a line of a printed footnote the reader took for text) or `handwriting` (a reader's pencilled note on the scanned copy, as on leaf 317 of Luke 1-10). It takes the whole line as read; the importer refuses one that names part of a line, one with no `removes`, and one with any other kind, so a line of commentary cannot be deleted this way. The OCR document keeps what was read there.

A margin note the OCR misread is not reached by a line correction, which changes the running text only. It is set with the excerpt-keyed `citation` correction in `corrections/catena-aurea.json` (the note as the page prints it, and `citationWas`, the reading it replaces, so the correction fails when that reading changes). Leaves 138 and 371 of Luke 1-10 and leaf 301 of John 1-10 were done this way; nothing wider has been needed.

Three kinds of statement are kept apart. What the recogniser read is in the OCR documents, untouched. What was read on the page image is in the correction and verified-suggestion records, each with its leaf and a note; every such reading so far was made by an AI model (Claude) with no second reader, and a page review names its reviewer. What an editor infers about structure or authorship that the page does not print outright goes in `corrections/catena-aurea.questions.json` as an open question with its scan, leaf and evidence; the import never takes text or an attribution from that file, so an inference never becomes either until it is settled and recorded as a correction. The same file holds source-fidelity defects that cannot be put right yet (Hebrew read as specks, tracked in #429). `queue.ts` counts the open ones against their leaf: a page with an open question is never done, however much else on it is settled. A question about one excerpt names it in `excerpt` (text found once in that excerpt) and says in `concerns` whether the citation, the attribution or the text is in doubt. The import derives each excerpt's citation status from these questions, the page-review log and the citation corrections (`src/catena-provenance.ts`): an open question on the citation or the attribution makes it unresolved whatever was checked, and a question whose excerpt is no longer found stops the import.

### Low priority and pairs

A sample of 120 suggestions read on the page images (benchmark/catena/README.md) showed which rules can be trusted least, and the queue counts by it. A `dictionary-cut-frequency` suggestion, and an `italic-frequency` suggestion whose word is exactly "wilt", are low priority: they are still open, a page holding only such is not done, but they order a page last and are counted on their own. A low-priority rule in scripture text is weighty all the same. `one-as-I-by-pair` and `lone-digit` propose opposite things for the same lone 1 (the word I, or a stray mark); where both are open on one span they are counted as one thing to read. Each keeps its id and rule and takes its own verdict, and a verdict on one leaves the other open. Nothing here settles a suggestion or changes the text: every verdict is still read from the page.

### Footnote lines

The edition's footnotes are left out of the corpus by design, so a footnote line the recogniser could not read is not missing commentary. The queue sets such a line apart only on two conditions together: the reader itself filed a line at that place under the page's footnotes, and `corrections/catena-aurea.footnote-lines.json` holds a record, read from the page image, naming that line by its y and its reading in the OCR document. A record that fits no such line stops `queue.ts`; a line the reader read as text is never dismissed this way, nor is a lost line of the chain next to a footnote. Footnote lines are counted on a line of their own in the queue's output, apart from unreadable commentary, and any question about what the footnote prints (Greek or Hebrew, #429) stays open in the questions file.

### Page reviews

`corrections/catena-aurea.page-reviews.json` logs each reading of a page on its image: the scan and leaf, the scope (`whole page` or `strips`), who read it and when, the scan bundle with its accepted checksum and the image's name in it, the OCR document's checksum and the commit the import ran at, the corrections and verdicts that came of it, the questions it left, the outcome and anything still in the way. `record.py` writes one from a `page` record and fills in the identities itself.

The log changes no text and no page's state. A page is done when nothing queued on it is left; a page is reviewed when a review is logged; neither follows from the other, and `queue.ts` prints both side by side (how many done pages were read whole, by strips, or have no review logged). A page that has a review and never had anything queued is counted under its review and under no queue status, so `done` counts queue pages only; the summary gives the OCR queue, strip reviews, whole-page reviews and margin-citation readings each on its own line. Pages read before the log existed have no entry, and none is to be written for them after the fact: only a reading actually made is logged, with what it found. Held-out benchmark pages are refused.

## Suspected omissions

The acceptance gate blocks on a run of four or more words the transcription has inside an excerpt and ours does not, because that is usually a line the OCR lost and no queue can see it.

1. `pnpm run accept:catena` writes the open ones to `data/processed/commentary-catena-aurea.gate-report.json`.
2. `python3 tools/catena-review/omissions.py` renders a strip for each on its page image, eight to a sheet, and lists the OCR lines around the place. Held-out benchmark pages are listed and never rendered.
3. Read the strip. Words the page prints and ours lacks go back by a line correction (or an excerpt correction when the lines are there but out of order). A run the page does not print there (a footnote, a margin note, a neighbouring excerpt the transcription ran in) is recorded as a `review` of that finding with `omissions` naming every run exactly as the finding lists them; a review that does not name them clears nothing.
4. Rebuild, run `verify:catena`, record the reviews, and run the gate again.

## Unicode report

Every `import:catena` writes `data/processed/commentary-catena-aurea.unicode-report.json` and prints two lines about it. It lists what the 1841 edition cannot have printed: characters of other scripts (the recogniser's models are Chinese-first, so its mistakes show as East Asian characters and full-width punctuation), stray symbols, and words that mix Greek letters with Latin ones, which is how a Greek word the recogniser could not read comes out. Latin, Greek and Hebrew letters and the edition's own typographic marks are not reported. Each finding has its count, how it divides between lemma, running text and margin citation, and up to three places (entry, scan, the leaf its excerpt starts on, and the words around it).

The report changes no text and never fails the import. What a given character stands for differs from case to case (the ideographic full stop is a period after a letter in a margin note, and has been a quotation mark elsewhere), so each is read on the page image and settled with a page-verified correction. It does not find Greek or Hebrew the recogniser dropped or read as ordinary Latin letters, so an empty report is never evidence that the Greek and Hebrew are preserved: that is settled only by the inventory from the page images (#429).

## Suggestions on a replaced line

The page reader proposes its changes before line corrections are applied, so a suggestion can be about a reading that a line correction has since replaced ("p os" on a line read as specks). No page can settle it, because the text it speaks of is no longer the text. The import retires these: a suggestion read on a corrected line whose reading lies wholly inside what the correction took. A correction placed by `y` takes its whole line; one placed by its text takes only its `find`, and a suggestion elsewhere on that line stays open. The retired ones are written to `data/processed/commentary-catena-aurea.retired-suggestions.json` and counted in the import's last lines.

A suggestion that already carries a verdict is never retired. If its reading has been replaced it is listed in the same file under `staleVerdicts`, for a person to look at and withdraw or keep. Retiring a suggestion does not make a page done: a page is done when nothing on it is left to read and no question stands against it.
