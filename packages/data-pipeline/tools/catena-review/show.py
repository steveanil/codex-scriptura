"""
Text views of the compared pairs (pairs.json), for scanning many findings at once.

    python3 show.py low <from> <below>        lexical pairs in a similarity band, by page
    python3 show.py page <item-prefix> <leaf> lexical pairs on a leaf
    python3 show.py ocr <item-prefix> <leaf>  the recogniser's lines on a leaf, with their boxes and pass
"""
import difflib, sys
from common import item_of, load_pairs, ocr_lines

PAIRS, _ = load_pairs()


def diff(p, ctx=2):
    a, b = p['a'], p['b']
    out = []
    for tag, i1, i2, j1, j2 in difflib.SequenceMatcher(None, a, b, autojunk=False).get_opcodes():
        if tag != 'equal':
            out.append(f"[{' '.join(a[max(0, i1 - ctx):i1])} <<{' '.join(a[i1:i2])}>> | <<{' '.join(b[j1:j2])}>> {' '.join(b[j2:j2 + ctx])}]")
    return ' '.join(out)


if __name__ == '__main__':
    mode = sys.argv[1] if len(sys.argv) > 1 else ''
    if mode == 'low':
        lo, hi = float(sys.argv[2]), float(sys.argv[3])
        for p in sorted((p for p in PAIRS if p['kind'] == 'lexical' and lo <= p['csim'] < hi), key=lambda p: (p['item'], p['leaf'])):
            print(f"{p['id']} {p['item'][:12]} L{p['leaf']} {p['csim']:.2f} {p['author']}/{p['oracleAuthor']} :: {diff(p)}"[:700])
    elif mode == 'page':
        item, leaf = item_of(sys.argv[2]), int(sys.argv[3])
        for p in PAIRS:
            if p['kind'] == 'lexical' and p['item'] == item and p['leaf'] == leaf:
                print(f"{p['id']} {p['csim']:.2f} {p['author']}/{p['oracleAuthor']} :: {diff(p, 3)}")
    elif mode == 'ocr':
        for i, l in enumerate(ocr_lines(item_of(sys.argv[2]), int(sys.argv[3]))):
            print(i, l['y1'], l['y2'], l['x1'], l['x2'], l.get('pass', 'page')[:4], repr(l['text'])[:110])
    else:
        sys.exit(__doc__)
