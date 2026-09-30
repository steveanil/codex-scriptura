"""
Read the reader's suggestions on the page images, and record what the page shows.

    python3 suggestions.py list [rule] [item-prefix]          counts, or the suggestions of a rule
    python3 suggestions.py sheet <rule> [start] [count]       numbered strips of the page lines (default 12 a sheet)
    python3 suggestions.py pick <rule> <n> [<n> ...]          strips of the numbered occurrences only
    python3 suggestions.py record apply|keep <rule> <n> [<n> ...] [--note "..."]
                                                              record the numbered occurrences as read on the page

A suggestion is a change the reader proposes but does not make (see transform-log.ts). Numbers are the
positions in `list`, stable while the corpus is unchanged; recording refuses a transforms file older than the
corpus. What a record says: the page shows the change should be made (apply) or the text stands (keep).
"""
import datetime, difflib, json, os, sys
from PIL import Image, ImageDraw
from common import CORRECTIONS, PROCESSED, SCRATCH, item_of, norm, ocr_lines, page_image

TRANSFORMS = PROCESSED / 'commentary-catena-aurea.transforms.json'
VERIFIED = CORRECTIONS / 'catena-aurea.transforms-verified.json'


def suggestions(rule=None, prefix=None):
    out = [t for t in json.load(open(TRANSFORMS)) if not t.get('applied') and 'verified' not in t]
    if rule:
        out = [t for t in out if t['rule'] == rule]
    if prefix:
        out = [t for t in out if t.get('item', '').startswith(prefix)]
    return out


def place(t):
    """The OCR line holding the suggestion, and the x span of the changed characters in rendered pixels."""
    lines = ocr_lines(t['item'], t['leaf'])
    ctx = norm(t['from'])
    best, score = None, 0
    for l in lines:
        s = difflib.SequenceMatcher(None, norm(l['text']), ctx).find_longest_match(0, len(norm(l['text'])), 0, len(ctx)).size
        if s > score:
            best, score = l, s
    if not best:
        return None, None
    # Where the texts part: the first character of `from` that `to` does not keep
    k = next((i for i, (a, b) in enumerate(zip(t['from'], t['to'])) if a != b), min(len(t['from']), len(t['to'])))
    anchor = t['from'][max(0, k - 12):k]
    at = best['text'].find(anchor)
    if at < 0 or not best.get('chars'):
        return best, None
    i = min(at + len(anchor), len(best['chars']) - 1)
    return best, (best['chars'][i][1], best['chars'][min(i + 2, len(best['chars']) - 1)][2])


def sheet(rule, start=0, count=12, picks=None):
    pool = suggestions(rule)
    numbered = [(n, pool[n]) for n in picks] if picks else list(enumerate(pool))[start:start + count]
    items = [t for _, t in numbered]
    pieces = []
    for n, t in numbered:
        line, span = place(t)
        bar = Image.new('L', (1800, 44), 255)
        d = ImageDraw.Draw(bar)
        d.text((6, 4), f"#{n}  {t['item'][:14]} leaf {t['leaf']}  {t['rule']}", fill=0)
        d.text((6, 24), f"{t['from']!r}  ->  {t['to']!r}"[:200], fill=0)
        pieces.append(bar)
        if not line:
            continue
        img = page_image(t['item'], t['leaf'])
        s = img.size[0] / 1600
        y1, y2 = max(0, line['y1'] - 40), line['y2'] + 40
        crop = img.crop((0, int(y1 * s), img.size[0], int(y2 * s))).convert('RGB')
        if span:
            ImageDraw.Draw(crop).rectangle((int(span[0] * s) - 6, int((line['y2'] - y1 - 14) * s) - 4, int(span[1] * s) + 6, int((line['y2'] - y1 - 14) * s)), fill=(220, 0, 0))
        cw, ch = crop.size
        pieces.append(crop.resize((1800, round(ch * 1800 / cw)), Image.Resampling.LANCZOS).convert('L'))
    canvas = Image.new('L', (1800, sum(p.size[1] for p in pieces) + 4 * len(pieces)), 160)
    y = 0
    for p in pieces:
        canvas.paste(p, (0, y))
        y += p.size[1] + 4
    out = SCRATCH / f'sheet-{rule}-{"p" + "-".join(map(str, picks)) if picks else start}.png'
    canvas.save(out)
    print(out, f'{len(items)} of {len(suggestions(rule))}')


def record(verdict, rule, numbers, note):
    if os.path.getmtime(TRANSFORMS) < os.path.getmtime(PROCESSED / 'commentary-catena-aurea.json'):
        sys.exit('the transforms file is older than the corpus: run import:catena first')
    pool = suggestions(rule)
    verified = json.load(open(VERIFIED)) if VERIFIED.exists() else []
    today = datetime.date.today().isoformat()
    for n in numbers:
        t = pool[n]
        verified.append({'rule': t['rule'], 'item': t['item'], 'leaf': t['leaf'], 'from': t['from'], 'to': t['to'], 'verdict': verdict, 'reviewed': today, 'note': note})
    with open(VERIFIED, 'w') as f:
        json.dump(verified, f, indent=1, ensure_ascii=False)
        f.write('\n')
    print(f'recorded {len(numbers)} {verdict} ({len(verified)} verified in all)')


if __name__ == '__main__':
    cmd, args = (sys.argv[1], sys.argv[2:]) if len(sys.argv) > 1 else ('', [])
    if cmd == 'list':
        pool = suggestions(args[0] if args else None, args[1] if len(args) > 1 else None)
        if args:
            for n, t in enumerate(pool):
                print(n, t['item'][:14], t['leaf'], repr(t['from']), '->', repr(t['to']))
        else:
            counts = {}
            for t in pool:
                counts[t['rule']] = counts.get(t['rule'], 0) + 1
            for r, c in sorted(counts.items(), key=lambda kv: -kv[1]):
                print(f'{r:28} {c}')
    elif cmd == 'sheet':
        sheet(args[0], *(int(x) for x in args[1:3]))
    elif cmd == 'pick':
        sheet(args[0], picks=[int(x) for x in args[1:]])
    elif cmd == 'record':
        note = args[args.index('--note') + 1] if '--note' in args else ''
        nums = [int(x) for x in (args[2:args.index('--note')] if '--note' in args else args[2:])]
        record(args[0], args[1], nums, note)
    else:
        sys.exit(__doc__)
