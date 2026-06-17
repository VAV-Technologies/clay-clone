"""
Surgical restore of the original `Company Domain` column on the Indonesia CEO sheet.

Context: a one-off step (not the runner scripts, not the enrichment engine) copied the
AI-found domains from `Official Domain (AI)` into the ORIGINAL `Company Domain` url column.
That mutated original data against this job's design (AI output was supposed to stay isolated
in its own column). This restores `Company Domain` to original-data-only by clearing ONLY the
cells whose value is byte-identical to the AI result (i.e. the copies). Genuinely-original
domains (where the AI never ran) are left untouched. The AI values remain safe in
`Official Domain (AI)`, so nothing is lost. A backup is written before any write.
"""
import os, sys, json, time, urllib.parse, urllib.request, urllib.error
try: sys.stdout.reconfigure(encoding="utf-8")
except Exception: pass

KEY = None
for line in open(r"C:\Users\Vilca\Desktop\Clay-Clone\.env.local", encoding="utf-8"):
    if line.strip().startswith("DATAFLOW_API_KEY"):
        KEY = line.split("=", 1)[1].strip().strip('"').strip("'"); break

BASE = "https://dataflow-pi.vercel.app"
TABLE = "cb09b8f0-aeea-4d53-8420-1f126131f1c3"
DOM = "96f79ff7-a9c1-424e-95cd-a37e7b9b2464"   # Company Domain (original, url)
OUTCOL = "cjLzwW5FPjPf"                         # Official Domain (AI)
NAME = "b0c9c4b4-954f-4ed3-a558-baffe8cdf7c1"
HERE = os.path.dirname(os.path.abspath(__file__))
BACKUP = os.path.join(HERE, "indo_company_domain_backup.json")
BATCH = 400

def req(method, path, body=None, timeout=120):
    data = json.dumps(body).encode() if body is not None else None
    r = urllib.request.Request(BASE + path, data=data, method=method)
    r.add_header("Authorization", "Bearer " + KEY)
    if data: r.add_header("Content-Type", "application/json")
    with urllib.request.urlopen(r, timeout=timeout) as resp:
        return resp.status, resp.read().decode(), resp.headers

def count(filters):
    flt = urllib.parse.quote(json.dumps(filters))
    st, txt, hdr = req("GET", f"/api/rows?tableId={TABLE}&filters={flt}&filterLogic=AND&limit=1")
    return int(hdr.get("X-Filtered-Count") or 0)

def norm(s):
    return (str(s or "").strip().lower()
            .replace("https://", "").replace("http://", "").replace("www.", "").rstrip("/"))

def log(*a): print(time.strftime("%H:%M:%S"), *a, flush=True)

# ---- 1. fetch the overlap (DOM filled AND AI filled) ----
flt = urllib.parse.quote(json.dumps([
    {"columnId": DOM, "operator": "is_not_empty"},
    {"columnId": OUTCOL, "operator": "is_not_empty"},
]))
st, txt, _ = req("GET", f"/api/rows?tableId={TABLE}&filters={flt}&filterLogic=AND&limit=10000")
rows = json.loads(txt)
log(f"overlap rows fetched: {len(rows)}")

to_clear, differ = [], []
for r in rows:
    dv = r["data"].get(DOM, {}).get("value")
    av = r["data"].get(OUTCOL, {}).get("value")
    if norm(dv) == norm(av):
        to_clear.append({"id": r["id"], "name": r["data"].get(NAME, {}).get("value"),
                         "cleared_company_domain": dv, "ai_value": av})
    else:
        differ.append({"id": r["id"], "company_domain": dv, "ai_value": av})

log(f"identical (copies -> will clear): {len(to_clear)}")
log(f"differ (ORIGINAL data, will KEEP): {len(differ)}")
if differ:
    log("  examples of kept/differing rows:")
    for d in differ[:10]:
        log("   ", json.dumps(d, ensure_ascii=False))

# ---- 2. backup before any write ----
json.dump({"table": TABLE, "column": DOM, "cleared": to_clear, "kept_differ": differ},
          open(BACKUP, "w", encoding="utf-8"), ensure_ascii=False)
log(f"backup written: {BACKUP} ({len(to_clear)} cells)")

if not to_clear:
    log("nothing to clear; exiting."); raise SystemExit

before_dom = count([{"columnId": DOM, "operator": "is_not_empty"}])
before_ai = count([{"columnId": OUTCOL, "operator": "is_not_empty"}])
log(f"BEFORE: Company Domain not-empty={before_dom}  AI not-empty={before_ai}")

# ---- 3. TEST on 5 rows first, confirm the clear registers as is_empty ----
test = to_clear[:5]
req("PATCH", "/api/rows", {"updates": [{"id": t["id"], "data": {DOM: {"value": ""}}} for t in test]}, timeout=120)
time.sleep(2)
test_ids = ",".join(t["id"] for t in test)
st, txt, _ = req("GET", f"/api/rows?tableId={TABLE}&rowIds={test_ids}&limit=5")
chk = {x["id"]: x for x in json.loads(txt)}
still_filled = [t["id"] for t in test if norm(chk.get(t["id"], {}).get("data", {}).get(DOM, {}).get("value"))]
if still_filled:
    log(f"!! TEST FAILED: {len(still_filled)} test cells still filled after value=''. Trying value=null...")
    req("PATCH", "/api/rows", {"updates": [{"id": t["id"], "data": {DOM: {"value": None}}} for t in test]}, timeout=120)
    time.sleep(2)
    st, txt, _ = req("GET", f"/api/rows?tableId={TABLE}&rowIds={test_ids}&limit=5")
    chk = {x["id"]: x for x in json.loads(txt)}
    still = [t["id"] for t in test if norm(chk.get(t["id"], {}).get("data", {}).get(DOM, {}).get("value"))]
    if still:
        log(f"!! null also failed ({len(still)} still filled). ABORTING — investigate clear semantics.")
        raise SystemExit
    CLEAR_VAL = None
    log("  value=null works; using null for the rest.")
else:
    CLEAR_VAL = ""
    log("  TEST OK: value='' clears the cell (registers as empty).")

# ---- 4. clear the remaining cells in batches ----
rest = to_clear[5:]
for i in range(0, len(rest), BATCH):
    chunk = rest[i:i + BATCH]
    req("PATCH", "/api/rows",
        {"updates": [{"id": c["id"], "data": {DOM: {"value": CLEAR_VAL}}} for c in chunk]}, timeout=180)
    log(f"  cleared batch {i//BATCH + 1}: {len(chunk)} cells ({i+5+len(chunk)}/{len(to_clear)})")

# ---- 5. verify ----
time.sleep(2)
after_dom = count([{"columnId": DOM, "operator": "is_not_empty"}])
after_ai = count([{"columnId": OUTCOL, "operator": "is_not_empty"}])
overlap = count([{"columnId": DOM, "operator": "is_not_empty"}, {"columnId": OUTCOL, "operator": "is_not_empty"}])
log(f"AFTER: Company Domain not-empty={after_dom}  AI not-empty={after_ai}  overlap={overlap}")
log(f"Company Domain dropped by {before_dom - after_dom} (expected ~{len(to_clear)}).")
log(f"AI column unchanged: {before_ai} -> {after_ai} ({'OK' if before_ai==after_ai else 'CHANGED!'})")
log("DONE.")
