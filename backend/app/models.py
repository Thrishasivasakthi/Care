"""Tables: patients, predictions, interventions_catalog, plans, tasks,
reviews, audit_log."""

from __future__ import annotations

from datetime import date, datetime

from sqlalchemy import JSON, Boolean, Date, DateTime, Float, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from backend.app.db import Base


class Patient(Base):
    __tablename__ = "patients"

    id: Mapped[int] = mapped_column(primary_key=True)
    patient_nbr: Mapped[int] = mapped_column(Integer, unique=True, index=True)
    encounter_id: Mapped[int] = mapped_column(Integer, index=True)

    age: Mapped[str] = mapped_column(String(16))
    gender: Mapped[str] = mapped_column(String(16))
    race: Mapped[str] = mapped_column(String(48))

    time_in_hospital: Mapped[int]
    num_lab_procedures: Mapped[int]
    num_procedures: Mapped[int]
    num_medications: Mapped[int]
    number_diagnoses: Mapped[int]
    number_outpatient: Mapped[int]
    number_emergency: Mapped[int]
    number_inpatient: Mapped[int]

    insulin: Mapped[str] = mapped_column(String(16))
    change: Mapped[str] = mapped_column(String(8))
    diabetesMed: Mapped[str] = mapped_column(String(8))

    admission_type_id: Mapped[int]
    admission_source_id: Mapped[int]
    discharge_disposition_id: Mapped[int]

    medical_specialty: Mapped[str] = mapped_column(String(64))
    diag_group: Mapped[str] = mapped_column(String(32))

    active_drugs: Mapped[list] = mapped_column(JSON, default=list)
    readmitted_30d: Mapped[int] = mapped_column(Integer, index=True)  # outcome, ops only

    prediction: Mapped["Prediction | None"] = relationship(back_populates="patient")
    plans: Mapped[list["Plan"]] = relationship(back_populates="patient")
    tasks: Mapped[list["Task"]] = relationship(back_populates="patient")


class Prediction(Base):
    __tablename__ = "predictions"

    id: Mapped[int] = mapped_column(primary_key=True)
    patient_id: Mapped[int] = mapped_column(ForeignKey("patients.id"), unique=True, index=True)
    risk_raw: Mapped[float] = mapped_column(Float)
    risk_calibrated: Mapped[float] = mapped_column(Float, index=True)
    high_risk: Mapped[bool] = mapped_column(Boolean, index=True)
    concept_shap: Mapped[dict] = mapped_column(JSON, default=dict)
    y_true: Mapped[int] = mapped_column(Integer)  # held-out outcome, aggregates only
    cohort: Mapped[bool] = mapped_column(Boolean, default=False, index=True)  # today's discharges
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.now)

    patient: Mapped[Patient] = relationship(back_populates="prediction")


class Intervention(Base):
    __tablename__ = "interventions_catalog"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(64), unique=True)
    target_concept: Mapped[str] = mapped_column(String(32))
    minutes: Mapped[int] = mapped_column(Integer)
    effect_low: Mapped[float] = mapped_column(Float)   # fraction, e.g. 0.05 = 5%
    effect_high: Mapped[float] = mapped_column(Float)
    window_start_day: Mapped[int] = mapped_column(Integer)
    window_end_day: Mapped[int] = mapped_column(Integer)
    source: Mapped[str] = mapped_column(String(16), default="assumption")

    plans: Mapped[list["Plan"]] = relationship(back_populates="intervention")


class Plan(Base):
    __tablename__ = "plans"

    id: Mapped[int] = mapped_column(primary_key=True)
    patient_id: Mapped[int] = mapped_column(ForeignKey("patients.id"), index=True)
    intervention_id: Mapped[int] = mapped_column(ForeignKey("interventions_catalog.id"))
    # Pending | Approved | Edited | Rejected
    status: Mapped[str] = mapped_column(String(16), default="Pending", index=True)
    priority_score: Mapped[float] = mapped_column(Float, default=0.0)
    minutes: Mapped[int] = mapped_column(Integer, default=0)
    note: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_by_role: Mapped[str] = mapped_column(String(16), default="system")
    updated_by_role: Mapped[str | None] = mapped_column(String(16), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.now)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.now, onupdate=datetime.now)

    patient: Mapped[Patient] = relationship(back_populates="plans")
    intervention: Mapped[Intervention] = relationship(back_populates="plans")
    tasks: Mapped[list["Task"]] = relationship(back_populates="plan")


class Task(Base):
    __tablename__ = "tasks"

    id: Mapped[int] = mapped_column(primary_key=True)
    plan_id: Mapped[int] = mapped_column(ForeignKey("plans.id"), index=True)
    patient_id: Mapped[int] = mapped_column(ForeignKey("patients.id"), index=True)
    title: Mapped[str] = mapped_column(String(128))
    due_date: Mapped[date] = mapped_column(Date)
    status: Mapped[str] = mapped_column(String(16), default="Due", index=True)  # Due|Done|Missed|Escalated
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.now)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.now, onupdate=datetime.now)

    plan: Mapped[Plan] = relationship(back_populates="tasks")
    patient: Mapped[Patient] = relationship(back_populates="tasks")


class Review(Base):
    __tablename__ = "reviews"

    id: Mapped[int] = mapped_column(primary_key=True)
    plan_id: Mapped[int] = mapped_column(ForeignKey("plans.id"), index=True)
    patient_id: Mapped[int] = mapped_column(ForeignKey("patients.id"), index=True)
    decision: Mapped[str] = mapped_column(String(16))  # Approved | Edited | Rejected
    role: Mapped[str] = mapped_column(String(16))
    actor: Mapped[str] = mapped_column(String(64))
    note: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.now)


class AuditLog(Base):
    __tablename__ = "audit_log"

    id: Mapped[int] = mapped_column(primary_key=True)
    role: Mapped[str] = mapped_column(String(16))
    actor: Mapped[str] = mapped_column(String(64))
    patient_id: Mapped[int | None] = mapped_column(Integer, index=True, nullable=True)
    entity: Mapped[str] = mapped_column(String(16))  # plan | task
    entity_id: Mapped[int] = mapped_column(Integer)
    field: Mapped[str] = mapped_column(String(24))
    old_value: Mapped[str | None] = mapped_column(String(64), nullable=True)
    new_value: Mapped[str | None] = mapped_column(String(64), nullable=True)
    note: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.now, index=True)
