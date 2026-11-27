"""CareTrace API.

System rule (shown in the UI footer and README):
ML scores. Rules recommend. The optimizer prioritizes.
The LLM only phrases. A clinician approves.
"""

from __future__ import annotations

import json
import threading
import time
from contextlib import asynccontextmanager
from datetime import timedelta
from pathlib import Path
from typing import Any

from fastapi import Depends, FastAPI, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import desc, func, select
from sqlalchemy.orm import Session

from backend.app import schemas as S
from backend.app.config import ACTOR_HEADER, DEMO_DATE, HONESTY, ROLE_HEADER, SYSTEM_RULE, VALID_ROLES
from backend.app.db import get_db, init_db
from backend.app.models import AuditLog, Intervention, Patient, Plan, Prediction, Review, Task
from backend.decision import optimizer as opt
from backend.decision.catalog import ASSUMPTION_TAG, catalog_dicts, effect_label, mid_effect, seed_catalog
from backend.language import slots as slots_mod
from backend.language import templates as tmpl

ARTIFACTS = Path(__file__).resolve().parents[2] / "artifacts"


# --------------------------------------------------------------------- #
# startup
# --------------------------------------------------------------------- #

@asynccontextmanager
async def lifespan(_: FastAPI):
    init_db()
    with _session_scope() as db:
        seed_catalog(db)
    import os as _os
    if not _os.getenv("CARETRACE_NO_WARM"):      # tests skip the slow warm-up
        thread = threading.Thread(target=_warm_lookalikes, daemon=True)
        thread.start()
    yield


class _session_scope:
    """Tiny context manager so startup can use a plain session."""

    def __enter__(self):
        from backend.app.db import SessionLocal

        self.db = SessionLocal()
        return self.db

    def __exit__(self, *exc):
        self.db.close()
        return False


def _warm_lookalikes() -> None:
    try:
        from backend.ml import lookalike

        lookalike._build()
    except Exception:                       # never block startup on this
        pass


