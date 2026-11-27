"""Print every number the README/demo script quotes, computed from
artifacts/ and the seeded database. Never type a demo number by hand:

    python scripts/demo_numbers.py
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

ART = ROOT / "artifacts"


def main() -> None:
    metrics = json.loads((ART / "metrics.json").read_text())
    replay = json.loads((ART / "replay.json").read_text())

    import sqlite3

    db = sqlite3.connect(ROOT / "caretrace.db")
    q = lambda s: db.execute(s).fetchall()

    print("=" * 70)
    print("MODEL (artifacts/metrics.json)")
    print("=" * 70)
    print(f"  ROC-AUC ................ {metrics['roc_auc']:.3f}")
    print(f"  PR-AUC ................. {metrics['pr_auc']:.3f}")
    print(f"  Base rate .............. {metrics['base_rate_test'] * 100:.1f}%")
    print(f"  Top-20% capture ........ {metrics['top20_capture'] * 100:.1f}%")
    print(f"  High-risk cutoff ....... {metrics['high_risk_cutoff'] * 100:.2f}%")
    print(f"  Flagged test rows ...... {metrics['n_high_risk_test']:,}"
          f" / {metrics['split']['test']:,}")
    print(f"  Patients after filters . {metrics['dataset']['rows_after_exclusions']:,}"
          f" (from {metrics['dataset']['rows']:,} rows)")
    print(f"  Split .................. train {metrics['split']['train']:,} / "
          f"cal {metrics['split']['calibration']:,} / test {metrics['split']['test']:,}")

    print()
    print("=" * 70)
    print("SEED (caretrace.db)")
    print("=" * 70)
    patients = q("select count(*) from patients")[0][0]
    preds = q("select count(*) from predictions")[0][0]
    cohort = q("select count(*) from predictions where cohort=1")[0][0]
    plans = dict(q("select status, count(*) from plans group by status"))
    tasks = q("select count(*) from tasks")[0][0]
    audit = q("select count(*) from audit_log")[0][0]
    print(f"  patients ................ {patients:,}")
    print(f"  predictions (test split)  {preds:,}")
    print(f"  demo cohort ............. {cohort}")
    print(f"  plans ................... {plans}")
    print(f"  tasks ................... {tasks}")
    print(f"  audit rows .............. {audit}")

    print()
    print("=" * 70)
    print("WORKLIST at 4 h (computed live from the seeded cohort)")
    print("=" * 70)
    from backend.decision import optimizer as opt
    from backend.decision.catalog import catalog_dicts, mid_effect
    from backend.app.models import Intervention, Patient, Plan, Prediction
    from backend.app.db import SessionLocal
    from sqlalchemy import select

    session = SessionLocal()
    catalog = [
        {"id": iv.id, "name": iv.name, "target_concept": iv.target_concept,
         "minutes": iv.minutes, "effect_low": iv.effect_low,
         "effect_high": iv.effect_high, "window_start_day": iv.window_start_day,
         "window_end_day": iv.window_end_day, "source": iv.source}
        for iv in session.scalars(select(Intervention)).all()
    ]
    rows = []
    for pr in session.scalars(select(Prediction).where(Prediction.cohort.is_(True))).all():
        best = opt.best_action(pr.risk_calibrated, pr.concept_shap or {}, catalog)
        if best is None:
            continue
        rows.append({
            "risk": pr.risk_calibrated, "y_true": pr.y_true,
            "minutes": best["action"]["minutes"],
            "mid_effect": mid_effect(best["action"]),
            "value": best["value"],
        })
    budget = 240
    sel_ct = opt.knapsack(rows, budget)
    risk_order = sorted(rows, key=lambda r: -r["risk"])
    sel_ro = opt.risk_only_select(risk_order, budget)
    ct = opt.policy_summary(rows, sel_ct, 4)
    ro = opt.policy_summary(risk_order, sel_ro, 4)
    no_driver = q("""select count(*) from predictions p
                     left join plans pl on pl.patient_id = p.patient_id
                     where p.cohort=1""")[0][0] - len(rows)
    print(f"  eligible patients ....... {len(rows)} of {cohort}"
          f" ({no_driver} below the line: no modifiable driver)")
    for name, s in (("risk-only", ro), ("CareTrace", ct)):
        print(f"  {name:<10} calls={s['calls_made']:>2}  "
              f"readmissions reached={s['readmissions_reached']}  "
              f"expected avoided={s['expected_avoided_readmissions']:.3f}  "
              f"per hour={s['expected_avoided_per_hour']:.3f}")
    session.close()

    print()
    print("=" * 70)
    print(f"REPLAY ({replay['days']} days x {replay['cohort_size']} patients,"
          f" {replay['budget_hours']} h)")
    print("=" * 70)
    for policy, m in replay["policies"].items():
        r = m["readmissions_reached"]
        a = m["expected_avoided_readmissions"]
        print(f"  {policy:<15} reached {r['mean']:.2f} ({r['p10']:.1f}-{r['p90']:.1f})  "
              f"avoided {a['mean']:.2f} ({a['p10']:.1f}-{a['p90']:.1f})")
    print(f"  warning: {replay['warning']}")

    care = replay["policies"]["caretrace"]["expected_avoided_readmissions"]["mean"]
    human = replay["policies"]["human"]["expected_avoided_readmissions"]["mean"]
    avg_stay = q("select avg(time_in_hospital) from patients")[0][0]
    print(f"  bed-days freed .......... {care * avg_stay:.1f}"
          f" (avoided {care:.2f} x avg stay {avg_stay:.2f} d)")
    print(f"  CareTrace vs human ...... {care:.2f} vs {human:.2f} expected avoided")

    print()
    print("=" * 70)
    print("LOOKALIKE (train split, computed now)")
    print("=" * 70)
    top = q("""select p.patient_nbr from predictions pr
               join patients p on p.id = pr.patient_id
               where pr.cohort=1 order by pr.risk_calibrated desc limit 1""")[0][0]
    from backend.ml import lookalike

    lk = lookalike.cohort(int(top))
    if lk:
        print(f"  patient #{top}: {lk['line']}")
    else:
        print("  (unavailable)")


if __name__ == "__main__":
    main()
