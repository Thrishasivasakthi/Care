"""make seed: catalog + patients + predictions + 60-patient demo cohort +
Pending plans (+ a few pre-approved plans/tasks so screens are not empty).

    python -m backend.seed
"""

from __future__ import annotations

import json
from datetime import timedelta

import numpy as np
import pandas as pd
from sqlalchemy import select

from backend.app.config import DEMO_DATE
from backend.app.db import Base, SessionLocal, engine
from backend.app.main import create_tasks_for_plan
from backend.app.models import AuditLog, Intervention, Patient, Plan, Prediction, Review, Task
from backend.decision import catalog as cat
from backend.decision import optimizer as opt
from backend.ml import concepts as C
from backend.ml import features as F

ARTIFACTS = F.REPO_ROOT / "artifacts"
COHORT_SIZE = 60
COHORT_SEED = F.SEED + 7
PRE_APPROVE = 4
CHUNK = 5000


def _active_drugs(df: pd.DataFrame) -> list[list[str]]:
    cols = F.DRUG_COLUMNS
    values = df[cols].to_numpy(dtype=object)
    out = []
    for row in values:
        out.append([
            cols[j] for j in range(len(cols))
            if str(row[j]) not in ("No", "nan", "None", "", "?")
        ])
    return out


def main() -> None:
    print("Recreating schema ...")
    Base.metadata.drop_all(engine)
    Base.metadata.create_all(engine)

    db = SessionLocal()
    try:
        n_iv = cat.seed_catalog(db)
        print(f"  catalog: {n_iv} interventions (source=assumption)")

        # ---------------------------------------------------------------- #
        # patients (full cleaned dataset -> ops rates are honest)
        # ---------------------------------------------------------------- #
        print("Loading patients ...")
        raw = F.load_raw()
        df = F.prepare(raw)
        df["diag_group"] = df["diag_1"].map(F.icd9_group)
        for col in ("age", "gender", "race", "insulin", "change",
                    "diabetesMed", "medical_specialty"):
            df[col] = df[col].fillna("Unknown")
        active = _active_drugs(df)
        cols = ["patient_nbr", "encounter_id", "age", "gender", "race",
                "time_in_hospital", "num_lab_procedures", "num_procedures",
                "num_medications", "number_diagnoses", "number_outpatient",
                "number_emergency", "number_inpatient", "insulin", "change",
                "diabetesMed", "admission_type_id", "admission_source_id",
                "discharge_disposition_id", "medical_specialty", "diag_group"]
        base = df[cols].to_dict("records")
        records = []
        for i, rec in enumerate(base):
            rec["active_drugs"] = active[i]
            rec["readmitted_30d"] = int(df["y"].iloc[i])
            records.append(rec)
        with engine.begin() as conn:
            for start in range(0, len(records), CHUNK):
                conn.execute(Patient.__table__.insert(), records[start:start + CHUNK])
        print(f"  patients: {len(records):,}")

        # ---------------------------------------------------------------- #
        # predictions (held-out test split, SHAP grouped per concept)
        # ---------------------------------------------------------------- #
        print("Loading predictions + SHAP ...")
        z = np.load(ARTIFACTS / "shap_test.npz", allow_pickle=True)
        feature_names = list(z["feature_names"])
        concept_names = C.concept_names_for(feature_names)
        grouped = C.group_rows(feature_names, z["shap"].astype("float64"))
        patient_nbr = z["patient_nbr"]
        risk = z["risk"].astype("float64")
        y_true = z["y_true"].astype(int)
        raw_risk = (
            pd.read_csv(ARTIFACTS / "test_predictions.csv",
                        float_precision="round_trip")
            .set_index("patient_nbr")["risk_raw"]
        )
        cutoff = json.loads((ARTIFACTS / "metrics.json").read_text())["high_risk_cutoff"]

        id_by_nbr = {
            nbr: pid for pid, nbr in db.execute(select(Patient.id, Patient.patient_nbr)).all()
        }

        pred_rows = []
        for i in range(len(patient_nbr)):
            pred_rows.append({
                "patient_id": id_by_nbr[int(patient_nbr[i])],
                "risk_raw": float(raw_risk.loc[int(patient_nbr[i])]),
                "risk_calibrated": float(risk[i]),
                "high_risk": bool(risk[i] >= cutoff),
                "concept_shap": {c: float(grouped[i, j]) for j, c in enumerate(concept_names)},
                "y_true": int(y_true[i]),
                "cohort": False,
            })
        with engine.begin() as conn:
            for start in range(0, len(pred_rows), CHUNK):
                conn.execute(Prediction.__table__.insert(), pred_rows[start:start + CHUNK])
        print(f"  predictions: {len(pred_rows):,} (test split), cutoff {cutoff:.4f}")

        # ---------------------------------------------------------------- #
        # 60-patient "today's discharges" cohort from the test split
        # ---------------------------------------------------------------- #
        rng = np.random.default_rng(COHORT_SEED)
        cohort_ids = rng.choice(len(pred_rows), size=COHORT_SIZE, replace=False)
        cohort_preds = [pred_rows[i] for i in sorted(cohort_ids.tolist())]
        for pr in cohort_preds:
            pr["cohort"] = True
        with engine.begin() as conn:
            for pr in cohort_preds:
                conn.execute(
                    Prediction.__table__.update()
                    .where(Prediction.__table__.c.patient_id == pr["patient_id"])
                    .values(cohort=True)
                )
        print(f"  cohort: {COHORT_SIZE} patients (seed {COHORT_SEED})")

        # ---------------------------------------------------------------- #
        # plans: every high-risk cohort patient with an eligible action
        # starts Pending
        # ---------------------------------------------------------------- #
        interventions = list(db.scalars(select(Intervention)).all())
        catalog = [{
            "id": iv.id, "name": iv.name, "target_concept": iv.target_concept,
            "minutes": iv.minutes, "effect_low": iv.effect_low,
            "effect_high": iv.effect_high,
            "window_start_day": iv.window_start_day,
            "window_end_day": iv.window_end_day, "source": iv.source,
        } for iv in interventions]

        plans: list[Plan] = []
        for pr in cohort_preds:
            if not pr["high_risk"]:
                continue
            best = opt.best_action(pr["risk_calibrated"], pr["concept_shap"], catalog)
            if best is None:
                continue
            plan = Plan(
                patient_id=pr["patient_id"],
                intervention_id=best["action"]["id"],
                status="Pending",
                priority_score=best["priority"],
                minutes=best["action"]["minutes"],
                created_by_role="system",
            )
            db.add(plan)
            db.flush()
            db.add(AuditLog(
                role="system", actor="seed", patient_id=pr["patient_id"],
                entity="plan", entity_id=plan.id, field="status",
                old_value=None, new_value="Pending",
                note="high-risk flag raised (calibrated risk >= cutoff)",
            ))
            plans.append(plan)
        db.commit()

        # ---------------------------------------------------------------- #
        # a few pre-approved plans + tasks so the demo screens are not empty
        # ---------------------------------------------------------------- #
        approved = 0
        for plan in plans[:PRE_APPROVE]:
            plan.status = "Approved"
            plan.updated_by_role = "clinician"
            plan.note = "Pre-approved during seeding for demo purposes."
            db.add(Review(
                plan_id=plan.id, patient_id=plan.patient_id, decision="Approved",
                role="clinician", actor="clinician (seed)",
                note="Pre-approved during seeding for demo purposes.",
            ))
            db.add(AuditLog(
                role="clinician", actor="clinician (seed)",
                patient_id=plan.patient_id, entity="plan", entity_id=plan.id,
                field="status", old_value="Pending", new_value="Approved",
                note="Pre-approved during seeding for demo purposes.",
            ))
            create_tasks_for_plan(db, plan, "clinician", "clinician (seed)")
            approved += 1
        db.commit()

        from sqlalchemy import func

        counts = dict(db.execute(
            select(Plan.status, func.count()).group_by(Plan.status)
        ).all())
        n_tasks = db.scalar(select(func.count()).select_from(Task)) or 0

        print()
        print("=" * 52)
        print(f"  patients ................ {len(records):,}")
        print(f"  predictions ............. {len(pred_rows):,}")
        print(f"  demo cohort ............. {COHORT_SIZE}")
        print(f"  plans ................... {counts}")
        print(f"  pre-approved / tasks .... {approved} / {n_tasks}")
        print(f"  unreviewed flags ........ {counts.get('Pending', 0)}")
        print("=" * 52)
        print(f"Demo date (day 0) = {DEMO_DATE.isoformat()}")
    finally:
        db.close()


if __name__ == "__main__":
    main()
