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
