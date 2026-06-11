#!/usr/bin/env python3
"""Merge the Telugu workflow outputs into the committed generated files:
  te-out/*.json   → data/cache/verse-telugu.json   {songId: {index: {teTranslit, teMeaning}}}
  ten-out/*.json  → data/cache/name-telugu.json     {ta: {te, teTranslit}}
  tep-out/*.json  → data/cache/temple-history-te.json {refId: {history}}
                  + data/cache/temple-extras-te.json  {refId: {festivals, timings}}
Idempotent and accumulative; reports coverage."""
import json, glob, os, re

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
C = os.path.join(ROOT, "data/cache")

def load(p):
    return json.load(open(p)) if os.path.exists(p) else {}

# --- verses ---
vt = load(f"{C}/verse-telugu.json"); n=0
for f in sorted(glob.glob(f"{C}/te-out/*.json")):
    sid = re.sub(r"__\d+\.json$", "", os.path.basename(f))
    try: arr = json.load(open(f))
    except Exception: continue
    b = vt.setdefault(sid, {})
    for e in arr:
        if e.get("teTranslit") and e.get("teMeaning"):
            b[str(e["index"])] = {"teTranslit": e["teTranslit"], "teMeaning": e["teMeaning"]}; n+=1
json.dump(vt, open(f"{C}/verse-telugu.json","w"), ensure_ascii=False, indent=0)
print(f"verses: {n} merged; {sum(len(v) for v in vt.values())} total across {len(vt)} songs")

# --- names ---
nm = load(f"{C}/name-telugu.json"); n=0
for f in sorted(glob.glob(f"{C}/ten-out/*.json")):
    try: d = json.load(open(f))
    except Exception: continue
    for k,v in d.items():
        if v.get("te"): nm[k] = {"te": v["te"], "teTranslit": v.get("teTranslit","")}; n+=1
json.dump(nm, open(f"{C}/name-telugu.json","w"), ensure_ascii=False, indent=0)
print(f"names: {n} merged; {len(nm)} total")

# --- temple prose ---
th = load(f"{C}/temple-history-te.json"); tx = load(f"{C}/temple-extras-te.json"); n=0
for f in sorted(glob.glob(f"{C}/tep-out/*.json")):
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
json.dump(th, open(f"{C}/temple-history-te.json","w"), ensure_ascii=False, indent=0)
json.dump(tx, open(f"{C}/temple-extras-te.json","w"), ensure_ascii=False, indent=0)
print(f"temple prose: {n} merged; history {len(th)}/108, extras {len(tx)}/108")
