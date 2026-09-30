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
spelling, capitals, punctuation and a hyphen at a line's end kept;
an author token as its letters read (AUG., CHRYS., GREG. NYSS.),
italic as plain text; a footnote mark as the character printed
== margin
each margin line, top to bottom, as printed
== footnotes
each footnote line, as printed
```

Draft from the page image only, without first looking at the OCR, the reader's output or its suggestions (`benchmark.ts render` writes the images with nothing else). A draft is a reference only after someone other than its drafter has checked it against the image line by line and signed the `checked` line; the scorer ignores a file without one.

## Scoring

`pnpm exec tsx tools/catena-review/benchmark.ts score` reads every checked transcription and reports, per page and per split:

- character and word error rates of the recogniser's own text (raw OCR) and of the reader's page text (after its automatic repairs and verified suggestions, before any manual correction), measured separately, so that better recognition and harmful cleanup cannot cancel out in one number
- lines of the page missing from the OCR, and lines read twice
- every change the reader logged on the page, made or suggested, judged against the transcription: agrees with the page, contradicts it, or cannot be told
- margin text (citations) error rate
- author tokens: printed on the page, and found by the parser on that leaf
