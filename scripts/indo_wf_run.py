"""Indonesia email waterfall runner. Order: AI Ark -> TryKitt -> BetterEnrich -> Ninjer.
Each provider runs only on rows the previous ones couldn't resolve (true fall-through).
Set MODE='test' (200 sampled rows from config) or 'all' (every row with Final Domain+name).
Writes the winning email into Email (Waterfall); 'not found' if the chain is exhausted."""
import os, sys, json, time, re, urllib.parse, urllib.request, urllib.error
try: sys.stdout.reconfigure(encoding="utf-8")
except Exception: pass

MODE = os.environ.get("WF_MODE", "test")
KEY=None
for line in open(r"C:\Users\Vilca\Desktop\Clay-Clone\.env.local", encoding="utf-8"):
    if line.strip().startswith("DATAFLOW_API_KEY"):
        KEY=line.split("=",1)[1].strip().strip('"').strip("'"); break
BASE="https://dataflow-pi.vercel.app"
HERE=os.path.dirname(os.path.abspath(__file__))
cfg=json.load(open(os.path.join(HERE,"indo_wf_cols.json")))
TABLE=cfg["table"]; FULL=cfg["fullName"]; LINKEDIN=cfg["linkedin"]; DOMAIN=cfg["domain"]
AIARK=cfg["cols"]["find_email_aiark"]; TRYKITT=cfg["cols"]["find_email_trykitt"]
BETTER=cfg["cols"]["find_email_betterenrich"]; NINJER=cfg["cols"]["find_email_ninjer"]
FINAL=cfg["finalCol"]

def log(*a): print(time.strftime("%H:%M:%S"), *a, flush=True)

def req(method, path, body=None, timeout=120, tries=5):
    for i in range(tries):
        try:
            data=json.dumps(body).encode() if body is not None else None
            r=urllib.request.Request(BASE+path, data=data, method=method)
            r.add_header("Authorization","Bearer "+KEY)
            if data: r.add_header("Content-Type","application/json")
            with urllib.request.urlopen(r, timeout=timeout) as resp:
                return resp.status, resp.read().decode(), resp.headers
        except urllib.error.HTTPError as e:
            return e.code, e.read().decode(), e.headers
        except (urllib.error.URLError, OSError):
            if i==tries-1: raise
            time.sleep(5)

EMAIL_RE=re.compile(r'^[^@\s]+@[^@\s]+\.[^@\s]{2,}$')
def valid_email(v):
    if not v: return False
    s=str(v).strip().lower()
    if s in {"not found","not_found","no-results-found","submitted","skipped","error","processing"}: return False
    return "@" in s and bool(EMAIL_RE.match(s))

def settled(cell, is_aiark):
    status=cell.get("status"); val=cell.get("value")
    ed=cell.get("enrichmentData") or {}; eds=str(ed.get("status") or "").lower()
    if is_aiark and (status=="processing" or str(val).strip().lower()=="submitted"): return False
    if valid_email(val): return True
    if status in ("complete","error"): return True
    if eds in ("not_found","valid","invalid","catch_all","error","found"): return True
    return False

def fetch_cells(rowIds, colId):
    out={}
    for i in range(0,len(rowIds),80):
        ids=",".join(rowIds[i:i+80])
        st,txt,_=req("GET",f"/api/rows?tableId={TABLE}&rowIds={ids}&limit=80")
        for x in json.loads(txt): out[x["id"]]=(x.get("data") or {}).get(colId,{}) or {}
    return out

def fire(path, rowIds, resultCol, extra=None):
    body={"tableId":TABLE,"rowIds":rowIds,"inputMode":"full_name",
          "fullNameColumnId":FULL,"domainColumnId":DOMAIN,"resultColumnId":resultCol}
    if extra: body.update(extra)
    try:
        st,txt,_=req("POST",path,body,timeout=600,tries=2)
        log(f"  POST {path} -> {st}: {txt[:200]}")
    except Exception as e:
        log(f"  POST {path} err (tolerated; polling): {e!r}")

def poll(rowIds, colId, is_aiark, max_wait):
    t0=time.time(); cells={}
    while True:
        time.sleep(12)
        try: cells=fetch_cells(rowIds,colId)
        except Exception as e:
            if time.time()-t0>max_wait: break
            log(f"   poll err {e!r}"); continue
        unsettled=[r for r in rowIds if not settled(cells.get(r,{}), is_aiark)]
        found=sum(1 for r in rowIds if valid_email(cells.get(r,{}).get("value")))
        log(f"   poll {colId[:8]}: settled {len(rowIds)-len(unsettled)}/{len(rowIds)} | found={found} | {int(time.time()-t0)}s")
        if not unsettled or time.time()-t0>max_wait: break
    return cells

