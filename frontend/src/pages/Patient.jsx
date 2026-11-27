import React, { useEffect, useState } from "react";
import { api, pct } from "../api.js";
import { AssumptionTag, ErrorBox, Spinner, StatusChip } from "../components/bits.jsx";

function RiskGauge({ value }) {
  const safeValue = Math.max(0, Math.min(1, Number(value) || 0));
  const percent = safeValue * 100;
  const radius = 43;
  const circumference = Math.PI * radius;
  const offset = circumference * (1 - safeValue);
  return (
    <div className="patient-gauge" aria-label={`Calibrated 30-day readmission risk ${percent.toFixed(1)} percent`}>
      <svg viewBox="0 0 100 62" role="img" aria-hidden="true">
        <path d="M 7 55 A 43 43 0 0 1 93 55" fill="none" stroke="#DCE5EB" strokeWidth="9" strokeLinecap="round" />
        <path d="M 7 55 A 43 43 0 0 1 93 55" fill="none" stroke="#0F766E" strokeWidth="9" strokeLinecap="round" strokeDasharray={circumference} strokeDashoffset={offset} />
      </svg>
      <div className="patient-gauge-value">{pct(safeValue, 1)}</div>
      <div className="patient-gauge-caption">calibrated · 30 days</div>
    </div>
  );
}

function RiskTier({ prediction }) {
  if (!prediction) return <span className="patient-tier neutral">No score</span>;
  const cutoff = Number(prediction.high_risk_cutoff);
  const risk = Number(prediction.risk_calibrated);
  const tier = prediction.high_risk
    ? "High"
    : Number.isFinite(cutoff) && cutoff > 0 && risk >= cutoff * 0.5
      ? "Medium"
      : "Low";
  return <span className={`patient-tier ${tier.toLowerCase()}`}>{tier} tier</span>;
}

function ConceptBars({ bars }) {
  const sorted = [...bars].sort((a, b) => Math.abs(b.shap) - Math.abs(a.shap)).slice(0, 8);
  const max = Math.max(0.0001, ...sorted.map((bar) => Math.abs(bar.shap)));
  if (!sorted.length) return <div className="patient-empty">No SHAP explanation is available for this record.</div>;
  return (
    <div className="patient-shap-list">
      {sorted.map((bar) => (
        <div className="patient-shap-row" key={bar.concept} title={bar.why || bar.concept}>
          <div className="patient-shap-label">
            <span>{bar.concept}</span>
            <strong>{bar.shap >= 0 ? "+" : ""}{Number(bar.shap).toFixed(3)}</strong>
          </div>
          <div className="patient-shap-track">
            <div
              className={bar.modifiable ? "patient-shap-fill modifiable" : "patient-shap-fill fixed"}
              style={{ width: `${(Math.abs(bar.shap) / max) * 100}%` }}
            />
          </div>
        </div>
      ))}
      <div className="patient-shap-legend">
        <span><i className="modifiable" /> Modifiable</span>
        <span><i className="fixed" /> Fixed</span>
        <b>Can we change it?</b>
      </div>
      <p className="patient-muted patient-footnote">SHAP describes contribution to this model score; it is not a cause or a treatment effect.</p>
    </div>
  );
}

function TimingStrip({ timing }) {
  const horizon = Math.max(1, Number(timing?.horizon_days) || 30);
  const items = timing?.items || [];
  const selected = items.find((item) => item.selected) || null;
  const cells = Array.from({ length: 30 }, (_, index) => index + 1);
  const inWindow = (day) => selected && day >= Number(selected.start_day) && day <= Number(selected.end_day);
  return (
    <div className="patient-timing">
      <div className="patient-timing-labels"><span>Discharge · {timing?.day_zero || "date not supplied"}</span><span>Day {horizon}</span></div>
      <div className="patient-timing-cells" role="img" aria-label="Thirty-day timeline. Teal cells mark the selected intervention window.">
        {cells.map((day) => (
          <div key={day} className={`patient-day-cell ${day <= horizon ? "" : "outside"} ${inWindow(day) ? "active" : ""}`}>
            <span>{day}</span>
          </div>
        ))}
      </div>
      <div className="patient-timing-legend">
        <span><i className="active" /> Selected action window</span>
        <span><i className="early" /> Early readmission window (days 1–7)</span>
      </div>
      {selected ? (
        <p className="patient-muted patient-footnote">
          {selected.name}: days {selected.start_day}–{selected.end_day}. <AssumptionTag />
        </p>
      ) : (
        <p className="patient-muted patient-footnote">No selected action window is available. This strip is visual only and does not change risk.</p>
      )}
    </div>
  );
}

