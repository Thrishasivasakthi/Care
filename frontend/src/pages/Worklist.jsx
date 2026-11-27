import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
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
  const careValue = Math.max(0, Number(care) || 0);
  const riskValue = Math.max(0, Number(risk) || 0);
  const max = Math.max(careValue, riskValue, 0.0001);
  const rows = [
    { name: "CareTrace", value: careValue, color: "#0F766E" },
    { name: "Risk-only", value: riskValue, color: "#94A3B8" },
  ];

  return (
    <div style={{ display: "grid", gap: 9 }}>
      <div style={{ color: "#334155", fontSize: 12, fontWeight: 600 }}>{label}</div>
      {rows.map((row) => {
        const width = row.value > 0 ? Math.max(2, row.value / max * 100) : 0;
        return (
          <div key={row.name} style={{ display: "grid", gridTemplateColumns: "78px minmax(0,1fr)", alignItems: "center", gap: 10 }}>
            <span style={{ color: "#475569", fontSize: 11, whiteSpace: "nowrap" }}>{row.name}</span>
            <div style={{ position: "relative", height: 13, paddingRight: 48 }}>
              <div style={{ position: "absolute", inset: "2px 48px 2px 0", borderRadius: 999, background: "#F1F5F9" }}>
                <span style={{ display: "block", width: width + "%", height: "100%", borderRadius: 999, background: row.color }} />
              </div>
              <strong style={{ position: "absolute", left: "calc(" + width + "% + 7px)", top: -3, color: "#334155", fontSize: 11, fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>
                {format(row.value)}
              </strong>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function policyValue(comparison, name, field) {
  const row = comparison.find((item) => /caretrace/i.test(item.policy) === (name === "caretrace"));
  return Number(row?.[field]) || 0;
}

function useReducedMotion() {
  const [reduced, setReduced] = useState(() =>
    typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduced(media.matches);
    update();
    media.addEventListener?.("change", update);
    return () => media.removeEventListener?.("change", update);
  }, []);
  return reduced;
}

function CountUp({ value, duration = 400, decimals = 0 }) {
  const reducedMotion = useReducedMotion();
  const target = Number(value) || 0;
  const [display, setDisplay] = useState(target);
  const previous = useRef(target);

  useEffect(() => {
    const from = previous.current;
    previous.current = target;
    if (reducedMotion || from === target) {
      setDisplay(target);
      return undefined;
    }
    let frame = 0;
    const started = performance.now();
    const tick = (now) => {
      const progress = Math.min(1, (now - started) / duration);
      const eased = 1 - Math.pow(1 - progress, 3);
      setDisplay(from + (target - from) * eased);
      if (progress < 1) frame = requestAnimationFrame(tick);
      else setDisplay(target);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [target, duration, reducedMotion]);

  return <>{display.toFixed(decimals)}</>;
}

function RankMovement({ movement }) {
  if (!movement) return null;
  return (
    <span className={`rank-movement ${movement.delta > 0 ? "up" : "down"}`} aria-label={`Moved ${Math.abs(movement.delta)} positions ${movement.delta > 0 ? "up" : "down"}`}>
      <span aria-hidden="true">{movement.delta > 0 ? "↑" : "↓"}</span>
      {Math.abs(movement.delta)}
    </span>
  );
}

export default function Worklist({ role, onOpenPatient }) {
  const [hours, setHours] = useState(4);
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const reducedMotion = useReducedMotion();
  const tableRef = useRef(null);
  const rowRefs = useRef(new Map());
  const previousRects = useRef(new Map());
  const previousRanks = useRef(new Map());
  const previousSelected = useRef(new Set());
  const [rankMovements, setRankMovements] = useState({});
  const [enteredIds, setEnteredIds] = useState([]);

  const load = useCallback((h) => {
    api(`/worklist?hours=${h}`)
      .then((d) => {
        if (tableRef.current && !reducedMotion) {
          const rects = new Map();
          tableRef.current.querySelectorAll("tbody tr[data-patient-id]").forEach((row) => {
            rects.set(String(row.dataset.patientId), row.getBoundingClientRect());
          });
          previousRects.current = rects;
        }
        setData(d);
        setError(null);
      })
      .catch((e) => setError(e.message));
  }, [reducedMotion]);

  useEffect(() => {
    load(hours);
  }, [hours, load]);


  useLayoutEffect(() => {
    if (!data || !tableRef.current) return;
    const rows = Array.from(tableRef.current.querySelectorAll("tbody tr[data-patient-id]"));
    const nextRanks = new Map();
    const nextSelected = new Set((data.selection || []).map((row) => String(row.patient_id)));
    const moved = {};
    const entered = [];

    rows.forEach((row) => {
      const id = String(row.dataset.patientId);
      const rank = Number(row.dataset.rank);
      nextRanks.set(id, rank);
      const oldRect = previousRects.current.get(id);
      const newRect = row.getBoundingClientRect();
      if (!reducedMotion && oldRect && oldRect.top !== newRect.top) {
        const deltaY = oldRect.top - newRect.top;
        row.animate(
          [{ transform: `translateY(${deltaY}px)` }, { transform: "translateY(0)" }],
          { duration: 300, easing: "cubic-bezier(0.2, 0.75, 0.25, 1)" }
        );
      }
      const oldRank = previousRanks.current.get(id);
      if (oldRank !== undefined && oldRank !== rank) moved[id] = { delta: oldRank - rank };
      if (!previousSelected.current.has(id)) entered.push(id);
    });

    previousRanks.current = nextRanks;
    previousSelected.current = nextSelected;
    previousRects.current = new Map(rows.map((row) => [String(row.dataset.patientId), row.getBoundingClientRect()]));
    setRankMovements(moved);
    setEnteredIds(entered);

    if (!reducedMotion && Object.keys(moved).length) {
      const timer = window.setTimeout(() => setRankMovements({}), 2000);
      return () => window.clearTimeout(timer);
    }
    return undefined;
  }, [data, reducedMotion]);

  useEffect(() => {
    if (!enteredIds.length || reducedMotion) return undefined;
    const timer = window.setTimeout(() => setEnteredIds([]), 1000);
    return () => window.clearTimeout(timer);
  }, [enteredIds, reducedMotion]);

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
    const avoidedDelta = careAvoided - riskAvoided;
    const lift = riskAvoided > 0 ? (avoidedDelta / riskAvoided) * 100 : null;
    return { careCalls, riskCalls, careReached, riskReached, careAvoided, riskAvoided, avoidedDelta, used, lift };
  }, [data]);

  return (
    <div className="worklist-page">
      <ErrorBox message={error} />

      {!data ? <Spinner label="Loading worklist…" /> : (
        <>
          <div className="worklist-hero-grid" style={{ gridTemplateColumns: "minmax(0, 1fr)" }}>
            <Card title="Why not just call the sickest?" className="worklist-hero-card">
              <div className="hero-metric-heading">Expected avoided readmissions today</div>
              <div className="hero-metric-line" style={{ marginBottom: 8 }}>
                <div className="hero-number">{metrics.careAvoided.toFixed(2)}</div>
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 9, marginBottom: 22 }}>
                <span style={{ color: "#475569", fontSize: 13 }}>
                  Risk-only list: <strong style={{ color: "#334155", fontVariantNumeric: "tabular-nums" }}>{metrics.riskAvoided.toFixed(2)}</strong>
                </span>
                <span className={`delta-pill ${metrics.avoidedDelta > 0 ? "positive" : metrics.avoidedDelta < 0 ? "negative" : "neutral"}`}>
                  <span aria-hidden="true">{metrics.avoidedDelta > 0 ? "↑" : metrics.avoidedDelta < 0 ? "↓" : "—"}</span>
                  {metrics.avoidedDelta > 0 ? "+" : metrics.avoidedDelta < 0 ? "−" : ""}{Math.abs(metrics.avoidedDelta).toFixed(2)} absolute difference
                </span>
                {metrics.lift !== null && <span style={{ color: "#64748B", fontSize: 11 }}>({metrics.lift >= 0 ? "+" : ""}{metrics.lift.toFixed(1)}%)</span>}
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

          </div>

          <div className="worklist-kpis">
            <div className="worklist-kpi">
              <div className="kpi-label"><i className="kpi-dot amber" />Unreviewed flags</div>
              <div className="kpi-value"><CountUp value={data.unreviewed_flags ?? 0} /></div>
              <div className="kpi-detail">Awaiting clinician review</div>
            </div>
            <div className="worklist-kpi">
              <div className="kpi-label">Patients selected</div>
              <div className="kpi-value"><CountUp value={data.selection.length} /><span className="kpi-total"> / {data.cohort_size}</span></div>
              <div className="kpi-detail">Eligible for a matched action</div>
            </div>
            <div className="worklist-kpi">
              <div className="kpi-label">Minutes used</div>
              <div className="kpi-value"><CountUp value={metrics.used} /><span className="kpi-total"> / {data.budget_minutes}</span></div>
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
                <tbody ref={tableRef}>
                  {data.selection.map((r) => (
                    <tr
                      key={r.patient_id}
                      ref={(node) => {
                        if (node) rowRefs.current.set(String(r.patient_id), node);
                        else rowRefs.current.delete(String(r.patient_id));
                      }}
                      data-patient-id={r.patient_id}
                      data-rank={r.rank}
                      className={enteredIds.includes(String(r.patient_id)) ? "worklist-row-entered" : ""}
                      onClick={() => onOpenPatient(r.patient_id)}
                      tabIndex={0} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onOpenPatient(r.patient_id); } }}>
                      <td><span className="rank-cell"><span className="rank-circle">{r.rank}</span><RankMovement movement={rankMovements[String(r.patient_id)]} /></span></td>
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
