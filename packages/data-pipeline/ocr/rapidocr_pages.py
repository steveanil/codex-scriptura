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
    'det_unclip_ratio': 1.6,
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


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--zip', required=True)
    ap.add_argument('--out', required=True)
    ap.add_argument('--width', type=int, default=CONFIG['width'])
    ap.add_argument('--leaves', default='')
    args = ap.parse_args()
    config = dict(CONFIG, width=args.width)
    only = {int(x) for x in args.leaves.split(',') if x} if args.leaves else None

    ocr = RapidOCR(det_unclip_ratio=config['det_unclip_ratio'])
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
        result, _ = ocr(np.asarray(img), return_word_box=config['return_word_box'])
        lines = []
        for r in result or []:
            box, text, score = r[0], r[1], float(r[2])
            char_boxes, chars = (r[3], r[4]) if len(r) >= 5 else ([], [])
            lines.append({'x1': int(min(p[0] for p in box)), 'y1': int(min(p[1] for p in box)), 'x2': int(max(p[0] for p in box)), 'y2': int(max(p[1] for p in box)), 'score': round(score, 3), 'text': text, 'chars': char_spans(char_boxes, chars) if char_boxes else []})
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
