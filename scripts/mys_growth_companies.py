"""Malaysia headcount-growth company list -> Campaigns June / "5% Growth >6 Months | Malaysia" / Sheet 1.

Direct AI Ark /companies pull (filter our wrapper doesn't expose: account.metric.growth),
then bulk import into the target sheet. No app code change, no ACA rebuild — does not touch
the running Indonesia email waterfall.

MYS_MODE=preview (default) : 1 page, report count/cost, no writes.
MYS_MODE=full              : paginate all (or MYS_CAP), create columns, bulk import.
"""
import os, sys, json, time, base64, re, urllib.request, urllib.error
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
try: sys.stdout.reconfigure(encoding="utf-8")
except Exception: pass

MODE = os.environ.get("MYS_MODE", "preview")
CAP = int(os.environ.get("MYS_CAP", "0"))  # 0 = all matches

ENV = {}
for line in open(r"C:\Users\Vilca\Desktop\Clay-Clone\.env.local", encoding="utf-8"):
    s = line.strip()
    if not s or s.startswith("#") or "=" not in s: continue
    k, v = s.split("=", 1)
    ENV[k.strip()] = v.strip().strip('"').strip("'")

DATAFLOW = "https://dataflow-pi.vercel.app"
DKEY = ENV["DATAFLOW_API_KEY"]
# Parameterized per country/sheet (default = Malaysia). Sibling workbooks reuse this.
COUNTRY = os.environ.get("MYS_COUNTRY", "Malaysia")
TABLE = os.environ.get("MYS_TABLE", "7fbd828a-9934-481b-a832-8b3e17859e21")
AIARK_BASE = "https://api.ai-ark.com/api/developer-portal/v1"

def log(*a): print(time.strftime("%H:%M:%S"), *a, flush=True)

# ── AI Ark key from Turso app_secrets (mirrors src/lib/secrets.ts) ──
def _enc_key():
    e = ENV.get("SECRETS_ENC_KEY", "").strip()
    if re.fullmatch(r"[0-9a-fA-F]{64}", e): return bytes.fromhex(e)
    b = base64.b64decode(e); return b if len(b) == 32 else None
def _decrypt(stored):
    if not stored.startswith("v1:gcm:"): return stored
    _, _, iv, tag, ct = stored.split(":")
    return AESGCM(_enc_key()).decrypt(base64.b64decode(iv), base64.b64decode(ct)+base64.b64decode(tag), None).decode()
def get_aiark_key():
    url = ENV["TURSO_DATABASE_URL"].replace("libsql://", "https://").split("?")[0].rstrip("/") + "/v2/pipeline"
    body = {"requests": [{"type":"execute","stmt":{"sql":"SELECT value FROM app_secrets WHERE key='AI_ARC_API_KEY'"}}, {"type":"close"}]}
    r = urllib.request.Request(url, data=json.dumps(body).encode(), method="POST")
    r.add_header("Authorization", "Bearer " + ENV["TURSO_AUTH_TOKEN"]); r.add_header("Content-Type","application/json")
    with urllib.request.urlopen(r, timeout=60) as resp:
        rows = json.loads(resp.read().decode())["results"][0]["response"]["result"]["rows"]
    return _decrypt(rows[0][0]["value"]).strip()

AIKEY = get_aiark_key()
log("AI Ark key loaded (masked ••••%s) | COUNTRY=%s | TABLE=%s | MODE=%s" % (AIKEY[-4:], COUNTRY, TABLE, MODE))

# ── AI Ark company search ──
FILTERS = {
    "account": {
        "location":     {"any": {"include": [COUNTRY]}},
        "employeeSize": {"type": "RANGE", "range": [{"start": 100, "end": 1000}]},
        "metric":       {"growth": [{"start": 5, "end": 100, "timeFrame": "TWELVE"}]},
    }
}
def aiark(path, body=None, method=None, tries=4):
    m = method or ("POST" if body is not None else "GET")
    for i in range(tries):
        try:
            r = urllib.request.Request(AIARK_BASE+path, data=(json.dumps(body).encode() if body is not None else None), method=m)
            r.add_header("Content-Type","application/json"); r.add_header("X-TOKEN", AIKEY)
            r.add_header("Accept","application/json")
            r.add_header("User-Agent","Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36")
            time.sleep(0.25)  # ~5 req/s, polite alongside the waterfall
            with urllib.request.urlopen(r, timeout=120) as resp:
                return resp.status, json.loads(resp.read().decode() or "{}")
        except urllib.error.HTTPError as e:
            txt = e.read().decode()[:300]
            if e.code in (429,) or e.code >= 500:
                if i < tries-1: time.sleep(2*(i+1)); continue
            return e.code, {"_error": txt}
        except (urllib.error.URLError, OSError) as e:
            if i < tries-1: time.sleep(2*(i+1)); continue
            return 0, {"_error": repr(e)}

def page_body(page, size): return {"page": page, "size": size, **FILTERS}

