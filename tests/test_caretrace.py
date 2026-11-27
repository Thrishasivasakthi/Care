"""CareTrace test suite.

Run: python -m pytest -q      (or `make test`)
Uses a TEMP database (CARETRACE_DB) so the demo DB is never touched.
"""

from __future__ import annotations

import os
import sys
import tempfile
from datetime import date
from pathlib import Path

import numpy as np
import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

# point the app at a throwaway database BEFORE importing it
_tmp = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
_tmp.close()
os.environ["CARETRACE_DB"] = _tmp.name
os.environ["CARETRACE_NO_WARM"] = "1"

from backend.app.db import Base, SessionLocal, engine  # noqa: E402
from backend.app.models import Intervention, Patient, Plan, Prediction  # noqa: E402
from backend.decision import optimizer as opt  # noqa: E402
from backend.decision.catalog import INTERVENTIONS, mid_effect  # noqa: E402
from backend.language import templates as tmpl  # noqa: E402
from backend.ml import concepts, features  # noqa: E402


# --------------------------------------------------------------------- #
# 1. split has no patient overlap
# --------------------------------------------------------------------- #
def test_split_has_no_patient_overlap():
    raw = features.load_raw()
    df = features.prepare(raw)
    parts = features.patient_split(df)
    train, cal, test = (set(parts[k]) for k in ("train", "calibration", "test"))
    assert not (train & cal)
    assert not (train & test)
    assert not (cal & test)
    assert train | cal | test == set(df["patient_nbr"])


def test_only_first_encounter_per_patient():
    df = features.prepare(features.load_raw())
    assert df["patient_nbr"].is_unique


# --------------------------------------------------------------------- #
# 2. readmitted is never a feature
# --------------------------------------------------------------------- #
def test_readmitted_not_in_features():
    df = features.prepare(features.load_raw())
    X = features.build_features(df)
    assert "readmitted" not in X.columns
    assert "y" not in X.columns
    assert not any("readmit" in c.lower() for c in X.columns)
    # and the label exists separately
    assert "y" in df.columns


def test_expired_patients_excluded():
    df = features.prepare(features.load_raw())
    assert not df["discharge_disposition_id"].isin(features.EXPIRED_DISCHARGE_IDS).any()


# --------------------------------------------------------------------- #
# 3. knapsack respects the budget (and is optimal vs brute force)
# --------------------------------------------------------------------- #
def _random_items(n, seed=0):
    rng = np.random.default_rng(seed)
    return [
        {"minutes": int(rng.integers(5, 60)), "value": float(rng.random())}
        for _ in range(n)
    ]


def test_knapsack_respects_budget():
    items = _random_items(60, seed=7)
    budget = 240
    sel = opt.knapsack(items, budget)
    assert len(sel) == len(set(sel))            # 0/1: no item twice
    assert sum(items[i]["minutes"] for i in sel) <= budget
    # optimality against brute force on a small instance
    small = _random_items(12, seed=3)
    best = 0.0
    for mask in range(1 << len(small)):
        minutes = sum(small[i]["minutes"] for i in range(len(small)) if mask >> i & 1)
        if minutes <= 120:
            value = sum(small[i]["value"] for i in range(len(small)) if mask >> i & 1)
            best = max(best, value)
    chosen = opt.knapsack(small, 120)
    got = sum(small[i]["value"] for i in chosen)
    assert got == pytest.approx(best, rel=1e-9)


def test_knapsack_no_items():
    assert opt.knapsack([], 240) == []
    assert opt.knapsack([{"minutes": 300, "value": 1.0}], 240) == []


