"""
OCR of a Catena Aurea scan's page images with word geometry (issue #85).

Reads the Internet Archive's JP2 bundle of one scan (the checksum-accepted
acquisition artifact), renders each leaf at a fixed width, runs RapidOCR
with character boxes, and writes one JSON document the data pipeline reads
in place of the Archive's djvu XML: per leaf the lines, per line the text
and the recogniser's characters with their horizontal spans in rendered
pixels; the pipeline's reader groups them into words with the page's
geometry. The document records everything that
determines its content (bundle checksum, package versions, model checksums,
configuration), so a stale artifact can be told from a current one.

The detector drops a line on about one page in three, mostly a line a
margin note sits beside, and sometimes the left part of a line. After the
page pass, each gap of about two line pitches between column lines, and
the blank left of a line that starts well inside the column, is cropped
and read again at the page's own scale, first with the page pass's
thresholds and then with lower ones. Lines found this way carry the pass
that found them.

RapidOCR resets the detector's box threshold and unclip ratio to their
defaults on every call made with keyword arguments (the character boxes
need one), so both are passed on each call rather than at construction.

    python rapidocr_pages.py --zip <item>_jp2.zip --out <item>.rapidocr.json [--width 1600] [--leaves 12,38]
"""

import argparse
import hashlib
import io
import json
import os
import platform
import re
import sys
import time
import zipfile
from importlib.metadata import version

import numpy as np
from PIL import Image
from rapidocr_onnxruntime import RapidOCR

FORMAT = 'rapidocr-pages/2'
CONFIG = {
    'width': 1600,
    'resample': 'LANCZOS',
    'mode': 'RGB',
    'return_word_box': True,
    'det_unclip_ratio': 1.6,
    'det_thresh': 0.3,
    'det_box_thresh': 0.5,
    'recovery': {
        'gap_ratio': [1.7, 2.4],
        'partial_offset': 150,
        'passes': [
            {'name': 'native', 'det_thresh': 0.3, 'det_box_thresh': 0.5},
            {'name': 'native-low', 'det_thresh': 0.2, 'det_box_thresh': 0.3},
        ],
    },
}


def sha256_file(path):
    h = hashlib.sha256()
    with open(path, 'rb') as f:
        for chunk in iter(lambda: f.read(1 << 20), b''):
            h.update(chunk)
    return h.hexdigest()


def model_checksums():
    base = os.path.dirname(sys.modules['rapidocr_onnxruntime'].__file__)
    out = {}
    for root, _, files in os.walk(base):
        for f in sorted(files):
            if f.endswith('.onnx') or f == 'config.yaml':
                p = os.path.join(root, f)
                out[os.path.relpath(p, base)] = sha256_file(p)
    return dict(sorted(out.items()))


def char_spans(char_boxes, chars):
    """The recogniser's characters with their horizontal spans, in rendered pixels; a space is a span of width 0 at its position. Word grouping happens in the pipeline's reader, where the page geometry is."""
    out = []
    for box, ch in zip(char_boxes, chars):
        x1, x2 = min(p[0] for p in box), max(p[0] for p in box)
        out.append([ch, int(round(x1)), int(round(x2))])
    return out


def to_lines(result, dx=0, dy=0, found_by='page'):
    lines = []
    for r in result or []:
        box, text, score = r[0], r[1], float(r[2])
        char_boxes, chars = (r[3], r[4]) if len(r) >= 5 else ([], [])
        spans = char_spans(char_boxes, chars) if char_boxes else []
        lines.append({'x1': int(min(p[0] for p in box)) + dx, 'y1': int(min(p[1] for p in box)) + dy, 'x2': int(max(p[0] for p in box)) + dx, 'y2': int(max(p[1] for p in box)) + dy, 'score': round(score, 3), 'text': text, 'chars': [[c, x1 + dx, x2 + dx] for c, x1, x2 in spans], 'pass': found_by})
    return lines


