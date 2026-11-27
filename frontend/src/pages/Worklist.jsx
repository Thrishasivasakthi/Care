import React, { useCallback, useEffect, useMemo, useState } from "react";
import { api, pct } from "../api.js";
import { Card, ErrorBox, Spinner, StatusChip } from "../components/bits.jsx";

function DeltaPill({ value, suffix = "" }) {
  const positive = Number(value) > 0;
  const negative = Number(value) < 0;
  return (
    <span className={`delta-pill ${positive ? "positive" : negative ? "negative" : "neutral"}`}>
      <span aria-hidden="true">{positive ? "↑" : negative ? "↓" : "—"}</span>
      {positive || negative ? Math.abs(Number(value)).toFixed(1) : "0"}{suffix}
    </span>
  );
}

function RiskMeter({ value }) {
  const n = Math.max(0, Math.min(1, Number(value) || 0));
  const color = n >= .3 ? "#DC2626" : n >= .15 ? "#D97706" : "#16A34A";
  return <div className="work-risk">
    <span className="work-risk-track"><span style={{ width: `${n * 100}%`, background: color }} /></span>
    <strong>{pct(n, 1)}</strong>
  </div>;
}

function ComparisonBar({ label, care, risk, format = (n) => String(n) }) {
  const max = Math.max(Number(care) || 0, Number(risk) || 0, .0001);
  return <div className="comparison-row">
    <div className="comparison-label">{label}</div>
    <div className="comparison-track-group">
      <div className="comparison-track care"><span style={{ width: `${Math.max(0, Number(care) || 0) / max * 100}%` }} /></div>
      <div className="comparison-track risk"><span style={{ width: `${Math.max(0, Number(risk) || 0) / max * 100}%` }} /></div>
    </div>
    <div className="comparison-values"><strong>{format(care)}</strong><span>{format(risk)}</span></div>
  </div>;
}

function policyValue(comparison, name, field) {
  const row = comparison.find((item) => /caretrace/i.test(item.policy) === (name === "caretrace"));
  return Number(row?.[field]) || 0;
}

