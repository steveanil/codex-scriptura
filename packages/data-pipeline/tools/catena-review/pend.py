"""
Queue review records for after the next rebuild, when a correction on the same page must land first.

    python3 pend.py add < records.json   add records to the queue
    python3 pend.py flush                record the queue with record.py (after import:catena and verify:catena)
"""
import json, subprocess, sys
from pathlib import Path
from common import SCRATCH

P = SCRATCH / 'pending.json'
queued = json.load(open(P)) if P.exists() else []
if sys.argv[1:] == ['add']:
    queued += json.load(sys.stdin)
    json.dump(queued, open(P, 'w'), indent=1)
    print('pending', len(queued))
elif sys.argv[1:] == ['flush']:
    if not queued:
        sys.exit('nothing pending')
    r = subprocess.run([sys.executable, str(Path(__file__).with_name('record.py'))], input=json.dumps(queued), text=True, capture_output=True)
    print(r.stdout, r.stderr)
    if r.returncode == 0:
        json.dump([], open(P, 'w'))
else:
    sys.exit(__doc__)
