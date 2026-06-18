"""Malaysia decision-maker PEOPLE list.
Part 1: write a `Qualified` column on the company Sheet 1 (KEEP/EXCLUDE by Industry exclude-set).
Part 2: AI Ark /people search (title union, SMART) scoped to KEEP companies' domains -> new "People" sheet.

MYS_PEOPLE_MODE=preview (default): write Qualified + size the people count (no People sheet/import).
MYS_PEOPLE_MODE=full: also create the People sheet + paginate + import.
No emails. Direct AI Ark calls (no app/ACA change) — does not disrupt the Indonesia waterfall.
"""
import os, sys, json, time, base64, re, urllib.request, urllib.error
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
try: sys.stdout.reconfigure(encoding="utf-8")
except Exception: pass

MODE = os.environ.get("MYS_PEOPLE_MODE", "preview")
SKIP_FILTER = os.environ.get("MYS_SKIP_FILTER", "") == "1"   # resume: Qualified already written
ENV = {}
for line in open(r"C:\Users\Vilca\Desktop\Clay-Clone\.env.local", encoding="utf-8"):
    s = line.strip()
    if not s or s.startswith("#") or "=" not in s: continue
    k, v = s.split("=", 1); ENV[k.strip()] = v.strip().strip('"').strip("'")

DATAFLOW = "https://dataflow-pi.vercel.app"; DKEY = ENV["DATAFLOW_API_KEY"]
WORKBOOK = "31450d90-5dd4-4561-b5f6-b95b65afe240"          # 5% Growth >6 Months | Malaysia
SRC = "7fbd828a-9934-481b-a832-8b3e17859e21"               # company Sheet 1
AIARK_BASE = "https://api.ai-ark.com/api/developer-portal/v1"
DOMAIN_BATCH = int(os.environ.get("MYS_DOMAIN_BATCH", "75"))   # small batches keep each query < AI Ark's 10k cap
TITLE_MODE = os.environ.get("MYS_TITLE_MODE", "STRICT")
CAP_PER_CO = int(os.environ.get("MYS_CAP_PER_CO", "8"))         # keep top-N most-senior per company
SENIORITY_RANK = {"owner":100,"founder":100,"c_suite":90,"c_level":90,"partner":80,"vp":70,
                  "head":60,"director":50,"managing_director":50,"manager":40,"lead":35,
                  "senior":30,"entry":5,"entry_level":5,"intern":1}

EXCLUDE = {
    "law practice","research services","market research","think tanks",
    "venture capital and private equity principals","capital markets",
    "government administration","government relations services","law enforcement",
    "non-profit organizations","civic and social organizations",
    "higher education","education administration programs","primary and secondary education",
}

TITLES = list(dict.fromkeys([
    # Ultimate champions
    "CEO","President","Founder","Owner","Chairman","Executive Chairman","Vice Chairman",
    "Managing Director","Group CEO","Global CEO",
    # Board / governance
    "Board Member","Independent Director","Lead Director","M&A Committee Chair",
    "Strategy Committee Chair","Audit Committee Chair","Board of Commissioners Member","President Commissioner",
    # Finance
    "CFO","Group CFO","Deputy CFO","Regional CFO","Divisional CFO","EVP Finance","SVP Finance",
    "VP Finance","Finance Director","Group Finance Director",
    # Corporate development
    "Chief Corporate Development Officer","Head of Corporate Development","EVP Corporate Development",
    "SVP Corporate Development","VP Corporate Development","Director of Corporate Development",
    "Corporate Development Lead","Corporate Development Manager","Corporate Development Associate",
    "Corporate Development Analyst",
    # M&A
    "Chief M&A Officer","Head of M&A","Global Head of M&A","Regional Head of M&A","VP M&A",
    "Director of M&A","M&A Manager","M&A Lead","M&A Associate","M&A Analyst","Head of Transactions",
    "Head of Deal Execution","Head of Inorganic Growth",
    # Strategy
    "Chief Strategy Officer","Head of Strategy","Head of Corporate Strategy","EVP Strategy","SVP Strategy",
    "VP Strategy","VP Corporate Strategy","Director of Strategy","Strategy Manager",
    "Chief Transformation Officer","Head of Strategy & Transformation",
    # Business development
    "Chief Business Officer","Chief Business Development Officer","EVP Business Development",
    "SVP Business Development","VP Business Development","Head of Business Development",
    "Director of Business Development","Head of Strategic Partnerships","VP Strategic Partnerships",
    "Head of Strategic Initiatives",
    # Investments
    "Chief Investment Officer","Head of Investments","VP Investments","Director of Investments",
    "Investment Manager","Head of Strategic Investments","Principal","Investment Committee Member",
    # Operating leadership
    "COO","Group President","Division President","Business Unit Head","Business Unit President",
    "General Manager","Country Head","Country Manager","Regional President","Regional Managing Director",
    # Legal
    "General Counsel","Chief Legal Officer","Deputy General Counsel","Associate General Counsel, M&A",
    "Head of Legal, M&A","VP Legal","Director of Legal Affairs","Corporate Secretary",
    # Treasury & capital markets
    "Treasurer","VP Treasury","Head of Capital Markets","Director of Capital Markets","Head of Corporate Finance",
    # Integration
    "Chief Integration Officer","Head of Integration","Head of Post-Merger Integration","VP Integration",
    "Director of PMI","Integration Manager",
    # Tax & accounting
    "VP Tax","Head of Tax","Director of M&A Tax","Chief Accounting Officer","Group Controller",
    # SME / founder-led
    "Co-Founder","Shareholder","Family Principal","Family Office Head","Operating Partner",
    "Managing Partner","Executive Director",
]))

