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

Draft from the page image only, without first looking at the OCR, the reader's output or its suggestions (`python3 tools/catena-review/benchmark_render.py` writes the images, with nothing else, to `data/scratch/catena-review/benchmark/`). A draft is a reference only after someone other than its drafter has checked it against the image line by line and signed the `checked` line; the scorer ignores a file without one.

## Scoring

`pnpm exec tsx tools/catena-review/benchmark.ts score` reads every checked transcription and reports, per page and per split:

- three stages measured separately, so that better recognition and harmful cleanup cannot cancel out in one number: the recogniser (every line the OCR document saved; a word-bag discrepancy rate against every printed word, fragments kept on both sides), the page reader (its text lines, character and word error line by line), and the complete reader (the chain as the parser leaves it before any manual correction, against the text joined as the transcription marks each line's end)
- lines of the page missing from the OCR, and lines read twice
- every change the reader logged on the page, made or suggested, judged against the transcription: agrees with the page, contradicts it, or cannot be told
- margin text (citations) error rate
- author tokens: printed on the page, and found by the parser on that leaf

## Baselines

`benchmark.ts score --record NAME` writes `baselines/NAME.json`: the scores with the commit, checksums of the scorer and reader files and of the reader's forms and verified records, each OCR document's checksum and provenance (generated, or migrated from an earlier format), and each transcription's checksum with who drafted and checked it. It refuses to record from uncommitted scorer or reader files and never overwrites a baseline, so two baselines can be compared knowing exactly what changed between them. Score the held-out split only to measure a change, never while developing one.
