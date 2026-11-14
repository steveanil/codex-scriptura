"""
Record page-read corrections and reviewed discrepancies, from a JSON list on stdin.

    {"type": "line", "item": ..., "leaf": ..., "find": ..., "replace": ..., "note": ...}
    {"type": "line", "item": ..., "leaf": ..., "y": ..., "find": <the whole line as read>, "replace": <the whole line>, "note": ...}
    {"type": "excerpt", "id": "catena-luke-7-11-17", "leaf": ..., "find": ..., "replace": ..., "note": ...}
    {"type": "review", "kind": "text", "id": "catena-luke-7-11-17#3", "leaf": ..., "note": ...}
    {"type": "footnote", "item": ..., "leaf": ..., "y": ..., "reading": <the OCR line as queue.ts prints it>, "note": ..., "issue": 429}
    {"type": "page", "item": ..., "leaf": ..., "scope": "whole page" | "strips", "reviewer": ..., "corrections": [...], "verdicts": [...],
     "questions": [...], "outcome": ..., "blockers": [...], "reviewed": <date, today if absent>, "revision": <commit, HEAD if absent>}

A line correction's find must occur once on the leaf; a line whose reading is not unique there (a whole line read as "r") is
named by its y as linecheck.ts prints it, with the whole line as find. A correction that puts back a line the OCR read as
nothing, by extending the line before or after it, names that line in "restores": its y as queue.ts prints it. A correction with an empty
replace removes a whole line that is not commentary and says which kind in "removes": "footnote" or "handwriting". An excerpt correction is placed by its find text, which must occur once in one excerpt of the entry. A review
binds to the finding's fingerprint as the oracle report gives it, so run verify:catena on the current corpus first.
A footnote record says an unreadable line is a line of a printed footnote and nothing else, as read on the page image. A page
record logs one reading of one page; it names the scan bundle and image, the OCR document and the commit by itself, and its
corrections are given as {"kind": "line", "find": ...} or {"kind": "citation", "chapter", "verseStart", "verseEnd", "excerpt"}.
"""
import datetime, hashlib, json, os, re, subprocess, sys, zipfile
from common import CATENA, CORRECTIONS, PIPELINE, PROCESSED

corpus = PROCESSED / 'commentary-catena-aurea.json'
report = PROCESSED / 'commentary-catena-aurea.oracle-report.json'
E = json.load(open(corpus))
R = json.load(open(report))
byid = {e['id']: e for e in E}
today = datetime.date.today().isoformat()


def unescape(s):
    return re.sub(r'\\(.)', r'\1', s)


def save(name, data):
    with open(CORRECTIONS / name, 'w') as f:
        json.dump(data, f, indent=2, ensure_ascii=False)
        f.write('\n')


def load(name):
    p = CORRECTIONS / name
    return json.load(open(p)) if p.exists() else []


def identity(item, leaf):
    """The page image and OCR document a review was made from, and the commit the import ran at."""
    bundle = f'{item}_jp2.zip'
    listed = re.search(r"'catena/source/%s': \{ sha256: '([0-9a-f]{64})'" % re.escape(bundle), open(PIPELINE / 'src' / 'core' / 'source-checksums.ts').read())
    if not listed:
        sys.exit(f'{bundle} has no accepted checksum')
    name = [n for n in zipfile.ZipFile(CATENA / 'source' / bundle).namelist() if re.search(r'_%04d\.jp2$' % (leaf + 1), n)][0]
    doc = f'{item}.rapidocr.json'
    return ({'bundle': bundle, 'sha256': listed.group(1), 'file': name},
            {'document': doc, 'sha256': hashlib.sha256(open(CATENA / 'ocr' / doc, 'rb').read()).hexdigest()},
            subprocess.run(['git', 'rev-parse', '--short', 'HEAD'], capture_output=True, text=True, cwd=PIPELINE).stdout.strip())


recs = json.load(sys.stdin)
if any(r['type'] == 'review' for r in recs) and os.path.getmtime(report) < os.path.getmtime(corpus):
    sys.exit('the oracle report is older than the corpus: run verify:catena first')