def log(*a): print(time.strftime("%H:%M:%S"), *a, flush=True)

# ── AI Ark key (Turso app_secrets, mirrors src/lib/secrets.ts) ──
def _enc_key():
    e = ENV.get("SECRETS_ENC_KEY", "").strip()
    if re.fullmatch(r"[0-9a-fA-F]{64}", e): return bytes.fromhex(e)
    b = base64.b64decode(e); return b if len(b) == 32 else None
def _decrypt(stored):
    if not stored.startswith("v1:gcm:"): return stored
    _, _, iv, tag, ct = stored.split(":")
    return AESGCM(_enc_key()).decrypt(base64.b64decode(iv), base64.b64decode(ct)+base64.b64decode(tag), None).decode()
def get_aiark_key():
    url = ENV["TURSO_DATABASE_URL"].replace("libsql://","https://").split("?")[0].rstrip("/") + "/v2/pipeline"
    body = {"requests":[{"type":"execute","stmt":{"sql":"SELECT value FROM app_secrets WHERE key='AI_ARC_API_KEY'"}},{"type":"close"}]}
    r = urllib.request.Request(url, data=json.dumps(body).encode(), method="POST")
    r.add_header("Authorization","Bearer "+ENV["TURSO_AUTH_TOKEN"]); r.add_header("Content-Type","application/json")
    with urllib.request.urlopen(r, timeout=60) as resp:
        rows = json.loads(resp.read().decode())["results"][0]["response"]["result"]["rows"]
    return _decrypt(rows[0][0]["value"]).strip()
AIKEY = get_aiark_key()
log(f"AI Ark key ••••{AIKEY[-4:]} | MODE={MODE} | {len(TITLES)} titles | mode={TITLE_MODE}")

UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
def aiark(path, body=None, tries=4):
    m = "POST" if body is not None else "GET"
    for i in range(tries):
        try:
            r = urllib.request.Request(AIARK_BASE+path, data=(json.dumps(body).encode() if body is not None else None), method=m)
            r.add_header("Content-Type","application/json"); r.add_header("Accept","application/json")
            r.add_header("X-TOKEN", AIKEY); r.add_header("User-Agent", UA)
            time.sleep(0.25)
            with urllib.request.urlopen(r, timeout=120) as resp:
                return resp.status, json.loads(resp.read().decode() or "{}")
        except urllib.error.HTTPError as e:
            txt = e.read().decode()[:200]
            if e.code == 429 or e.code >= 500:
                if i < tries-1: time.sleep(2*(i+1)); continue
            return e.code, {"_error": txt}
        except (urllib.error.URLError, OSError) as e:
            if i < tries-1: time.sleep(2*(i+1)); continue
            return 0, {"_error": repr(e)}

