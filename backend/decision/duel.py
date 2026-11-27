"""Duel: human vs risk-only vs CareTrace on a fixed 15-patient set.

Session seed is FIXED (2042) so every judge faces the same 15 patients.
Risk values are never sent to the client until scoring.
"""
from __future__ import annotations

from backend.decision import optimizer as opt
from backend.decision.catalog import mid_effect

DUEL_SEED = 2042
N_PATIENTS = 15


def pick_session(rows: list[dict], catalog: list[dict]) -> list[dict]:
    """Fixed 15 patients from the test rows that have an eligible action."""
    import numpy as np

    # deterministic: eligible patients sorted by patient_nbr, seeded sample
    eligible = []
    for r in sorted(rows, key=lambda r: r["patient_nbr"]):
        ba = opt.best_action(r["risk"], r["concept_shap"], catalog)
        if ba is None:
            continue
        eligible.append((r, ba))
    rng = np.random.default_rng(DUEL_SEED)
    idx = rng.choice(len(eligible), size=min(N_PATIENTS, len(eligible)),
                     replace=False)
    out = []
    for i in sorted(int(x) for x in idx):
        r, ba = eligible[i]
        out.append({
            "patient_nbr": r["patient_nbr"],
            "age": r.get("age", "?"),
            "top_drivers": [c for c, _ in opt_top_drivers(r["concept_shap"], 3)],
            "action": ba["action"]["name"],
            "minutes": int(ba["action"]["minutes"]),
            "y_true": int(r["y_true"]),     # only used server-side at score time
            "risk": float(r["risk"]),       # only used server-side at score time
            "mid_effect": mid_effect(ba["action"]),
        })
    return out


def opt_top_drivers(concept_shap: dict, k: int) -> list[tuple[str, float]]:
    items = [(c, float(v)) for c, v in concept_shap.items() if v > 0]
    items.sort(key=lambda kv: -kv[1])
    return items[:k]


def score(session: list[dict], human_nbrs: list[int], budget_minutes: int) -> dict:
    """Score three strategies on the same 15 patients and the same budget."""
    items = [{
        "patient_nbr": p["patient_nbr"],
        "minutes": p["minutes"],
        "value": p["risk"] * p["mid_effect"],       # knapsack objective (Step A)
        "risk": p["risk"],
        "y_true": p["y_true"],
        "mid_effect": p["mid_effect"],
    } for p in session]
    by_nbr = {it["patient_nbr"]: i for i, it in enumerate(items)}

    # human: block over-budget selections at the API layer; enforce again here
    human_sel, used = [], 0
    for nbr in human_nbrs:
        i = by_nbr.get(nbr)
        if i is None:
            continue
        if used + items[i]["minutes"] <= budget_minutes:
            human_sel.append(i)
            used += items[i]["minutes"]

    risk_order = sorted(range(len(items)), key=lambda i: (-items[i]["risk"], items[i]["patient_nbr"]))
    risk_sel, used = [], 0
    for i in risk_order:                       # same greedy-fill rule as replay
        if used + items[i]["minutes"] <= budget_minutes:
            risk_sel.append(i)
            used += items[i]["minutes"]

    care_sel = opt.knapsack(items, budget_minutes)

    def summarize(sel: list[int]) -> dict:
        return {
            "calls_made": len(sel),
            "minutes_used": sum(items[i]["minutes"] for i in sel),
            "readmissions_reached": sum(items[i]["y_true"] for i in sel),
            "expected_avoided_readmissions": sum(
                items[i]["y_true"] * items[i]["mid_effect"] for i in sel),
            "pct_eligible": 100.0 if sel else 0.0,   # every pool pick has an action
        }

    return {
        "budget_minutes": budget_minutes,
        "strategies": {
            "human": summarize(human_sel),
            "risk_only": summarize(risk_sel),
            "caretrace": summarize(care_sel),
        },
        "note": ("expected_avoided = true label x assumed mid effect "
                 "(assumption, not a prediction)"),
    }
