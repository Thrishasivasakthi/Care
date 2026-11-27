"""Feature construction for CareTrace.

Strict rules encoded here (see README honesty section):
  * `readmitted` is NEVER an input. It is read once to build the label `y`
    and then dropped from every frame that reaches the model.
  * Patients who cannot be readmitted are removed (expired / hospice
    discharge dispositions 11, 13, 14, 19, 20, 21).
  * Only the FIRST encounter per patient is kept, then the split is done by
    patient (60 / 20 / 20) with a fixed seed, so no patient can appear in
    two splits.
"""

from __future__ import annotations

import re
from pathlib import Path

import numpy as np
import pandas as pd

REPO_ROOT = Path(__file__).resolve().parents[2]
DATA_PATH = REPO_ROOT / "data" / "diabetic_data.csv"

SEED = 2025

# expired / hospice: these patients cannot be readmitted
EXPIRED_DISCHARGE_IDS = {11, 13, 14, 19, 20, 21}

IDENTIFIERS = ["encounter_id", "patient_nbr"]
# dropped: identifiers + very-high-missing columns (weight ~97% missing,
# payer_code ~40% missing and not useful for the demo)
DROPPED_COLUMNS = ["encounter_id", "patient_nbr", "readmitted", "weight", "payer_code"]

NUMERIC_FEATURES = [
    "time_in_hospital",
    "num_lab_procedures",
    "num_procedures",
    "num_medications",
    "number_diagnoses",
    "number_outpatient",
    "number_emergency",
    "number_inpatient",
]

CATEGORICAL_FEATURES = [
    "age",                      # age band, e.g. [70-80]
    "gender",
    "race",
    "insulin",
    "change",
    "diabetesMed",
    "admission_type_id",
    "admission_source_id",
    "discharge_disposition_id",
    "medical_specialty",
    "diag_group",               # built from diag_1 (ICD-9 -> ~9 groups)
]

TOP_N_SPECIALTIES = 10

# the 23 medication columns in the UCI file (kept for discharge instructions,
# NOT used as model features beyond insulin/change/diabetesMed)
DRUG_COLUMNS = [
    "metformin", "repaglinide", "nateglinide", "chlorpropamide", "glimepiride",
    "acetohexamide", "glipizide", "glyburide", "tolbutamide", "pioglitazone",
    "rosiglitazone", "acarbose", "miglitol", "troglitazone", "tolazamide",
    "examide", "citoglipton", "insulin", "glyburide-metformin",
    "glipizide-metformin", "glimepiride-pioglitazone",
    "metformin-rosiglitazone", "metformin-pioglitazone",
]

# --------------------------------------------------------------------------- #
# ICD-9 primary diagnosis grouping (~9 groups)
# --------------------------------------------------------------------------- #

ICD9_GROUP_NAMES = [
    "Circulatory",
    "Respiratory",
    "Digestive",
    "Genitourinary",
    "Musculoskeletal",
    "Neoplasm",
    "Injury",
    "Diabetes",
    "Other/Unknown",
]


def icd9_group(code: object) -> str:
    """Map a diag_1 ICD-9 code to one of ~9 clinical groups."""
    if code is None:
        return "Other/Unknown"
    s = str(code).strip()
    if s in ("", "?", "nan", "None"):
        return "Other/Unknown"
    if s[0] in ("E", "V"):                      # external causes / V codes
        return "Other/Unknown"
    m = re.match(r"^(\d+)", s)
    if not m:
        return "Other/Unknown"
    n = int(m.group(1))
    if n == 250:
        return "Diabetes"
    if 390 <= n <= 459 or n == 785:
        return "Circulatory"
    if 460 <= n <= 519 or n == 786:
        return "Respiratory"
    if 520 <= n <= 579 or n == 787:
        return "Digestive"
    if 580 <= n <= 629 or n == 788:
        return "Genitourinary"
    if 710 <= n <= 739:
        return "Musculoskeletal"
    if 140 <= n <= 239:
        return "Neoplasm"
    if 800 <= n <= 999:
        return "Injury"
    return "Other/Unknown"                      # 001-139, 630-709, 740-799, etc.


# --------------------------------------------------------------------------- #
# Load + clean
# --------------------------------------------------------------------------- #

def load_raw(path: Path = DATA_PATH) -> pd.DataFrame:
    """Read the UCI csv; `?` means missing everywhere."""
    if not path.exists():
        raise FileNotFoundError(f"Expected dataset at {path}")
    return pd.read_csv(path, na_values=["?"], low_memory=False)


