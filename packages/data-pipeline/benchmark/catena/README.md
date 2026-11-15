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

### Suggestion rules: a stratified sample (2026-11-14)

Question: how often is a suggestion of each of the five largest rules right, read on the page image? Earlier verdicts came from damaged pages and could not answer it.

Sample: for each rule, the open suggestion with the lowest id in each third of the page (top, middle, foot) of each of the eight volumes, 24 a rule and 120 in all, drawn from the log at commit a201833. Benchmark pages, held-out and development, were left out. Each was read on a strip of its page image (its line and the lines either side), not on the whole page.

| Rule | Right | Wrong | What the wrong ones were |
|---|---|---|---|
| lone-consonant | 18 of 24 | 5 harmful, 1 a printed footnote mark | the "stray" letter was part of a word the recogniser split or half lost (d mons for dæmons, M e for Me, tr e for true, y for by, t for it): removing it damages the text further |
| lone-digit | 19 of 24 | 2 harmful, 2 printed reference marks, 1 Hebrew | a 1 that is the word I (twice); a superscript mark answering a margin note, one of them naming an author ('1 Pseudo-Jerome.', Mark leaf 166); Hebrew in a footnote read as digits |
| italic-frequency | 11 of 24 | 11 sound words, 2 wrong corrections | nine of the sound words are "wilt", three of them in scripture text; "duly" would have become "duty"; twice the reading was wrong and so was the proposed word (ure for are, proposed we; ome for come, proposed one) |
| dictionary-cut-frequency | 2 of 24 | 16 sound words, 5 other misreadings, 1 Greek | whole words (uphold, island, forborne, Anselm), words broken at a line end, Latin words; five flagged a real misreading the cut would not mend (ihe, mew, uwhen, rwith); Greek read as Latin letters |
| one-as-I-by-pair | 3 of 24 | 19 stray marks, 2 margin marks | nothing is printed there: the 1 wants removing, which the paired lone-digit suggestion proposes, not turning into I |

Of the 24 lone-digit cases, five were a digit from a margin scripture reference read into the text, and four stood before an author token. Two of the 120 touched a printed reference mark that answers a margin note; one of those is an attribution case of the kind recorded under issue 430.

What it shows, within this sample: no rule is safe to settle as a class. The two that are usually right (lone-consonant, lone-digit) are wrong about one time in four or five, and their wrong cases are the damaging ones (a real letter or the word I removed, a printed mark dropped). one-as-I-by-pair is almost always wrong where its lone-digit twin is right, so the pair should be read together. "wilt" accounts for most of italic-frequency's false positives and could be left out of that rule. dictionary-cut-frequency rarely finds a lost space; its value is as a flag for a misread word.

Limits: 24 cases a rule gives a wide margin (18 of 24 is roughly 55 to 90 per cent at the usual confidence); one case to a volume and page third is not a random draw; a strip does not show the margin's full note or the rest of the page; the reader was an AI model and no second reader checked the readings.

The 103 clear cases were recorded as page-read verdicts (53 apply, 50 keep). Seventeen were left open because neither verdict is right: the text is misread and needs a line correction read from the page.

### The fl ligature read as f: every "fee" checked (2026-11-14)

Whole-page reads had found "fee" and "feeth" where the page prints "flee" and "fleeth". Every remaining "fee" in the corpus was then looked for in the OCR documents (39 lines, none on a held-out page) and each read on a strip of its page image.

| Volume | Lines | Leaves |
|---|---|---|
| Luke 1-10 | 4 | 132, 133, 133, 334 |
| Matthew 11-21 | 2 | 111, 295 |
| John 11-21 | 1 | 165 |
| Matthew 1-10 | 5 | 101, 102, 121, 407, 409 |
| Matthew 22-28 | 3 | 74, 81, 85 |
| Mark | 5 | 69, 270, 271, 350, 350 |
| John 1-10 | 10 | 184, 228, 350, 353, 359, 359, 359, 359, 359, 359 |
| Luke 11-24 | 9 | 137, 217, 303, 304, 312, 315, 317, 385, 414 |

All 39 print "flee", set with the fl ligature, which the recogniser read as a plain f. "fee" is an English word of another meaning, so each changed the sense, and no dictionary check could catch it. Eight are in the scripture text of a lemma (Matthew 2:13, 3:7, 10:23, 24:16; Mark 13:14; Luke 3:7, 21:21; John 10:5); the rest are in commentary or in quotations of those verses. One had been corrected by a whole-page read; the other 38 were corrected one by one with line corrections, each placed by the words around it on its leaf. Nothing was replaced across the corpus.

Not looked for: other words in which a ligature (fl, fi, ff, ffi, ffl) was read short and left a real word behind. The whole-page reads met "fax" for flax, "fatter" for flatter and "favour" for flavour; an importer rule already mends those that leave a non-word (chiefy, dificulty). How many real-word cases remain is not known.

### Margin citations: a 64-page audit (2026-11-14)

Question: how often is a margin note in the corpus what the page prints? The 48 pages read whole earlier cannot answer it, because they were chosen for known damage.