def parse_company(raw):
    summ = raw.get("summary") or {}; link = raw.get("link") or {}
    fin = (raw.get("financial") or {}).get("funding") or {}
    hq = (raw.get("location") or {}).get("headquarter") or {}
    staff = summ.get("staff") or {}; rng = staff.get("range") or {}
    techs = raw.get("technologies") or []
    tech_names = []
    for t in (techs if isinstance(techs, list) else []):
        if isinstance(t, str): tech_names.append(t)
        elif isinstance(t, dict): tech_names.append(t.get("name") or t.get("product") or t.get("vendor") or "")
    tech_names = [t for t in tech_names if t][:15]
    tot = fin.get("total_amount")
    return {
        "Company Name": summ.get("name") or "",
        "Domain": link.get("domain") or "",
        "Website": link.get("website") or "",
        "Employees": staff.get("total") or "",
        "Employee Range": (f"{rng.get('start')}-{rng.get('end')}" if rng.get("start") and rng.get("end") else ""),
        "Industry": summ.get("industry") or "",
        "HQ City": hq.get("city") or "",
        "HQ State": hq.get("state") or "",
        "Founded Year": summ.get("founded_year") or "",
        "LinkedIn URL": link.get("linkedin") or "",
        "Funding": (f"${tot/1e6:.1f}M" if isinstance(tot,(int,float)) and tot else "") + ((" " + fin.get("type")) if fin.get("type") else ""),
        "Technologies": ", ".join(tech_names),
        "Description": ((summ.get("description") or "")[:500]),
    }

# ── PREVIEW ──
st, data = aiark("/companies", page_body(0, 20))
log(f"AI Ark /companies preview -> HTTP {st}")
if st != 200:
    log("preview failed:", json.dumps(data)[:400]); raise SystemExit(1)
total = data.get("totalElements"); pages = data.get("totalPages")
content = data.get("content") or []
log(f"totalElements={total}  totalPages={pages}  sample_returned={len(content)}")
for raw in content[:8]:
    c = parse_company(raw)
    log("   -", c["Company Name"], "|", c["Domain"], "| emp", c["Employees"], c["Employee Range"], "|", c["HQ City"], c["HQ State"])

if MODE != "full":
    log("PREVIEW ONLY. Re-run with MYS_MODE=full (optional MYS_CAP=N) to create columns + import.")
    raise SystemExit(0)

# ── FULL: create columns + paginate + import ──
def df(method, path, body=None, timeout=180, tries=5):
    for i in range(tries):
        try:
            r = urllib.request.Request(DATAFLOW+path, data=(json.dumps(body).encode() if body is not None else None), method=method)
            r.add_header("Authorization","Bearer "+DKEY)
            if body is not None: r.add_header("Content-Type","application/json")
            with urllib.request.urlopen(r, timeout=timeout) as resp:
                return resp.status, json.loads(resp.read().decode() or "{}")
        except urllib.error.HTTPError as e:
            return e.code, {"_error": e.read().decode()[:300]}
        except (urllib.error.URLError, OSError):
            if i < tries-1: time.sleep(4); continue
            raise

COLS = [("Company Name","text"),("Domain","url"),("Website","url"),("Employees","number"),
        ("Employee Range","text"),("Industry","text"),("HQ City","text"),("HQ State","text"),
        ("Founded Year","number"),("LinkedIn URL","url"),("Funding","text"),
        ("Technologies","text"),("Description","text")]
_, existing = df("GET", f"/api/columns?tableId={TABLE}")
have = {c["name"]: c["id"] for c in existing} if isinstance(existing, list) else {}
colid = {}
for name, typ in COLS:
    if name in have: colid[name] = have[name]
    else:
        _, r = df("POST","/api/columns",{"tableId":TABLE,"name":name,"type":typ})
        colid[name] = r.get("id") or (r.get("column") or {}).get("id")
        log(f"created column {name} -> {colid[name]}")

# paginate
size = 100
all_rows = []   # refetch cleanly from page 0 at full page size (preview used size 20)
page = 0
while True:
    st, data = aiark("/companies", page_body(page, size))
    if st != 200:
        log(f"page {page} HTTP {st}: {json.dumps(data)[:200]}"); break
    batch = data.get("content") or []
    all_rows.extend(batch)
    log(f"fetched page {page} (+{len(batch)}, total {len(all_rows)})")
    page += 1
    if len(batch) < size: break
    if page >= (pages or 1): break
    if CAP > 0 and len(all_rows) >= CAP: break
if CAP > 0: all_rows = all_rows[:CAP]
log(f"fetched {len(all_rows)} companies; importing into Sheet 1...")

# bulk import (chunks of 300, lightweight to not compete with the waterfall)
rows_payload = []
for raw in all_rows:
    c = parse_company(raw)
    data_obj = {}
    for name, _ in COLS:
        v = c.get(name)
        if v not in (None, ""): data_obj[colid[name]] = {"value": v}
    if data_obj.get(colid["Company Name"]): rows_payload.append(data_obj)
imported = 0
for i in range(0, len(rows_payload), 300):
    chunk = rows_payload[i:i+300]
    st, r = df("POST","/api/rows",{"tableId":TABLE,"rows":chunk})
    imported += len(chunk)
    log(f"imported {imported}/{len(rows_payload)} (HTTP {st})")
log(f"DONE. imported {imported} companies into Sheet 1.")
