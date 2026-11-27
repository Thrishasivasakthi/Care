"""Pydantic request/response schemas."""

from __future__ import annotations

from datetime import date, datetime
from typing import Any, Literal

from pydantic import BaseModel, Field


# --------------------------------------------------------------------- #
# requests
# --------------------------------------------------------------------- #

DecisionAction = Literal["approve", "edit", "reject"]


class DecisionIn(BaseModel):
    action: DecisionAction
    note: str | None = None
    intervention_id: int | None = None  # only used for action="edit"


class TaskPatchIn(BaseModel):
    status: Literal["Due", "Done", "Missed", "Escalated"]
    note: str | None = None


# --------------------------------------------------------------------- #
# shared fragments
# --------------------------------------------------------------------- #

class InterventionOut(BaseModel):
    id: int
    name: str
    target_concept: str
    minutes: int
    effect_low: float
    effect_high: float
    effect_label: str
    window_start_day: int
    window_end_day: int
    source: str
    assumption_tag: str = "assumption, not a prediction"


class TaskOut(BaseModel):
    id: int
    plan_id: int
    patient_id: int
    title: str
    due_date: date
    status: str
    created_at: datetime


class PlanOut(BaseModel):
    id: int
    patient_id: int
    intervention: InterventionOut
    status: str
    priority_score: float
    minutes: int
    note: str | None = None
    updated_by_role: str | None = None
    updated_at: datetime


class AuditOut(BaseModel):
    id: int
    role: str
    actor: str
    patient_id: int | None
    entity: str
    entity_id: int
    field: str
    old_value: str | None
    new_value: str | None
    note: str | None
    created_at: datetime


# --------------------------------------------------------------------- #
# worklist
# --------------------------------------------------------------------- #

class WorklistRow(BaseModel):
    rank: int
    patient_id: int
    patient_nbr: int
    risk: float
    high_risk: bool
    driver: str | None                    # top modifiable driver
    action: InterventionOut | None        # matched action (best action / plan action)
    priority: float | None
    minutes: int | None
    status: str                           # Pending/Approved/Edited/Rejected/Not flagged/No modifiable driver
    plan_id: int | None = None
    delta: int                            # risk_rank - caretrace_rank (positive = promoted)
    selected: bool                        # in this hour's optimizer selection
    selected_risk_only: bool


class ComparisonRow(BaseModel):
    policy: str
    calls_made: int
    minutes_used: int
    readmissions_reached: int
    expected_avoided_readmissions: float
    expected_avoided_per_hour: float
    assumption_tag: str = "assumption, not a prediction"


class WorklistOut(BaseModel):
    hours: float
    budget_minutes: int
    cohort_size: int
    selection: list[WorklistRow]          # optimizer's order (selected first)
    ranking: list[WorklistRow]            # full cohort in CareTrace order
    no_modifiable_driver: list[WorklistRow]
    unreviewed_flags: int
    comparison: list[ComparisonRow]       # risk-only vs CareTrace
    elapsed_ms: float


# --------------------------------------------------------------------- #
# patient detail
# --------------------------------------------------------------------- #

class ConceptBar(BaseModel):
    concept: str
    shap: float
    group: str                            # Fixed | Modifiable
    modifiable: bool
    why: str


class ExplanationLine(BaseModel):
    concept: str
    text: str


class LookalikeCard(BaseModel):
    patient_id: int | None = None
    age: str
    top_drivers: list[str]
    outcome: str                          # history, not cause


class LookalikeOut(BaseModel):
    line: str                             # "X% of 50 similar patients were readmitted vs Y% overall"
    readmitted_rate: float
    overall_rate: float
    k: int
    cards: list[LookalikeCard]
    label: str = "history, not cause"


class TimingOut(BaseModel):
    horizon_days: int = 30
    early_window_days: int = 7            # shaded early-heavy window (visual only)
    day_zero: date
    items: list[dict[str, Any]]           # {name, start_day, end_day, minutes}


class PatientOut(BaseModel):
    patient_id: int
    patient_nbr: int
    demographics: dict[str, Any]
    prediction: dict[str, Any] | None     # risk, flag, risk_raw (null if unscored)
    concept_bars: list[ConceptBar]
    explanation: list[ExplanationLine]
    matched_interventions: list[dict[str, Any]]
    best_action: dict[str, Any] | None
    lookalike: LookalikeOut | None
    timing: TimingOut
    plan: PlanOut | None
    tasks: list[TaskOut]
    audit: list[AuditOut]
    reviews: list[dict[str, Any]]
    history_label: str = "SHAP explains this model on this patient's record; it is not a cause."


# --------------------------------------------------------------------- #
# ops / discharge / meta
# --------------------------------------------------------------------- #

class RateRow(BaseModel):
    name: str
    patients: int
    readmitted: int
    rate: float


class OpsOut(BaseModel):
    metrics: dict[str, Any]
    replay: dict[str, Any] | None
    high_risk_cutoff: float
    departments: list[RateRow]
    diagnosis_groups: list[RateRow]
    avg_stay_days: float
    bed_days_freed: float | None
    bed_days_note: str
    system_rule: str
    honesty: list[str]


class DischargeOut(BaseModel):
    patient_id: int
    patient_nbr: int
    instructions: dict[str, Any]          # {text, source, verified, missing_slots, slots}
    intervention: dict[str, Any] | None
    tasks: list[TaskOut]
    reminders: list[str]                  # simulated, nothing sent
    demo_date: date


class MetaOut(BaseModel):
    system_rule: str
    honesty: list[str]
    demo_date: date
    llm_configured: bool
    llm_provider: str
    roles: list[str]