def median(xs):
    xs = sorted(xs)
    return xs[len(xs) // 2] if xs else 0


def centre(l):
    return (l['y1'] + l['y2']) / 2


def recover(engines, img, lines, config):
    """Lines the page pass dropped: read again from crops of the gaps between column lines and of the blank left of a line starting inside the column."""
    rc = config['recovery']
    width = img.shape[1]
    column = [l for l in lines if l['x2'] - l['x1'] > 0.45 * width]
    if len(column) < 8:
        return []
    left, right = median([l['x1'] for l in column]), median([l['x2'] for l in column])
    in_column = sorted([l for l in lines if l['x1'] < left + 250 and l['x2'] > left + 200], key=centre)
    pitch = median([centre(b) - centre(a) for a, b in zip(in_column, in_column[1:])])
    if pitch <= 0:
        return []

    def cascade(y1, y2, x1, x2, keep, found_by):
        y1, y2, x1, x2 = max(0, y1), min(img.shape[0], y2), max(0, x1), min(width, x2)
        if y2 - y1 < 20 or x2 - x1 < 40:
            return []
        for p in rc['passes']:
            result, _ = engines[p['name']](img[y1:y2, x1:x2], return_word_box=config['return_word_box'], box_thresh=p['det_box_thresh'], unclip_ratio=config['det_unclip_ratio'])
            found = [l for l in to_lines(result, x1, y1, f'{found_by}:{p["name"]}') if keep(l)]
            # A margin note alone is not the line the gap is missing
            if any(l['x2'] - l['x1'] > 60 and l['x1'] < left + 250 and l['x2'] > left + 200 for l in found):
                return found
        return []

    recovered = []
    lo, hi = rc['gap_ratio']
    for a, b in zip(in_column, in_column[1:]):
        if not lo < (centre(b) - centre(a)) / pitch < hi:
            continue
        top, bottom = a['y2'], b['y1']
        recovered += cascade(top - 8, bottom + 8, 0, width, lambda l: top - 2 < centre(l) < bottom + 2 and l['y2'] - l['y1'] >= 20, 'gap')
    for l in in_column:
        if l['x1'] <= left + rc['partial_offset'] or l['x2'] < right - 80 or not 30 < l['y2'] - l['y1'] < 90:
            continue
        if any(o is not l and o['x1'] < l['x1'] - 50 and min(o['y2'], l['y2']) - max(o['y1'], l['y1']) > 20 for o in lines + recovered):
            continue
        recovered += cascade(l['y1'] - 6, l['y2'] + 6, 0, l['x1'] + 10, lambda f, l=l: f['x2'] <= l['x1'] + 30 and l['y1'] - 4 < centre(f) < l['y2'] + 4, 'partial')
    return recovered


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--zip', required=True)
    ap.add_argument('--out', required=True)
    ap.add_argument('--width', type=int, default=CONFIG['width'])
    ap.add_argument('--leaves', default='')
    args = ap.parse_args()
    config = dict(CONFIG, width=args.width)
    only = {int(x) for x in args.leaves.split(',') if x} if args.leaves else None

    ocr = RapidOCR(det_unclip_ratio=config['det_unclip_ratio'], det_thresh=config['det_thresh'], det_box_thresh=config['det_box_thresh'])
    # Crops are read at the page's scale: RapidOCR would otherwise upscale a thin strip to its minimum side
    engines = {p['name']: RapidOCR(det_unclip_ratio=config['det_unclip_ratio'], det_thresh=p['det_thresh'], det_box_thresh=p['det_box_thresh'], det_limit_type='max', det_limit_side_len=config['width']) for p in config['recovery']['passes']}
    zf = zipfile.ZipFile(args.zip)
    entries = []
    for name in zf.namelist():
        m = re.search(r'_(\d{4})\.jp2$', name)
        # The bundle numbers leaves from 0001; the Archive's page/nN and the djvu reader count from 0
        if m:
            entries.append((int(m.group(1)) - 1, name))
    entries.sort()
    if not entries:
        sys.exit(f'no *_NNNN.jp2 entries in {args.zip}')

    pages = []
    started = time.time()
    for i, (leaf, name) in enumerate(entries):
        if only is not None and leaf not in only:
            continue
        img = Image.open(io.BytesIO(zf.read(name)))
        width, height = img.size
        img = img.convert(config['mode'])
        rendered_h = round(height * config['width'] / width)
        img = img.resize((config['width'], rendered_h), Image.Resampling.LANCZOS)
        arr = np.asarray(img)
        result, _ = ocr(arr, return_word_box=config['return_word_box'], box_thresh=config['det_box_thresh'], unclip_ratio=config['det_unclip_ratio'])
        lines = to_lines(result)
        lines += recover(engines, arr, lines, config)
        pages.append({'leaf': leaf, 'width': width, 'height': height, 'rendered_width': config['width'], 'rendered_height': rendered_h, 'lines': lines})
        if (i + 1) % 25 == 0 or only is not None:
            print(f'[rapidocr] {os.path.basename(args.zip)} leaf {leaf} ({i + 1}/{len(entries)}) {time.time() - started:.0f}s', flush=True)

    doc = {
        'format': FORMAT,
        'item': os.path.basename(args.zip).replace('_jp2.zip', ''),
        'source': {'file': os.path.basename(args.zip), 'sha256': sha256_file(args.zip)},
        'engine': {
            'python': platform.python_version(),
            'rapidocr_onnxruntime': version('rapidocr-onnxruntime'),
            'onnxruntime': version('onnxruntime'),
            'pillow': version('pillow'),
            'numpy': version('numpy'),
        },
        'models': model_checksums(),
        'config': config,
        'pages': pages,
    }
    os.makedirs(os.path.dirname(os.path.abspath(args.out)), exist_ok=True)
    with open(args.out, 'w') as f:
        json.dump(doc, f, separators=(',', ':'))
    print(f'[rapidocr] wrote {args.out}: {len(pages)} pages in {time.time() - started:.0f}s')


if __name__ == '__main__':
    main()
