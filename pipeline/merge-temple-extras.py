#!/usr/bin/env python3
"""Merge the festivals/timings workflow outputs (data/cache/ft-out/chunk_*.json,
each [{refId, festivals, timings}]) into data/cache/temple-extras.json keyed by
refId, which the site reads to render each temple's AI-drafted festivals + timings."""
import json, glob, os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUTDIR = os.path.join(ROOT, "data/cache/ft-out")
DEST = os.path.join(ROOT, "data/cache/temple-extras.json")

extras = json.load(open(DEST)) if os.path.exists(DEST) else {}
files = sorted(glob.glob(os.path.join(OUTDIR, "*.json")))
merged = bad = 0
for f in files:
    try:
        arr = json.load(open(f))
    except Exception as e:
        print(f"  ! skip {os.path.basename(f)}: {e}"); bad += 1; continue
    for e in arr:
        if isinstance(e, dict) and e.get("refId") and (e.get("festivals") or e.get("timings")):
            extras[str(e["refId"])] = {
                "festivals": (e.get("festivals") or "").strip(),
                "timings": (e.get("timings") or "").strip(),
                "review": "auto",
            }
            merged += 1

json.dump(extras, open(DEST, "w"), ensure_ascii=False, indent=0)
print(f"merged {merged} temple extras from {len(files)} chunk files ({bad} unreadable)")
print(f"coverage: {len(extras)}/108 temples")
