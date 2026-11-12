# Catena Aurea OCR benchmark

A fixed set of page images with transcriptions read from the images, to measure the recogniser and the reader against the page rather than against the oracle transcription (issue #85). A lower finding count against the oracle cannot show that the text improved while the reader and the comparison are both changing; this can.

## Pages

`pages.json` lists ten development pages and ten held-out pages, one or more from each of the eight scan parts, chosen by kind: ordinary pages, dense margins, lines the detector dropped and the recovery pass found, italics, ligatures, footnotes, a page an excerpt runs onto, and a noisy page. The file records how they were chosen.

- **Development** pages were already used to develop the reader. They are regression cases and may be looked at freely.
- **Held-out** pages were untouched when chosen and must stay so: no reader rule, form table, correction, review or verified record may be written from them. Look at them only to transcribe and to score.

## Transcriptions

One file per page, `transcriptions/<item>-<leaf>.txt`:

```
# item: catenaaureacomme00thomuoft
# leaf: 53
# drafted: <who>, <date>, from the page image only
# checked: <who>, <date>
== text
the running text, one printed line per line, as printed:
spelling, capitals and punctuation kept; a line ending in a
hyphen ends "-" when the hyphen breaks a word over the line,
and "-=" when the word is itself hyphenated (life-= / giving);
an author token as its letters read (AUG., CHRYS., GREG. NYSS.),
italic as plain text; a footnote mark as the character printed;
the running head, page number and printer's signature left out
== margin
each margin line, top to bottom, as printed
== footnotes
each footnote line, as printed
```

A reading the drafter cannot make out for certain is written as best read and listed on a header line, one entry per reading separated by ` | `: `# uncertain: text 12 "exampleg" (faint mark after example, read from the footnote letter) | margin 3 "Hom.iii."`. The checker settles each one against the image; the scorer does not read this line.

Draft from the page image only, without first looking at the OCR, the reader's output or its suggestions (`python3 tools/catena-review/benchmark_render.py` writes the images, with nothing else, to `data/scratch/catena-review/benchmark/`). A draft is a reference only after someone other than its drafter has checked it against the image line by line and signed the `checked` line. The scorer ignores an unchecked held-out file; an unchecked development file is scored as a draft, marked as one in the output and in a baseline (its `checked` is empty), so development can go on while the check waits.

## Scoring

`pnpm exec tsx tools/catena-review/benchmark.ts score` reads every checked transcription (and every development draft) and reports, per page and per split:

- three stages measured separately, so that better recognition and harmful cleanup cannot cancel out in one number: the recogniser (every line the OCR document saved; a word-bag discrepancy rate against every printed word, fragments kept on both sides), the page reader (its text lines, character and word error line by line), and the complete reader (the chain as the parser leaves it before any manual correction, against the text joined as the transcription marks each line's end)
- lines of the page missing from the OCR, and lines read twice
- every change the reader logged on the page, made or suggested, judged against the transcription: agrees with the page, contradicts it, or cannot be told
- margin text (citations) error rate
- author tokens: printed on the page, and found by the parser on that leaf

## Baselines

`benchmark.ts score --record NAME` writes `baselines/NAME.json`: the scores with the commit, checksums of the scorer and reader files and of the reader's forms and verified records, each OCR document's checksum and provenance (generated, or migrated from an earlier format), and each transcription's checksum with who drafted and checked it. It refuses to record from uncommitted scorer or reader files and never overwrites a baseline, so two baselines can be compared knowing exactly what changed between them. Score the held-out split only to measure a change, never while developing one.

## Investigations

Findings that decided how the corpus is read, kept here so the question is not reopened without new evidence. The working files of an investigation are not kept; what is recorded is what was compared, what came out, and how far it can be trusted.

### Reading the pages at a larger size (2026-11-12)

**Question.** RapidOCR shrinks each 1600-wide page so that its long side is 2000 px, so the recogniser sees the page at about 0.69 of the rendered size. Would reading it unshrunk, or from a larger render, give a better text?

**What was compared.** The ten development pages, re-read three ways and scored with `benchmark.ts`: as saved (the control), unshrunk at 1600 wide, and unshrunk from a 2400-wide render with coordinates scaled back. The control reproduced the saved OCR documents line for line, so the comparison was like for like.

| Read | Recogniser discrepancy | Complete reader CER | Complete reader WER | Lines missing |
|---|---|---|---|---|
| Saved (0.69) | 14.8% | 1.3% | 3.4% | 2 |
| Unshrunk, 1600 wide | 11.8% | 1.9% | 3.9% | 4 |
| Unshrunk, 2400 wide | 13.2% | 1.7% | 4.7% | 3 |

**What it showed.**

- The recogniser alone does better unshrunk, but the reader already repairs those words, so the finished text is no better.
- Every difference of note between the sizes was a whole line. The detector finds the line and the recogniser returns specks with a low score; which lines fail this way changes with the size. On pages where no line flipped, the character error moved by 0.2 points or less.
- The larger reads did hold the two lines the saved read lacks. Putting those two lines, checked against the page images, into the saved read gave CER 0.8%, WER 2.9% and no missing line, with nothing read twice. Neither came through clean: one had a speck read as an apostrophe, the other an author token read as "CuRys.".

**Decision.** The saved scale stays, and there is no second OCR pass. A second read is at best a draft of a line; the text of a lost line is settled on the page image and entered as a page-verified line correction, which the pipeline already had. Unreadable lines are found by their recogniser score (under 0.7 on a column-wide line) and worked through with `tools/catena-review/queue.ts`. Regenerating at another size would also move the line positions that corrections and verified suggestions are bound to.

**Limits.** Ten pages, chosen by kind and not at random, six of them unchecked drafts at the time, so the percentages are indicative only. The held-out pages were not scored, as nothing was being changed. A line that no read detects at all leaves no low-score box and is not measured here: one such line was met (found only by the 2400-wide read), and how many there are in the corpus is not known.
