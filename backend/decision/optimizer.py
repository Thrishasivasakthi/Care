"""Decision layer: eligibility -> priority score -> 0/1 knapsack.

Rules (spec 4.2):
  * eligible  = target concept is modifiable AND has positive SHAP for the
                patient
  * priority  = calibrated_risk * mid_effect * shap_share / minutes
  * selection = 0/1 knapsack over coordinator minutes, at most one main
                action per patient, maximizing sum(risk * mid_effect * shap_share)

Everything here is pure Python over plain dicts so the replay backtest can
reuse exactly the same rules.
"""

from __future__ import annotations

from backend.decision.catalog import mid_effect
from backend.ml import concepts as C

EPS = 1e-12


def positive_concepts(concept_shap: dict) -> dict:
    return {k: float(v) for k, v in concept_shap.items() if v > 0}


def total_positive_shap(concept_shap: dict) -> float:
    return sum(max(0.0, float(v)) for v in concept_shap.values())


def shap_share(concept_shap: dict, concept: str) -> float:
    """Target concept's positive SHAP / total positive SHAP."""
    total = total_positive_shap(concept_shap)
    value = float(concept_shap.get(concept, 0.0))
    if total <= 0 or value <= 0:
        return 0.0
    return value / total


def eligible_actions(concept_shap: dict, catalog: list[dict]) -> list[dict]:
    """Modifiable concept with positive SHAP for this patient."""
    pos = positive_concepts(concept_shap)
    return [
        iv for iv in catalog
        if iv["target_concept"] in C.MODIFIABLE
        and pos.get(iv["target_concept"], 0.0) > 0
    ]


def top_modifiable_driver(concept_shap: dict) -> str | None:
    best, best_v = None, 0.0
    for concept in C.MODIFIABLE:
        v = float(concept_shap.get(concept, 0.0))
        if v > best_v:
            best, best_v = concept, v
    return best


def best_action(risk: float, concept_shap: dict, catalog: list[dict]) -> dict | None:
    """Highest priority eligible intervention for one patient, or None."""
    best = None
    best_priority = -1.0
    for iv in eligible_actions(concept_shap, catalog):
        share = shap_share(concept_shap, iv["target_concept"])
        priority = risk * mid_effect(iv) * share / iv["minutes"]
        if priority > best_priority + EPS:          # deterministic tie-break
            best_priority = priority
            best = iv
    if best is None:
        return None
    share = shap_share(concept_shap, best["target_concept"])
    return {
        "action": dict(best),
        "priority": best_priority,
        "value": risk * mid_effect(best) * share,   # expected avoided (risk-weighted)
        "shap_share": share,
        "driver": best["target_concept"],
    }


def knapsack(items: list[dict], budget_minutes: int) -> list[int]:
    """0/1 knapsack, integer-minute DP. Items need `minutes` and `value`.
    Returns selected item indexes; total minutes <= budget."""
    n = len(items)
    budget = int(budget_minutes)
    if n == 0 or budget <= 0:
        return []
    minutes = [max(0, int(it["minutes"])) for it in items]
    values = [float(it["value"]) for it in items]

    dp = [[0.0] * (budget + 1) for _ in range(n + 1)]
    for i in range(1, n + 1):
        m, v = minutes[i - 1], values[i - 1]
        prev, cur = dp[i - 1], dp[i]
        if m > budget:
            cur[:] = prev
            continue
        for cap in range(budget + 1):
            best = prev[cap]
            if m <= cap:
                cand = prev[cap - m] + v
                if cand > best + EPS:
                    best = cand
            cur[cap] = best

    selected: list[int] = []
    cap = budget
    for i in range(n, 0, -1):
        if dp[i][cap] > dp[i - 1][cap] + EPS:
            selected.append(i - 1)
            cap -= minutes[i - 1]
    selected.reverse()
    return selected


def risk_only_select(items: list[dict], budget_minutes: int) -> list[int]:
    """'Call the sickest first': items sorted by risk desc by the caller,
    greedily fill the budget (skip what does not fit, keep going)."""
    used = 0
    budget = int(budget_minutes)
    selected: list[int] = []
    for idx, it in enumerate(items):
        m = int(it["minutes"])
        if used + m <= budget:
            selected.append(idx)
            used += m
    return selected


def policy_summary(rows: list[dict], selected: list[int], hours: float) -> dict:
    """Aggregate a policy's selection. Metric 1 uses true labels only;
    metric 2 = true label x mid effect (ASSUMED effects)."""
    calls = len(selected)
    minutes = sum(int(rows[i]["minutes"]) for i in selected)
    reached = sum(int(rows[i]["y_true"]) for i in selected)
    avoided = sum(float(rows[i]["y_true"]) * float(rows[i]["mid_effect"]) for i in selected)
    return {
        "calls_made": calls,
        "minutes_used": minutes,
        "readmissions_reached": reached,
        "expected_avoided_readmissions": avoided,
        "expected_avoided_per_hour": avoided / hours if hours else 0.0,
        "note": "expected_avoided uses assumed effect sizes (assumption, not a prediction)",
    }
