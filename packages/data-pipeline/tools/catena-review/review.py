"""
Page review: the lexical findings on one leaf, with strips of the page image where each difference sits.

    python3 review.py queue [below]              pages with lexical findings under a similarity, worst first
    python3 review.py page <item-prefix> <leaf>  the differences on a leaf, and an image of their lines
    python3 review.py at <item-prefix> <leaf> <words> [after] [before]
                                                 an image of the line holding those words, and lines around it

A difference is shown unless its words are the same or a pair the classifier accepts (pairs.json), so what
is hidden here is exactly what the oracle comparison hides. Images go to data/scratch/catena-review.
"""
import difflib, json, sys
from PIL import Image, ImageDraw
from common import CORRECTIONS, SCRATCH, item_of, load_pairs, norm, ocr_lines, page_image

PAIRS, VARIANTS = load_pairs()
REVIEWED = {d['id'] for d in json.load(open(CORRECTIONS / 'catena-aurea.discrepancies.json')) if d['kind'] == 'text'}
OPEN = [p for p in PAIRS if p['kind'] == 'lexical' and p['id'] not in REVIEWED]


def same(a, b):
    return a == b or f'{a} {b}' in VARIANTS


def spans(p):
    a, b = p['a'], p['b']
    out = []
    for tag, i1, i2, j1, j2 in difflib.SequenceMatcher(None, a, b, autojunk=False).get_opcodes():
        if tag == 'equal':
            continue
        if tag == 'replace' and i2 - i1 == j2 - j1 and all(same(u, v) for u, v in zip(a[i1:i2], b[j1:j2])):
            continue
        out.append((tag, i1, i2, j1, j2))
    return out


def locate(lines, words):
    """The line holding the longest run of consecutive context words."""
    best = None
    for l in lines:
        t = ' ' + norm(l['text']) + ' '
        for n in range(min(4, len(words)), 0, -1):
            if any(' ' + ' '.join(words[k:k + n]) + ' ' in t for k in range(0, len(words) - n + 1)):
                if not best or n > best[0]:
                    best = (n, l)
                break
    return best[1] if best else None


def strip(img, y1, y2, s, width=1800):
    crop = img.crop((int(40 * s), int(y1 * s), int(1590 * s), int(y2 * s)))
    cw, ch = crop.size
    return crop.resize((width, round(ch * width / cw)), Image.Resampling.LANCZOS)


def page(prefix, leaf, out=None):
    item, leaf = item_of(prefix), int(leaf)
    out = out or SCRATCH / f'page-{item}-{leaf}.png'
    fs = sorted([p for p in OPEN if p['item'] == item and p['leaf'] == leaf], key=lambda p: p['csim'])
    lines = ocr_lines(item, leaf)
    img = page_image(item, leaf)
    s = img.size[0] / 1600
    strips = []
    for p in fs:
        print(f"== {p['id']} csim {p['csim']:.2f} {p['author']} / {p['oracleAuthor']}")
        for tag, i1, i2, j1, j2 in spans(p):
            a, b = p['a'], p['b']
            ctx, ours, theirs, after = a[max(0, i1 - 3):i1], a[i1:i2], b[j1:j2], a[i2:i2 + 3]
            print(f"   [{' '.join(ctx)}] OURS <<{' '.join(ours)[:80]}>> ORACLE <<{' '.join(theirs)[:80]}>> [{' '.join(after)}]")
            l = locate(lines, ctx + ours + after) or locate(lines, ctx + after)
            if l:
                strips.append((p['id'], ' '.join(ours)[:30] + ' | ' + ' '.join(theirs)[:30], max(0, l['y1'] - 75), min(img.size[1] / s, l['y2'] + 75)))
            else:
                print('   (no line located)')
    strips.sort(key=lambda t: t[2])
    merged = []
    for sid, lab, y1, y2 in strips:
        if merged and y1 <= merged[-1][3]:
            merged[-1][3] = max(merged[-1][3], y2)
            merged[-1][1] += ' || ' + lab
        else:
            merged.append([sid, lab, y1, y2])
    pieces = []
    for sid, lab, y1, y2 in merged:
        bar = Image.new('L', (1800, 26), 255)
        ImageDraw.Draw(bar).text((6, 6), f'{sid}  {lab}'[:170], fill=0)
        pieces += [bar, strip(img, y1, y2, s)]
    if not pieces:
        print('no strips')
        return
    canvas = Image.new('L', (1800, sum(x.size[1] for x in pieces) + 6 * len(pieces)), 200)
    y = 0
    for x in pieces:
        canvas.paste(x, (0, y))
        y += x.size[1] + 6
    canvas.save(out)
    print('image', out, canvas.size, 'strips', len(merged))


def at(prefix, leaf, words, after=2, before=0, out=None):
    item, leaf = item_of(prefix), int(leaf)
    out = out or SCRATCH / 'at.png'
    l = locate(ocr_lines(item, leaf), norm(words).split())
    if not l:
        print('not found')
        return
    img = page_image(item, leaf)
    s = img.size[0] / 1600
    strip(img, max(0, l['y1'] - 30 - before * 58), min(img.size[1] / s, l['y2'] + 30 + after * 58), s).save(out)
    print(out)


def queue(below=0.8):
    pages = {}
    for p in OPEN:
        if p['csim'] < below:
            pages.setdefault((p['item'], p['leaf']), []).append(p['csim'])
    for (it, lf), v in sorted(pages.items(), key=lambda kv: min(kv[1])):
        print(it, lf, f'{min(v):.2f}', len(v), 'lexical on page:', sum(1 for p in OPEN if p['item'] == it and p['leaf'] == lf))


if __name__ == '__main__':
    cmd, args = sys.argv[1], sys.argv[2:]
    if cmd == 'queue':
        queue(float(args[0]) if args else 0.8)
    elif cmd == 'page':
        page(*args[:3])
    elif cmd == 'at':
        at(args[0], args[1], args[2], *(int(x) for x in args[3:5]))
    else:
        sys.exit(__doc__)