function LookalikeCard({ lookalike }) {
  if (!lookalike) return null;
  return (
    <section className="patient-panel patient-lookalike">
      <div className="patient-panel-heading">
        <div><span className="patient-eyebrow">REFERENCE COHORT</span><h2>Patients like this</h2></div>
        <AssumptionTag />
      </div>
      <p className="patient-lookalike-line">{lookalike.line}</p>
      <div className="patient-lookalike-list">
        {(lookalike.cards || []).map((card, index) => (
          <div className="patient-lookalike-row" key={`${card.age}-${index}`}>
            <span>Age {card.age}</span>
            <span>{(card.top_drivers || []).join(", ") || "No listed drivers"}</span>
            <strong className={String(card.outcome).startsWith("readmitted") ? "outcome-risk" : ""}>{card.outcome}</strong>
          </div>
        ))}
      </div>
      <p className="patient-muted patient-footnote">{lookalike.label} Similar history is descriptive only; it does not explain or predict this patient.</p>
    </section>
  );
}

function PatientStyles() {
  return (
    <style>{`
      .patient-page{display:flex;flex-direction:column;gap:18px;padding-bottom:100px;color:#0F172A}
      .patient-topline{display:flex;align-items:center;gap:12px;flex-wrap:wrap}
      .patient-back{border:0;background:transparent;color:#0F766E;font-size:13px;font-weight:700;padding:7px 0}
      .patient-id{font-size:14px;font-weight:800;color:#0B2545;letter-spacing:.01em}
      .patient-hero{display:grid;grid-template-columns:minmax(0,1.15fr) minmax(220px,.85fr);gap:22px;align-items:center;padding:25px 28px;border-radius:24px;background:linear-gradient(115deg,#0B2545,#123D5A);color:#FFFFFF;box-shadow:0 12px 30px rgba(11,37,69,.14)}
      .patient-eyebrow{display:block;color:#8DD5C8;font-size:10px;font-weight:800;letter-spacing:.13em}
      .patient-hero h2{margin:8px 0 6px;color:#FFFFFF;font-size:23px;font-weight:700;letter-spacing:-.035em}
      .patient-hero-copy{margin:0;color:#D3E0E9;font-size:13px;line-height:1.6;max-width:600px}
      .patient-hero-meta{display:flex;gap:8px;flex-wrap:wrap;margin-top:16px}
      .patient-hero-meta span{padding:6px 10px;border:1px solid rgba(255,255,255,.18);border-radius:999px;background:rgba(255,255,255,.08);color:#F0F7FA;font-size:11px;font-weight:600}
      .patient-risk-side{display:flex;align-items:center;justify-content:space-around;gap:12px;padding:10px 0}
      .patient-gauge{position:relative;width:160px;min-width:140px;text-align:center}
      .patient-gauge svg{display:block;width:100%;overflow:visible}
      .patient-gauge-value{margin-top:-1px;color:#FFFFFF;font-size:30px;font-weight:800;letter-spacing:-.04em;font-variant-numeric:tabular-nums}
      .patient-gauge-caption{margin-top:2px;color:#C4D5E1;font-size:10px}
      .patient-tier{display:inline-flex;align-items:center;justify-content:center;padding:7px 11px;border:1px solid transparent;border-radius:999px;font-size:11px;font-weight:800;white-space:nowrap}
      .patient-tier.high{background:#FEE2E2;color:#991B1B;border-color:#FECACA}
      .patient-tier.medium{background:#FEF3C7;color:#92400E;border-color:#FDE68A}
      .patient-tier.low{background:#D1FAE5;color:#065F46;border-color:#A7F3D0}
      .patient-tier.neutral{background:#E2E8F0;color:#334155}
      .patient-grid{display:grid;grid-template-columns:minmax(0,1.05fr) minmax(0,.95fr);gap:16px;align-items:stretch}
      .patient-panel{min-width:0;padding:21px 23px;border:1px solid #E2E8F0;border-radius:22px;background:#FFFFFF;box-shadow:0 5px 18px rgba(15,23,42,.045)}
      .patient-panel-heading{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:15px}
      .patient-panel-heading h2{margin:4px 0 0;color:#0B2545;font-size:16px;font-weight:750;letter-spacing:-.02em}
      .patient-panel-heading .patient-eyebrow{color:#0F766E;font-size:9px}
      .patient-muted{color:#475569;font-size:12px;line-height:1.55}
      .patient-footnote{margin:12px 0 0;font-size:11px}
      .patient-shap-list{display:flex;flex-direction:column;gap:12px}
      .patient-shap-label{display:flex;justify-content:space-between;gap:12px;margin-bottom:5px;color:#334155;font-size:12px}
      .patient-shap-label strong{font-variant-numeric:tabular-nums;color:#475569;font-size:11px}
      .patient-shap-track{height:9px;overflow:hidden;border-radius:999px;background:#EEF2F6}
      .patient-shap-fill{height:100%;border-radius:999px}
      .patient-shap-fill.modifiable{background:#0F766E}
      .patient-shap-fill.fixed{background:#64748B}
      .patient-shap-legend{display:flex;align-items:center;gap:14px;flex-wrap:wrap;margin-top:5px;padding-top:12px;border-top:1px solid #EEF2F6;color:#475569;font-size:11px}
      .patient-shap-legend span{display:inline-flex;align-items:center;gap:6px}
      .patient-shap-legend i,.patient-timing-legend i{display:inline-block;width:9px;height:9px;border-radius:3px}
      .patient-shap-legend i.modifiable{background:#0F766E}.patient-shap-legend i.fixed{background:#64748B}
      .patient-action-name{margin:2px 0 8px;color:#0B2545;font-size:20px;font-weight:800;letter-spacing:-.03em}
      .patient-action-metrics{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:9px;margin:15px 0}
      .patient-action-metric{padding:12px;border:1px solid #E5EBF0;border-radius:13px;background:#F8FAFC}
      .patient-action-metric span{display:block;color:#64748B;font-size:10px;font-weight:700}
      .patient-action-metric strong{display:block;margin-top:4px;color:#0B2545;font-size:19px;font-weight:800;font-variant-numeric:tabular-nums}
      .patient-action-note{padding:10px 12px;border-radius:11px;background:#FFF7E8;color:#854D0E;font-size:11px;line-height:1.5}
      .patient-record-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px}
      .patient-record-item{padding:12px;border:1px solid #E8EDF1;border-radius:13px;background:#FFFFFF}
      .patient-record-item span{display:block;color:#64748B;font-size:10px;font-weight:600}
      .patient-record-item strong{display:block;margin-top:5px;color:#1E293B;font-size:13px;font-weight:700;overflow-wrap:anywhere}
      .patient-timing-labels{display:flex;justify-content:space-between;gap:12px;margin-bottom:10px;color:#64748B;font-size:11px}
      .patient-timing-cells{display:grid;grid-template-columns:repeat(30,minmax(0,1fr));gap:4px}
      .patient-day-cell{display:grid;min-width:0;aspect-ratio:1/1;place-items:center;border:1px solid #E2E8F0;border-radius:6px;background:#F8FAFC;color:#64748B;font-size:9px;font-weight:700;font-variant-numeric:tabular-nums}
      .patient-day-cell:nth-child(-n+7){background:#FFF1F2;border-color:#FFE4E6;color:#9F1239}
      .patient-day-cell.active{background:#0F766E;border-color:#0F766E;color:#FFFFFF}
      .patient-day-cell.outside{opacity:.35}
      .patient-timing-legend{display:flex;gap:16px;flex-wrap:wrap;margin-top:12px;color:#475569;font-size:11px}
      .patient-timing-legend span{display:flex;align-items:center;gap:6px}
      .patient-timing-legend i.active{background:#0F766E}.patient-timing-legend i.early{background:#FBCFE8}
      .patient-lookalike-line{margin:0 0 12px;color:#334155;font-size:13px;font-weight:650}
      .patient-lookalike-list{display:flex;flex-direction:column;gap:7px}
      .patient-lookalike-row{display:grid;grid-template-columns:65px minmax(0,1fr) auto;gap:10px;align-items:center;padding:10px;border:1px solid #E8EDF1;border-radius:11px;color:#475569;font-size:11px}
      .patient-lookalike-row strong{color:#64748B;font-size:10px}.patient-lookalike-row strong.outcome-risk{color:#B91C1C}
      .patient-explanation{display:flex;flex-direction:column;gap:10px}
      .patient-explanation li{padding:11px 13px;border-left:3px solid #0F766E;border-radius:0 10px 10px 0;background:#F6FAF9;color:#334155;font-size:12px;line-height:1.55}
      .patient-empty{padding:20px;border:1px dashed #CBD5E1;border-radius:12px;color:#475569;font-size:12px}
      .patient-sticky-actions{position:sticky;bottom:12px;z-index:12;display:flex;align-items:center;justify-content:space-between;gap:14px;padding:13px 16px;border:1px solid #DCE5EA;border-radius:17px;background:rgba(255,255,255,.96);box-shadow:0 10px 30px rgba(11,37,69,.13);backdrop-filter:blur(12px)}
      .patient-sticky-copy{min-width:0;color:#475569;font-size:11px;line-height:1.45}
      .patient-sticky-copy strong{display:block;color:#0B2545;font-size:12px}
      .patient-action-buttons{display:flex;gap:8px;flex-wrap:wrap}
      .patient-action-buttons button{min-height:39px;padding:0 15px;border:1px solid transparent;border-radius:10px;font-size:12px;font-weight:750}
      .patient-action-buttons .approve{background:#0F766E;color:#FFFFFF}.patient-action-buttons .edit{background:#EAF2F8;color:#0B2545;border-color:#D7E3EC}.patient-action-buttons .reject{background:#FFF1F2;color:#B91C1C;border-color:#FECACA}
      .patient-action-buttons button:disabled{opacity:.42;cursor:not-allowed}
      .patient-role-hint{margin-top:7px;color:#92400E;font-size:10px;text-align:right}
      @media(max-width:850px){.patient-hero{grid-template-columns:minmax(0,1fr)}.patient-risk-side{justify-content:flex-start}.patient-grid{grid-template-columns:minmax(0,1fr)}.patient-record-grid{grid-template-columns:repeat(2,minmax(0,1fr))}}
      @media(max-width:560px){.patient-hero{padding:20px}.patient-panel{padding:17px}.patient-record-grid{grid-template-columns:minmax(0,1fr) minmax(0,1fr)}.patient-day-cell{font-size:7px;border-radius:4px}.patient-timing-cells{gap:2px}.patient-sticky-actions{align-items:stretch;flex-direction:column}.patient-action-buttons{display:grid;grid-template-columns:repeat(3,minmax(0,1fr))}.patient-action-buttons button{padding:0 7px}.patient-lookalike-row{grid-template-columns:52px minmax(0,1fr)}.patient-lookalike-row strong{grid-column:2}}
      @media(prefers-reduced-motion:reduce){.patient-page *{scroll-behavior:auto!important;transition:none!important}}
    `}</style>
  );
}

