import React, { useEffect, useState } from "react";
import {
  Bar, BarChart, CartesianGrid, Cell, ComposedChart, ErrorBar, Line, LineChart,
  ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis, LabelList,
} from "recharts";
import { api, pct } from "../api.js";
import { Card, ErrorBox, Spinner } from "../components/bits.jsx";

const COLORS = { chronological: "#94A3B8", raw_risk: "#2563EB", human: "#64748B", caretrace: "#0F766E" };
const LABELS = { chronological: "Chronological", raw_risk: "Raw risk", human: "Human", caretrace: "CareTrace" };
const POLICY_ORDER = ["chronological", "raw_risk", "human", "caretrace"];

function Kpi({ label, value, detail, tone = "", ring }) {
  return <div className={`ops-kpi ${tone}`}>
    <div className="ops-kpi-label">{label}</div>
    <div className="ops-kpi-value">{value}</div>
    <div className="ops-kpi-detail">{detail}</div>
    {ring !== undefined && <div className="ops-kpi-ring"><span style={{ background: `conic-gradient(#0F766E ${ring * 360}deg,#E7EEF0 0deg)` }}><i /></span></div>}
  </div>;
}

function GrainDefs() {
  return <defs>
    <linearGradient id="opsTeal" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#42A99A" /><stop offset="100%" stopColor="#0F766E" /></linearGradient>
    <pattern id="opsHatch" width="7" height="7" patternUnits="userSpaceOnUse" patternTransform="rotate(35)"><path d="M0 0V7" stroke="#FFFFFF" strokeOpacity=".3" strokeWidth="2" /></pattern>
  </defs>;
}

function PolicyChart({ replay, metricKey, title }) {
  const rows = POLICY_ORDER.filter((key) => replay.policies?.[key]).map((key) => {
    const metric = replay.policies[key][metricKey];
    return { name: LABELS[key] || key, key, mean: metric.mean, range: [Math.max(0, metric.mean - metric.p10), Math.max(0, metric.p90 - metric.mean)], p10: metric.p10, p90: metric.p90 };
  });
  return <div className="ops-policy-chart">
    <h3>{title}</h3>
    <ResponsiveContainer width="100%" height={230}>
      <ComposedChart data={rows} margin={{ top: 24, right: 14, left: -14, bottom: 4 }}>
        <GrainDefs />
        <CartesianGrid vertical={false} stroke="#E8EDF2" strokeDasharray="3 4" />
        <XAxis dataKey="name" tick={{ fontSize: 10, fill: "#64748B" }} axisLine={false} tickLine={false} />
        <YAxis tick={{ fontSize: 10, fill: "#64748B" }} axisLine={false} tickLine={false} />
        <Tooltip formatter={(v, name, item) => [Number(v).toFixed(2), name === "mean" ? `Mean · p10–p90 ${item.payload.p10.toFixed(2)}–${item.payload.p90.toFixed(2)}` : name]} />
        <Bar dataKey="mean" barSize={48} radius={[8, 8, 2, 2]}>
          {rows.map((r) => <Cell key={r.key} fill={r.key === "caretrace" ? "url(#opsTeal)" : COLORS[r.key]} />)}
          <LabelList dataKey="mean" position="top" formatter={(v) => Number(v).toFixed(2)} style={{ fill: "#334155", fontSize: 10, fontWeight: 700 }} />
          <ErrorBar dataKey="range" direction="y" width={8} stroke="#334155" strokeWidth={1.2} />
        </Bar>
      </ComposedChart>
    </ResponsiveContainer>
  </div>;
}

