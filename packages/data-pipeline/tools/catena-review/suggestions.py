"""
Read the reader's suggestions on the page images, and record what the page shows.

    python3 suggestions.py list [--rule R] [--item PREFIX] [--leaf N]     suggestions with their ids, or counts by rule
    python3 suggestions.py sheet --rule R [--item PREFIX] [--leaf N] [--from K] [--count C]
                                                                          strips of their lines, labelled by id (12 a sheet)
    python3 suggestions.py pick ID [ID ...]                               strips of the named suggestions
    python3 suggestions.py record apply|keep ID [ID ...] --note "..."     record what the page shows for each

A suggestion is a change the reader proposes but does not make (see transform-log.ts). Its id is fixed by the
rule, the scan, the characters' place on the page and the change itself, so a listing, a sheet and a record
name the same occurrence however they were filtered, and a rebuild that moves or changes it retires the id
instead of pointing it elsewhere. Each sheet saves the ids it shows and the log it was drawn from beside the
image. Record only what the strip shows; a record says the page shows the change should be made (apply) or
the text stands as read (keep). Clearing the queue does not mean applying everything.
"""
import argparse, datetime, hashlib, json, os, sys
from PIL import Image, ImageDraw
from common import CORRECTIONS, PROCESSED, SCRATCH, page_image

TRANSFORMS = PROCESSED / 'commentary-catena-aurea.transforms.json'
VERIFIED = CORRECTIONS / 'catena-aurea.transforms-verified.json'


def snapshot():
    return hashlib.sha256(TRANSFORMS.read_bytes()).hexdigest()[:16]


def open_suggestions():
    """Suggestions not yet recorded, by id; an id two occurrences share can never be recorded."""
    pool = [t for t in json.load(open(TRANSFORMS)) if not t.get('applied') and 'verified' not in t]
    counts = {}
    for t in pool:
        counts[t['id']] = counts.get(t['id'], 0) + 1
    return pool, {i for i, n in counts.items() if n > 1}


def select(pool, rule=None, item=None, leaf=None):
    return [t for t in pool if (not rule or t['rule'] == rule) and (not item or t.get('item', '').startswith(item)) and (leaf is None or t.get('leaf') == leaf)]


def strip(t):
    """The suggestion's line and the lines either side, cut at the height its span names."""
    img = page_image(t['item'], t['leaf'])
    w, h = img.size
    line = round(w * 0.028)
    y = t.get('y', -1)
    if y is None or y < 0:
        return None
    crop = img.crop((0, max(0, y - line), w, min(h, y + 2 * line))).convert('RGB')
    ImageDraw.Draw(crop).rectangle((0, min(line, y), 14, min(line, y) + line), fill=(220, 0, 0))
    cw, ch = crop.size
    return crop.resize((1800, round(ch * 1800 / cw)), Image.Resampling.LANCZOS).convert('L')


def sheet(items, name):
    pieces = []
    for t in items:
        bar = Image.new('L', (1800, 44), 255)
        d = ImageDraw.Draw(bar)
        d.text((6, 4), f"{t['id']}  {t['item'][:14]} leaf {t['leaf']}  {t['rule']}  {t.get('span', '')}", fill=0)
        d.text((6, 24), f"{t['from']!r}  ->  {t['to']!r}"[:200], fill=0)
        pieces.append(bar)
        s = strip(t)
        if s:
            pieces.append(s)
    canvas = Image.new('L', (1800, sum(p.size[1] for p in pieces) + 4 * len(pieces)), 160)
    y = 0
    for p in pieces:
        canvas.paste(p, (0, y))
        y += p.size[1] + 4
    out = SCRATCH / f'sheet-{name}.png'
    canvas.save(out)
    (SCRATCH / f'sheet-{name}.json').write_text(json.dumps({'transforms': snapshot(), 'ids': [t['id'] for t in items]}))
    print(out, len(items))


def record(verdict, ids, note):
    if os.path.getmtime(TRANSFORMS) < os.path.getmtime(PROCESSED / 'commentary-catena-aurea.json'):
        sys.exit('the transforms file is older than the corpus: run import:catena first')
    pool, shared = open_suggestions()
    by_id = {t['id']: t for t in pool}
    missing = [i for i in ids if i not in by_id]
    if missing or any(i in shared for i in ids):
        sys.exit(f'not one current suggestion each: missing {missing}, shared {[i for i in ids if i in shared]}')
    verified = json.load(open(VERIFIED)) if VERIFIED.exists() else []
    today = datetime.date.today().isoformat()
    for i in ids:
        t = by_id[i]
        verified.append({'id': i, 'rule': t['rule'], 'item': t['item'], 'leaf': t['leaf'], 'span': t['span'], 'from': t['from'], 'to': t['to'], 'verdict': verdict, 'reviewed': today, 'note': note})
    with open(VERIFIED, 'w') as f:
        json.dump(verified, f, indent=1, ensure_ascii=False)
        f.write('\n')
    print(f'recorded {len(ids)} {verdict} ({len(verified)} verified in all)')


if __name__ == '__main__':
    ap = argparse.ArgumentParser(usage=__doc__)
    ap.add_argument('cmd')
    ap.add_argument('args', nargs='*')
    ap.add_argument('--rule')
    ap.add_argument('--item')
    ap.add_argument('--leaf', type=int)
    ap.add_argument('--from', dest='start', type=int, default=0)
    ap.add_argument('--count', type=int, default=12)
    ap.add_argument('--note', default='')
    a = ap.parse_args()
    pool, shared = open_suggestions()
    if a.cmd == 'list':
        chosen = select(pool, a.rule, a.item, a.leaf)
        if a.rule or a.item or a.leaf is not None:
            for t in chosen:
                print(t['id'], '(shared)' if t['id'] in shared else '', t['rule'], t['item'][:14], t['leaf'], repr(t['from']), '->', repr(t['to']))
        else:
            counts = {}
            for t in chosen:
                counts[t['rule']] = counts.get(t['rule'], 0) + 1
            for r, c in sorted(counts.items(), key=lambda kv: -kv[1]):
                print(f'{r:28} {c}')
    elif a.cmd == 'sheet':
        chosen = select(pool, a.rule, a.item, a.leaf)[a.start:a.start + a.count]
        sheet(chosen, f"{a.rule or 'all'}-{a.item or ''}-{a.leaf if a.leaf is not None else ''}-{a.start}")
    elif a.cmd == 'pick':
        by_id = {t['id']: t for t in pool}
        sheet([by_id[i] for i in a.args], 'pick-' + '-'.join(a.args)[:80])
    elif a.cmd == 'record':
        record(a.args[0], a.args[1:], a.note)
    else:
        sys.exit(__doc__)
