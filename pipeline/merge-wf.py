#!/usr/bin/env python3
"""Merge parallel-workflow verse outputs (data/cache/wf/<songId>__<start>.json,
each a list of {index, translit, meaning}) into the generated verse-translations
file that translate.ts applies as review:"auto". Reports coverage vs the manifest."""
import json, glob, os, re

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
WF = os.path.join(ROOT, "data/cache/wf")
OUT = os.path.join(ROOT, "data/cache/verse-translations.json")

gen = {}
if os.path.exists(OUT):
    gen = json.load(open(OUT))

files = sorted(glob.glob(os.path.join(WF, "*.json")))
merged = bad = 0
for f in files:
    song_id = re.sub(r"__\d+\.json$", "", os.path.basename(f))
    try:
        arr = json.load(open(f))
    except Exception as e:
        print(f"  ! skip {os.path.basename(f)}: {e}")
        bad += 1
        continue
    bucket = gen.setdefault(song_id, {})
    for e in arr:
        if isinstance(e, dict) and "index" in e and e.get("translit") and e.get("meaning"):
            bucket[str(e["index"])] = {"translit": e["translit"], "meaning": e["meaning"]}
            merged += 1

json.dump(gen, open(OUT, "w"), ensure_ascii=False, indent=0)
print(f"merged {merged} verse translations from {len(files)} chunk files ({bad} unreadable)")

# coverage vs manifest
man = json.load(open(os.path.join(ROOT, "data/cache/wf-manifest.json")))
got = {os.path.basename(f).replace(".json", "") for f in files}
missing = [m for m in man if f"{m['songId']}__{m['start']}" not in got]
if missing:
    print(f"MISSING {len(missing)} chunks (re-run these):", [m['songId'] + ':' + str(m['start']) for m in missing[:20]])
else:
    print("all manifest chunks present")
