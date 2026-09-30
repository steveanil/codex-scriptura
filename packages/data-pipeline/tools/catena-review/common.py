"""Paths and loaders the review tools share. Everything they write goes to data/scratch/catena-review (gitignored)."""
import io, json, re, zipfile
from pathlib import Path

REPO = Path(__file__).resolve().parents[4]
PIPELINE = REPO / 'packages' / 'data-pipeline'
CORRECTIONS = PIPELINE / 'corrections'
CATENA = REPO / 'data' / 'texts' / 'catena'
PROCESSED = REPO / 'data' / 'processed'
SCRATCH = REPO / 'data' / 'scratch' / 'catena-review'
SCRATCH.mkdir(parents=True, exist_ok=True)
ITEMS = sorted(p.name.replace('.rapidocr.json', '') for p in (CATENA / 'ocr').glob('*.rapidocr.json'))


def item_of(prefix):
    found = [i for i in ITEMS if i.startswith(prefix)]
    if len(found) != 1:
        raise SystemExit(f'{prefix!r} names {len(found)} scan items: {found}')
    return found[0]


def load_pairs():
    """pairs.ts output: every compared excerpt, and the word pairs the classifier accepts as one word."""
    d = json.load(open(SCRATCH / 'pairs.json'))
    return d['pairs'], set(d['variants'])


def norm(s):
    return re.sub(r'[^a-z0-9]+', ' ', s.lower()).strip()


_ocr = {}


def ocr_lines(item, leaf):
    """The recogniser's lines on a leaf, top to bottom, in the rendered 1600-wide space."""
    if item not in _ocr:
        d = json.load(open(CATENA / 'ocr' / f'{item}.rapidocr.json'))
        _ocr[item] = {p['leaf']: sorted(p['lines'], key=lambda l: (l['y1'], l['x1'])) for p in d['pages']}
    return _ocr[item][leaf]


def page_image(item, leaf):
    from PIL import Image
    zf = zipfile.ZipFile(CATENA / 'source' / f'{item}_jp2.zip')
    name = [n for n in zf.namelist() if re.search(r'_%04d\.jp2$' % (leaf + 1), n)][0]
    return Image.open(io.BytesIO(zf.read(name))).convert('L')
