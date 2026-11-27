import React, { useCallback, useEffect, useState } from "react";
import { api, pct } from "../api.js";
import { Card, Delta, ErrorBox, Spinner, StatusChip, AssumptionTag } from "../components/bits.jsx";

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

  return (
    <div className="page-stack">
      <div className="banner">Decision support only. Expected avoided readmissions use assumed intervention effects; they are not predictions.</div>
      <ErrorBox message={error} />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="kpi"><div className="kpi-label">Unreviewed flags</div><div className="kpi-value">{data ? data.unreviewed_flags : "—"}</div></div>
        <div className="kpi"><div className="kpi-label">Patients selected</div><div className="kpi-value">{data ? data.selection.length : "—"}</div></div>
        <div className="kpi"><div className="kpi-label">Minutes used of budget</div><div className="kpi-value">{data ? (data.budget_minutes - data.remaining_minutes ?? "—") : "—"}</div></div>
        <div className="kpi"><div className="kpi-label">Expected avoided readmissions</div><div className="kpi-value">{data ? data.selection.reduce((a,r)=>a+(r.expected_avoided_readmissions || 0),0).toFixed(2) : "—"}</div></div>
      </div>
      <div className="flex flex-wrap items-center gap-4">
        <div className="bg-white border border-slate-200 rounded-lg px-4 py-3 flex items-center gap-3">
          <label className="text-sm font-medium text-slate-700" htmlFor="hours">
            Coordinator hours today
          </label>
          <input
            id="hours"
            type="range"
            min="1"
            max="8"
            step="1"
            value={hours}
            onChange={(e) => setHours(Number(e.target.value))}
            className="w-40 accent-teal-700"
          />
          <span className="text-sm font-semibold text-teal-800 w-16">
            {hours} h ({hours * 60} min)
          </span>
        </div>

        <div className="bg-white border border-slate-200 rounded-lg px-4 py-3 text-sm">
          <span className="text-slate-500">Unreviewed flags</span>{" "}
          <span
            className={`ml-1 font-semibold ${
              data?.unreviewed_flags ? "text-amber-700" : "text-slate-400"
            }`}
          >
            {data ? data.unreviewed_flags : "—"}
          </span>
        </div>

        <div className="text-xs text-slate-500">
          {data ? (
            <>
              cohort {data.cohort_size} · budget {data.budget_minutes} min ·{" "}
              {data.elapsed_ms} ms
            </>
          ) : (
            "…"
          )}
        </div>
      </div>

      {!data ? <Spinner label="Loading worklist…" /> : (
        <>
          {/* ---------------------------------------- why not just call the sickest */}
          <Card title="Why not just call the sickest?">
            <div className="grid md:grid-cols-2 gap-4">
              {data.comparison.map((c) => (
                <div
                  key={c.policy}
                  className={`rounded-lg border p-3 ${
                    c.policy.startsWith("CareTrace")
                      ? "border-teal-300 bg-teal-50/50"
                      : "border-slate-200"
                  }`}
                >
                  <div className="text-sm font-semibold mb-2">{c.policy}</div>
                  <dl className="grid grid-cols-3 gap-2 text-center">
                    <div>
                      <dt className="text-[11px] text-slate-500">calls made</dt>
                      <dd className="text-lg font-semibold">{c.calls_made}</dd>
                    </div>
                    <div>
                      <dt className="text-[11px] text-slate-500">
                        readmissions reached
                      </dt>
                      <dd className="text-lg font-semibold">
                        {c.readmissions_reached}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-[11px] text-slate-500">avoided / hour</dt>
                      <dd className="text-lg font-semibold">
                        {c.expected_avoided_per_hour.toFixed(3)}
                      </dd>
                    </div>
                  </dl>
                  <div className="mt-2 flex items-center gap-2">
                    
                    <span className="text-[11px] text-slate-500">
                      expected avoided {c.expected_avoided_readmissions.toFixed(3)}{" "}
                      (held-out labels × assumed effect)
                    </span>
                  </div>
                </div>
              ))}
            </div>
            <p className="text-[11px] text-slate-500 mt-3">
              "Readmissions reached" uses true held-out outcomes only. "Avoided"
              multiplies those outcomes by assumed effect sizes — an assumption,
              not a prediction. See Ops for the 200-day replay with ranges.
            </p>
          </Card>

          {/* ---------------------------------------- main table */}
          <Card
            title={`Optimizer selection — ${data.selection.length} patients in ${hours} h`}
            right={
              <span className="text-xs text-slate-500">
                Δ = position vs risk-only ranking
              </span>
            }
          >
            <div className="overflow-x-auto">
              <table className="table compact w-full text-sm">
                <thead>
                  <tr className="text-left text-[11px] uppercase tracking-wide text-slate-500 border-b border-slate-200">
                    <th className="py-2">#</th>
                    <th>Patient</th>
                    <th>Risk</th>
                    <th>Top modifiable driver</th>
                    <th>Matched action</th>
                    <th className="text-right">Min</th>
                    <th>Status</th>
                    <th className="text-right">vs risk-only</th>
                  </tr>
                </thead>
                <tbody>
                  {data.selection.map((r) => (
                    <tr
                      key={r.patient_id}
                      className="border-b border-slate-100 hover:bg-slate-50 cursor-pointer"
                      onClick={() => onOpenPatient(r.patient_id)}
                    >
                      <td className="font-medium text-slate-500">{r.rank}</td>
                      <td className="font-mono text-xs">#{r.patient_nbr}</td>
                      <td className="font-semibold">{pct(r.risk, 1)}</td>
                      <td className="text-slate-700">{r.driver || "—"}</td>
                      <td>
                        {r.action ? (
                          <span className="text-teal-800">{r.action.name}</span>
                        ) : (
                          <span className="text-slate-400">—</span>
                        )}
                        {r.action && (
                          <span className="ml-1 text-[10px] text-slate-400">
                            {r.action.effect_label} <AssumptionTag />
                          </span>
                        )}
                      </td>
                      <td className="text-right text-slate-600">{r.minutes ?? "—"}</td>
                      <td>
                        <StatusChip status={r.status} />
                      </td>
                      <td className="text-right">
                        <Delta value={r.delta} />
                      </td>
                    </tr>
                  ))}
                  {data.selection.length === 0 && (
                    <tr>
                      <td colSpan="8" className="py-6 text-center text-slate-500">
                        No eligible actions for this budget.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            <div className="mt-2 text-[11px] text-slate-500">
              Rows promoted (▲) by CareTrace are patients whose modifiable drivers
              make the call more worthwhile than raw risk suggests; demoted (▼)
              rows are sicker but have little an intervention can change.{" "}
              {role === "coordinator" && (
                <span className="text-amber-700">
                  Switch to Clinician to approve, edit or reject flags.
                </span>
              )}
            </div>
          </Card>

          {/* ---------------------------------------- below the line */}
          <Card
            title={`Patients with no modifiable driver (${data.no_modifiable_driver.length})`}
          >
            <p className="text-xs text-slate-500 mb-2">
              These patients have no positive modifiable SHAP driver, so no
              intervention in the catalog targets them. They are not "safe" —
              they simply have nothing this catalog can act on.
            </p>
            <div className="flex flex-wrap gap-2">
              {data.no_modifiable_driver.map((r) => (
                <button
                  key={r.patient_id}
                  onClick={() => onOpenPatient(r.patient_id)}
                  className="text-xs border border-slate-200 rounded-md px-2 py-1 hover:bg-slate-50 flex items-center gap-2"
                >
                  <span className="font-mono">#{r.patient_nbr}</span>
                  <span className="text-slate-500">{pct(r.risk, 1)}</span>
                </button>
              ))}
            </div>
          </Card>
        </>
      )}
    </div>
  );
}