export default function Worklist({ role, onOpenPatient }) {
  const [hours, setHours] = useState(4);
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  const load = useCallback((h) => {
    api(`/worklist?hours=${h}`)
      .then((d) => {
        setData(d);
        setError(null);
      })
      .catch((e) => setError(e.message));
  }, []);

  useEffect(() => {
    load(hours);
  }, [hours, load]);

  const metrics = useMemo(() => {
    if (!data) return null;
    const comparison = data.comparison || [];
    const careCalls = policyValue(comparison, "caretrace", "calls_made");
    const riskCalls = policyValue(comparison, "risk-only", "calls_made");
    const careReached = policyValue(comparison, "caretrace", "readmissions_reached");
    const riskReached = policyValue(comparison, "risk-only", "readmissions_reached");
    const careAvoided = policyValue(comparison, "caretrace", "expected_avoided_readmissions");
    const riskAvoided = policyValue(comparison, "risk-only", "expected_avoided_readmissions");
    const used = (data.selection || []).reduce((sum, row) => sum + (Number(row.minutes) || 0), 0);
    const lift = riskAvoided > 0 ? ((careAvoided - riskAvoided) / riskAvoided) * 100 : null;
    return { careCalls, riskCalls, careReached, riskReached, careAvoided, riskAvoided, used, lift };
  }, [data]);

  return (
    <div className="worklist-page">
      <ErrorBox message={error} />

      {!data ? <Spinner label="Loading worklist…" /> : (
        <>
          <div className="worklist-hero-grid">
            <Card title="Why not just call the sickest?" className="worklist-hero-card">
              <div className="hero-metric-heading">Expected avoided readmissions</div>
              <div className="hero-metric-line">
                <div className="hero-number">{metrics.careAvoided.toFixed(2)}</div>
                {metrics.lift !== null && <DeltaPill value={metrics.lift} suffix="% vs risk-only" />}
              </div>
              <div className="comparison-legend">
                <span><i className="legend-swatch care" />CareTrace</span>
                <span><i className="legend-swatch risk" />Risk-only</span>
              </div>
              <div className="comparison-bars">
                <ComparisonBar label="Calls made" care={metrics.careCalls} risk={metrics.riskCalls} />
                <ComparisonBar label="Readmissions reached" care={metrics.careReached} risk={metrics.riskReached} />
                <ComparisonBar label="Avoided per hour" care={policyValue(data.comparison || [], "caretrace", "expected_avoided_per_hour")} risk={policyValue(data.comparison || [], "risk-only", "expected_avoided_per_hour")} format={(n) => Number(n || 0).toFixed(3)} />
              </div>
              <p className="worklist-footnote">Reached uses held-out readmission outcomes. Avoided estimates use assumed intervention effects.</p>
            </Card>

            <div className="worklist-insight-card">
              <div className="insight-kicker">200-day replay context</div>
              <div className="insight-number">{metrics.lift === null ? "—" : `${metrics.lift >= 0 ? "+" : ""}${metrics.lift.toFixed(1)}%`}</div>
              <p>{metrics.lift === null
                ? "A risk-only comparison is not available for this budget."
                : `CareTrace's estimated avoided readmissions are ${Math.abs(metrics.lift).toFixed(1)}% ${metrics.lift >= 0 ? "higher" : "lower"} than the risk-only list for this worklist budget.`}</p>
              <span className="insight-assumption">ⓘ Based on assumed effects</span>
              <div className="insight-orb insight-orb-one" />
              <div className="insight-orb insight-orb-two" />
            </div>
          </div>

          <div className="worklist-kpis">
            <div className="worklist-kpi">
              <div className="kpi-label"><i className="kpi-dot amber" />Unreviewed flags</div>
              <div className="kpi-value">{data.unreviewed_flags ?? "—"}</div>
              <div className="kpi-detail">Awaiting clinician review</div>
            </div>
            <div className="worklist-kpi">
              <div className="kpi-label">Patients selected</div>
              <div className="kpi-value">{data.selection.length}<span className="kpi-total"> / {data.cohort_size}</span></div>
              <div className="kpi-detail">Eligible for a matched action</div>
            </div>
            <div className="worklist-kpi">
              <div className="kpi-label">Minutes used</div>
              <div className="kpi-value">{metrics.used}<span className="kpi-total"> / {data.budget_minutes}</span></div>
              <div className="kpi-progress"><span style={{ width: `${Math.min(100, data.budget_minutes ? metrics.used / data.budget_minutes * 100 : 0)}%` }} /></div>
            </div>
          </div>

          <div className="worklist-toolbar">
            <div className="toolbar-title">
              <strong>Coordinator time</strong>
              <span>Set the time available for follow-up today</span>
            </div>
            <div className="toolbar-slider">
              <input id="hours" type="range" min="1" max="8" step="1" value={hours} onChange={(e) => setHours(Number(e.target.value))} aria-label="Coordinator hours today" />
              <div className="slider-ticks"><span>1</span><span>2</span><span>4</span><span>6</span><span>8 h</span></div>
            </div>
            <span className="hours-value">{hours} h ({hours * 60} min)</span>
            <button className="toolbar-reset" type="button" onClick={() => setHours(4)}>Reset</button>
          </div>

          <Card title={`Optimizer selection · ${data.selection.length} patients`} right={<span className="table-context">Ranked within {hours} h · {data.elapsed_ms} ms</span>}>
            <div className="overflow-x-auto">
              <table className="compact worklist-table w-full text-sm">
                <thead><tr>
                  <th>#</th><th>Patient</th><th>Risk</th><th>Top modifiable driver</th><th>Matched action</th><th className="text-right">Min</th><th>Status</th><th className="text-right">vs risk-only</th>
                </tr></thead>
                <tbody>
                  {data.selection.map((r) => (
                    <tr key={r.patient_id} onClick={() => onOpenPatient(r.patient_id)} tabIndex={0} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onOpenPatient(r.patient_id); } }}>
                      <td><span className="rank-circle">{r.rank}</span></td>
                      <td><strong className="patient-id">#{r.patient_nbr}</strong></td>
                      <td><RiskMeter value={r.risk} /></td>
                      <td><span className="work-driver-chip">{r.driver || "—"}</span></td>
                      <td><div className="action-cell"><strong>{r.action?.name || "—"}</strong>{r.action?.effect_label && <span>{r.action.effect_label} assumed</span>}</div></td>
                      <td className="text-right tabular-nums">{r.minutes ?? "—"}</td>
                      <td><StatusChip status={r.status} /></td>
                      <td className="text-right"><DeltaPill value={r.delta} /></td>
                    </tr>
                  ))}
                  {data.selection.length === 0 && <tr><td colSpan="8" className="py-8 text-center text-slate-500">No eligible actions for this budget.</td></tr>}
                </tbody>
              </table>
            </div>
            <div className="table-note">Rows promoted by CareTrace have modifiable drivers that make follow-up more worthwhile than raw risk alone. Demoted rows may have high risk but fewer actionable drivers. {role === "coordinator" && <span>Switch to Clinician to approve, edit or reject flags.</span>}</div>
          </Card>

          <details className="no-driver-accordion">
            <summary>
              <span><strong>{data.no_modifiable_driver.length} patients have no modifiable driver</strong><small>These patients are not considered safe; the current intervention catalog has no matching action.</small></span>
              <span className="accordion-chevron">⌄</span>
            </summary>
            <div className="no-driver-content">
              <div className="overflow-x-auto">
                <table className="compact w-full text-sm">
                  <thead><tr><th>Patient</th><th>Risk</th><th>Why</th></tr></thead>
                  <tbody>{data.no_modifiable_driver.map((r) => (
                    <tr key={r.patient_id} onClick={() => onOpenPatient(r.patient_id)} className="cursor-pointer">
                      <td><strong>#{r.patient_nbr}</strong></td>
                      <td><RiskMeter value={r.risk} /></td>
                      <td className="text-slate-600">No positive modifiable SHAP driver matched by the intervention catalog.</td>
                    </tr>
                  ))}</tbody>
                </table>
              </div>
            </div>
          </details>
        </>
      )}
    </div>
  );
}
