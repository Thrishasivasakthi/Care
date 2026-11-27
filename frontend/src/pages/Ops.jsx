import React, { useEffect, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { api, pct } from "../api.js";
import { AssumptionTag, Card, ErrorBox, Spinner, Stat } from "../components/bits.jsx";

const TEAL = "#0f766e";
const SLATE = "#94a3b8";

function RateChart({ data, color }) {
  return (
    <ResponsiveContainer width="100%" height={Math.max(180, data.length * 26)}>
      <BarChart data={data} layout="vertical" margin={{ left: 8, right: 12 }}>
        <CartesianGrid strokeDasharray="3 3" horizontal={false} />
        <XAxis type="number" tickFormatter={(v) => `${(v * 100).toFixed(0)}%`} />
        <YAxis type="category" dataKey="name" width={130} tick={{ fontSize: 11 }} />
        <Tooltip
          formatter={(v, _n, row) => [
            `${(v * 100).toFixed(1)}% readmitted (${row.payload.readmitted}/${row.payload.patients})`,
            "rate",
          ]}
        />
        <Bar dataKey="rate" fill={color} radius={[0, 3, 3, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}

function PolicyChart({ replay, metricKey, title, colorFor }) {
  const rows = Object.entries(replay.policies).map(([name, m]) => ({
    name,
    mean: m[metricKey].mean,
    p10: m[metricKey].p10,
    p90: m[metricKey].p90,
  }));
  return (
    <div>
      <div className="text-xs font-semibold text-slate-600 mb-1">{title}</div>
      <ResponsiveContainer width="100%" height={200}>
        <BarChart data={rows} margin={{ top: 4, right: 8 }}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey="name" tick={{ fontSize: 11 }} />
          <YAxis tick={{ fontSize: 11 }} />
          <Tooltip formatter={(v) => v.toFixed(2)} />
          <Bar dataKey="mean" radius={[3, 3, 0, 0]}>
            {rows.map((r) => (
              <Cell key={r.name} fill={colorFor(r.name)} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
      <table className="w-full text-[11px] text-slate-600">
        <tbody>
          {rows.map((r) => (
            <tr key={r.name}>
              <td className="py-0.5">{r.name}</td>
              <td className="text-right font-mono">
                {r.mean.toFixed(2)}{" "}
                <span className="text-slate-400">
                  (p10–p90: {r.p10.toFixed(1)}–{r.p90.toFixed(1)})
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function Ops() {
  const [ops, setOps] = useState(null);
  const [error, setError] = useState(null);
  const [resetting, setResetting] = useState(false);

  useEffect(() => {
    api("/ops")
      .then(setOps)
      .catch((e) => setError(e.message));
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
  if (!ops) return <Spinner label="Loading ops…" />;

  const m = ops.metrics;
  const replay = ops.replay;
  const policyColor = (n) =>
    n === "caretrace" ? TEAL : n === "raw_risk" ? "#2563eb" : SLATE;

  return (
    <div className="page-stack">
      <div className="banner">Decision support only. Review source data and clinical context before acting. Assumed intervention effects are not predictions.</div>
      <ErrorBox message={error} />

      {/* ------------------------------------------------ model card */}
      <Card
        title="Model card (held-out test split)"
        right={
          <div className="flex items-center gap-2">
            <button
              onClick={resetDemo}
              disabled={resetting}
              className="text-xs border border-slate-300 rounded px-2 py-1 hover:bg-slate-50 disabled:opacity-40"
            >
              {resetting ? "resetting…" : "Reset demo"}
            </button>
            <span className="text-xs text-slate-500">
              {m.dataset?.patients?.toLocaleString()} patients ·{" "}
              {m.n_features} features · seed {m.seed}
            </span>
          </div>
        }
      >
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          <Stat label="ROC-AUC" value={m.roc_auc.toFixed(3)} sub="untuned" />
          <Stat label="PR-AUC" value={m.pr_auc.toFixed(3)} sub="baseline = base rate" />
          <Stat label="Base rate" value={pct(m.base_rate_test, 1)} sub="30-day readmit" />
          <Stat
            label="Top-20% capture"
            value={pct(m.top20_capture, 1)}
            sub="true readmissions in top 20% by risk"
            accent="text-teal-800"
          />
          <Stat
            label="High-risk cutoff"
            value={pct(m.high_risk_cutoff, 2)}
            sub={`${m.n_high_risk_test.toLocaleString()} test rows flagged (ties → >20%)`}
          />
        </div>
        <div className="mt-3 grid md:grid-cols-2 gap-4 text-xs text-slate-600">
          <div>
            <div className="font-semibold text-slate-700 mb-1">Calibration</div>
            <div className="font-mono text-[11px] leading-5">
              {m.calibration_points.map(
                (p) => `${p.predicted.toFixed(3)} → ${p.observed.toFixed(3)}  n=${p.n}`
              ).join(" · ")}
            </div>
          </div>
          <div>
            <div className="font-semibold text-slate-700 mb-1">Limits</div>
            <ul className="list-disc pl-4 space-y-0.5">
              {(m.notes || []).map((n) => (
                <li key={n}>{n}</li>
              ))}
              <li>Dataset is 1999–2008, diabetes drugs only; decision support, not a diagnostic tool.</li>
            </ul>
          </div>
        </div>
      </Card>

      {/* ------------------------------------------------ ops rates */}
      <div className="grid lg:grid-cols-2 gap-4">
        <Card
          title="Readmission rate by department"
          right={<span className="text-xs text-slate-500">full cleaned dataset</span>}
        >
          <RateChart data={ops.departments} color={TEAL} />
          <div className="text-[11px] text-slate-500">
            Missing specialty → “Unknown/General”. {ops.departments.length}{" "}
            departments.
          </div>
        </Card>

        <Card title="Readmission rate by primary diagnosis group">
          <RateChart data={ops.diagnosis_groups} color="#2563eb" />
          <div className="text-[11px] text-slate-500">
            ICD-9 diag_1 mapped into {ops.diagnosis_groups.length} groups.
          </div>
        </Card>
      </div>

      {/* ------------------------------------------------ replay */}
      <Card
        title={`Replay backtest — ${replay ? `${replay.days} simulated days × ${replay.cohort_size} patients, ${replay.budget_hours} h budget` : "not run yet"}`}
        right={<span className="text-xs text-slate-500">artifacts/replay.json</span>}
      >
        {!replay ? (
          <div className="text-sm text-slate-500">
            Run <code className="bg-slate-100 px-1 rounded">make train &amp;&amp; python -m
            backend.decision.replay</code> to generate it.
          </div>
        ) : (
          <>
            {replay.warning && (
              <div className="mb-3 rounded-md border border-rose-300 bg-rose-50 text-rose-800 px-3 py-2 text-sm font-medium">
                ⚠ {replay.warning}
              </div>
            )}
            <div className="grid md:grid-cols-2 gap-6">
              <div>
                <PolicyChart
                  replay={replay}
                  metricKey="readmissions_reached"
                  title="Metric 1 — real readmissions reached (true labels only)"
                  colorFor={policyColor}
                />
              </div>
              <div>
                <PolicyChart
                  replay={replay}
                  metricKey="expected_avoided_readmissions"
                  title="Metric 2 — expected avoided (true label × ASSUMED effect)"
                  colorFor={policyColor}
                />
                <div className="mt-1">
                  <AssumptionTag />
                </div>
              </div>
            </div>
            <div className="text-[11px] text-slate-500 mt-2 space-y-0.5">
              <div>{replay.metric_definitions.expected}</div>
              <div>{replay.metric_definitions.eligibility}</div>
            </div>

            {/* beat the AI */}
            <div className="mt-5 pt-4 border-t border-slate-100">
              <div className="text-sm font-semibold mb-2">
                Beat the AI — human vs risk-only vs CareTrace
              </div>
              <div className="grid md:grid-cols-2 gap-6">
                <PolicyChart
                  replay={{
                    policies: Object.fromEntries(
                      ["human", "raw_risk", "caretrace"].map((k) => [
                        k,
                        replay.policies[k],
                      ])
                    ),
                  }}
                  metricKey="readmissions_reached"
                  title="Real readmissions reached (mean over days)"
                  colorFor={policyColor}
                />
                <PolicyChart
                  replay={{
                    policies: Object.fromEntries(
                      ["human", "raw_risk", "caretrace"].map((k) => [
                        k,
                        replay.policies[k],
                      ])
                    ),
                  }}
                  metricKey="expected_avoided_readmissions"
                  title="Expected avoided — assumed effects (mean over days)"
                  colorFor={policyColor}
                />
              </div>
            </div>
          </>
        )}
      </Card>

      {/* ------------------------------------------------ fairness */}
      {/* ------------------------------------------------ fairness */}
      {ops.fairness && (
        <Card title="Fairness panel (descriptive, test split)">
          <p className="text-xs text-slate-500 mb-3">
            AUC, base rate, flag rate and top-20% capture by group. Groups with
            n &lt; {ops.fairness.min_group_n} are marked "too small". Differences
            are descriptive, not a causal fairness claim.
          </p>
          {Object.entries(ops.fairness.dimensions).map(([dim, rows]) => (
            <div key={dim} className="mb-5">
              <div className="text-sm font-semibold text-slate-700 mb-2 capitalize">
                {dim}
              </div>
              <div className="overflow-x-auto">
                <table className="compact w-full text-xs">
                  <thead>
                    <tr className="text-left text-[11px] uppercase text-slate-500 border-b border-slate-200">
                      <th className="py-1">group</th>
                      <th className="text-right">n</th>
                      <th className="text-right">base rate</th>
                      <th className="text-right">flag rate</th>
                      <th className="text-right">AUC</th>
                      <th className="text-right">top-20% capture</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr key={r.group} className="border-b border-slate-100">
                        <td className="py-1">{r.group}</td>
                        <td className="text-right">{r.n}</td>
                        <td className="text-right">{(r.base_rate * 100).toFixed(1)}%</td>
                        <td className="text-right">{(r.flag_rate * 100).toFixed(1)}%</td>
                        <td className="text-right">
                          {r.too_small || r.roc_auc === null
                            ? "too small"
                            : r.roc_auc.toFixed(3)}
                        </td>
                        <td className="text-right">
                          {r.too_small || r.top20_capture === null
                            ? "too small"
                            : `${(r.top20_capture * 100).toFixed(1)}%`}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
        </Card>
      )}

      <div className="grid lg:grid-cols-3 gap-4">
        <Card title="Bed-days freed">
          <div className="text-3xl font-semibold text-teal-800">
            {ops.bed_days_freed ?? "—"}
          </div>
          <div className="text-xs text-slate-500 mt-1">
            {ops.bed_days_note}
          </div>
          <div className="text-xs text-slate-500 mt-2">
            average stay in this dataset: {ops.avg_stay_days} days
          </div>
        </Card>

        <Card title="Intervention catalog assumptions" className="lg:col-span-2">
          <div className="flex flex-wrap gap-2 text-xs">
            {[
              "48-hour follow-up call 5–15% · d2–3",
              "Medication reconciliation 10–20% · d1–5",
              "Pharmacist counselling 5–15% · d1–7",
              "PCP visit within 7 days 10–20% · d3–7",
              "Home visit 10–25% · d3–10",
              "Care handoff to nursing facility 5–15% · d1–3",
            ].map((t) => (
              <span
                key={t}
                className="border border-slate-200 rounded px-2 py-1 bg-slate-50"
              >
                {t} <AssumptionTag />
              </span>
            ))}
          </div>
          <ul className="text-xs text-slate-600 mt-3 list-disc pl-4 space-y-1">
            {(ops.honesty || []).map((h) => (
              <li key={h}>{h}</li>
            ))}
          </ul>
        </Card>
      </div>
    </div>
  );
}