lines = json.load(open(CORRECTIONS / 'catena-aurea.ocr.json'))
exc = json.load(open(CORRECTIONS / 'catena-aurea.json'))
disc = json.load(open(CORRECTIONS / 'catena-aurea.discrepancies.json'))
foot = load('catena-aurea.footnote-lines.json')
pagereviews = load('catena-aurea.page-reviews.json')
for r in recs:
    if r['type'] == 'line':
        lines.append({k: r[k] for k in ('item', 'leaf', 'y', 'restores', 'find', 'replace', 'removes', 'note') if k not in ('y', 'restores', 'removes') or k in r})
        print('line', r['item'][:12], r['leaf'], repr(r['find'][:50]))
    elif r['type'] == 'excerpt':
        e = byid[r['id']]
        paras = [unescape(p) for p in e['content'].split('\n\n') if p.startswith('**')]
        hits = [i for i, p in enumerate(paras) if r['find'] in p]
        if len(hits) != 1:
            sys.exit(f"find matches {len(hits)} excerpts in {r['id']}: {r['find']!r}")
        if paras[hits[0]].count(r['find']) != 1:
            sys.exit(f"find occurs {paras[hits[0]].count(r['find'])} times in excerpt {hits[0] + 1} of {r['id']}")
        item = e['source']['item']
        _, ch, v1 = e['startRef'].split('.')
        v2 = e['endRef'].split('.')[2]
        same_range = [x['id'] for x in E if x['source']['item'] == item and x['startRef'] == e['startRef'] and x['endRef'] == e['endRef']]
        exc.append({'item': item, 'chapter': int(ch), 'verseStart': int(v1), 'verseEnd': int(v2), 'occurrence': 1 + same_range.index(e['id']),
                    'excerpt': hits[0] + 1, 'find': r['find'], 'replace': r['replace'], 'leaf': r['leaf'], 'note': r['note']})
        print('excerpt', r['id'], '#', hits[0] + 1, repr(r['find'][:40]), '->', repr(r['replace'][:40]))
    elif r['type'] == 'review':
        f = [x for x in R['findings'] if x['kind'] == r['kind'] and x['id'] == r['id']]
        if len(f) != 1:
            sys.exit(f"finding {r['kind']} {r['id']}: {len(f)} matches")
        if any(d['kind'] == r['kind'] and d['id'] == r['id'] for d in disc):
            sys.exit(f"already reviewed: {r['id']}")
        disc.append({'id': r['id'], 'kind': r['kind'], 'findingFingerprint': f[0]['fingerprint'], 'item': f[0]['item'], 'leaf': r['leaf'], 'note': r['note'], 'reviewed': today})
        print('review', r['kind'], r['id'])
    elif r['type'] == 'footnote':
        foot.append({'item': r['item'], 'leaf': r['leaf'], 'y': r['y'], 'reading': r['reading'], 'reviewed': today, 'note': r['note'], **({'issue': r['issue']} if 'issue' in r else {})})
        print('footnote', r['item'][:12], r['leaf'], r['y'])
    elif r['type'] == 'page':
        if r['scope'] not in ('whole page', 'strips', 'margin citations'):
            sys.exit(f"scope is 'whole page', 'strips' or 'margin citations': {r['scope']!r}")
        image, ocr, head = identity(r['item'], r['leaf'])
        for c in r['corrections']:
            if c['kind'] == 'line' and sum(1 for l in lines if l['item'] == r['item'] and l['leaf'] == r['leaf'] and l['find'] == c['find']) != 1:
                sys.exit(f"page {r['item']} {r['leaf']}: no single line correction with find {c['find']!r}")
            if c['kind'] == 'citation' and sum(1 for x in exc if x['item'] == r['item'] and x['leaf'] == r['leaf'] and 'citation' in x and (x['chapter'], x['verseStart'], x['verseEnd'], x['excerpt']) == (c['chapter'], c['verseStart'], c['verseEnd'], c['excerpt'])) != 1:
                sys.exit(f"page {r['item']} {r['leaf']}: no single citation correction for {c}")
        known = {v['id'] for v in json.load(open(CORRECTIONS / 'catena-aurea.transforms-verified.json'))}
        if set(r['verdicts']) - known:
            sys.exit(f"page {r['item']} {r['leaf']}: verdicts not recorded: {sorted(set(r['verdicts']) - known)}")
        pagereviews.append({'item': r['item'], 'leaf': r['leaf'], 'scope': r['scope'], 'reviewer': r['reviewer'], 'reviewed': r.get('reviewed', today),
                            'image': image, 'ocr': ocr, 'revision': r.get('revision', head), 'corrections': r['corrections'], 'verdicts': r['verdicts'],
                            'questions': r['questions'], 'outcome': r['outcome'], 'blockers': r['blockers']})
        print('page', r['item'][:12], r['leaf'], r['scope'])
    else:
        sys.exit(f"unknown record type {r['type']!r}")
save('catena-aurea.ocr.json', lines)
save('catena-aurea.json', exc)
save('catena-aurea.discrepancies.json', disc)
if foot:
    save('catena-aurea.footnote-lines.json', foot)
if pagereviews:
    save('catena-aurea.page-reviews.json', pagereviews)
print('saved: lines', len(lines), 'excerpt', len(exc), 'reviews', len(disc))
