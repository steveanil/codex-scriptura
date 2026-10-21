"""
Record page-read corrections and reviewed discrepancies, from a JSON list on stdin.

    {"type": "line", "item": ..., "leaf": ..., "find": ..., "replace": ..., "note": ...}
    {"type": "excerpt", "id": "catena-luke-7-11-17", "leaf": ..., "find": ..., "replace": ..., "note": ...}
    {"type": "review", "kind": "text", "id": "catena-luke-7-11-17#3", "leaf": ..., "note": ...}

An excerpt correction is placed by its find text, which must occur once in one excerpt of the entry. A review
binds to the finding's fingerprint as the oracle report gives it, so run verify:catena on the current corpus first.
"""
import datetime, json, os, re, sys
from common import CORRECTIONS, PROCESSED

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


recs = json.load(sys.stdin)
if any(r['type'] == 'review' for r in recs) and os.path.getmtime(report) < os.path.getmtime(corpus):
    sys.exit('the oracle report is older than the corpus: run verify:catena first')
lines = json.load(open(CORRECTIONS / 'catena-aurea.ocr.json'))
exc = json.load(open(CORRECTIONS / 'catena-aurea.json'))
disc = json.load(open(CORRECTIONS / 'catena-aurea.discrepancies.json'))
for r in recs:
    if r['type'] == 'line':
        lines.append({k: r[k] for k in ('item', 'leaf', 'find', 'replace', 'note')})
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
    else:
        sys.exit(f"unknown record type {r['type']!r}")
save('catena-aurea.ocr.json', lines)
save('catena-aurea.json', exc)
save('catena-aurea.discrepancies.json', disc)
print('saved: lines', len(lines), 'excerpt', len(exc), 'reviews', len(disc))
