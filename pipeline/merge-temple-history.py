#!/usr/bin/env python3
"""Merge the temple-history workflow outputs (data/cache/th-out/chunk_*.json,
each [{refId, history}]) into data/cache/temple-history.json keyed by refId,
which the site reads to render each temple's AI-drafted Sthala Puranam."""
import json, glob, os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUTDIR = os.path.join(ROOT, "data/cache/th-out")
DEST = os.path.join(ROOT, "data/cache/temple-history.json")

hist = json.load(open(DEST)) if os.path.exists(DEST) else {}
files = sorted(glob.glob(os.path.join(OUTDIR, "*.json")))
merged = bad = 0
for f in files:
    try:
        arr = json.load(open(f))
    except Exception as e:
        print(f"  ! skip {os.path.basename(f)}: {e}"); bad += 1; continue
    for e in arr:
        if isinstance(e, dict) and e.get("refId") and e.get("history"):
            hist[str(e["refId"])] = {"history": e["history"].strip(), "review": "auto"}
            merged += 1

json.dump(hist, open(DEST, "w"), ensure_ascii=False, indent=0)
man = json.load(open(os.path.join(ROOT, "data/cache/th-manifest.json")))
print(f"merged {merged} temple histories from {len(files)} chunk files ({bad} unreadable)")
print(f"coverage: {len(hist)}/108 temples")
