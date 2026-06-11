#!/usr/bin/env python3
"""Merge the Kannada workflow outputs into committed generated files:
  kn-out/*.json  → data/cache/verse-kannada.json   {songId: {index: {knTranslit, knMeaning}}}
  knn-out/*.json → data/cache/name-kannada.json     {ta: {kn, knTranslit}}
  knp-out/*.json → data/cache/temple-history-kn.json {refId: {history}}
                 + data/cache/temple-extras-kn.json  {refId: {festivals, timings}}"""
import json, glob, os, re

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
C = os.path.join(ROOT, "data/cache")
def load(p): return json.load(open(p)) if os.path.exists(p) else {}

vt = load(f"{C}/verse-kannada.json"); n=0
for f in sorted(glob.glob(f"{C}/kn-out/*.json")):
    sid = re.sub(r"__\d+\.json$", "", os.path.basename(f))
    try: arr = json.load(open(f))
    except Exception: continue
    b = vt.setdefault(sid, {})
    for e in arr:
        if e.get("knTranslit") and e.get("knMeaning"):
            b[str(e["index"])] = {"knTranslit": e["knTranslit"], "knMeaning": e["knMeaning"]}; n+=1
json.dump(vt, open(f"{C}/verse-kannada.json","w"), ensure_ascii=False, indent=0)
print(f"verses: {n} merged; {sum(len(v) for v in vt.values())} total across {len(vt)} songs")

nm = load(f"{C}/name-kannada.json"); n=0
for f in sorted(glob.glob(f"{C}/knn-out/*.json")):
    try: d = json.load(open(f))
    except Exception: continue
    for k,v in d.items():
        if v.get("kn"): nm[k] = {"kn": v["kn"], "knTranslit": v.get("knTranslit","")}; n+=1
json.dump(nm, open(f"{C}/name-kannada.json","w"), ensure_ascii=False, indent=0)
print(f"names: {n} merged; {len(nm)} total")

th = load(f"{C}/temple-history-kn.json"); tx = load(f"{C}/temple-extras-kn.json"); n=0
for f in sorted(glob.glob(f"{C}/knp-out/*.json")):
    try: arr = json.load(open(f))
    except Exception: continue
    for e in arr:
        r = str(e.get("refId",""))
        if not r: continue
        if e.get("history"): th[r] = {"history": e["history"].strip(), "review":"auto"}
        if e.get("festivals") or e.get("timings"):
            tx[r] = {"festivals": (e.get("festivals") or "").strip(),
                     "timings": (e.get("timings") or "").strip(), "review":"auto"}
        n+=1
json.dump(th, open(f"{C}/temple-history-kn.json","w"), ensure_ascii=False, indent=0)
json.dump(tx, open(f"{C}/temple-extras-kn.json","w"), ensure_ascii=False, indent=0)
print(f"temple prose: {n} merged; history {len(th)}/108, extras {len(tx)}/108")