def df(method, path, body=None, timeout=180, tries=5):
    for i in range(tries):
        try:
            r = urllib.request.Request(DATAFLOW+path, data=(json.dumps(body).encode() if body is not None else None), method=method)
            r.add_header("Authorization","Bearer "+DKEY)
            if body is not None: r.add_header("Content-Type","application/json")
            with urllib.request.urlopen(r, timeout=timeout) as resp:
                return resp.status, json.loads(resp.read().decode() or "{}")
        except urllib.error.HTTPError as e:
            return e.code, {"_error": e.read().decode()[:200]}
        except (urllib.error.URLError, OSError):
            if i < tries-1: time.sleep(4); continue
            raise

def people_body(domains, page, size):
    return {"page": page, "size": size,
            "account": {"domain": {"any": {"include": domains}}},
            "contact": {"experience": {"current": {"title": {"any": {"include": {"mode": TITLE_MODE, "content": TITLES}}}}}}}

def nd(d):  # normalize a domain for comparison/storage
    return str(d or "").strip().lower().replace("https://","").replace("http://","").replace("www.","").rstrip("/")

def parse_person(raw):
    p = raw.get("profile") or {}; link = raw.get("link") or {}; loc = raw.get("location") or {}
    co = raw.get("company") or {}; cs = co.get("summary") or {}; cl = co.get("link") or {}
    dept = raw.get("department") or {}
    return {
        "id": raw.get("id") or "",
        "First Name": p.get("first_name") or "", "Last Name": p.get("last_name") or "",
        "Full Name": p.get("full_name") or "", "Job Title": p.get("title") or "",
        "Seniority": dept.get("seniority") or "",
        "Company Name": cs.get("name") or "", "Company Domain": nd(cl.get("domain")),
        "Industry": cs.get("industry") or raw.get("industry") or "",
        "Location": loc.get("default") or loc.get("short") or "",
        "LinkedIn URL": link.get("linkedin") or "",
    }

# ── Part 1: Qualified column ──
_, cols = df("GET", f"/api/columns?tableId={SRC}")
cmap = {c["name"]: c["id"] for c in cols}
IND, DOM, CNAME = cmap["Industry"], cmap["Domain"], cmap["Company Name"]
if "Qualified" in cmap: QUAL = cmap["Qualified"]
else:
    _, r = df("POST","/api/columns",{"tableId":SRC,"name":"Qualified","type":"text"}); QUAL = r.get("id") or (r.get("column") or {}).get("id")
    log(f"created Qualified column -> {QUAL}")
_, src_rows = df("GET", f"/api/rows?tableId={SRC}&limit=3000")   # /api/rows returns a bare array
keep=excl=0; keep_domains=[]; updates=[]
for row in src_rows:
    d = row.get("data") or {}
    ind = str((d.get(IND) or {}).get("value") or "").strip().lower()
    dom = nd((d.get(DOM) or {}).get("value"))
    q = "EXCLUDE" if ind in EXCLUDE else "KEEP"
    if q == "KEEP": keep += 1
    else: excl += 1
    updates.append({"id": row["id"], "data": {QUAL: {"value": q}}})
    if q == "KEEP" and dom: keep_domains.append(dom)
keep_domains = list(dict.fromkeys(keep_domains))
QUALSET = set(keep_domains)   # hard post-filter target: only keep people whose company domain is in here
if not SKIP_FILTER:
    for i in range(0, len(updates), 300):
        df("PATCH","/api/rows",{"updates": updates[i:i+300]})
    log(f"Qualified written: KEEP={keep} EXCLUDE={excl} | KEEP w/ domain (unique)={len(keep_domains)}")
else:
    log(f"SKIP_FILTER: Qualified already written; KEEP={keep} EXCLUDE={excl} | KEEP w/ domain (unique)={len(keep_domains)}")

batches = [keep_domains[i:i+DOMAIN_BATCH] for i in range(0, len(keep_domains), DOMAIN_BATCH)]
if MODE != "full":
    # ── Sizing preview only ──
    total_est = 0; maxbatch = 0; errs = 0
    for bi, b in enumerate(batches):
        st, data = aiark("/people", people_body(b, 0, 1))
        if st != 200: errs += 1; log(f"  size batch {bi+1}/{len(batches)} HTTP {st}: {json.dumps(data)[:150]}"); continue
        te = data.get("totalElements") or 0; total_est += te; maxbatch = max(maxbatch, te)
    log(f"PEOPLE SIZE ESTIMATE: ~{total_est} across {len(batches)} domain-batches (max batch={maxbatch}, errs={errs})")
    log("PREVIEW ONLY. Re-run with MYS_PEOPLE_MODE=full to create the People sheet + import.")
    raise SystemExit(0)