function RateChart({ data, color = "#0F766E" }) {
  const sorted = [...(data || [])].sort((a, b) => b.rate - a.rate);
  return <div className="ops-rate-scroll">
    <ResponsiveContainer width="100%" height={Math.max(210, sorted.length * 31)}>
      <BarChart data={sorted} layout="vertical" margin={{ left: 8, right: 42, top: 4, bottom: 4 }}>
        <defs>
          <linearGradient id="rateGradient" x1="0" y1="0" x2="1" y2="0"><stop offset="0%" stopColor="#0F766E" /><stop offset="100%" stopColor="#53B5A4" /></linearGradient>
          <pattern id="rateHatch" width="7" height="7" patternUnits="userSpaceOnUse" patternTransform="rotate(35)"><path d="M0 0V7" stroke="#FFFFFF" strokeOpacity=".3" strokeWidth="2" /></pattern>
        </defs>
        <CartesianGrid stroke="#E8EDF2" strokeDasharray="3 4" horizontal={false} />
        <XAxis type="number" tickFormatter={(v) => `${(v * 100).toFixed(0)}%`} tick={{ fontSize: 10, fill: "#64748B" }} axisLine={false} tickLine={false} />
        <YAxis type="category" dataKey="name" width={145} tick={{ fontSize: 10, fill: "#475569" }} axisLine={false} tickLine={false} interval={0} />
        <Tooltip formatter={(v, _n, row) => [`${(v * 100).toFixed(1)}% · ${row.payload.readmitted}/${row.payload.patients} patients`, "Readmission rate"]} />
        <Bar dataKey="rate" fill={color} radius={[0, 6, 6, 0]} barSize={17}>
          {sorted.map((row, index) => <Cell key={row.name} fill={color === "#2563EB" ? "#2563EB" : "url(#rateGradient)"} />)}
          <LabelList dataKey="rate" position="right" formatter={(v) => `${(v * 100).toFixed(1)}%`} style={{ fill: "#475569", fontSize: 10 }} />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  </div>;
}

function CalibrationChart({ points }) {
  const data = [...(points || [])].sort((a, b) => a.predicted - b.predicted);
  return <ResponsiveContainer width="100%" height={260}>
    <LineChart data={data} margin={{ top: 12, right: 18, bottom: 8, left: 0 }}>
      <CartesianGrid stroke="#E8EDF2" strokeDasharray="3 4" />
      <XAxis type="number" dataKey="predicted" domain={[0, 1]} tickFormatter={(v) => `${Math.round(v * 100)}%`} tick={{ fontSize: 10, fill: "#64748B" }} label={{ value: "Predicted risk", position: "insideBottom", offset: -4, fontSize: 10, fill: "#64748B" }} />
      <YAxis type="number" dataKey="observed" domain={[0, 1]} tickFormatter={(v) => `${Math.round(v * 100)}%`} tick={{ fontSize: 10, fill: "#64748B" }} label={{ value: "Observed rate", angle: -90, position: "insideLeft", fontSize: 10, fill: "#64748B" }} />
      <Tooltip formatter={(v) => `${(v * 100).toFixed(1)}%`} />
      <ReferenceLine segment={[{ x: 0, y: 0 }, { x: 1, y: 1 }]} stroke="#94A3B8" strokeDasharray="5 5" />
      <Line type="monotone" dataKey="observed" stroke="#0F766E" strokeWidth={2.5} dot={{ r: 4, fill: "#0F766E", stroke: "#FFFFFF", strokeWidth: 2 }} activeDot={{ r: 6 }} />
    </LineChart>
  </ResponsiveContainer>;
}

function InterventionTable() {
  const rows = [
    ["48-hour follow-up call", "Post-discharge contact", "15 min", "5–15%", "Day 2–3"],
    ["Medication reconciliation", "Medication changes", "25 min", "10–20%", "Day 1–5"],
    ["Pharmacist counselling", "Medication understanding", "20 min", "5–15%", "Day 1–7"],
    ["PCP visit within 7 days", "Follow-up access", "20 min", "10–20%", "Day 3–7"],
    ["Home visit", "Home support needs", "45 min", "10–25%", "Day 3–10"],
    ["Care handoff to nursing facility", "Care transition", "20 min", "5–15%", "Day 1–3"],
  ];
  return <div className="overflow-x-auto">
    <table className="compact ops-intervention-table w-full">
      <thead><tr><th>Intervention</th><th>Target driver</th><th>Minutes</th><th>Assumed effect</th><th>Timing</th></tr></thead>
      <tbody>{rows.map((r) => <tr key={r[0]}>{r.map((v, i) => <td key={i}>{i === 3 ? <span className="effect-pill">{v}</span> : v}</td>)}</tr>)}</tbody>
    </table>
    <p className="ops-small-note">Catalog effect ranges are seeded assumptions, not measured treatment effects.</p>
  </div>;
}