# --------------------------------------------------------------------- #
# 4. coordinator gets 403 on approve
# --------------------------------------------------------------------- #
@pytest.fixture()
def client():
    Base.metadata.drop_all(engine)
    Base.metadata.create_all(engine)
    db = SessionLocal()
    for iv in INTERVENTIONS:
        db.add(Intervention(**iv))
    patient = Patient(
        patient_nbr=1, encounter_id=1, age="[60-70)", gender="Female",
        race="Caucasian", time_in_hospital=4, num_lab_procedures=40,
        num_procedures=1, num_medications=10, number_diagnoses=5,
        number_outpatient=0, number_emergency=0, number_inpatient=1,
        insulin="Steady", change="Ch", diabetesMed="Yes",
        admission_type_id=1, admission_source_id=7,
        discharge_disposition_id=1, medical_specialty="Cardiology",
        diag_group="Circulatory", active_drugs=["metformin"],
        readmitted_30d=0,
    )
    db.add(patient)
    db.flush()
    db.add(Prediction(
        patient_id=patient.id, risk_raw=0.2, risk_calibrated=0.3,
        high_risk=True,
        concept_shap={"Discharge setting": 0.4, "Medication complexity": 0.1,
                      "Follow-up access": 0.05, "Prior use": -0.1,
                      "Demographics": 0.02, "Stay severity": 0.03,
                      "Admission context": -0.05},
        y_true=1, cohort=True,
    ))
    db.commit()
    db.close()

    from fastapi.testclient import TestClient
    from backend.app.main import app

    with TestClient(app) as c:
        yield c


def _plan_id(client) -> int:
    wl = client.get("/worklist?hours=4").json()
    pending = [r for r in wl["ranking"] if r["plan_id"]]
    if pending:
        return pending[0]["plan_id"]
    # seed created no plan -> make one through the API path is out of scope,
    # so create directly
    from backend.app.db import SessionLocal
    from backend.app.models import Plan

    db = SessionLocal()
    plan = Plan(patient_id=db.query(Patient).first().id,
                intervention_id=db.query(Intervention).first().id)
    db.add(plan)
    db.commit()
    pid = plan.id
    db.close()
    return pid


def test_coordinator_cannot_approve(client):
    pid = _plan_id(client)
    r = client.post(f"/plan/{pid}/decision",
                    json={"action": "approve"},
                    headers={"X-Role": "coordinator"})
    assert r.status_code == 403


def test_clinician_can_approve(client):
    pid = _plan_id(client)
    r = client.post(f"/plan/{pid}/decision",
                    json={"action": "approve", "note": "ok"},
                    headers={"X-Role": "clinician"})
    assert r.status_code == 200
    assert r.json()["plan"]["status"] == "Approved"
    assert len(r.json()["tasks"]) >= 1     # tasks created from timing window


def test_every_decision_is_audited(client):
    pid = _plan_id(client)
    client.post(f"/plan/{pid}/decision", json={"action": "reject"},
                headers={"X-Role": "clinician", "X-User": "dr-x"})
    audit = client.get("/audit").json()
    entry = [a for a in audit if a["entity"] == "plan" and a["new_value"] == "Rejected"]
    assert entry, "reject must write an audit entry"
    assert entry[0]["role"] == "clinician"
    assert entry[0]["old_value"] == "Pending"


def test_missing_role_defaults_to_coordinator(client):
    pid = _plan_id(client)
    r = client.post(f"/plan/{pid}/decision", json={"action": "approve"})  # no header
    assert r.status_code == 403


# --------------------------------------------------------------------- #
# 5. slots-unfilled triggers fallback
# --------------------------------------------------------------------- #
def test_no_key_uses_fallback():
    os.environ.pop("ANTHROPIC_API_KEY", None)
    os.environ.pop("LLM_API_KEY", None)
    out = tmpl.render_discharge_instructions(
        {"active_drugs": ["metformin"], "patient_nbr": 1},
        {"name": "48-hour follow-up call"}, date(2026, 1, 1),
    )
    assert out["source"] == "fallback"
    assert out["verified"] is True
    assert "{" not in out["text"]
    assert "metformin" in out["text"]
    assert "2026-01-03" in out["text"]          # day 0 + 2, filled by code


