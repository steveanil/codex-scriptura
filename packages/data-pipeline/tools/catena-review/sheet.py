"""
One image of a queued page for reading: a strip for each unreadable line still uncorrected and for each line an
open suggestion sits on, top to bottom, strips that overlap drawn as one.

    python3 sheet.py <item-prefix> <leaf> [...more leaves]

It draws from the list queue.ts last wrote, so run that first; the image goes to data/scratch/catena-review and
what each strip holds is printed. Nothing else is written.
"""
import json, sys
from PIL import Image
from common import PROCESSED, SCRATCH, item_of, page_image

if len(sys.argv) < 3:
    sys.exit(__doc__)
item = item_of(sys.argv[1])
queue = {(p['item'], p['leaf']): p for p in json.load(open(SCRATCH / 'queue.json'))}
log = json.load(open(PROCESSED / 'commentary-catena-aurea.transforms.json'))
for leaf in map(int, sys.argv[2:]):
    page = queue.get((item, leaf))
    if not page:
        print(f'{item} {leaf}: not in the queue (done, held out, or outside the chain)')
        continue
    img = page_image(item, leaf)
    w, h = img.size
    bands = []
    for l in page['lines']:
        if l['state'] != 'corrected':
            height = (l['y2'] - l['y1']) * l['y'] / max(l['y1'], 1)
            notes = [f'UNREADABLE y {l["y"]} score {l["score"]} ({l["state"]}): {l["text"][:60]!r}'] + [f'    reader y {r["y"]}: {r["main"]!r}' for r in l['reader']]
            bands.append([l['y'] - height, l['y'] + 2 * height, notes])
    for t in log:
        if t.get('item') == item and t.get('leaf') == leaf and not t.get('applied') and not t.get('verified'):
            bands.append([t['y'] - 0.03 * w, t['y'] + 0.055 * w, [f'{t["id"]} {t["rule"]}: {t["from"]!r} -> {t["to"]!r}']])
    bands.sort(key=lambda b: (b[0], b[2]))
    merged = []
    for b in bands:
        if merged and b[0] < merged[-1][1]:
            merged[-1][1] = max(merged[-1][1], b[1])
            merged[-1][2] += b[2]
        else:
            merged.append(b)
    strips = [img.crop((0, max(0, int(top)), w, min(h, int(bottom)))) for top, bottom, _ in merged]
    gap = 14
    sheet = Image.new('RGB', (w, sum(s.size[1] for s in strips) + gap * len(strips)), (200, 0, 0))
    y = 0
    for s in strips:
        sheet.paste(s, (0, y))
        y += s.size[1] + gap
    if w > 1700:
        sheet = sheet.resize((1700, round(sheet.size[1] * 1700 / w)), Image.Resampling.LANCZOS)
    out = SCRATCH / f'sheet-{item}-{leaf}.png'
    sheet.save(out)
    print(f'{item} {leaf}: {out}')
    for i, (_, _, notes) in enumerate(merged):
        print(f'  strip {i + 1}:')
        for n in notes:
            print('     ', n)
