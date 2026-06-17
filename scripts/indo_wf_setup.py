"""Setup for the Indonesia email waterfall TEST (200 rows).
Creates 4 per-provider result columns + 1 final text column (idempotent by name),
samples 200 rows evenly across those with a Final Domain + Full Name, saves config."""
import os, sys, json, time, urllib.parse, urllib.request, urllib.error
try: sys.stdout.reconfigure(encoding="utf-8")
except Exception: pass

KEY=None
for line in open(r"C:\Users\Vilca\Desktop\Clay-Clone\.env.local", encoding="utf-8"):
    if line.strip().startswith("DATAFLOW_API_KEY"):
        KEY=line.split("=",1)[1].strip().strip('"').strip("'"); break
BASE="https://dataflow-pi.vercel.app"
TABLE="cb09b8f0-aeea-4d53-8420-1f126131f1c3"
FULL="5e5a84e2-2af8-465d-9a2e-88ce26636bd1"   # Full Name
LINKEDIN="74adace3-82e1-482f-80aa-c13b541cfaaf" # LinkedIn URL
FIN="Cc7URQrrMAZb"                              # Final Domain (formula) — the "has everything" domain col
HERE=os.path.dirname(os.path.abspath(__file__))
CFG=os.path.join(HERE,"indo_wf_cols.json")
N_TEST=200

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
            time.sleep(4)

ACTION_CFG={"inputMode":"full_name","fullNameColumnId":FULL,"domainColumnId":FIN,"linkedinColumnId":LINKEDIN}
PROVIDERS=[
    ("Email (AI Ark)",     "find_email_aiark"),
    ("Email (TryKitt)",    "find_email_trykitt"),
    ("Email (BetterEnrich)","find_email_betterenrich"),
    ("Email (Ninjer)",     "find_email_ninjer"),
]

# existing columns by name
st,txt,_=req("GET",f"/api/columns?tableId={TABLE}")
existing={c["name"]:c["id"] for c in json.loads(txt)}

cols={}
for name,kind in PROVIDERS:
    if name in existing:
        cols[kind]=existing[name]; print(f"exists: {name} -> {existing[name]}")
    else:
        st,txt,_=req("POST","/api/columns",{"tableId":TABLE,"name":name,"type":"enrichment",
                     "actionKind":kind,"actionConfig":ACTION_CFG})
        cid=json.loads(txt).get("id") or (json.loads(txt).get("column") or {}).get("id")
        cols[kind]=cid; print(f"created: {name} -> {cid} (HTTP {st})")

# final waterfall text column
if "Email (Waterfall)" in existing:
    final_col=existing["Email (Waterfall)"]; print(f"exists: Email (Waterfall) -> {final_col}")
else:
    st,txt,_=req("POST","/api/columns",{"tableId":TABLE,"name":"Email (Waterfall)","type":"text"})
    final_col=json.loads(txt).get("id") or (json.loads(txt).get("column") or {}).get("id")
    print(f"created: Email (Waterfall) -> {final_col} (HTTP {st})")

# sample 200 rows evenly across those with Final Domain + Full Name
flt=urllib.parse.quote(json.dumps([{"columnId":FIN,"operator":"is_not_empty"},
                                   {"columnId":FULL,"operator":"is_not_empty"}]))
st,txt,_=req("GET",f"/api/rows?tableId={TABLE}&filters={flt}&filterLogic=AND&limit=30000")
rows=json.loads(txt)
print(f"\neligible rows (Final Domain + Full Name): {len(rows)}")
step=max(1,len(rows)//N_TEST)
sample=[rows[i] for i in range(0,len(rows),step)][:N_TEST]
test_ids=[r["id"] for r in sample]
print(f"sampled {len(test_ids)} test rows (every {step}th)")

json.dump({"table":TABLE,"fullName":FULL,"linkedin":LINKEDIN,"domain":FIN,
           "providers":[k for _,k in PROVIDERS],"cols":cols,"finalCol":final_col,
           "testRowIds":test_ids}, open(CFG,"w"))
print(f"\nconfig saved: {CFG}")
print("provider result columns:", json.dumps(cols, indent=2))
print("final column:", final_col)
