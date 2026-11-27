"""Lookalike cohort: NearestNeighbors(k=50) on SCALED features, fit on the
TRAIN split only. Both rates are computed from data - never hardcoded.

Label everywhere: "history, not cause".
"""

from __future__ import annotations

import threading

import numpy as np
from sklearn.neighbors import NearestNeighbors
from sklearn.preprocessing import StandardScaler

from backend.ml import concepts as C
from backend.ml import features as F

K = 50
_ctx: dict = {}
_lock = threading.Lock()


def _build() -> dict:
    """Fit (and cache) scaler + NN index over the train split."""
    if _ctx:
        return _ctx
    with _lock:
        if _ctx:
            return _ctx
        raw = F.load_raw()
        df = F.prepare(raw)
        X = F.build_features(df)
        parts = F.patient_split(df)
        train_mask = df["patient_nbr"].isin(parts["train"]).to_numpy()

        scaler = StandardScaler()
        Z_train = scaler.fit_transform(X[train_mask].to_numpy(dtype="float64"))
        nn = NearestNeighbors(n_neighbors=K, metric="euclidean").fit(Z_train)

        y_train = df.loc[train_mask, "y"].to_numpy()
        df_train = df[train_mask].reset_index(drop=True)

        _ctx.update(
            nn=nn, scaler=scaler, df=df, X=X, train_mask=train_mask,
            df_train=df_train, y_train=y_train,
            overall_rate=float(y_train.mean()),
            feature_names=list(X.columns),
        )
        return _ctx


def _model_explainer():
    """TreeExplainer for example cards (optional - degrade gracefully)."""
    if "explainer" in _ctx:
        return _ctx["explainer"]
    try:
        import joblib
        import shap

        model = joblib.load(F.REPO_ROOT / "artifacts" / "model.joblib")
        _ctx["explainer"] = shap.TreeExplainer(model)
    except Exception:
        _ctx["explainer"] = None
    return _ctx["explainer"]


def _top_concepts_for(ctx: dict, row: np.ndarray) -> list[str]:
    explainer = _model_explainer()
    if explainer is None:
        return []
    try:
        sv = np.asarray(explainer.shap_values(row.reshape(1, -1)))[0]
        grouped = C.group_rows(ctx["feature_names"], sv.reshape(1, -1))[0]
        names = C.concept_names_for(ctx["feature_names"])
        pairs = sorted(zip(names, grouped), key=lambda kv: -kv[1])
        return [c for c, v in pairs[:3] if v > 0] or [pairs[0][0]]
    except Exception:
        return []


def cohort(patient_nbr: int, k: int = K) -> dict | None:
    """Return {line, readmitted_rate, overall_rate, k, cards} or None."""
    try:
        ctx = _build()
        mask = ctx["df"]["patient_nbr"].to_numpy() == patient_nbr
        if not mask.any():
            return None
        x_row = ctx["X"][mask].to_numpy(dtype="float64")
        z = ctx["scaler"].transform(x_row)

        distances, indices = ctx["nn"].kneighbors(z, n_neighbors=k + 1)
        train_pos = np.flatnonzero(ctx["train_mask"])
        neigh_rows, neigh_pos = [], []
        for d, i in zip(distances[0], indices[0]):
            global_i = train_pos[i]
            if ctx["df"]["patient_nbr"].to_numpy()[global_i] == patient_nbr:
                continue                      # drop self if it somehow matches
            neigh_rows.append(i)
            neigh_pos.append(global_i)
            if len(neigh_rows) == k:
                break

        y = ctx["df"]["y"].to_numpy()[neigh_pos]
        rate = float(y.mean()) if len(y) else float("nan")
        overall = ctx["overall_rate"]

        cards = []
        for i in neigh_rows[:3]:
            global_i = train_pos[i]
            p = ctx["df"].iloc[global_i]
            row_vec = ctx["X"].iloc[global_i].to_numpy(dtype="float64")
            cards.append({
                "patient_id": int(p["patient_nbr"]),
                "age": str(p["age"]),
                "top_drivers": _top_concepts_for(ctx, row_vec),
                "outcome": (
                    "readmitted within 30 days"
                    if int(p["y"]) == 1
                    else "not readmitted within 30 days"
                ),
            })

        return {
            "line": (
                f"{rate * 100:.0f}% of {len(y)} similar patients were readmitted "
                f"within 30 days vs {overall * 100:.0f}% overall in the training data"
            ),
            "readmitted_rate": rate,
            "overall_rate": overall,
            "k": len(y),
            "cards": cards,
            "label": "history, not cause",
        }
    except Exception:
        return None
