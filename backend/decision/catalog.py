"""Intervention catalog — SYNTHETIC. Effect sizes are label assumptions,
never predictions. Every UI surface must tag them
"assumption, not a prediction"."""

from __future__ import annotations

ASSUMPTION_TAG = "assumption, not a prediction"

# name, target_concept, minutes, effect_low, effect_high, window days, source
INTERVENTIONS: list[dict] = [
    dict(name="48-hour follow-up call", target_concept="Follow-up access",
         minutes=10, effect_low=0.05, effect_high=0.15,
         window_start_day=2, window_end_day=3, source="assumption"),
    dict(name="Medication reconciliation", target_concept="Medication complexity",
         minutes=20, effect_low=0.10, effect_high=0.20,
         window_start_day=1, window_end_day=5, source="assumption"),
    dict(name="Pharmacist counselling", target_concept="Medication complexity",
         minutes=20, effect_low=0.05, effect_high=0.15,
         window_start_day=1, window_end_day=7, source="assumption"),
    dict(name="PCP visit within 7 days", target_concept="Follow-up access",
         minutes=15, effect_low=0.10, effect_high=0.20,
         window_start_day=3, window_end_day=7, source="assumption"),
    dict(name="Home visit", target_concept="Discharge setting",
         minutes=45, effect_low=0.10, effect_high=0.25,
         window_start_day=3, window_end_day=10, source="assumption"),
    dict(name="Care handoff to nursing facility", target_concept="Discharge setting",
         minutes=25, effect_low=0.05, effect_high=0.15,
         window_start_day=1, window_end_day=3, source="assumption"),
]


def catalog_dicts() -> list[dict]:
    return [dict(iv) for iv in INTERVENTIONS]


def mid_effect(iv: dict) -> float:
    """(low+high)/2 — an ASSUMED relative risk reduction, not a prediction."""
    return (float(iv["effect_low"]) + float(iv["effect_high"])) / 2.0


def effect_label(iv: dict) -> str:
    return f"{iv['effect_low'] * 100:.0f}-{iv['effect_high'] * 100:.0f}%"


def seed_catalog(session) -> int:
    """Insert the 6 rows if the catalog is empty. Returns rows inserted."""
    from backend.app.models import Intervention

    if session.query(Intervention).count() == 0:
        for iv in INTERVENTIONS:
            session.add(Intervention(**iv))
        session.commit()
        return len(INTERVENTIONS)
    return 0
