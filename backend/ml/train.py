"""Phase 1: train, calibrate, explain. No LLM anywhere in this file.

    python -m backend.ml.train     (or `make train`)

Writes to artifacts/:
    model.joblib           raw XGBoost model (SHAP is computed on this)
    calibrator.joblib      isotonic regression fitted on the calibration split
    metrics.json           ROC-AUC, PR-AUC, base rate, calibration points,
                           top-20% capture, high-risk cutoff
    shap_test.npz          TreeExplainer SHAP values for the test split
    test_predictions.csv  per-patient risk + truth for the test split
"""

from __future__ import annotations

import json
import math
from pathlib import Path

import joblib
import numpy as np
import pandas as pd
import shap
import xgboost as xgb
from sklearn.isotonic import IsotonicRegression
from sklearn.metrics import average_precision_score, roc_auc_score

from backend.ml import concepts, features

ARTIFACTS = features.REPO_ROOT / "artifacts"

MODEL_PARAMS = dict(
    n_estimators=400,
    max_depth=4,
    learning_rate=0.05,
    subsample=0.8,
    colsample_bytree=0.8,
    min_child_weight=5,
    reg_lambda=1.0,
    objective="binary:logistic",
    eval_metric="logloss",
    tree_method="hist",
    random_state=features.SEED,
    n_jobs=-1,
)

N_CALIBRATION_POINTS = 10
TOP_FRACTION = 0.20


def calibration_points(y: np.ndarray, risk: np.ndarray, n_bins: int = N_CALIBRATION_POINTS):
    """Equal-frequency bins: mean predicted risk vs observed event rate."""
    edges = np.quantile(risk, np.linspace(0, 1, n_bins + 1))
    edges[0] -= 1e-9
    edges[-1] += 1e-9
    bins = np.digitize(risk, edges[1:-1])
    points = []
    for b in range(n_bins):
        sel = bins == b
        if sel.sum() == 0:
            continue
        points.append(
            {
                "bin": b,
                "n": int(sel.sum()),
                "predicted": float(risk[sel].mean()),
                "observed": float(y[sel].mean()),
            }
        )
    return points


