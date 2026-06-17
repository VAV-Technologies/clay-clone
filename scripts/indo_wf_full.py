"""FULL Indonesia email waterfall — AI Ark -> TryKitt -> BetterEnrich -> Ninjer on every
row with a Final Domain + Full Name. Resumable, parallel sub-batches, checkpointed.

Design:
- One live state column = Email (Waterfall). A row is "resolved" once it holds a valid email.
- Providers run in strict order (stages). Within a stage, sub-batches run concurrently.
- Each provider writes its own result column; found emails are copied into Email (Waterfall)
  immediately, so the next stage only targets still-unresolved rows.
- Checkpoint (indo_wf_full_ckpt.json) records rows already attempted per provider so a restart
  does not re-fire (and re-charge) settled rows. Resume = just run again.
- After all 4 stages, rows still unresolved get 'not found'.

Env: WF_AIARK_CONC (default 3), WF_SYNC_CONC (default 8).
"""
import os, sys, json, time, re, threading, urllib.parse, urllib.request, urllib.error
from concurrent.futures import ThreadPoolExecutor, as_completed
try: sys.stdout.reconfigure(encoding="utf-8")
except Exception: pass

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
CKPT=os.path.join(HERE,"indo_wf_full_ckpt.json")

AIARK_CONC=int(os.environ.get("WF_AIARK_CONC","3"))
SYNC_CONC=int(os.environ.get("WF_SYNC_CONC","8"))
AIARK_BATCH=80; SYNC_BATCH=100
POLL_EVERY=15; STALL_POLLS=14; HARD_CAP=3000   # per sub-batch poll

lock=threading.Lock()
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

def patch_final(found):  # found: {rowId: email}
    items=[{"id":r,"data":{FINAL:{"value":str(v).strip()}}} for r,v in found.items()]
    for i in range(0,len(items),150):
        req("PATCH","/api/rows",{"updates":items[i:i+150]},timeout=180)

def fire(path, rowIds, resultCol, linkedin=False):
    body={"tableId":TABLE,"rowIds":rowIds,"inputMode":"full_name",
          "fullNameColumnId":FULL,"domainColumnId":DOMAIN,"resultColumnId":resultCol}
    if linkedin: body["linkedinColumnId"]=LINKEDIN
    try:
        req("POST",path,body,timeout=600,tries=2)
    except Exception as e:
        pass  # gateway 502 expected on long syncs; backend continues; we poll

def poll_batch(batch, col, is_aiark):
    t0=time.time(); last=-1; stall=0; cells={}
    while True:
        time.sleep(POLL_EVERY)
        try: cells=fetch_cells(batch,col)
        except Exception:
            if time.time()-t0>HARD_CAP: return cells
            continue
        s=sum(1 for r in batch if settled(cells.get(r,{}),is_aiark))
        if s>=len(batch): return cells
        if s==last: stall+=1
        else: stall=0; last=s
        if (stall>=STALL_POLLS and time.time()-t0>300) or time.time()-t0>HARD_CAP:
            return cells

def load_ckpt():
    if os.path.exists(CKPT): return json.load(open(CKPT))
    return {"attempted":{}, "found_total":0}
ckpt=load_ckpt()
def save_ckpt():
    json.dump(ckpt, open(CKPT,"w"))

def load_target():
    flt=urllib.parse.quote(json.dumps([{"columnId":DOMAIN,"operator":"is_not_empty"},
                                       {"columnId":FULL,"operator":"is_not_empty"}]))
    st,txt,_=req("GET",f"/api/rows?tableId={TABLE}&filters={flt}&filterLogic=AND&limit=30000")
    return [r["id"] for r in json.loads(txt)]

def resolved_set(target):
    cells=fetch_cells(target, FINAL)
    return {r for r in target if valid_email(cells.get(r,{}).get("value"))}

def run_stage(path, key, col, is_aiark, conc, batch_size, target):
    # "needing" is computed from PERSISTED state: a row needs this provider iff it has no
    # valid email yet (Email Waterfall) AND this provider's own cell isn't already settled.
    # This auto-skips the 200 test rows + anything already attempted, and makes resume clean.
    resolved=resolved_set(target)
    provcells=fetch_cells(target, col)
    needing=[r for r in target if r not in resolved and not settled(provcells.get(r,{}), is_aiark)]
    batches=[needing[i:i+batch_size] for i in range(0,len(needing),batch_size)]
    log(f"=== STAGE {key}: needing={len(needing)} | resolved-so-far={len(resolved)} | "
        f"{len(batches)} batches x{batch_size} conc={conc} ===")
    stage_found=0; done=0
    def do_batch(batch):
        fire(path, batch, col, linkedin=(key=="betterenrich"))
        cells=poll_batch(batch, col, is_aiark)
        found={r:cells[r]["value"] for r in batch if valid_email(cells.get(r,{}).get("value"))}
        if found: patch_final(found)
        with lock:
            ckpt["attempted"].setdefault(key,[]).extend(batch)
            ckpt["found_total"]=ckpt.get("found_total",0)+len(found)
            save_ckpt()
        return len(found), len(batch)
    with ThreadPoolExecutor(max_workers=conc) as ex:
        futs=[ex.submit(do_batch,b) for b in batches]
        for f in as_completed(futs):
            try: fnd,n=f.result()
            except Exception as e: log(f"  [{key}] batch err {e!r}"); continue
            stage_found+=fnd; done+=1
            log(f"  [{key}] batch {done}/{len(batches)} +{fnd} | stage_found={stage_found} | cum_found={ckpt['found_total']}")
    log(f"=== STAGE {key} DONE: +{stage_found} emails of {len(needing)} attempted ===")

target=load_target()
log(f"TARGET rows (Final Domain + Full Name): {len(target)}")
log(f"already resolved at start: {len(resolved_set(target))}")

STAGES=[("/api/find-email/ai-ark","aiark",AIARK,True,AIARK_CONC,AIARK_BATCH),
        ("/api/find-email/trykitt","trykitt",TRYKITT,False,SYNC_CONC,SYNC_BATCH),
        ("/api/find-email/betterenrich","betterenrich",BETTER,False,SYNC_CONC,SYNC_BATCH),
        ("/api/find-email/run","ninjer",NINJER,False,SYNC_CONC,SYNC_BATCH)]
for path,key,col,aiark,conc,bs in STAGES:
    run_stage(path,key,col,aiark,conc,bs,target)

# finalize: mark exhausted rows 'not found'
resolved=resolved_set(target)
notfound=[r for r in target if r not in resolved]
log(f"finalizing: {len(resolved)} with email, {len(notfound)} exhausted -> 'not found'")
for i in range(0,len(notfound),150):
    req("PATCH","/api/rows",{"updates":[{"id":r,"data":{FINAL:{"value":"not found"}}} for r in notfound[i:i+150]]},timeout=180)
log("="*60)
log(f"FULL WATERFALL DONE: {len(resolved)}/{len(target)} rows have an email "
    f"({100*len(resolved)/max(1,len(target)):.1f}%)")
log("="*60)