app = FastAPI(title="CareTrace", version="1.0", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


# --------------------------------------------------------------------- #
# helpers
# --------------------------------------------------------------------- #

def role_of(request: Request) -> str:
    return (request.headers.get(ROLE_HEADER) or "coordinator").strip().lower()


def actor_of(request: Request, role: str) -> str:
    return (request.headers.get(ACTOR_HEADER) or role).strip()


def require_clinician(request: Request) -> tuple[str, str]:
    role = role_of(request)
    if role != "clinician":
        raise HTTPException(
            status_code=403,
            detail="Only a clinician can approve, edit or reject a flag.",
        )
    return role, actor_of(request, role)


def iv_dict(iv: Intervention) -> dict:
    return {
        "id": iv.id,
        "name": iv.name,
        "target_concept": iv.target_concept,
        "minutes": iv.minutes,
        "effect_low": iv.effect_low,
        "effect_high": iv.effect_high,
        "effect_label": effect_label({"effect_low": iv.effect_low, "effect_high": iv.effect_high}),
        "window_start_day": iv.window_start_day,
        "window_end_day": iv.window_end_day,
        "source": iv.source,
        "assumption_tag": ASSUMPTION_TAG,
    }


def plan_dict(plan: Plan) -> dict:
    return {
        "id": plan.id,
        "patient_id": plan.patient_id,
        "intervention": iv_dict(plan.intervention),
        "status": plan.status,
        "priority_score": plan.priority_score,
        "minutes": plan.minutes,
        "note": plan.note,
        "updated_by_role": plan.updated_by_role,
        "updated_at": plan.updated_at,
    }


def task_dict(t: Task) -> dict:
    return {
        "id": t.id, "plan_id": t.plan_id, "patient_id": t.patient_id,
        "title": t.title, "due_date": t.due_date, "status": t.status,
        "created_at": t.created_at,
    }


def audit_dict(a: AuditLog) -> dict:
    return {
        "id": a.id, "role": a.role, "actor": a.actor, "patient_id": a.patient_id,
        "entity": a.entity, "entity_id": a.entity_id, "field": a.field,
        "old_value": a.old_value, "new_value": a.new_value, "note": a.note,
        "created_at": a.created_at,
    }


def patient_record(p: Patient, pr: Prediction | None = None) -> dict:
    """Flat record used by the language layer (facts + slot filling)."""
    return {
        "patient_nbr": p.patient_nbr, "age": p.age, "gender": p.gender,
        "race": p.race, "time_in_hospital": p.time_in_hospital,
        "num_lab_procedures": p.num_lab_procedures, "num_procedures": p.num_procedures,
        "num_medications": p.num_medications, "number_diagnoses": p.number_diagnoses,
        "number_outpatient": p.number_outpatient, "number_emergency": p.number_emergency,
        "number_inpatient": p.number_inpatient, "insulin": p.insulin,
        "change": p.change, "diabetesMed": p.diabetesMed,
        "admission_type_id": p.admission_type_id,
        "admission_source_id": p.admission_source_id,
        "discharge_disposition_id": p.discharge_disposition_id,
        "medical_specialty": p.medical_specialty, "diag_group": p.diag_group,
        "active_drugs": p.active_drugs or [],
        "_risk": pr.risk_calibrated if pr else None,
    }


def get_catalog(db: Session) -> list[dict]:
    return [iv_dict(iv) for iv in db.scalars(select(Intervention)).all()]


def get_or_404(db: Session, model, ident) -> object:
    obj = db.get(model, ident)
    if obj is None:
        raise HTTPException(status_code=404, detail=f"{model.__name__} {ident} not found")
    return obj


def write_audit(db: Session, *, role: str, actor: str, patient_id: int | None,
                entity: str, entity_id: int, field: str,
                old_value: str | None, new_value: str | None,
                note: str | None = None) -> None:
    db.add(AuditLog(
        role=role, actor=actor, patient_id=patient_id, entity=entity,
        entity_id=entity_id, field=field, old_value=old_value,
        new_value=new_value, note=note,
    ))


def create_tasks_for_plan(db: Session, plan: Plan, role: str, actor: str) -> list[Task]:
    """Tasks with due dates from the intervention timing window
    (day 0 = today's demo discharge date). Idempotent per plan."""
    existing = db.scalars(select(Task).where(Task.plan_id == plan.id)).all()
    if existing:
        return list(existing)
    iv = plan.intervention
    made: list[Task] = []
    t1 = Task(
        plan_id=plan.id, patient_id=plan.patient_id, title=iv.name,
        due_date=DEMO_DATE + timedelta(days=iv.window_start_day), status="Due",
    )
    db.add(t1)
    made.append(t1)
    if iv.window_end_day > iv.window_start_day:
        t2 = Task(
            plan_id=plan.id, patient_id=plan.patient_id,
            title=f"Confirm {iv.name} completed",
            due_date=DEMO_DATE + timedelta(days=iv.window_end_day), status="Due",
        )
        db.add(t2)
        made.append(t2)
    db.flush()
    for t in made:
        write_audit(db, role=role, actor=actor, patient_id=plan.patient_id,
                    entity="task", entity_id=t.id, field="status",
                    old_value=None, new_value="Due",
                    note=f"created from plan {plan.id} ({iv.name})")
    return made


# --------------------------------------------------------------------- #
# meta
# --------------------------------------------------------------------- #

@app.get("/meta", response_model=S.MetaOut)
def meta():
    return {
        "system_rule": SYSTEM_RULE,
        "honesty": HONESTY,
        "demo_date": DEMO_DATE,
        "llm_configured": tmpl.llm_configured(),
        "llm_provider": "anthropic (langchain)" if tmpl.llm_configured()
                        else "none - fixed template fallback active",
        "roles": list(VALID_ROLES),
    }


@app.get("/")
def root():
    return {"name": "CareTrace", "status": "ok", "system_rule": SYSTEM_RULE}


# --------------------------------------------------------------------- #
# worklist (spec 4.2)
# --------------------------------------------------------------------- #

@app.get("/worklist", response_model=S.WorklistOut)
def worklist(
    request: Request,
    hours: float = Query(default=4, ge=1, le=8),
    db: Session = Depends(get_db),
):
    t0 = time.perf_counter()
    hours = max(1.0, min(8.0, float(hours)))
    budget = int(hours * 60)
    catalog = get_catalog(db)

    preds = list(db.scalars(
        select(Prediction).where(Prediction.cohort.is_(True)).order_by(Prediction.id)
    ).all())
    if not preds:
        raise HTTPException(400, "No demo cohort found. Run `make seed` first.")

    patient_ids = [pr.patient_id for pr in preds]
    patients = {p.id: p for p in db.scalars(
        select(Patient).where(Patient.id.in_(patient_ids))
    ).all()}
    plans = {pl.patient_id: pl for pl in db.scalars(
        select(Plan).where(Plan.patient_id.in_(patient_ids))
    ).all()}

    # ---- build one row per cohort patient ---------------------------- #
    rows: list[dict] = []
    for pr in preds:
        p = patients.get(pr.patient_id)
        if p is None:
            continue
        plan = plans.get(p.id)
        shap = pr.concept_shap or {}
        risk = float(pr.risk_calibrated)
        driver = opt.top_modifiable_driver(shap)
        best = opt.best_action(risk, shap, catalog)

        chosen = None
        if plan is not None and plan.status == "Rejected":
            chosen = None                      # clinician said no: not re-pitched
        elif plan is not None:
            iv = iv_dict(plan.intervention)    # clinician's action wins
            share = opt.shap_share(shap, iv["target_concept"])
            chosen = {
                "action": iv,
                "priority": risk * mid_effect(iv) * share / iv["minutes"],
                "value": risk * mid_effect(iv) * share,
                "shap_share": share,
            }
        elif best is not None:
            chosen = best

        if plan is not None:
            status = plan.status
        elif driver is None:
            status = "No modifiable driver"
        else:
            status = "Not flagged"

        row = {
            "patient_id": p.id,
            "patient_nbr": p.patient_nbr,
            "risk": risk,
            "high_risk": bool(pr.high_risk),
            "driver": driver,
            "action": chosen["action"] if chosen else None,
            "priority": chosen["priority"] if chosen else None,
            "minutes": chosen["action"]["minutes"] if chosen else None,
            "value": chosen["value"] if chosen else None,
            "mid_effect": mid_effect(chosen["action"]) if chosen else 0.0,
            "y_true": int(pr.y_true),
            "status": status,
            "plan_id": plan.id if plan else None,
            "selected": False,
            "selected_risk_only": False,
        }
        rows.append(row)

    # ---- optimizer selection (0/1 knapsack) -------------------------- #
    items = [r for r in rows if r["action"] is not None]
    selected_items = opt.knapsack(items, budget) if items else []
    selected_set = {items[i]["patient_id"] for i in selected_items}

    # risk-only policy on the same pool and budget
    risk_order = sorted(items, key=lambda r: (-r["risk"], r["patient_id"]))
    risk_only_items = opt.risk_only_select(risk_order, budget)
    risk_only_set = {risk_order[i]["patient_id"] for i in risk_only_items}

    # full CareTrace ordering (for the delta column)
    selected_rows = sorted(
        [items[i] for i in selected_items], key=lambda r: (-r["priority"], r["patient_id"])
    )
    rest_rows = sorted(
        [r for r in items if r["patient_id"] not in selected_set],
        key=lambda r: (-r["risk"], r["patient_id"]),
    )
    no_driver_rows = sorted(
        [r for r in rows if r["action"] is None],
        key=lambda r: (-r["risk"], r["patient_id"]),
    )
    caretrace_order = selected_rows + rest_rows + no_driver_rows
    caretrace_rank = {r["patient_id"]: i + 1 for i, r in enumerate(caretrace_order)}
    risk_rank = {
        r["patient_id"]: i + 1
        for i, r in enumerate(sorted(rows, key=lambda r: (-r["risk"], r["patient_id"])))
    }

    def to_out(r: dict, rank: int) -> dict:
        return {
            "rank": rank,
            "patient_id": r["patient_id"],
            "patient_nbr": r["patient_nbr"],
            "risk": r["risk"],
            "high_risk": r["high_risk"],
            "driver": r["driver"],
            "action": r["action"],
            "priority": r["priority"],
            "minutes": r["minutes"],
            "status": r["status"],
            "plan_id": r["plan_id"],
            "delta": risk_rank[r["patient_id"]] - caretrace_rank[r["patient_id"]],
            "selected": r["patient_id"] in selected_set,
            "selected_risk_only": r["patient_id"] in risk_only_set,
        }

    selection = [to_out(r, i + 1) for i, r in enumerate(selected_rows)]
    ranking = [to_out(r, caretrace_rank[r["patient_id"]]) for r in caretrace_order]
    no_driver = [to_out(r, caretrace_rank[r["patient_id"]]) for r in no_driver_rows]

    unreviewed = sum(
        1 for pl in plans.values() if pl.status == "Pending"
    )

    comparison = [
        {
            "policy": "risk-only (call the sickest first)",
            **opt.policy_summary(risk_order, risk_only_items, hours),
        },
        {
            "policy": "CareTrace optimizer",
            **opt.policy_summary(items, selected_items, hours),
        },
    ]

    return {
        "hours": hours,
        "budget_minutes": budget,
        "cohort_size": len(rows),
        "selection": selection,
        "ranking": ranking,
        "no_modifiable_driver": no_driver,
        "unreviewed_flags": unreviewed,
        "comparison": comparison,
        "elapsed_ms": round((time.perf_counter() - t0) * 1000, 1),
    }


# --------------------------------------------------------------------- #
# patient detail (spec 4.5)
# --------------------------------------------------------------------- #

@app.get("/patient/{patient_id}", response_model=S.PatientOut)
def patient_detail(patient_id: int, db: Session = Depends(get_db)):
    p = get_or_404(db, Patient, patient_id)
    pr = db.scalar(select(Prediction).where(Prediction.patient_id == p.id))
    catalog = get_catalog(db)
    record = patient_record(p, pr)

    # plan / tasks / audit / reviews for this patient
    plan = db.scalar(
        select(Plan).where(Plan.patient_id == p.id).order_by(desc(Plan.id))
    )
    tasks = list(db.scalars(
        select(Task).where(Task.patient_id == p.id).order_by(Task.due_date)
    ).all())
    audits = list(db.scalars(
        select(AuditLog).where(AuditLog.patient_id == p.id)
        .order_by(desc(AuditLog.created_at), desc(AuditLog.id)).limit(50)
    ).all())
    reviews = list(db.scalars(
        select(Review).where(Review.patient_id == p.id)
        .order_by(desc(Review.created_at), desc(Review.id))
    ).all())

    concept_bars, explanation, matched, best, timing_items = [], [], [], None, []
    prediction_out = None

    if pr is not None:
        shap = pr.concept_shap or {}
        for concept in _concept_order(shap):
            concept_bars.append({
                "concept": concept,
                "shap": float(shap.get(concept, 0.0)),
                "group": "Modifiable" if concept in _modifiable() else "Fixed",
                "modifiable": concept in _modifiable(),
                "why": _concept_why(concept),
            })
        explanation = slots_mod.explanation_lines(record, shap, catalog)
        eligible = opt.eligible_actions(shap, catalog)
        best = opt.best_action(float(pr.risk_calibrated), shap, catalog)

        shared = {iv["name"]: (best is not None and iv["name"] == best["action"]["name"])
                  for iv in eligible}
        for iv in eligible:
            share = opt.shap_share(shap, iv["target_concept"])
            matched.append({
                **iv,
                "shap_share": share,
                "priority": (float(pr.risk_calibrated) * mid_effect(iv)
                             * share / iv["minutes"]),
                "is_best": shared.get(iv["name"], False),
            })
        matched.sort(key=lambda m: -m["priority"])

        # timing strip: chosen action first, then other matched windows
        chosen_name = None
        if plan is not None:
            chosen_name = plan.intervention.name
        elif best is not None:
            chosen_name = best["action"]["name"]

        ordered: list[dict] = []
        if plan is not None:
            ordered.append(iv_dict(plan.intervention))
        if best is not None:
            ordered.append(best["action"])
        ordered.extend(eligible)

        seen: set[str] = set()
        for iv in ordered:
            if iv["name"] in seen:
                continue
            seen.add(iv["name"])
            timing_items.append({
                "name": iv["name"], "start_day": iv["window_start_day"],
                "end_day": iv["window_end_day"], "minutes": iv["minutes"],
                "selected": iv["name"] == chosen_name,
                "assumption_tag": ASSUMPTION_TAG,
            })

        prediction_out = {
            "risk_raw": pr.risk_raw,
            "risk_calibrated": pr.risk_calibrated,
            "high_risk": bool(pr.high_risk),
            "high_risk_cutoff": _metrics().get("high_risk_cutoff"),
            "in_test_split": True,
        }

    return {
        "patient_id": p.id,
        "patient_nbr": p.patient_nbr,
        "demographics": {
            "age": p.age, "gender": p.gender, "race": p.race,
            "medical_specialty": p.medical_specialty, "diag_group": p.diag_group,
            "time_in_hospital": p.time_in_hospital,
            "num_medications": p.num_medications,
            "insulin": p.insulin, "diabetesMed": p.diabetesMed,
            "number_inpatient": p.number_inpatient,
            "number_outpatient": p.number_outpatient,
            "discharge_disposition_id": p.discharge_disposition_id,
            "active_drugs": p.active_drugs or [],
        },
        "prediction": prediction_out,
        "concept_bars": concept_bars,
        "explanation": explanation,
        "matched_interventions": matched,
        "best_action": best,
        "lookalike": _lookalike(p.patient_nbr),
        "timing": {
            "horizon_days": 30, "early_window_days": 7,
            "day_zero": DEMO_DATE, "items": timing_items,
        },
        "plan": plan_dict(plan) if plan else None,
        "tasks": [task_dict(t) for t in tasks],
        "audit": [audit_dict(a) for a in audits],
        "reviews": [
            {"decision": r.decision, "role": r.role, "actor": r.actor,
             "note": r.note, "created_at": r.created_at}
            for r in reviews
        ],
        "history_label": ("SHAP explains this model on this patient's record; "
                          "it is not a cause."),
    }


def _concept_order(shap: dict) -> list[str]:
    from backend.ml import concepts as C

    return [c for c in C.CONCEPT_ORDER if c in shap]


def _modifiable() -> set[str]:
    from backend.ml import concepts as C

    return set(C.MODIFIABLE)


def _concept_why(concept: str) -> str:
    from backend.ml import concepts as C

    return C.CONCEPTS.get(concept, {}).get("why", "")


def _metrics() -> dict:
    try:
        return json.loads((ARTIFACTS / "metrics.json").read_text())
    except Exception:
        return {}


def _lookalike(patient_nbr: int) -> dict | None:
    try:
        from backend.ml import lookalike

        return lookalike.cohort(patient_nbr)
    except Exception:
        return None


# --------------------------------------------------------------------- #
# review workflow (spec 4.3) - clinician only
# --------------------------------------------------------------------- #

DECISION_STATUS = {"approve": "Approved", "edit": "Edited", "reject": "Rejected"}


@app.post("/plan/{plan_id}/decision")
def plan_decision(plan_id: int, body: S.DecisionIn, request: Request,
                  db: Session = Depends(get_db)):
    role, actor = require_clinician(request)          # coordinator -> 403
    plan = get_or_404(db, Plan, plan_id)
    old_status = plan.status
    new_status = DECISION_STATUS[body.action]

    swapped = None
    if body.action == "edit" and body.intervention_id and body.intervention_id != plan.intervention_id:
        new_iv = get_or_404(db, Intervention, body.intervention_id)
        plan.intervention_id = new_iv.id
        plan.minutes = new_iv.minutes
        swapped = new_iv.name

    plan.status = new_status
    plan.note = body.note
    plan.updated_by_role = role

    write_audit(
        db, role=role, actor=actor, patient_id=plan.patient_id,
        entity="plan", entity_id=plan.id, field="status",
        old_value=old_status, new_value=new_status,
        note=body.note or (f"action swapped to {swapped}" if swapped else None),
    )
    db.add(Review(
        plan_id=plan.id, patient_id=plan.patient_id, decision=new_status,
        role=role, actor=actor, note=body.note,
    ))

    tasks: list[Task] = []
    if new_status in ("Approved", "Edited"):
        tasks = create_tasks_for_plan(db, plan, role, actor)
    db.commit()
    db.refresh(plan)

    return {
        "plan": plan_dict(plan),
        "tasks": [task_dict(t) for t in tasks],
        "review": {"decision": new_status, "role": role, "actor": actor,
                   "note": body.note},
    }


# --------------------------------------------------------------------- #
# tasks + audit
# --------------------------------------------------------------------- #

@app.get("/tasks")
def list_tasks(
    status: str | None = Query(default=None),
    patient_id: int | None = Query(default=None),
    db: Session = Depends(get_db),
):
    q = select(Task).order_by(Task.due_date, Task.id)
    if status:
        q = q.where(Task.status == status)
    if patient_id:
        q = q.where(Task.patient_id == patient_id)
    tasks = list(db.scalars(q).all())
    patients = {p.id: p.patient_nbr for p in db.scalars(
        select(Patient).where(Patient.id.in_([t.patient_id for t in tasks]))
    ).all()} if tasks else {}
    return {
        "tasks": [
            {**task_dict(t), "patient_nbr": patients.get(t.patient_id)}
            for t in tasks
        ],
        "count": len(tasks),
    }


@app.patch("/tasks/{task_id}")
def patch_task(task_id: int, body: S.TaskPatchIn, request: Request,
               db: Session = Depends(get_db)):
    role, actor = role_of(request), actor_of(request, role_of(request))
    task = get_or_404(db, Task, task_id)
    old = task.status
    if old == body.status:
        return {"task": task_dict(task), "changed": False}
    task.status = body.status
    write_audit(db, role=role, actor=actor, patient_id=task.patient_id,
                entity="task", entity_id=task.id, field="status",
                old_value=old, new_value=body.status, note=body.note)
    db.commit()
    db.refresh(task)
    return {"task": task_dict(task), "changed": True}


@app.get("/audit", response_model=list[S.AuditOut])
def audit_log(limit: int = Query(default=100, le=500),
              patient_id: int | None = Query(default=None),
              db: Session = Depends(get_db)):
    q = select(AuditLog).order_by(desc(AuditLog.created_at), desc(AuditLog.id)).limit(limit)
    if patient_id:
        q = q.where(AuditLog.patient_id == patient_id)
    return [audit_dict(a) for a in db.scalars(q).all()]


# --------------------------------------------------------------------- #
# ops (spec 4.5 + 4.6)
# --------------------------------------------------------------------- #

DEPARTMENT_BY_SPECIALTY = {
    "Cardiology": "Cardiology",
    "InternalMedicine": "Internal Medicine",
    "Family/GeneralPractice": "Primary Care",
    "Emergency/Trauma": "Emergency",
    "Surgery": "Surgery", "Orthopedic": "Surgery", "Vascular": "Surgery",
    "Gastroenterology": "Gastroenterology",
    "Neurology": "Neurology", "Neurosurgeon": "Neurology",
    "Pulmonology": "Pulmonology",
    "Nephrology": "Nephrology",
    "Endocrinology": "Endocrinology",
    "Psychiatry": "Psychiatry", "Psychology": "Psychiatry",
    "Obstetrics": "OB/GYN", "Gynecology": "OB/GYN",
    "Oncology": "Oncology",
    "Pediatrics": "Pediatrics", "Neonatology": "Pediatrics",
    "Hospitalist": "Hospitalist", "Surgeon": "Surgery",
}


def _department(specialty: str | None) -> str:
    if not specialty or specialty in ("?", "Unknown", "Other/Unknown", "nan"):
        return "Unknown/General"
    return DEPARTMENT_BY_SPECIALTY.get(specialty, "Other specialty")


@app.get("/ops", response_model=S.OpsOut)
def ops(db: Session = Depends(get_db)):
    metrics = _metrics()
    try:
        replay = json.loads((ARTIFACTS / "replay.json").read_text())
    except Exception:
        replay = None

    by_dept: dict[str, list[int]] = {}
    by_group: dict[str, list[int]] = {}
    stays: list[int] = []
    for specialty, y, stay in db.execute(
        select(Patient.medical_specialty, Patient.readmitted_30d, Patient.time_in_hospital)
    ).all():
        d = _department(specialty)
        acc = by_dept.setdefault(d, [0, 0])
        acc[0] += 1
        acc[1] += int(y)
        stays.append(int(stay))

    for group, y in db.execute(select(Patient.diag_group, Patient.readmitted_30d)).all():
        acc = by_group.setdefault(group or "Other/Unknown", [0, 0])
        acc[0] += 1
        acc[1] += int(y)

    def rates(by: dict[str, list[int]]) -> list[dict]:
        out = [
            {"name": k, "patients": v[0], "readmitted": v[1],
             "rate": v[1] / v[0] if v[0] else 0.0}
            for k, v in by.items()
        ]
        out.sort(key=lambda r: (-r["rate"], r["name"]))
        return out

    avg_stay = sum(stays) / len(stays) if stays else 0.0
    avoided = None
    if replay:
        avoided = replay["policies"]["caretrace"]["expected_avoided_readmissions"]["mean"]
    bed_days = avoided * avg_stay if avoided is not None else None

    return {
        "metrics": metrics,
        "replay": replay,
        "high_risk_cutoff": metrics.get("high_risk_cutoff"),
        "departments": rates(by_dept),
        "diagnosis_groups": rates(by_group),
        "avg_stay_days": round(avg_stay, 2),
        "bed_days_freed": round(bed_days, 1) if bed_days is not None else None,
        "bed_days_note": (
            "expected avoided readmissions (assumed effects) x average stay "
            "in this dataset - assumption, not a prediction"
        ),
        "system_rule": SYSTEM_RULE,
        "honesty": HONESTY,
    }


# --------------------------------------------------------------------- #
# discharge instructions (spec 4.6)
# --------------------------------------------------------------------- #

@app.get("/discharge/{patient_id}", response_model=S.DischargeOut)
def discharge(patient_id: int, db: Session = Depends(get_db)):
    p = get_or_404(db, Patient, patient_id)
    pr = db.scalar(select(Prediction).where(Prediction.patient_id == p.id))
    catalog = get_catalog(db)

    plan = db.scalar(
        select(Plan).where(Plan.patient_id == p.id).order_by(desc(Plan.id))
    )
    intervention = None
    if plan is not None and plan.status in ("Approved", "Edited"):
        intervention = iv_dict(plan.intervention)
    elif pr is not None:
        best = opt.best_action(float(pr.risk_calibrated), pr.concept_shap or {}, catalog)
        if best:
            intervention = best["action"]

    instructions = tmpl.render_discharge_instructions(
        patient_record(p, pr), intervention, DEMO_DATE
    )

    tasks = list(db.scalars(
        select(Task).where(Task.patient_id == p.id).order_by(Task.due_date)
    ).all())
    reminders = tmpl.simulated_reminders(
        [{**task_dict(t), "patient_id": t.patient_id} for t in tasks], DEMO_DATE
    )

    return {
        "patient_id": p.id,
        "patient_nbr": p.patient_nbr,
        "instructions": instructions,
        "intervention": intervention,
        "tasks": [task_dict(t) for t in tasks],
        "reminders": reminders,
        "demo_date": DEMO_DATE,
    }