export default function Ops() {
  const [ops, setOps] = useState(null);
  const [error, setError] = useState(null);
  const [resetting, setResetting] = useState(false);

  useEffect(() => {
    api("/ops").then(setOps).catch((e) => setError(e.message));
  }, []);

  const resetDemo = async () => {
    if (!confirm("Reset the demo to seeded state?")) return;
    setResetting(true);
    try {
      await api("/demo/reset", { method: "POST" });
      const o = await api("/ops");
      setOps(o);
    } catch (e) {
      setError(e.message);
    } finally {
      setResetting(false);
    }
  };

  if (error) return <ErrorBox message={error} />;
  if (!ops) return <Spinner label="Loading operations data…" />;

  const m = ops.metrics;
  const replay = ops.replay;
  const captureLift = m.top20_capture / .2;
  const care = replay?.policies?.caretrace;
  const raw = replay?.policies?.raw_risk;
  const reachedLead = care && raw ? care.readmissions_reached.mean >= raw.readmissions_reached.mean : false;
  const avoidedLead = care && raw ? care.expected_avoided_readmissions.mean >= raw.expected_avoided_readmissions.mean : false;

  return <div className="ops-page">
    <div className="ops-toolbar">
      <span className="ops-dataset-note">{m.dataset?.patients?.toLocaleString()} patients · {m.n_features} features · seed {m.seed}</span>
      <button onClick={resetDemo} disabled={resetting} className="ops-reset-button">{resetting ? "Resetting…" : "Reset demo"}</button>
    </div>

    <div className="ops-kpi-grid">
      <Kpi label="ROC-AUC" value={m.roc_auc.toFixed(3)} detail="Discrimination · held-out test" />
      <Kpi label="PR-AUC" value={m.pr_auc.toFixed(3)} detail={`Baseline = ${pct(m.base_rate_test, 1)}`} />
      <Kpi label="Base rate" value={pct(m.base_rate_test, 1)} detail="30-day readmission prevalence" />
      <Kpi label="Top-20% capture" value={pct(m.top20_capture, 1)} detail={`${captureLift.toFixed(1)}× better than random`} tone="teal" ring={Math.min(1, m.top20_capture)} />
      <Kpi label="High-risk cutoff" value={pct(m.high_risk_cutoff, 2)} detail={`${m.n_high_risk_test.toLocaleString()} test rows flagged`} />
    </div>

    <div className="ops-main-grid">
      <Card title={`Replay backtest · ${replay ? `${replay.days} simulated days` : "not generated"}`} right={<span className="ops-dataset-note">{replay ? `${replay.cohort_size} patients · ${replay.budget_hours} h budget` : "Replay artifact"}</span>}>
        {!replay ? <p className="ops-empty">Generate the replay artifact to display the historical strategy comparison.</p> : <>
          {replay.warning && <div className="ops-warning">{replay.warning}</div>}
          <div className="ops-winner-pill">{reachedLead && avoidedLead ? "✓ CareTrace leads on both metrics" : "Replay comparison · see both metrics"}</div>
          <div className="ops-replay-charts">
            <PolicyChart replay={replay} metricKey="readmissions_reached" title="Real readmissions reached" />
            <PolicyChart replay={replay} metricKey="expected_avoided_readmissions" title="Expected avoided · assumed effect" />
          </div>
          <p className="ops-footnote">Raw risk may tie on readmissions reached; that is expected. Avoided-readmission estimates multiply held-out outcomes by assumed intervention effects.</p>
          <div className="ops-legend">{POLICY_ORDER.filter((k) => replay.policies?.[k]).map((k) => <span key={k}><i style={{ background: COLORS[k] }} />{LABELS[k]}</span>)}</div>
          <div className="ops-definitions">{replay.metric_definitions.expected} {replay.metric_definitions.eligibility}</div>
        </>}
      </Card>

      <div className="ops-insight-card">
        <span className="ops-insight-kicker">CareTrace vs raw risk</span>
        <strong>{care && raw ? `${raw.readmissions_reached.mean > 0 ? ((care.readmissions_reached.mean - raw.readmissions_reached.mean) / raw.readmissions_reached.mean * 100).toFixed(1) : "—"}%` : "—"}</strong>
        <p>Difference in real readmissions reached across the replay. The result is based on historical held-out labels, not a guarantee of future outcomes.</p>
        <small>ⓘ Replay comparison · historical simulation</small>
      </div>
    </div>

    <div className="ops-secondary-grid">
      <Card title="Calibration" right={<span className="ops-dataset-note">Predicted vs observed</span>}>
        <CalibrationChart points={m.calibration_points} />
        <p className="ops-footnote">Closer to the dashed diagonal indicates better agreement between predicted probabilities and observed readmission rates. n labels are available in the source calibration data.</p>
      </Card>
      <Card title="Limits and honesty">
        <ul className="ops-limits">
          <li><strong>Historical data:</strong> UCI records span 1999–2008.</li>
          <li><strong>Population:</strong> the dataset focuses on diabetes-related hospital encounters and medications.</li>
          <li><strong>Intervention effects:</strong> effect ranges and avoided estimates are assumptions, not causal evidence.</li>
          <li><strong>Clinical use:</strong> decision support only; clinician review is required.</li>
          {(m.notes || []).map((note) => <li key={note}>{note}</li>)}
        </ul>
      </Card>
    </div>

    <div className="ops-rate-grid">
      <Card title="Readmission rate by department" right={<span className="ops-dataset-note">All {ops.departments.length} groups</span>}>
        <RateChart data={ops.departments} />
        <p className="ops-footnote">Missing specialty is grouped as Unknown/General. Sorted by observed readmission rate.</p>
      </Card>
      <Card title="Readmission rate by primary diagnosis group" right={<span className="ops-dataset-note">All {ops.diagnosis_groups.length} groups</span>}>
        <RateChart data={ops.diagnosis_groups} color="#2563EB" />
        <p className="ops-footnote">Primary diagnosis group derived from ICD-9 diag_1 mapping. Sorted descending.</p>
      </Card>
    </div>

    <div className="ops-bottom-grid">
      <Card title="Bed-days freed">
        <div className="ops-bed-days">{ops.bed_days_freed ?? "—"}</div>
        <p className="ops-footnote">{ops.bed_days_note}</p>
        <p className="ops-footnote">Average stay in this dataset: {ops.avg_stay_days} days.</p>
      </Card>
      <Card title="Intervention catalog">
        <InterventionTable />
      </Card>
    </div>

    {ops.fairness && <Card title="Fairness panel · descriptive test-split analysis">
      <p className="ops-footnote">AUC, base rate, flag rate and top-20% capture by group. Groups with n &lt; {ops.fairness.min_group_n} are too small. Differences are descriptive, not causal fairness claims.</p>
      {Object.entries(ops.fairness.dimensions).map(([dim, rows]) => <div key={dim} className="ops-fairness-section">
        <h3>{dim}</h3>
        <div className="overflow-x-auto"><table className="compact w-full"><thead><tr><th>Group</th><th>n</th><th>Base rate</th><th>Flag rate</th><th>AUC</th><th>Top-20% capture</th></tr></thead>
          <tbody>{rows.map((r) => <tr key={r.group}><td>{r.group}</td><td>{r.n}</td><td>{pct(r.base_rate, 1)}</td><td>{pct(r.flag_rate, 1)}</td><td>{r.too_small || r.roc_auc === null ? "Too small" : r.roc_auc.toFixed(3)}</td><td>{r.too_small || r.top20_capture === null ? "Too small" : pct(r.top20_capture, 1)}</td></tr>)}</tbody>
        </table></div>
      </div>)}
    </Card>}
  </div>;
}