def prepare(raw: pd.DataFrame) -> pd.DataFrame:
    """Filter, label, keep first encounter per patient. Returns a frame with
    one row per patient and an integer label column `y`."""
    df = raw.copy()
    df["discharge_disposition_id"] = pd.to_numeric(
        df["discharge_disposition_id"], errors="coerce"
    )
    # 1) drop patients who cannot be readmitted
    df = df[~df["discharge_disposition_id"].isin(EXPIRED_DISCHARGE_IDS)].copy()
    # 2) target: readmitted within 30 days -> 1, else 0
    label = df["readmitted"].astype(str).str.strip()
    df["y"] = (label == "<30").astype(np.int8)
    # 3) first encounter per patient (lowest encounter_id)
    df = (
        df.sort_values(["patient_nbr", "encounter_id"])
        .drop_duplicates("patient_nbr", keep="first")
        .reset_index(drop=True)
    )
    # the label source must never travel further as a feature
    df = df.drop(columns=["readmitted"])
    return df


# --------------------------------------------------------------------------- #
# Features
# --------------------------------------------------------------------------- #

def _clean_category(series: pd.Series) -> pd.Series:
    s = series.astype("string").str.strip()
    s = s.replace({"": "Unknown", "?": "Unknown"})
    return s.fillna("Unknown").astype(str)


def build_features(df: pd.DataFrame) -> pd.DataFrame:
    """Numeric columns as-is (NaN kept: XGBoost handles missing natively)
    plus one-hot columns named `base__value` so SHAP columns can be mapped
    back to their base feature and then to a concept."""
    out = pd.DataFrame(index=df.index)

    for col in NUMERIC_FEATURES:
        out[col] = pd.to_numeric(df[col], errors="coerce").astype("float32")

    cats = pd.DataFrame(index=df.index)
    for col in CATEGORICAL_FEATURES:
        if col == "diag_group":
            cats[col] = df["diag_1"].map(icd9_group)
            continue
        cats[col] = _clean_category(df[col])

    # medical_specialty: top categories, everything else -> Other/Unknown
    counts = cats["medical_specialty"].value_counts()
    keep = set(counts.head(TOP_N_SPECIALTIES).index)
    cats["medical_specialty"] = cats["medical_specialty"].where(
        cats["medical_specialty"].isin(keep), "Other/Unknown"
    )

    dummies = pd.get_dummies(cats, prefix=CATEGORICAL_FEATURES, prefix_sep="__")
    dummies = dummies.astype("float32")
    # XGBoost rejects `[`/`]` in feature names (age bands are e.g. [70-80])
    dummies.columns = [c.replace("[", "").replace("]", "") for c in dummies.columns]

    X = pd.concat([out, dummies], axis=1)
    # safety net: the label and identifiers must never be features
    for forbidden in DROPPED_COLUMNS + ["y", "readmitted"]:
        if forbidden in X.columns:
            raise AssertionError(f"forbidden column reached the feature matrix: {forbidden}")
    return X


# --------------------------------------------------------------------------- #
# Patient-level split
# --------------------------------------------------------------------------- #

def patient_split(
    df: pd.DataFrame, seed: int = SEED, ratios=(0.6, 0.2, 0.2)
) -> dict[str, list[int]]:
    """60 / 20 / 20 split of patient numbers. Deterministic for a fixed seed."""
    patients = np.array(sorted(df["patient_nbr"].unique()))
    rng = np.random.default_rng(seed)
    rng.shuffle(patients)
    n = len(patients)
    n_train = int(ratios[0] * n)
    n_cal = int(ratios[1] * n)
    return {
        "train": patients[:n_train].tolist(),
        "calibration": patients[n_train : n_train + n_cal].tolist(),
        "test": patients[n_train + n_cal :].tolist(),
    }


def load_splits(path: Path = DATA_PATH, seed: int = SEED):
    """Convenience: raw -> prepared -> features -> {split: (df, X, y)}."""
    raw = load_raw(path)
    df = prepare(raw)
    X = build_features(df)
    parts = patient_split(df, seed=seed)
    out = {}
    for name, ids in parts.items():
        mask = df["patient_nbr"].isin(ids)
        out[name] = (df[mask].reset_index(drop=True), X[mask].reset_index(drop=True))
    return out