Sample: eight leaves from each of the eight scans. For each scan, every leaf the corpus places in a chain, less the held-out benchmark leaves, was ranked by the SHA-256 of the string `catena-margin-audit-2026-11-14|<scan item>|<leaf>` and the first eight taken. Suggestion counts, recognition scores and earlier corrections played no part. One leaf drawn (Mark, leaf 352) had already been read whole; its notes are counted as the import gave them before that correction.

Method: each page was rendered in two halves and every margin note printed on it compared with the citation the corpus carries for the excerpt it stands beside. A note is one printed unit (a source reference, a scripture reference, a gloss). Only notes printed on the sampled leaf were counted; the part of a note that runs on from or to a neighbouring leaf was not. The running text was not verified.

| Volume | Pages (with no note) | Notes | Exact | Right but for spacing or punctuation | Wrong text, minor | Wrong text, changes the reference | Missing | Given to the wrong excerpt | Ambiguous | Pages with an error |
|---|---|---|---|---|---|---|---|---|---|---|
| Matthew 1-10 | 8 (0) | 25 | 6 | 12 | 2 | 5 | 0 | 0 | 0 | 6 |
| Matthew 11-21 | 8 (1) | 21 | 3 | 6 | 6 | 6 | 0 | 0 | 0 | 7 |
| Matthew 22-28 | 8 (2) | 14 | 4 | 6 | 4 | 0 | 0 | 0 | 0 | 3 |
| Mark | 8 (1) | 36 | 15 | 11 | 2 | 3 | 1 | 3 | 1 | 5 |
| Luke 1-10 | 8 (1) | 21 | 2 | 10 | 4 | 5 | 0 | 0 | 0 | 7 |
| Luke 11-24 | 8 (2) | 18 | 3 | 11 | 3 | 1 | 0 | 0 | 0 | 4 |
| John 1-10 | 8 (0) | 42 | 14 | 11 | 11 | 5 | 0 | 0 | 1 | 7 |
| John 11-21 | 8 (0) | 41 | 6 | 21 | 6 | 7 | 0 | 1 | 0 | 8 |
| All | 64 (7) | 218 | 53 | 88 | 38 | 32 | 1 | 4 | 2 | 47 |

"Minor" is a wrong reading that leaves the reference findable (lines out of order, a dropped "de", "l" for "1" in a chapter). "Changes the reference" is a wrong or lost number, book or work: a homily or tract number misread (lxvii as lxvi, xxxiii as xxxii, li as hi), a scripture chapter or verse lost, or Greek read as Latin letters.

Overall, of 218 notes: 141 (65 per cent; 58 to 71 at 95 per cent confidence) are right, 53 of them exactly and 88 but for spacing or punctuation; 77 (35 per cent; 29 to 42) are wrong in some way; 39 (18 per cent; 13 to 24) are wrong in a way that changes or loses the reference, counting the missing, misassigned and ambiguous ones. 47 of the 64 pages (73 per cent; 62 to 83) carry at least one error, and 47 of the 57 pages that print any note.

What the errors are: misordered lines of a note set in a narrow column are the commonest cause; roman numerals are the commonest casualty; four notes had been given to a neighbouring excerpt and one was absent; four Greek glosses were read as Latin letters; two notes are ambiguous as to author or place (a text token CHRYS. beside a margin note beginning "Aug. (Chrys. Nic.)", and a scripture reference level with the end of one excerpt that answers the opening of the next). Every confirmed error was corrected with the excerpt-keyed citation correction, and each page has a review record of scope "margin citations".

Limits: eight pages a volume is too few to compare volumes (the per-volume rows are counts, not rates to rely on); the intervals treat notes as independent, though errors cluster by page, so the true intervals are wider; a faint or crowded note was sometimes hard to read, and where the print itself looks wrong it was recorded as printed; the reader was an AI model and no second reader checked the readings; whether a correct note is attached to the right excerpt was judged by where it stands on the page, which the edition does not always make plain.