export default function Patient({ patientId, role, onBack }) {
  const [p, setP] = useState(null);
  const [error, setError] = useState(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  const load = () => {
    if (!patientId) return;
    api(`/patient/${patientId}`)
      .then((data) => {
        setP(data);
        setError(null);
      })
      .catch((err) => setError(err.message));
  };

  useEffect(() => {
    load();
  }, [patientId]);

  const decide = async (action) => {
    if (!p?.plan || role !== "clinician") return;
    setBusy(true);
    try {
      await api(`/plan/${p.plan.id}/decision`, {
        method: "POST",
        body: { action, note: note || null },
      });
      setNote("");
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  if (!p) {
    return (
      <div className="space-y-3">
        <button onClick={onBack} className="patient-back">← Back to worklist</button>
        {error ? <ErrorBox message={error} /> : <Spinner label="Loading patient record…" />}
      </div>
    );
  }

  const pred = p.prediction;
  const plan = p.plan;
  const canAct = role === "clinician" && Boolean(plan);
  const recommended = plan?.intervention
    || p.matched_interventions?.find((item) => item.is_best)
    || p.matched_interventions?.[0]
    || null;
  const demographics = p.demographics || {};
  const riskTierText = pred?.high_risk ? "High-risk flag · clinician review" : "Below model high-risk cutoff";

  return (
    <div className="patient-page">
      <PatientStyles />
      <div className="patient-topline">
        <button onClick={onBack} className="patient-back">← Back to worklist</button>
        <span className="patient-id">Patient #{p.patient_nbr}</span>
        {plan && <StatusChip status={plan.status} />}
      </div>

      <ErrorBox message={error} />

      <section className="patient-hero">
        <div>
          <span className="patient-eyebrow">PATIENT RISK OVERVIEW</span>
          <h2>30-day readmission risk</h2>
          <p className="patient-hero-copy">
            {pred
              ? "Calibrated model score with the current review state and recommended care-coordination action."
              : "This patient is not in the held-out test split, so no calibrated prediction is available."}
          </p>
          <div className="patient-hero-meta">
            <span>{plan ? `Review: ${plan.status}` : "No active plan"}</span>
            {pred && <span>{riskTierText}</span>}
            {pred && <span>Raw model {pct(pred.risk_raw, 1)}</span>}
          </div>
        </div>
        <div className="patient-risk-side">
          {pred ? <RiskGauge value={pred.risk_calibrated} /> : <div className="patient-empty">No score available</div>}
          <div>
            <RiskTier prediction={pred} />
            {pred && <p className="patient-gauge-caption">High-risk cutoff {pct(pred.high_risk_cutoff, 1)}</p>}
          </div>
        </div>
      </section>

      <div className="patient-grid">
        <section className="patient-panel" data-demo-target="patient-drivers">
          <div className="patient-panel-heading">
            <div><span className="patient-eyebrow">MODEL EXPLANATION</span><h2>Why this risk?</h2></div>
            <span className="patient-muted">SHAP concepts</span>
          </div>
          <ConceptBars bars={p.concept_bars || []} />
          <p className="patient-muted patient-footnote">{p.history_label}</p>
        </section>

        <section className="patient-panel">
          <div className="patient-panel-heading">
            <div><span className="patient-eyebrow">CARE COORDINATION</span><h2>Recommended action</h2></div>
            {recommended && <AssumptionTag />}
          </div>
          {recommended ? (
            <>
              <div className="patient-action-name">{recommended.name}</div>
              <p className="patient-muted">Matched to the patient's modifiable model drivers and the intervention catalogue.</p>
              <div className="patient-action-metrics">
                <div className="patient-action-metric"><span>Coordinator time</span><strong>{recommended.minutes} min</strong></div>
                <div className="patient-action-metric"><span>Action window</span><strong>Day {recommended.window_start_day}–{recommended.window_end_day}</strong></div>
              </div>
              <div className="patient-action-note">
                Effect range {recommended.effect_label || "from intervention catalogue"} is an assumed effect, not a clinical prediction or proven outcome.
              </div>
              {plan && <p className="patient-muted patient-footnote">Current plan status: <strong>{plan.status}</strong>{plan.note ? ` · ${plan.note}` : ""}</p>}
            </>
          ) : (
            <div className="patient-empty">No eligible intervention is available from the current record and catalogue.</div>
          )}
        </section>
      </div>

      <section className="patient-panel">
        <div className="patient-panel-heading">
          <div><span className="patient-eyebrow">PATIENT RECORD</span><h2>Clinical context</h2></div>
        </div>
        <div className="patient-record-grid">
          <div className="patient-record-item"><span>Age band</span><strong>{demographics.age ?? "—"}</strong></div>
          <div className="patient-record-item"><span>Gender / race</span><strong>{[demographics.gender, demographics.race].filter(Boolean).join(" / ") || "—"}</strong></div>
          <div className="patient-record-item"><span>Medical specialty</span><strong>{demographics.medical_specialty || "—"}</strong></div>
          <div className="patient-record-item"><span>Diagnosis group</span><strong>{demographics.diag_group || "—"}</strong></div>
          <div className="patient-record-item"><span>Length of stay</span><strong>{demographics.time_in_hospital ?? "—"} days</strong></div>
          <div className="patient-record-item"><span>Medications</span><strong>{demographics.num_medications ?? "—"}</strong></div>
          <div className="patient-record-item"><span>Prior inpatient visits</span><strong>{demographics.number_inpatient ?? "—"}</strong></div>
          <div className="patient-record-item"><span>Prior outpatient visits</span><strong>{demographics.number_outpatient ?? "—"}</strong></div>
          <div className="patient-record-item"><span>Active drugs in record</span><strong>{demographics.active_drugs?.length ?? 0}</strong></div>
        </div>
      </section>

      <LookalikeCard lookalike={p.lookalike} />

      <section className="patient-panel">
        <div className="patient-panel-heading">
          <div><span className="patient-eyebrow">CARE WINDOW</span><h2>30-day timing strip</h2></div>
          <span className="patient-muted">Visual only</span>
        </div>
        <TimingStrip timing={p.timing || {}} />
      </section>

      <div className="patient-grid">
        <section className="patient-panel">
          <div className="patient-panel-heading"><div><span className="patient-eyebrow">EXPLANATION</span><h2>Risk explanation</h2></div><span className="patient-muted">Code-generated</span></div>
          {p.explanation?.length ? (
            <ol className="patient-explanation">{p.explanation.map((line, index) => <li key={index}>{line.text}</li>)}</ol>
          ) : <div className="patient-empty">No explanation lines are available.</div>}
          <p className="patient-muted patient-footnote">Facts come from the record and actions from the intervention catalogue. Demographics never map to an action.</p>
        </section>

        <section className="patient-panel">
          <div className="patient-panel-heading"><div><span className="patient-eyebrow">AUDIT TRAIL</span><h2>Recent decisions</h2></div></div>
          {p.audit?.length ? (
            <div className="space-y-2">
              {p.audit.slice(0, 8).map((entry) => (
                <div key={entry.id} className="border-b border-slate-100 pb-2 text-xs text-slate-600">
                  <strong className="text-slate-800">{entry.role}</strong> · {entry.entity} #{entry.entity_id} · {entry.field}: {entry.old_value ?? "—"} → {entry.new_value ?? "—"}
                  <div className="mt-1 text-slate-500">{String(entry.created_at).slice(0, 16).replace("T", " ")}{entry.note ? ` · ${entry.note}` : ""}</div>
                </div>
              ))}
            </div>
          ) : <div className="patient-empty">No audit entries for this patient.</div>}
        </section>
      </div>

      <section className="patient-panel">
        <div className="patient-panel-heading"><div><span className="patient-eyebrow">FOLLOW-UP</span><h2>Scheduled tasks</h2></div></div>
        {p.tasks?.length ? (
          <div className="space-y-2">
            {p.tasks.map((task) => (
              <div key={task.id} className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 py-2 text-sm">
                <span className="font-semibold text-slate-800">{task.title}</span>
                <span className="flex items-center gap-2 text-xs text-slate-600">Due {task.due_date} <StatusChip status={task.status} /></span>
              </div>
            ))}
          </div>
        ) : <div className="patient-empty">No follow-up tasks yet. Tasks are created when a plan is approved or edited.</div>}
      </section>

      <section className="patient-panel">
        <div className="patient-panel-heading"><div><span className="patient-eyebrow">CLINICIAN WORKFLOW</span><h2>Review decision</h2></div>{plan && <StatusChip status={plan.status} />}</div>
        {plan ? (
          <>
            <p className="patient-muted">Plan: <strong className="text-slate-900">{plan.intervention.name}</strong> · {plan.minutes} minutes · priority score {Number(plan.priority_score).toFixed(4)}. Priority is a ranking score, not a prediction.</p>
            <label className="block mt-3 text-xs font-semibold text-slate-600" htmlFor="patient-review-note">Review note</label>
            <input id="patient-review-note" value={note} onChange={(event) => setNote(event.target.value)} placeholder="Optional note recorded in the audit log" className="mt-1 w-full min-h-11 px-3 py-2 border border-slate-300 rounded-xl text-sm" />
          </>
        ) : <div className="patient-empty">No plan exists for this patient. There is no decision to approve, edit or reject.</div>}
        {!canAct && plan && <p className="patient-muted mt-3">Clinician approval required. Switch to the Clinician role to take a review action.</p>}
      </section>

      <div className="patient-sticky-actions">
        <div className="patient-sticky-copy">
          <strong>{plan ? `Plan status: ${plan.status}` : "No reviewable plan"}</strong>
          {role === "clinician" ? "Clinician actions are recorded in the audit log." : "Clinician approval required to change this plan."}
        </div>
        <div>
          <div className="patient-action-buttons">
            <button className="approve" disabled={!canAct || busy} title={!canAct ? "Clinician approval required" : "Approve this plan"} onClick={() => decide("approve")}>{busy ? "Saving…" : "Approve"}</button>
            <button className="edit" disabled={!canAct || busy} title={!canAct ? "Clinician approval required" : "Mark this plan as edited"} onClick={() => decide("edit")}>Edit</button>
            <button className="reject" disabled={!canAct || busy} title={!canAct ? "Clinician approval required" : "Reject this plan"} onClick={() => decide("reject")}>Reject</button>
          </div>
          {!canAct && <div className="patient-role-hint">Clinician approval required</div>}
        </div>
      </div>
    </div>
  );
}
