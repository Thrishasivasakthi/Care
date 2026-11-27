"""Replay backtest (offline) -> artifacts/replay.json.

Simulates ~200 random "days". Each day samples 60 patients from the TEST
split with a fixed minutes budget and runs four policies on the same day:

  chronological  encounter order (stand-in: UCI has no dates)
  raw_risk       calibrated risk top-down
  caretrace      the optimizer (0/1 knapsack)
  human          simulated human: random pick that fills the budget

Two metrics per policy, reported as mean with 10th-90th percentile:
  1. real readmissions reached        (true labels only)
  2. expected avoided readmissions    (true label x ASSUMED mid effect)

Metric 2 depends on assumed effect sizes; raw risk may tie or win on
metric 1 - that is expected. A loud warning is printed if CareTrace does
not beat raw risk on metric 2.

    python -m backend.decision.replay
"""

from __future__ import annotations

import json
import time
from datetime import datetime, timezone
from pathlib import Path

import numpy as np

from backend.decision import optimizer as opt
from backend.decision.catalog import catalog_dicts, mid_effect
from backend.ml import concepts as C
from backend.ml import features as F

ARTIFACTS = F.REPO_ROOT / "artifacts"

DAYS = 200
COHORT_SIZE = 60
BUDGET_MINUTES = 240          # 4 coordinator-hours
SEED = 2025

POLICIES = ("chronological", "raw_risk", "caretrace", "human")


def load_test_rows() -> list[dict]:
    z = np.load(ARTIFACTS / "shap_test.npz", allow_pickle=True)
    feature_names = list(z["feature_names"])
    shap_values = z["shap"].astype("float64")
    grouped = C.group_rows(feature_names, shap_values)
    concept_names = C.concept_names_for(feature_names)

    patient_nbr = z["patient_nbr"]
    risk = z["risk"].astype("float64")
    y_true = z["y_true"].astype(int)

    raw = F.load_raw()
    df = F.prepare(raw)
    encounter = (
        df.set_index("patient_nbr")["encounter_id"].reindex(patient_nbr).to_numpy()
    )

    rows = []
    for i in range(len(patient_nbr)):
        rows.append({
            "patient_nbr": int(patient_nbr[i]),
            "encounter": int(encounter[i]),
            "risk": float(risk[i]),
            "y_true": int(y_true[i]),
            "concept_shap": {c: float(grouped[i, j]) for j, c in enumerate(concept_names)},
        })
    return rows


def _greedy_fill(order: list[int], items: list[dict], budget: int) -> list[int]:
    used, selected = 0, []
    for i in order:
        m = int(items[i]["minutes"])
        if used + m <= budget:
            selected.append(i)
            used += m
    return selected


def _metrics(items: list[dict], selected: list[int]) -> tuple[float, float]:
    reached = sum(items[i]["y_true"] for i in selected)
    avoided = sum(items[i]["y_true"] * items[i]["mid_effect"] for i in selected)
    return float(reached), float(avoided)


def _summarize(values: np.ndarray) -> dict:
    return {
        "mean": float(values.mean()),
        "p10": float(np.percentile(values, 10)),
        "p90": float(np.percentile(values, 90)),
        "min": float(values.min()),
        "max": float(values.max()),
    }


