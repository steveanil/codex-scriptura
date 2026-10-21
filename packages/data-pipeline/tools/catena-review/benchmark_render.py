"""
Page images for transcribing the benchmark pages, and nothing else: no OCR, no reader output, no suggestions.

    python3 benchmark_render.py [development|held-out]    writes data/scratch/catena-review/benchmark/<split>-<item>-<leaf>.png
"""
import json, sys
from PIL import Image
from common import PIPELINE, SCRATCH, page_image

pages = json.load(open(PIPELINE / 'benchmark' / 'catena' / 'pages.json'))
out = SCRATCH / 'benchmark'
out.mkdir(exist_ok=True)
for split in sys.argv[1:] or ['development', 'held-out']:
    for p in pages[split]:
        img = page_image(p['item'], p['leaf'])
        w, h = img.size
        img = img.resize((2200, round(h * 2200 / w)), Image.Resampling.LANCZOS)
        f = out / f"{split}-{p['item']}-{p['leaf']}.png"
        img.save(f)
        print(f)