# ── Part 2 full: reuse-or-create People sheet + paginate + import ──
_, ex_tbls = df("GET", f"/api/tables?projectId={WORKBOOK}")
ppl = next((t for t in ex_tbls if t.get("name") == "People"), None) if isinstance(ex_tbls, list) else None
if ppl:
    PT = ppl["id"]; log(f"reusing existing People sheet -> {PT}")
else:
    _, tbl = df("POST","/api/tables",{"projectId":WORKBOOK,"name":"People"})
    PT = tbl.get("id") or (tbl.get("table") or {}).get("id"); log(f"created People sheet -> {PT}")
PCOLS = [("First Name","text"),("Last Name","text"),("Full Name","text"),("Job Title","text"),
         ("Seniority","text"),("Company Name","text"),("Company Domain","url"),("Industry","text"),
         ("Location","text"),("LinkedIn URL","url")]
_, ex_cols = df("GET", f"/api/columns?tableId={PT}")
have = {c["name"]: c["id"] for c in ex_cols} if isinstance(ex_cols, list) else {}
pcid = {}
for name, typ in PCOLS:
    if name in have: pcid[name] = have[name]
    else:
        _, r = df("POST","/api/columns",{"tableId":PT,"name":name,"type":typ})
        pcid[name] = r.get("id") or (r.get("column") or {}).get("id")
log("People columns ready.")

# clear any contaminated rows from a prior pull (re-pull replaces, never appends)
_, exrows = df("GET", f"/api/rows?tableId={PT}&limit=30000")
exids = [r["id"] for r in exrows] if isinstance(exrows, list) else []
for i in range(0, len(exids), 500):
    df("DELETE","/api/rows",{"ids": exids[i:i+500], "tableId": PT})
if exids: log(f"cleared {len(exids)} pre-existing rows from People sheet")

seen=set(); people=[]
for bi, b in enumerate(batches):
    page=0; got=0
    while True:
        st, data = aiark("/people", people_body(b, page, 100))
        if st != 200: log(f"  batch {bi+1} page {page} HTTP {st}: {json.dumps(data)[:150]}"); break
        content = data.get("content") or []; pages = data.get("totalPages") or 1
        for raw in content:
            pp = parse_person(raw)
            if not pp["id"] or pp["id"] in seen: continue
            if pp["Company Domain"] not in QUALSET: continue   # HARD post-filter: drop AI Ark look-alike padding
            seen.add(pp["id"]); people.append(pp); got += 1
        page += 1
        if len(content) < 100 or page >= pages or page*100 >= 10000: break
    log(f"  batch {bi+1}/{len(batches)} domains={len(b)} -> +{got} people (total {len(people)})")

# cap to top-N most-senior per company
from collections import defaultdict
by_co = defaultdict(list)
for pp in people: by_co[(pp["Company Domain"] or "").lower()].append(pp)
capped = []
for dom, plist in by_co.items():
    plist.sort(key=lambda p: SENIORITY_RANK.get((p["Seniority"] or "").lower(), 10), reverse=True)
    capped.extend(plist[:CAP_PER_CO])
log(f"capped to <={CAP_PER_CO}/company: {len(people)} -> {len(capped)} across {len(by_co)} companies")
people = capped

# bulk import
payload=[]
for pp in people:
    obj={}
    for name,_ in PCOLS:
        v = pp.get(name)
        if v not in (None,""): obj[pcid[name]] = {"value": v}
    if obj.get(pcid["Full Name"]) or obj.get(pcid["LinkedIn URL"]): payload.append(obj)
imported=0
for i in range(0, len(payload), 400):
    st, r = df("POST","/api/rows",{"tableId":PT,"rows":payload[i:i+400]})
    imported += len(payload[i:i+400])
    log(f"  imported {imported}/{len(payload)} (HTTP {st})")
log(f"DONE. {len(people)} unique people -> People sheet {PT} (imported {imported}).")
