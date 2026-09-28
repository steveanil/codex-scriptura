"""
OCR of a Catena Aurea scan's page images with word geometry (issue #85).

Reads the Internet Archive's JP2 bundle of one scan (the checksum-accepted
acquisition artifact), renders each leaf at a fixed width, runs RapidOCR
with character boxes, and writes one JSON document the data pipeline reads
in place of the Archive's djvu XML: per leaf the lines, per line the words
with their boxes in rendered pixels. The document records everything that
determines its content (bundle checksum, package versions, model checksums,
configuration), so a stale artifact can be told from a current one.

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

FORMAT = 'rapidocr-pages/1'
CONFIG = {
    'width': 1600,
    'resample': 'LANCZOS',
    'mode': 'RGB',
    'return_word_box': True,
    # A gap this many character widths wide is a space the recogniser dropped (measured: spaces run 0.8 to 2.2,
    # gaps inside words stay under 0.45); after punctuation the print's space is narrower
    'word_gap_ratio': 0.8,
    'word_gap_ratio_after_punctuation': 0.5,
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


def words_of(char_boxes, chars, gap_ratio, punct_gap_ratio):
    """Group RapidOCR's character boxes into words: at a space the recogniser gave, or at a horizontal gap a space wide that it missed."""
    widths = [b[1][0] - b[0][0] for b in char_boxes if b[1][0] > b[0][0]]
    median = sorted(widths)[len(widths) // 2] if widths else 0
    words, cur = [], None
    prev_x2 = None
    for box, ch in zip(char_boxes, chars):
        x1, y1 = min(p[0] for p in box), min(p[1] for p in box)
        x2, y2 = max(p[0] for p in box), max(p[1] for p in box)
        if ch == ' ':
            if cur:
                words.append(cur)
            cur = None
            prev_x2 = x2
            continue
        gap = (x1 - prev_x2) if prev_x2 is not None else 0
        limit = punct_gap_ratio if cur is not None and cur['t'][-1] in '.,;:!?)' else gap_ratio
        if cur is not None and gap > median * limit:
            words.append(cur)
            cur = None
        if cur is None:
            cur = {'t': ch, 'x1': x1, 'y1': y1, 'x2': x2, 'y2': y2}
        else:
            cur['t'] += ch
            cur['x1'], cur['y1'] = min(cur['x1'], x1), min(cur['y1'], y1)
            cur['x2'], cur['y2'] = max(cur['x2'], x2), max(cur['y2'], y2)
        prev_x2 = x2
    if cur:
        words.append(cur)
    return [{'t': w['t'], 'x1': int(round(w['x1'])), 'y1': int(round(w['y1'])), 'x2': int(round(w['x2'])), 'y2': int(round(w['y2']))} for w in words if w['t'].strip()]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--zip', required=True)
    ap.add_argument('--out', required=True)
    ap.add_argument('--width', type=int, default=CONFIG['width'])
    ap.add_argument('--leaves', default='')
    args = ap.parse_args()
    config = dict(CONFIG, width=args.width)
    only = {int(x) for x in args.leaves.split(',') if x} if args.leaves else None

    ocr = RapidOCR()
    zf = zipfile.ZipFile(args.zip)
    entries = []
    for name in zf.namelist():
        m = re.search(r'_(\d{4})\.jp2$', name)
        if m:
            entries.append((int(m.group(1)), name))
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
        result, _ = ocr(np.asarray(img), return_word_box=config['return_word_box'])
        lines = []
        for r in result or []:
            box, text, score = r[0], r[1], float(r[2])
            char_boxes, chars = (r[3], r[4]) if len(r) >= 5 else ([], [])
            words = words_of(char_boxes, chars, config['word_gap_ratio'], config['word_gap_ratio_after_punctuation']) if char_boxes else [{'t': text, 'x1': int(min(p[0] for p in box)), 'y1': int(min(p[1] for p in box)), 'x2': int(max(p[0] for p in box)), 'y2': int(max(p[1] for p in box))}]
            lines.append({'x1': int(min(p[0] for p in box)), 'y1': int(min(p[1] for p in box)), 'x2': int(max(p[0] for p in box)), 'y2': int(max(p[1] for p in box)), 'score': round(score, 3), 'text': text, 'words': words})
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
