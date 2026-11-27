"""End-to-end smoke test of every Phase 2 endpoint."""
import json
import httpx

B = "http://127.0.0.1:8000"
c = httpx.Client(base_url=B, timeout=60)


def head(title):
    print("\n" + "=" * 66)
    print(title)
    print("=" * 66)


r = c.get("/")
head("GET /")
print(r.status_code, r.json())

r = c.get("/meta")
head("GET /meta")
print(json.dumps(r.json(), indent=1)[:500])

r = c.get("/worklist", params={"hours": 4})
head("GET /worklist?hours=4")
d = r.json()
print(f"status={r.status_code} cohort={d['cohort_size']} budget={d['budget_minutes']}min "
      f"elapsed={d['elapsed_ms']}ms unreviewed={d['unreviewed_flags']}")
print(f"selection: {len(d['selection'])} patients, "
      f"minutes used = {sum(x['minutes'] for x in d['selection'])}")
print(f"{'rk':>3} {'pat':>8} {'risk':>6} {'driver':<22} {'action':<34} {'min':>4} {'status':<10} {'delta':>5}")
for row in d["selection"]:
    print(f"{row['rank']:>3} {row['patient_nbr']:>8} {row['risk']:>6.3f} "
          f"{(row['driver'] or '-'):<22} {(row['action']['name'] if row['action'] else '-'):<34} "
          f"{(row['minutes'] or 0):>4} {row['status']:<10} {row['delta']:>+5}")
print("no-modifiable-driver rows:", len(d["no_modifiable_driver"]))
for cmp_ in d["comparison"]:
    print(f"  {cmp_['policy']:<36} calls={cmp_['calls_made']:>2} "
          f"reached={cmp_['readmissions_reached']} "
          f"avoided={cmp_['expected_avoided_readmissions']:.3f} "
          f"per_hour={cmp_['expected_avoided_per_hour']:.3f}")

r2 = c.get("/worklist", params={"hours": 2})
d2 = r2.json()
print(f"\nhours=2 -> {len(d2['selection'])} selected, {d2['budget_minutes']}min, "
      f"{d2['elapsed_ms']}ms; top-3 order: "
      f"{[x['patient_nbr'] for x in d2['selection'][:3]]} vs hours=4 "
      f"{[x['patient_nbr'] for x in d['selection'][:3]]}")

# pick a patient from the selection
pid = d["selection"][0]["patient_id"]
r = c.get(f"/patient/{pid}")
head(f"GET /patient/{pid}")
pd = r.json()
print(f"status={r.status_code} risk={pd['prediction']['risk_calibrated']:.4f} "
      f"flag={pd['prediction']['high_risk']} plan={pd['plan']['status'] if pd['plan'] else None}")
print("concept bars (group):")
for b in pd["concept_bars"]:
    print(f"   {b['group']:<11} {b['concept']:<22} {b['shap']:+.4f}")
print("explanation (3 lines):")
for line in pd["explanation"]:
    print("   " + line["text"])
print("matched interventions:")
for m in pd["matched_interventions"][:3]:
    print(f"   {m['name']:<34} {m['minutes']:>3}min  eff {m['effect_label']}%  "
          f"[{m['assumption_tag']}]  priority={m['priority']:.4f}")
print("lookalike:", pd["lookalike"]["line"] if pd["lookalike"] else None)
if pd["lookalike"]:
    for card in pd["lookalike"]["cards"]:
        print(f"   age {card['age']} drivers={card['top_drivers']} -> {card['outcome']}")
print("timing items:", [(i['name'], i['start_day'], i['end_day'], i['selected'])
                        for i in pd["timing"]["items"]])
print("tasks:", [(t["title"], str(t["due_date"]), t["status"]) for t in pd["tasks"]])
print("audit entries:", len(pd["audit"]))

# role enforcement
pending = [x for x in d["ranking"] if x["status"] == "Pending"]
plan_id = pending[0]["plan_id"] if pending else None
head("POST /plan/{id}/decision as coordinator (must be 403)")
if plan_id:
    r = c.post(f"/plan/{plan_id}/decision",
               json={"action": "approve", "note": "trying as coordinator"},
               headers={"X-Role": "coordinator"})
    print(r.status_code, r.json())

head("POST /plan/{id}/decision as clinician (approve)")
if plan_id:
    r = c.post(f"/plan/{plan_id}/decision",
               json={"action": "approve", "note": "looks appropriate"},
               headers={"X-Role": "clinician", "X-User": "dr-demo"})
    print(r.status_code, json.dumps(r.json(), indent=1, default=str)[:700])

r = c.get("/tasks")
head("GET /tasks")
print(r.status_code, "count:", r.json()["count"])
for t in r.json()["tasks"][:6]:
    print(f"   #{t['id']} pat {t['patient_nbr']} {t['title']:<40} "
          f"due {t['due_date']} {t['status']}")

if r.json()["tasks"]:
    tid = r.json()["tasks"][-1]["id"]
    r = c.patch(f"/tasks/{tid}", json={"status": "Done", "note": "completed in demo"},
                headers={"X-Role": "coordinator"})
    head(f"PATCH /tasks/{tid} -> Done (coordinator allowed)")
    print(r.status_code, r.json())

r = c.get("/audit", params={"limit": 8})
head("GET /audit")
print(r.status_code)
for a in r.json():
    print(f"   {a['created_at'][:19]} {a['role']:<11} {a['entity']}#{a['entity_id']} "
          f"{a['field']} {a['old_value']} -> {a['new_value']}  ({a['note']})")

r = c.get("/ops")
head("GET /ops")
o = r.json()
print("status:", r.status_code)
print("cutoff:", o["high_risk_cutoff"], "| avg stay:", o["avg_stay_days"],
      "| bed-days freed:", o["bed_days_freed"])
print("replay present:", o["replay"] is not None)
print("top departments by readmit rate:")
for row in o["departments"][:6]:
    print(f"   {row['name']:<22} n={row['patients']:>6} rate={row['rate']:.3f}")
print("diagnosis groups:")
for row in o["diagnosis_groups"]:
    print(f"   {row['name']:<22} n={row['patients']:>6} rate={row['rate']:.3f}")
print("metrics keys:", list(o["metrics"].keys()))

r = c.get(f"/discharge/{pid}")
head(f"GET /discharge/{pid}")
dd = r.json()
ins = dd["instructions"]
print("status:", r.status_code, "| source:", ins["source"], "| verified:", ins["verified"],
      "| llm_configured:", ins["llm_configured"])
print("--- instructions text ---")
print(ins["text"])
print("--- reminders ---")
for line in dd["reminders"]:
    print("   " + line)
print("SMOKE TEST COMPLETE")
