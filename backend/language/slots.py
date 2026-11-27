"""Risk explanation: 3 plain lines from slots. NO LLM here.

    Driver: {CONCEPT}, because {FACT}. Suggested action: {INTERVENTION}.

Facts are built from the patient's record by code. Fixed drivers (age/race/
gender, prior use, stay severity, admission context) never map to an action.
"""

from __future__ import annotations

from backend.decision import optimizer as opt
from backend.ml import concepts as C

# Only meanings that are documented/verified for this dataset are asserted.
# Everything else is reported as the raw recorded code (no invented facts).
DISPOSITION_LABELS = {
    1: "home",
}


def fact(concept: str, p: dict) -> str:
    """One factual line about the patient, built from the record."""
    if concept == "Prior use":
        return (
            f"{p['number_inpatient']} prior inpatient admission(s) and "
            f"{p['number_emergency']} emergency visit(s) before this stay"
        )
    if concept == "Demographics":
        return f"age band {p['age']}, recorded as {p['gender']}, {p['race']}"
    if concept == "Stay severity":
        return (
            f"{p['time_in_hospital']}-day stay with {p['number_diagnoses']} "
            f"diagnosis codes and {p['num_lab_procedures']} lab procedures"
        )
    if concept == "Medication complexity":
        insulin = (
            "insulin in the regimen" if p["insulin"] != "No" else "no insulin recorded"
        )
        change = (
            "a regimen change recorded" if p["change"] == "Ch"
            else "no regimen change recorded"
        )
        return f"{p['num_medications']} medications, {insulin}, {change}"
    if concept == "Discharge setting":
        code = int(p["discharge_disposition_id"])
        label = DISPOSITION_LABELS.get(code)
        if label:
            return f"discharged to {label} (disposition code {code})"
        return f"discharge disposition recorded as code {code} at discharge"
    if concept == "Follow-up access":
        n = int(p["number_outpatient"])
        if n == 0:
            return "no outpatient visits recorded before this admission"
        return f"{n} outpatient visit(s) recorded before this admission"
    if concept == "Admission context":
        return (
            f"admitted through source {p['admission_source_id']} to "
            f"{p['medical_specialty']}, primary diagnosis group {p['diag_group']}"
        )
    return "recorded on this admission"


def top_drivers(concept_shap: dict, k: int = 3) -> list[tuple[str, float]]:
    """Top-k concepts by SHAP value for this patient (descending)."""
    items = [(c, float(v)) for c, v in concept_shap.items() if c in C.CONCEPT_ORDER]
    items.sort(key=lambda kv: (-kv[1], C.CONCEPT_ORDER.index(kv[0])))
    return items[:k]


def explanation_lines(
    patient: dict, concept_shap: dict, catalog: list[dict]
) -> list[dict]:
    """Exactly 3 lines: Driver, because FACT, Suggested action."""
    lines = []
    for concept, _value in top_drivers(concept_shap, 3):
        f = fact(concept, patient)
        action = None
        if concept in C.MODIFIABLE:
            # best eligible intervention targeting this concept
            best = None
            for iv in opt.eligible_actions(concept_shap, catalog):
                if iv["target_concept"] != concept:
                    continue
                share = opt.shap_share(concept_shap, concept)
                priority = (
                    float(patient.get("_risk", 0.0)) * opt.mid_effect(iv) * share / iv["minutes"]
                )
                if best is None or priority > best[0]:
                    best = (priority, iv)
            action = best[1]["name"] if best else None
        if action:
            text = f"Driver: {concept}, because {f}. Suggested action: {action}."
        else:
            text = (
                f"Driver: {concept}, because {f}. "
                f"Suggested action: none - this driver is fixed history."
            )
        lines.append({"concept": concept, "text": text})
    # pad to 3 if the record produced fewer concepts
    while len(lines) < 3:
        lines.append({
            "concept": "-",
            "text": "Driver: none, because this record has no further recorded drivers. "
                    "Suggested action: none.",
        })
    return lines
