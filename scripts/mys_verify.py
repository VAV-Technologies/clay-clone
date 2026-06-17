import sys, json, urllib.parse, urllib.request
try: sys.stdout.reconfigure(encoding="utf-8")
except Exception: pass
KEY=None
for line in open(r"C:\Users\Vilca\Desktop\Clay-Clone\.env.local", encoding="utf-8"):
    if line.strip().startswith("DATAFLOW_API_KEY"):
        KEY=line.split("=",1)[1].strip().strip('"').strip("'"); break
BASE="https://dataflow-pi.vercel.app"; T="7fbd828a-9934-481b-a832-8b3e17859e21"
def req(path):
    r=urllib.request.Request(BASE+path); r.add_header("Authorization","Bearer "+KEY)
    with urllib.request.urlopen(r,timeout=120) as resp: return resp.read().decode(), resp.headers
# total
_,h=req(f"/api/rows?tableId={T}&limit=1")
print("Sheet 1 total rows:", h.get("X-Total-Count") or h.get("X-Filtered-Count"))
# domains: count .gov.my and empty
txt,_=req(f"/api/rows?tableId={T}&limit=5000")
rows=json.loads(txt)
cols_txt,_=req(f"/api/columns?tableId={T}")
import json as _j
cols=_j.loads(cols_txt)
dom=[c["id"] for c in cols if c["name"]=="Domain"][0]
emp=[c["id"] for c in cols if c["name"]=="Employees"][0]
gov=sum(1 for r in rows if str((r["data"].get(dom) or {}).get("value") or "").endswith(".gov.my"))
nodom=sum(1 for r in rows if not str((r["data"].get(dom) or {}).get("value") or "").strip())
emps=[ (r["data"].get(emp) or {}).get("value") for r in rows ]
emps=[e for e in emps if isinstance(e,(int,float))]
out_of_range=sum(1 for e in emps if e<100 or e>1000)
print(f"rows fetched: {len(rows)} | .gov.my domains: {gov} | empty domain: {nodom}")
print(f"employees present: {len(emps)} | outside 100-1000: {out_of_range} | min {min(emps) if emps else '-'} max {max(emps) if emps else '-'}")