def main() -> None:
    ARTIFACTS.mkdir(exist_ok=True)

    print("Loading data ...")
    raw = features.load_raw()
    df = features.prepare(raw)
    X = features.build_features(df)
    splits = features.patient_split(df)

    masks = {
        name: df["patient_nbr"].isin(ids).to_numpy() for name, ids in splits.items()
    }
    # no patient can appear in two splits (enforced by construction, verified too)
    for a in ("train", "calibration", "test"):
        for b in ("train", "calibration", "test"):
            if a < b:
                assert not (masks[a] & masks[b]).any(), f"patient overlap {a}/{b}"

    X_train, y_train = X[masks["train"]], df.loc[masks["train"], "y"].to_numpy()
    X_cal, y_cal = X[masks["calibration"]], df.loc[masks["calibration"], "y"].to_numpy()
    X_test = X[masks["test"]]
    y_test = df.loc[masks["test"], "y"].to_numpy()
    test_patients = df.loc[masks["test"], "patient_nbr"].to_numpy()

    pos = int(y_train.sum())
    neg = len(y_train) - pos
    spw = neg / pos

    print(
        f"Patients: train {len(y_train):,} | calibration {len(y_cal):,} | "
        f"test {len(y_test):,} | features {X.shape[1]} | "
        f"base rate(train) {y_train.mean():.3f} | scale_pos_weight {spw:.2f}"
    )

    print("Training XGBoost ...")
    model = xgb.XGBClassifier(**MODEL_PARAMS, scale_pos_weight=spw)
    model.fit(X_train, y_train, verbose=False)

    print("Calibrating (isotonic, calibration split) ...")
    calibrator = IsotonicRegression(out_of_bounds="clip")
    calibrator.fit(model.predict_proba(X_cal)[:, 1], y_cal)

    risk_raw = model.predict_proba(X_test)[:, 1]
    risk = calibrator.predict(risk_raw)

    roc = float(roc_auc_score(y_test, risk))
    pr_auc = float(average_precision_score(y_test, risk))
    base_rate = float(y_test.mean())

    # top-20% by calibrated risk, exactly 20% of the test rows by rank
    n = len(risk)
    k = max(1, math.ceil(TOP_FRACTION * n))
    order = np.argsort(-risk, kind="stable")
    top_idx = order[:k]
    cutoff = float(risk[order[k - 1]])
    capture = float(y_test[top_idx].sum() / max(1, y_test.sum()))

    print("Computing SHAP (TreeExplainer on the raw model) ...")
    explainer = shap.TreeExplainer(model)
    shap_values = np.asarray(explainer.shap_values(X_test), dtype="float32")
    feature_names = list(X.columns)

    # ------------------------------------------------------------------ #
    # artifacts
    # ------------------------------------------------------------------ #
    joblib.dump(model, ARTIFACTS / "model.joblib")
    joblib.dump(calibrator, ARTIFACTS / "calibrator.joblib")
    np.savez_compressed(
        ARTIFACTS / "shap_test.npz",
        patient_nbr=test_patients,
        feature_names=np.array(feature_names, dtype=object),
        shap=shap_values,
        risk=risk.astype("float64"),
        y_true=y_test.astype("int8"),
    )
    pd.DataFrame(
        {
            "patient_nbr": test_patients,
            "risk_calibrated": risk,
            "risk_raw": risk_raw,
            "y_true": y_test,
        }
    ).to_csv(ARTIFACTS / "test_predictions.csv", index=False, float_format="%.17g")

    # concept-level mean |SHAP| on the test set (for the model card / ops)
    grouped = concepts.group_rows(feature_names, shap_values.astype("float64"))
    concept_names = concepts.concept_names_for(feature_names)
    concept_importance = {
        c: float(np.abs(grouped[:, j]).mean())
        for j, c in enumerate(concept_names)
    }

    metrics = {
        "dataset": {
            "rows": int(len(raw)),
            "rows_after_exclusions": int(len(df)),
            "patients": int(df["patient_nbr"].nunique()),
            "excluded_discharge_ids": sorted(features.EXPIRED_DISCHARGE_IDS),
            "target": "readmitted == '<30'",
        },
        "split": {k: len(v) for k, v in splits.items()},
        "seed": features.SEED,
        "n_features": int(X.shape[1]),
        "base_rate_test": base_rate,
        "base_rate_train": float(y_train.mean()),
        "roc_auc": roc,
        "pr_auc": pr_auc,
        "top20_fraction": TOP_FRACTION,
        "top20_capture": capture,
        "high_risk_cutoff": cutoff,
        "n_high_risk_test": int((risk >= cutoff).sum()),
        "calibration_points": calibration_points(y_test, risk),
        "model": {"type": "XGBoost", "params": MODEL_PARAMS, "scale_pos_weight": float(spw)},
        "calibration": "isotonic (calibration split)",
        "concept_importance": concept_importance,
        "concept_order": concept_names,
        "modifiable_concepts": sorted(concepts.MODIFIABLE),
        "notes": [
            "Honest out-of-sample metrics; no tuning to inflate AUC.",
            "SHAP is computed on the raw model; calibrated risk is used for flags.",
            "High-risk flag = calibrated risk >= high_risk_cutoff (value at the top-20% "
            "rank on test). Isotonic calibration makes many risks identical, so ties at "
            f"the cutoff flag {int((risk >= cutoff).sum())}/{n} = "
            f"{(risk >= cutoff).mean():.0%} of test rows rather than exactly 20%.",
        ],
    }
    (ARTIFACTS / "metrics.json").write_text(json.dumps(metrics, indent=2))

    print()
    print("=" * 52)
    print(f"  ROC-AUC ............ {roc:.4f}")
    print(f"  PR-AUC ............. {pr_auc:.4f}")
    print(f"  Base rate .......... {base_rate:.4f}")
    print(f"  Top-20% capture .... {capture:.4f}  ({capture * 100:.1f}% of true readmissions in the top 20% by risk)")
    print(f"  High-risk cutoff ... {cutoff:.4f}")
    print("=" * 52)
    print("Artifacts written to", ARTIFACTS)


if __name__ == "__main__":
    main()