Cross-page notes: thirteen of the 28 whole-page reviews with a blocker were blocked by a note that runs on to or from the next leaf. Showing the upper half of the adjacent leaf was tried on five of them and resolved all five; two more had been resolved earlier the same way. No attribution was changed. The adjacent leaf is now the rule for a note that runs over a page. The eight left over and the four such notes met in the margin audit were then read the same way (twelve leaves): all twelve were settled as to the Latin and scripture references, seven with nothing to correct and five with a correction (a homily number misread on two, a tract number on one, a lost number on one, a scripture reference lost on one), and one scripture reference seen in passing was moved from an Augustine excerpt to the Theophylact excerpt it stands beside. One note still holds a Greek gloss that is not transcribed (#429).

### The fl ligature read as f: further words (2026-11-14)

After "fee", a bounded audit of other words that lose their sense when "fl" is read as "f". It began with an inventory of the corpus: every word that becomes a word of the edition when an "l" is put back after its "f". Real words were then screened by their context (for example "fed from", "fight into Egypt", "tormented in this fame", "the food came"), since "fed", "fight", "fame" and "food" are also words the edition prints.

| Read by the OCR | The page prints | Lines read | Confirmed |
|---|---|---|---|
| fed | fled | 37 | 37 |
| fight | flight | 20 | 20 |
| fame | flame | 17 | 17 |
| food, foods | flood, floods | 13 | 13 |
| fesh | flesh | 6 | 6 |
| fees | flees | 5 | 5 |
| fatter | flatter | 4 | 4 |
| four | flour | 4 | 4 |
| fax, far, flar | flax | 5 | 5 |
| favour | flavour | 2 | 2 |
| few | flew | 1 | 1 |
| fed (after "cruci-") | fied | 1 | 1 (the fi ligature) |

115 lines were read on strips of their page images and all 115 were wrong as the OCR had them; each was corrected by its own line correction, and no replacement rule was added. Two further lines turned up already corrected in September and were left alone. Sixteen of the lines are scripture text: Matthew 7:25, 7:27, 8:33, 12:20, 24:20, 24:38, 24:39, 26:56; Mark 13:18, 14:50, 14:52, 16:8; Luke 6:48, 8:34, 16:24, 17:27. Every one changed the meaning. One September verdict on a corrected line (the "ID." of leaf 50, Matthew 11-21) was folded into the line correction, because it was bound to the line as it read before.

Not read, and still candidates: fourteen more "fight" in a context that suggests flight; the non-words fo (4), superfuities (8), superfuous (2), foor, confict, fing, confagrations, overfows, infame, infames, overfowing and feeth (one each); "signiflies" (3) and "signiflying" (4), where fi was read as fl; "crucifed" (2); and three "fax" on a held-out benchmark page, which is not to be touched. The words left as real words after the context screen (74 fed, 67 fame, 331 food, 137 few, 164 four, 75 favour, 292 feet) were not read on the page, so the screen's misses are unknown.

### What the acceptance gate's lexical findings are (2026-11-15)

`accept:catena` passes its structural and identity tiers and stops at the text tier with 4,759 excerpts whose words differ from the comparison transcription (7,332 separate differences). Every difference was classified by its shape, and a sample of 100 was read on strips of the page images. The sample is stratified by shape and ranked by sha256 of `catena-gate-audit-2026-11-15|<finding id>|<difference index>`; held-out pages are excluded. An AI model read the strips and no second reader checked.

| Shape of the difference | In the corpus | Read | The page supports our text | OCR error in ours | Words missing from ours | Footnote, Greek or reference mark in ours | Not settled on the strip |
|---|---|---|---|---|---|---|---|
| One word against a near word, both real ("be"/"he") | 1,688 | 14 | 11 | 3 | 0 | 0 | 0 |
| One word against a near word, ours not a word | 1,799 | 6 | 0 | 6 | 0 | 0 | 0 |
| Spacing only ("ofchrists") | 913 | 0 | | | | | |
| A digit or reference number | 758 | 6 | 0 | 5 | 0 | 1 | 0 |
| One to three words only in ours | 948 | 12 | 5 | 6 | 0 | 1 | 0 |
| One to three words only in the comparison | 376 | 12 | 9 | 0 | 2 | 0 | 1 |
| A different word | 384 | 12 | 10 | 2 | 0 | 0 | 0 |
| Four or more words only in the comparison | 149 | 12 | 0 | 0 | 9 | 0 | 3 |
| Four or more words only in ours | 43 | 10 | 5 | 0 | 0 | 5 | 0 |
| A run at the start or end of the excerpt | 91 | 10 | 7 | 0 | 2 | 1 | 0 |
| A run reworded | 125 | 6 | 0 | 5 | 1 | 0 | 0 |
| The comparison's own misspelling | 58 | 0 | | | | | |
| **Sample** | | **100** | **47** | **27** | **14** | **8** | **4** |

What the classes are:

- The page supports our text (47 of 100): the comparison modernises ("doest" to "does", "thither" to "there"), misreads ("shredding" for "wedding", "soil" for "Son"), drops or adds a word, or divides the excerpts at another place. These are not defects of the corpus.
- OCR error in ours (27): a wrong or stray character, words run together, a lost ligature. The suggestion queue and the page reviews are the route for these.
- Words missing from ours (14): the page prints words the corpus does not have. Nine of the twelve long runs read were whole printed lines the OCR never returned, most of them beside a margin note or at the head of a page. The queue cannot see these, because it lists only lines the recogniser returned with a low score. This is the one class that loses text silently.
- Footnote, Greek or reference mark in ours (8): a footnote line or a Greek phrase read into the chain, or a printed reference mark kept as a digit (#429 for the Greek and Hebrew).
- No difference read was duplicated text, and none was text given to the wrong excerpt apart from the boundary differences above.

The proportions hold within each shape only; the sample is too small for a corpus-wide rate. 132 findings have a run of four or more words found only in the comparison and away from the excerpt's edge, which is the shape that was a lost line nine times in twelve.