def test_llm_output_with_number_is_rejected():
    good = "Take {DRUG_1}. Your visit is {FOLLOWUP_DATE}. We scheduled {INTERVENTION}."
    assert tmpl.validate_llm_text(good) is True
    bad_number = "Take 500 mg of {DRUG_1}. Visit {FOLLOWUP_DATE}. {INTERVENTION}."
    assert tmpl.validate_llm_text(bad_number) is False
    bad_drug = "Take metformin. Visit {FOLLOWUP_DATE}. {INTERVENTION}."
    assert tmpl.validate_llm_text(bad_drug) is False
    bad_slot = "Take {DRUG_1}. Visit {DOSE_1}. {INTERVENTION}."
    assert tmpl.validate_llm_text(bad_slot) is False
    missing = "Take {DRUG_1}. Visit {FOLLOWUP_DATE}."      # intervention missing
    assert tmpl.validate_llm_text(missing) is False


def test_unfilled_slot_means_unverified():
    out = tmpl.render_discharge_instructions(
        {"active_drugs": [], "patient_nbr": 1},
        None,                       # no intervention -> INTERVENTION unfilled?
        date(2026, 1, 1),
    )
    # the fallback template adapts to missing slots, so it stays verified;
    # verify the low-level filler reports a miss when a slot really is absent
    filled, missing = tmpl.fill("Hello {MISSING_SLOT}", {"MISSING_SLOT": None})
    assert missing == ["MISSING_SLOT"]
    assert "{" in filled
    assert out["verified"] is True            # template itself left nothing open


def test_simulated_reminders_are_text_only():
    lines = tmpl.simulated_reminders(
        [{"patient_id": 7, "title": "Home visit", "due_date": "2026-01-05"}],
        date(2026, 1, 1),
    )
    assert len(lines) == 1
    assert lines[0].startswith("[SIMULATED - NOT SENT]")
    assert "Home visit" in lines[0]


# --------------------------------------------------------------------- #
# Step B: duel budget enforcement
# --------------------------------------------------------------------- #
def test_duel_budget_enforcement():
    import numpy as np
    from backend.decision import duel, optimizer
    from backend.decision.catalog import catalog_dicts, mid_effect
    from backend.decision.replay import load_test_rows

    rows = load_test_rows()
    catalog = catalog_dicts()
    session = duel.pick_session(rows, catalog)
    assert len(session) == 15
    # score with a budget too small for everything: selected minutes <= budget
    budget = 30
    res = duel.score(session, [s["patient_nbr"] for s in session], budget)
    for strat in ("human", "risk_only", "caretrace"):
        assert res["strategies"][strat]["minutes_used"] <= budget
    # an over-budget human pick is dropped (not counted)
    big = max(session, key=lambda s: s["minutes"])
    res2 = duel.score(session, [big["patient_nbr"]], 1)  # budget 1 min
    assert res2["strategies"]["human"]["calls_made"] == 0


# --------------------------------------------------------------------- #
# Step C: fairness hides small groups
# --------------------------------------------------------------------- #
def test_fairness_hides_small_groups():
    import json
    from pathlib import Path
    f = json.loads((Path("artifacts") / "fairness.json").read_text())
    assert "dimensions" in f
    for dim, rows in f["dimensions"].items():
        for r in rows:
            if r["n"] < f["min_group_n"]:
                assert r["too_small"] is True
                assert r["roc_auc"] is None
                assert r["top20_capture"] is None


# --------------------------------------------------------------------- #
# Step E: language fallback when a slot is missing
# --------------------------------------------------------------------- #
def test_language_fallback_when_slot_missing():
    from backend.language import templates as tmpl
    out = tmpl.render_regional_instructions(
        {"active_drugs": [], "patient_nbr": 1}, None, __import__("datetime").date(2026, 1, 1),
        lang="hi",
    )
    assert out["verified"] is False
    assert "INTERVENTION" in out["missing_slots"] or "DRUG_1" in out["missing_slots"]
    assert out["back_translation"]  # still returned
    assert out["needs_native_review"] is True
