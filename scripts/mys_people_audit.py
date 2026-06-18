import sys, json, urllib.parse, urllib.request
from collections import Counter
try: sys.stdout.reconfigure(encoding="utf-8")
except Exception: pass
KEY=None
for line in open(r"C:\Users\Vilca\Desktop\Clay-Clone\.env.local", encoding="utf-8"):
    if line.strip().startswith("DATAFLOW_API_KEY"): KEY=line.split("=",1)[1].strip().strip('"').strip("'"); break
BASE="https://dataflow-pi.vercel.app"
def req(path):
    r=urllib.request.Request(BASE+path); r.add_header("Authorization","Bearer "+KEY)
    with urllib.request.urlopen(r,timeout=180) as resp: return resp.read().decode()
SRC="7fbd828a-9934-481b-a832-8b3e17859e21"; PT="d916a4b6-b5e0-4ef2-a0d1-dc655cb20f9f"
scm={c["name"]:c["id"] for c in json.loads(req(f"/api/columns?tableId={SRC}"))}
pcm={c["name"]:c["id"] for c in json.loads(req(f"/api/columns?tableId={PT}"))}
# qualified domain set
flt=urllib.parse.quote(json.dumps([{"columnId":scm["Qualified"],"operator":"equals","value":"KEEP"},{"columnId":scm["Domain"],"operator":"is_not_empty"}]))
srows=json.loads(req(f"/api/rows?tableId={SRC}&filters={flt}&filterLogic=AND&limit=5000"))
def norm(d): return str(d or "").strip().lower().replace("https://","").replace("http://","").replace("www.","").rstrip("/")
qual=set(norm((r.get("data") or {}).get(scm["Domain"],{}).get("value")) for r in srows)
qual.discard("")
print("qualified domains:", len(qual))
# people
prows=json.loads(req(f"/api/rows?tableId={PT}&limit=20000"))
print("people rows:", len(prows))
dom=pcm["Company Domain"]; co=pcm["Company Name"]; sen=pcm["Seniority"]; ttl=pcm["Job Title"]
inset=0; offset=0
codoms=Counter(); senc=Counter(); titlec=Counter()
for r in prows:
    d=norm((r.get("data") or {}).get(dom,{}).get("value"))
    if d in qual: inset+=1
    else: offset+=1
    codoms[(r.get("data") or {}).get(co,{}).get("value") or d]+=1
    senc[(r.get("data") or {}).get(sen,{}).get("value") or "(none)"]+=1
    titlec[(r.get("data") or {}).get(ttl,{}).get("value") or "(none)"]+=1
print(f"company_domain IN qualified set: {inset} ({100*inset/max(1,len(prows)):.1f}%) | OFF-set: {offset}")
print("distinct company_domains in People:", len({norm((r.get('data') or {}).get(dom,{}).get('value')) for r in prows}))
print("\ntop 12 companies by people count:")
for c,n in codoms.most_common(12): print(f"  {n:5}  {c}")
print("\nseniority distribution:")
for s,n in senc.most_common(): print(f"  {n:6}  {s}")
print("\ntop 15 job titles:")
for tt,n in titlec.most_common(15): print(f"  {n:5}  {tt}")