# ---- target rows ----
if MODE=="test":
    TARGET=cfg["testRowIds"]
else:
    flt=urllib.parse.quote(json.dumps([{"columnId":DOMAIN,"operator":"is_not_empty"},
                                       {"columnId":FULL,"operator":"is_not_empty"}]))
    st,txt,_=req("GET",f"/api/rows?tableId={TABLE}&filters={flt}&filterLogic=AND&limit=30000")
    TARGET=[r["id"] for r in json.loads(txt)]
log(f"MODE={MODE} | target rows={len(TARGET)}")

passes=[]
# Pass 1: AI Ark (async)
log("PASS 1 — AI Ark (async) on all targets")
fire("/api/find-email/ai-ark", TARGET, AIARK)
c=poll(TARGET, AIARK, True, 1200)
missing=[r for r in TARGET if not valid_email(c.get(r,{}).get("value"))]
passes.append(("AI Ark", len(TARGET), len(TARGET)-len(missing)))
log(f"AI Ark found {len(TARGET)-len(missing)}/{len(TARGET)}; {len(missing)} fall through")

# Pass 2: TryKitt
if missing:
    log(f"PASS 2 — TryKitt on {len(missing)}")
    fire("/api/find-email/trykitt", missing, TRYKITT)
    c=poll(missing, TRYKITT, False, 900)
    m2=[r for r in missing if not valid_email(c.get(r,{}).get("value"))]
    passes.append(("TryKitt", len(missing), len(missing)-len(m2))); missing=m2
log(f"after TryKitt: {len(missing)} remaining")

# Pass 3: BetterEnrich (+linkedin)
if missing:
    log(f"PASS 3 — BetterEnrich on {len(missing)}")
    fire("/api/find-email/betterenrich", missing, BETTER, {"linkedinColumnId":LINKEDIN})
    c=poll(missing, BETTER, False, 1200)
    m3=[r for r in missing if not valid_email(c.get(r,{}).get("value"))]
    passes.append(("BetterEnrich", len(missing), len(missing)-len(m3))); missing=m3
log(f"after BetterEnrich: {len(missing)} remaining")

# Pass 4: Ninjer
if missing:
    log(f"PASS 4 — Ninjer on {len(missing)}")
    fire("/api/find-email/run", missing, NINJER)
    c=poll(missing, NINJER, False, 1200)
    m4=[r for r in missing if not valid_email(c.get(r,{}).get("value"))]
    passes.append(("Ninjer", len(missing), len(missing)-len(m4))); missing=m4
log(f"after Ninjer: {len(missing)} remaining (no email)")

# ---- write final column ----
log("writing Email (Waterfall) final column...")
allcells={col:fetch_cells(TARGET,col) for col in [AIARK,TRYKITT,BETTER,NINJER]}
updates=[]; final_found=0; cost=0.0
for rid in TARGET:
    email=None; src=None
    for col,nm in [(AIARK,"AI Ark"),(TRYKITT,"TryKitt"),(BETTER,"BetterEnrich"),(NINJER,"Ninjer")]:
        cell=allcells[col].get(rid,{})
        v=cell.get("value")
        m=cell.get("metadata") or {}; ed=cell.get("enrichmentData") or {}
        cost+= (m.get("totalCost") or m.get("cost") or ed.get("cost") or 0) or 0
        if valid_email(v): email=str(v).strip(); src=nm; break
    if email: final_found+=1
    updates.append({"id":rid,"data":{FINAL:{"value": email or "not found"}}})
for i in range(0,len(updates),200):
    req("PATCH","/api/rows",{"updates":updates[i:i+200]},timeout=180)
log(f"final column written: {final_found}/{len(TARGET)} have an email")

# ---- report ----
log("="*60)
log(f"WATERFALL {MODE.upper()} REPORT  (target={len(TARGET)})")
cum=0
for nm,ran,found in passes:
    cum+=found
    log(f"  {nm:13} ran on {ran:>4} -> found {found:>4} new   (cumulative {cum})")
log(f"  TOTAL with email: {final_found}/{len(TARGET)}  ({100*final_found/max(1,len(TARGET)):.1f}% hit rate)")
log(f"  no email found:   {len(TARGET)-final_found}")
if cost: log(f"  metadata cost sum (if reported): ${cost:.4f}")
log("="*60)