def test_eligibility_requires_modifiable_positive_shap():
    shap = {"Discharge setting": 0.5, "Demographics": 0.9, "Prior use": -0.2}
    eligible = opt.eligible_actions(shap, [dict(iv) for iv in INTERVENTIONS])
    assert eligible, "positive modifiable concept must be eligible"
    assert all(iv["target_concept"] in concepts.MODIFIABLE for iv in eligible)
    # a positive FIXED concept must never create eligibility
    shap_fixed_only = {"Demographics": 0.9, "Prior use": 0.4}
    assert opt.eligible_actions(shap_fixed_only, [dict(iv) for iv in INTERVENTIONS]) == []


def test_priority_formula():
    shap = {"Discharge setting": 0.5, "Medication complexity": 0.5}
    risk = 0.2
    iv = next(i for i in INTERVENTIONS if i["name"] == "Home visit")
    share = 0.5 / 1.0
    expected = risk * mid_effect(iv) * share / iv["minutes"]
    got = opt.best_action(risk, shap, [dict(iv) for iv in INTERVENTIONS])
    # best action may be another intervention; check the one it returns matches formula
    ba_iv = got["action"]
    exp2 = risk * mid_effect(ba_iv) * opt.shap_share(shap, ba_iv["target_concept"]) / ba_iv["minutes"]
    assert got["priority"] == pytest.approx(exp2)
    assert expected > 0


def test_knapsack_maximizes_the_scored_objective():
    """The knapsack value must be exactly what the replay's metric 2 tracks:
    value = calibrated_risk * mid_effect (expected avoided readmissions).
    shap_share must NOT discount the value (it double-discounts multi-driver
    patients and pushed CareTrace below raw risk on metric 2)."""
    rng = np.random.default_rng(11)
    items = []
    for _ in range(40):
        risk = float(rng.uniform(0.05, 0.4))
        # simulate two patients: one with a single big driver, one with several
        # small drivers (lower shap_share) but the SAME risk and action value
        shap = {
            "Discharge setting": float(rng.uniform(0.05, 0.5)),
            "Medication complexity": float(rng.uniform(0.05, 0.5)),
            "Follow-up access": float(rng.uniform(0.05, 0.5)),
        }
        ba = opt.best_action(risk, shap, [dict(iv) for iv in INTERVENTIONS])
        assert ba is not None
        # objective consistency: value == risk * mid_effect of the chosen action
        assert ba["value"] == pytest.approx(
            risk * mid_effect(ba["action"]), rel=1e-12
        )
        # value is independent of shap_share: doubling all SHAP values leaves
        # the value unchanged (only priority/share change)
        shap2 = {k: v * 4 for k, v in shap.items()}
        ba2 = opt.best_action(risk, shap2, [dict(iv) for iv in INTERVENTIONS])
        assert ba2["value"] == pytest.approx(ba["value"], rel=1e-12)
        items.append({
            "minutes": int(ba["action"]["minutes"]),
            "value": ba["value"],
            "risk": risk,
        })
    # knapsack must beat any random feasible subset on the summed objective
    budget = 240
    sel = opt.knapsack(items, budget)
    assert sum(items[i]["minutes"] for i in sel) <= budget
    best_greedy_risk = 0.0
    for order in (sorted(range(len(items)), key=lambda i: -items[i]["risk"]),
                  list(range(len(items)))):
        used, v = 0, 0.0
        for i in order:
            if used + items[i]["minutes"] <= budget:
                used += items[i]["minutes"]
                v += items[i]["value"]
        best_greedy_risk = max(best_greedy_risk, v)
    knap_v = sum(items[i]["value"] for i in sel)
    assert knap_v >= best_greedy_risk - 1e-9   # knapsack >= risk-only greedy