def run() -> dict:
    rows = load_test_rows()
    n = len(rows)
    catalog = catalog_dicts()
    rng = np.random.default_rng(SEED)

    per_policy: dict[str, dict[str, list[float]]] = {
        p: {"reached": [], "avoided": []} for p in POLICIES
    }

    t0 = time.perf_counter()
    for day in range(DAYS):
        sample_idx = rng.choice(n, size=COHORT_SIZE, replace=False)

        # one pool per day: patients with an eligible action, each with its
        # per-patient best action (same eligibility rules for every policy)
        items: list[dict] = []
        for i in sample_idx:
            r = rows[i]
            ba = opt.best_action(r["risk"], r["concept_shap"], catalog)
            if ba is None:
                continue
            iv = ba["action"]
            items.append({
                "patient_nbr": r["patient_nbr"],
                "encounter": r["encounter"],
                "risk": r["risk"],
                "y_true": r["y_true"],
                "minutes": int(iv["minutes"]),
                "mid_effect": mid_effect(iv),
                "value": ba["value"],
                "priority": ba["priority"],
            })
        if not items:
            continue

        chrono_order = sorted(range(len(items)), key=lambda i: (items[i]["encounter"], items[i]["patient_nbr"]))
        risk_order = sorted(range(len(items)), key=lambda i: (-items[i]["risk"], items[i]["patient_nbr"]))
        human_rng = np.random.default_rng(SEED * 1000 + day)
        human_order = list(human_rng.permutation(len(items)))

        selected = {
            "chronological": _greedy_fill(chrono_order, items, BUDGET_MINUTES),
            "raw_risk": _greedy_fill(risk_order, items, BUDGET_MINUTES),
            "caretrace": opt.knapsack(items, BUDGET_MINUTES),
            "human": _greedy_fill([int(i) for i in human_order], items, BUDGET_MINUTES),
        }
        for policy, sel in selected.items():
            reached, avoided = _metrics(items, sel)
            per_policy[policy]["reached"].append(reached)
            per_policy[policy]["avoided"].append(avoided)

    elapsed = time.perf_counter() - t0

    summary = {}
    for policy in POLICIES:
        summary[policy] = {
            "readmissions_reached": _summarize(np.array(per_policy[policy]["reached"])),
            "expected_avoided_readmissions": _summarize(np.array(per_policy[policy]["avoided"])),
        }

    care = summary["caretrace"]["expected_avoided_readmissions"]["mean"]
    risk = summary["raw_risk"]["expected_avoided_readmissions"]["mean"]
    warning = None
    if care <= risk:
        warning = (
            "WARNING: CareTrace did NOT beat raw risk on expected avoided "
            f"readmissions ({care:.2f} vs {risk:.2f} mean over {DAYS} days). "
            "Adjust the pitch: report metric 1 (real readmissions reached) "
            "and note metric 2 depends on ASSUMED effects."
        )

    result = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "days": DAYS,
        "cohort_size": COHORT_SIZE,
        "budget_minutes": BUDGET_MINUTES,
        "budget_hours": BUDGET_MINUTES / 60,
        "seed": SEED,
        "test_population": n,
        "elapsed_seconds": round(elapsed, 2),
        "policies": summary,
        "metric_definitions": {
            "readmissions_reached": (
                "True held-out readmissions among patients the policy would "
                "call (true labels only)."
            ),
            "expected_avoided_readmissions": (
                "True label x mid effect of the assigned action. DEPENDS ON "
                "ASSUMED EFFECT SIZES - assumption, not a prediction."
            ),
            "expected": (
                "Raw risk may tie or win on readmissions reached; that is "
                "expected. Metrics are mean with 10th-90th percentile over "
                "the simulated days."
            ),
            "eligibility": (
                "All four policies draw from the same pool: patients with at "
                "least one eligible action, using the same eligibility rules."
            ),
        },
        "warning": warning,
    }
    return result


def main() -> None:
    print(f"Replaying {DAYS} days x {COHORT_SIZE} patients, "
          f"budget {BUDGET_MINUTES} minutes ...")
    result = run()
    out = ARTIFACTS / "replay.json"
    out.write_text(json.dumps(result, indent=2))
    print(f"Wrote {out}\n")
    header = f"{'policy':<16}{'reached (mean p10-p90)':<30}{'avoided (mean p10-p90)'}"
    print(header)
    print("-" * len(header))
    for policy in POLICIES:
        s = result["policies"][policy]
        r, a = s["readmissions_reached"], s["expected_avoided_readmissions"]
        print(f"{policy:<16}{r['mean']:>7.2f}  ({r['p10']:.1f}-{r['p90']:.1f})"
              f"{a['mean']:>18.2f}  ({a['p10']:.1f}-{a['p90']:.1f})")
    print()
    if result["warning"]:
        print("!" * 72)
        print(result["warning"])
        print("!" * 72)
    else:
        print("CareTrace beats raw risk on expected avoided readmissions "
              "(metric 2, assumed effects).")


if __name__ == "__main__":
    main()
