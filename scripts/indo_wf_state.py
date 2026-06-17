import sys, json, time, urllib.parse, urllib.request, urllib.error
try: sys.stdout.reconfigure(encoding="utf-8")
except Exception: pass
KEY=None
for line in open(r"C:\Users\Vilca\Desktop\Clay-Clone\.env.local", encoding="utf-8"):
    if line.strip().startswith("DATAFLOW_API_KEY"):
        KEY=line.split("=",1)[1].strip().strip('"').strip("'"); break
BASE="https://dataflow-pi.vercel.app"; TABLE="cb09b8f0-aeea-4d53-8420-1f126131f1c3"
FIN="Cc7URQrrMAZb"; FULL="5e5a84e2-2af8-465d-9a2e-88ce26636bd1"
def req(path, tries=6):
    for i in range(tries):
        try:
            r=urllib.request.Request(BASE+path, method="GET"); r.add_header("Authorization","Bearer "+KEY)
            with urllib.request.urlopen(r, timeout=120) as resp: return resp.read().decode(), resp.headers
        except (urllib.error.URLError, OSError):
            if i==tries-1: raise
            time.sleep(4)
def count(filters, logic="AND"):
    flt=urllib.parse.quote(json.dumps(filters))
    _,hdr=req(f"/api/rows?tableId={TABLE}&filters={flt}&filterLogic={logic}&limit=1")
    return int(hdr.get("X-Filtered-Count") or 0)

print("== Final Domain completeness ==")
print("Final Domain non-empty:", count([{"columnId":FIN,"operator":"is_not_empty"}]), "(target ~8576)")
print("Final Domain + Full Name both present:", count([{"columnId":FIN,"operator":"is_not_empty"},{"columnId":FULL,"operator":"is_not_empty"}]))

print("\n== all columns on this sheet ==")
txt,_=req(f"/api/columns?tableId={TABLE}")
for c in json.loads(txt):
    print(f"  {c['id']}  {str(c.get('type')):10} {c.get('name')}")
