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

1. `pnpm run import:catena`, then `pnpm exec tsx tools/catena-review/queue.ts [count]` for the pages to read and the counts. Pages come in this order: unreadable lines still uncorrected (a column-wide line the recogniser scored under 0.7: text on the page that is not in the corpus), then open suggestions on scripture text or at an author token, then the other open suggestions. The first line of the output is the one to watch: how many unreadable-line pages still have an uncorrected line.
2. `python3 tools/catena-review/sheet.py <item-prefix> <leaf> [...]` for one image a page, a strip for each uncorrected unreadable line and each open suggestion's line. `queue.ts <item> <leaf>` gives the reader's own lines there, with their y.
3. Read the image and record what it prints: a line correction for an unreadable line (`record.py`), `apply` or `keep` for a suggestion (`suggestions.py record`). Rebuild, and the page is done when `queue.ts <item> <leaf>` says so.

An unreadable line counts as corrected when a line correction replaces that reading in the reader's line at its place. Where the reader made no line of it, the text is put back by extending the line before or after, and that correction must name the lost line in `restores` (its y as `queue.ts` prints it); until one does, the line stays open, however much text its neighbours gained. The queue never infers a restoration. Pages on the benchmark's held-out split are never queued, and only leaves the corpus places in a chain are read. The import and the tests passing show the records are consistent; only the page image shows the text is what was printed.

A line correction's `find` must occur once on the leaf. A line read as a letter or two ("r") cannot be named that way: give its `y` as `queue.ts` or `linecheck.ts` prints it, with the whole line as read for `find` and the whole printed line for `replace`. The importer takes the line at exactly that y, refuses it when it reads otherwise, and never takes a nearby one.

Not covered yet: a margin note the OCR misread beside a corrected line (leaf 371 of Luke 1-10 reads "lo aq" for "ubi sup."; leaf 138 reads "fib.xxii." for "lib. xxii."). A line correction changes the running text only, so the note stays as read. The excerpt-keyed `citation` correction is the existing way to set a citation; nothing wider is planned until more cases show it is needed.

Three kinds of statement are kept apart. What the recogniser read is in the OCR documents, untouched. What a person read on the page image is in the correction and verified-suggestion records, each with its leaf and a note. What an editor infers about structure or authorship that the page does not print outright goes in `corrections/catena-aurea.questions.json` as an open question with its scan, leaf and evidence; nothing in the import reads that file, so an inference never becomes text or an attribution until it is settled and recorded as a correction.

## Unicode report

Every `import:catena` writes `data/processed/commentary-catena-aurea.unicode-report.json` and prints two lines about it. It lists what the 1841 edition cannot have printed: characters of other scripts (the recogniser's models are Chinese-first, so its mistakes show as East Asian characters and full-width punctuation), stray symbols, and words that mix Greek letters with Latin ones, which is how a Greek word the recogniser could not read comes out. Latin, Greek and Hebrew letters and the edition's own typographic marks are not reported. Each finding has its count, how it divides between lemma, running text and margin citation, and up to three places (entry, scan, the leaf its excerpt starts on, and the words around it).

The report changes no text and never fails the import. What a given character stands for differs from case to case (the ideographic full stop is a period after a letter in a margin note, and has been a quotation mark elsewhere), so each is read on the page image and settled with a page-verified correction. It does not find Greek or Hebrew the recogniser dropped or read as ordinary Latin letters: that needs the page, not the text.
