"""Concept grouping of SHAP drivers.

Every one-hot column is mapped back to its base feature, and every base
feature belongs to exactly ONE concept (a feature shared by two concepts in
the spec is assigned to one primary concept and documented here).

Primary-concept assignments worth noting:
  * `number_outpatient` -> **Follow-up access** (modifiable). The spec also
    lists it under "Prior use"; it is assigned here to Follow-up access
    because few post-discharge outpatient visits = poor follow-up access,
    which is the thing an intervention can change. `number_inpatient` and
    `number_emergency` carry the "prior use" concept.
  * Age / race / gender live in Demographics, which is Fixed: they are never
    eligible for an action (age/race/gender never map to an action).
"""

from __future__ import annotations

import numpy as np

CONCEPT_ORDER = [
    "Prior use",
    "Demographics",
    "Stay severity",
    "Medication complexity",
    "Discharge setting",
    "Follow-up access",
    "Admission context",
]

CONCEPTS: dict[str, dict] = {
    "Prior use": {
        "features": ["number_inpatient", "number_emergency"],
        "modifiable": False,
        "why": "Prior admissions and ER visits are history; they set context but cannot be changed this week.",
    },
    "Demographics": {
        "features": ["age", "gender", "race"],
        "modifiable": False,
        "why": "Who the patient is, not what can be done. Never mapped to an action.",
    },
    "Stay severity": {
        "features": [
            "time_in_hospital",
            "number_diagnoses",
            "num_lab_procedures",
            "num_procedures",
        ],
        "modifiable": False,
        "why": "Already happened during the admission.",
    },
    "Medication complexity": {
        "features": ["num_medications", "insulin", "change", "diabetesMed"],
        "modifiable": True,
        "why": "Regimen complexity and changes are what medication reconciliation and counselling act on.",
    },
    "Discharge setting": {
        "features": ["discharge_disposition_id"],
        "modifiable": True,
        "why": "Where the patient goes next is influenced by handoff and home-visit support.",
    },
    "Follow-up access": {
        "features": ["number_outpatient"],
        "modifiable": True,
        "why": "Few outpatient visits signal poor access; follow-up calls and PCP visits close the gap.",
    },
    "Admission context": {
        "features": [
            "admission_source_id",
            "admission_type_id",
            "medical_specialty",
            "diag_group",
        ],
        "modifiable": False,
        "why": "How and why the patient arrived; fixed by the time discharge planning starts.",
    },
}

MODIFIABLE = {name for name, spec in CONCEPTS.items() if spec["modifiable"]}


def feature_to_concept(feature_names: list[str]) -> dict[str, str]:
    """Map every model column (including `base__value` one-hot columns) to its
    concept. Unmapped columns are dropped rather than guessed."""
    mapping = {}
    for col in feature_names:
        base = col.split("__", 1)[0]
        for concept, spec in CONCEPTS.items():
            if base in spec["features"]:
                mapping[col] = concept
                break
    return mapping


def concept_names_for(feature_names: list[str]) -> list[str]:
    """Concepts present, in canonical order, restricted to mapped features."""
    present = set(feature_to_concept(feature_names).values())
    return [c for c in CONCEPT_ORDER if c in present]


def group_rows(feature_names: list[str], shap_values: np.ndarray) -> np.ndarray:
    """(n, n_features) SHAP -> (n, n_concepts) sums, canonical concept order."""
    mapping = feature_to_concept(feature_names)
    names = concept_names_for(feature_names)
    idx = {c: [] for c in names}
    for j, col in enumerate(feature_names):
        c = mapping.get(col)
        if c is not None:
            idx[c].append(j)
    out = np.zeros((shap_values.shape[0], len(names)), dtype="float64")
    for j, c in enumerate(names):
        cols = idx[c]
        if cols:
            out[:, j] = shap_values[:, cols].sum(axis=1)
    return out


def group_row(feature_names: list[str], shap_row: np.ndarray) -> dict[str, float]:
    """One patient: concept -> summed SHAP."""
    mat = group_rows(feature_names, shap_row.reshape(1, -1))
    return {c: float(v) for c, v in zip(concept_names_for(feature_names), mat[0])}
