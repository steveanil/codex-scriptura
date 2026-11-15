"""
Render one leaf, or a strip of it, from a scan's JP2 bundle as PNG for reading.

    python3 page.py <item-prefix> <leaf> <out.png> [--y y1:y2] [--x x1:x2] [--width 2200]

Coordinates are in the OCR's rendered space (1600 wide), so a line's box from show.py ocr can be cut out as it is.
"""
import argparse
from PIL import Image
from common import item_of, page_image

ap = argparse.ArgumentParser()
ap.add_argument('item')
ap.add_argument('leaf', type=int)
ap.add_argument('out')
ap.add_argument('--y', default='')
ap.add_argument('--x', default='')
ap.add_argument('--width', type=int, default=2200)
a = ap.parse_args()
img = page_image(item_of(a.item), a.leaf)
w, h = img.size
s = w / 1600
box = [0, 0, w, h]
if a.x:
    x1, x2 = map(int, a.x.split(':'))
    box[0], box[2] = int(x1 * s), int(x2 * s)
if a.y:
    y1, y2 = map(int, a.y.split(':'))
    box[1], box[3] = int(y1 * s), int(y2 * s)
img = img.crop(box)
bw, bh = img.size
img.resize((a.width, round(bh * a.width / bw)), Image.Resampling.LANCZOS).save(a.out)
print(a.out, img.size)
