"""
Page strips for the gate's suspected omissions: each run of words the transcription has inside an excerpt and ours
does not, shown where it would stand on the page, so a reader can say whether the page prints it.

    uv run --project ocr python tools/catena-review/omissions.py [--start N] [--count N]

Reads the gate report (run accept:catena first) and the oracle report. Writes sheets of eight strips to
data/scratch/catena-review/omissions-<n>.png and the list they show to omissions.json, with the OCR lines around
each place as the corrections name them. Held-out benchmark pages are listed and never rendered.
"""
import json, re, sys
from PIL import Image, ImageDraw
from common import PIPELINE, PROCESSED, SCRATCH, norm, ocr_lines, page_image

args = sys.argv[1:]
opt = lambda name, default: int(args[args.index(name) + 1]) if name in args else default
start, count = opt('--start', 0), opt('--count', 10 ** 6)

gate = json.load(open(PROCESSED / 'commentary-catena-aurea.gate-report.json'))
findings = {f['id']: f for f in json.load(open(PROCESSED / 'commentary-catena-aurea.oracle-report.json'))['findings'] if f['kind'] == 'text'}
index = json.load(open(PROCESSED / 'commentary-catena-aurea.review-index.json'))
held = {(p['item'], p['leaf']) for p in json.load(open(PIPELINE / 'benchmark' / 'catena' / 'pages.json'))['held-out']}

tasks = []
for o in gate['openOmissions']:
    f = findings[o['id']]
    theirs = norm(f['compared'].split('\n')[1].split(': ', 1)[1]).split()
    entry, n = o['id'].split('#')
    leaves = index[entry]['excerptLeaves']
    n = min(int(n) - 1, len(leaves) - 1)
    first, last = leaves[n], leaves[n + 1] if n + 1 < len(leaves) else leaves[n] + 1
    for run in o['omissions']:
        words = run.split()
        # The run is in canonical words; the first and last three place it well enough in the transcription
        at = next((i for i in range(len(theirs)) if theirs[i:i + 3] == words[:3] or theirs[i + len(words) - 3:i + len(words)] == words[-3:]), None)
        before, after = (theirs[max(0, at - 7):at], theirs[at + len(words):at + len(words) + 7]) if at is not None else ([], [])
        best = None
        for leaf in range(first, min(last, first + 3) + 1):
            try:
                lines = ocr_lines(o['item'], leaf)
            except KeyError:
                continue
            for i, l in enumerate(lines):
                here = norm(l['text']).split()
                nxt = norm(lines[i + 1]['text']).split() if i + 1 < len(lines) else []
                score = 2 * sum(1 for w in before[-4:] if w in here) + sum(1 for w in before[:-4] if w in here) + sum(1 for w in after[:4] if w in here + nxt)
                if best is None or score > best[0]:
                    best = (score, leaf, i)
        task = {'id': o['id'], 'item': o['item'], 'fingerprint': o['fingerprint'], 'run': run, 'before': ' '.join(before), 'after': ' '.join(after)}
        if best and best[0] >= 4:
            _, leaf, i = best
            lines = ocr_lines(o['item'], leaf)
            task.update(leaf=leaf, line=i, near=[l['text'] for l in lines[max(0, i - 2):i + 5]], held=(o['item'], leaf) in held)
        else:
            task.update(leaf=first, line=None, held=any((o['item'], l) in held for l in range(first, last + 1)))
        tasks.append(task)

json.dump(tasks, open(SCRATCH / 'omissions.json', 'w'), indent=1, ensure_ascii=False)
print(len(tasks), 'runs;', sum(1 for t in tasks if t['line'] is None), 'not placed;', sum(1 for t in tasks if t['held']), 'on held-out pages')

chosen = [(k, t) for k, t in enumerate(tasks) if start <= k < start + count]
for s in range(0, len(chosen), 8):
    pieces = []
    for k, t in chosen[s:s + 8]:
        bar = Image.new('L', (1600, 64), 255)
        d = ImageDraw.Draw(bar)
        d.text((6, 4), f"#{k} {t['id'][7:]} leaf {t['leaf']}" + (' HELD-OUT, not shown' if t['held'] else '') + (' NOT PLACED' if t['line'] is None else ''), fill=0)
        d.text((6, 24), f"... {t['before']} [[ {t['run'][:150]} ]]"[:250], fill=0)
        d.text((6, 44), f"   {t['run'][150:300]} ]] {t['after']} ..."[:250] if len(t['run']) > 150 else f"   {t['after']} ...", fill=0)
        pieces.append(bar)
        if t['held'] or t['line'] is None:
            continue
        img = page_image(t['item'], t['leaf'])
        w, h = img.size
        lines = ocr_lines(t['item'], t['leaf'])
        scale = w / 1600
        y = lines[t['line']]['y1'] * scale
        pitch = w * 0.028
        down = 4 + len(t['run'].split()) // 9
        crop = img.crop((0, max(0, round(y - 2.2 * pitch)), w, min(h, round(y + down * pitch))))
        ImageDraw.Draw(crop).rectangle((0, round(min(2.2 * pitch, y)), 16, round(min(2.2 * pitch, y) + pitch)), fill=0)
        pieces.append(crop.resize((1600, round(crop.size[1] * 1600 / crop.size[0])), Image.Resampling.LANCZOS))
    sheet = Image.new('L', (1600, sum(p.size[1] for p in pieces) + 3 * len(pieces)), 150)
    y = 0
    for p in pieces:
        sheet.paste(p, (0, y))
        y += p.size[1] + 3
    out = SCRATCH / f'omissions-{(start + s) // 8}.png'
    sheet.save(out)
    print(out)
