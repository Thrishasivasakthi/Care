import React, { useEffect, useState } from "react";
import { api, pct } from "../api.js";
import {
  AssumptionTag,
  Card,
  ErrorBox,
  Spinner,
  StatusChip,
} from "../components/bits.jsx";

function ConceptBars({ bars }) {
  const fixed = bars.filter((b) => !b.modifiable);
  const mod = bars.filter((b) => b.modifiable);
  const max = Math.max(0.0001, ...bars.map((b) => Math.abs(b.shap)));

  const group = (title, list, color, note) => (
    <div>
      <div className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-1">
        {title}
      </div>
      {list.map((b) => (
        <div key={b.concept} className="mb-1.5" title={b.why}>
          <div className="flex justify-between text-xs">
            <span className="text-slate-700">{b.concept}</span>
            <span className={b.shap >= 0 ? "text-slate-600" : "text-slate-400"}>
              {b.shap >= 0 ? "+" : ""}
              {b.shap.toFixed(3)}
            </span>
          </div>
          <div className="h-2 bg-slate-100 rounded overflow-hidden">
            <div
              className={`h-2 rounded ${color}`}
              style={{
                width: `${(Math.abs(b.shap) / max) * 100}%`,
                marginLeft: b.shap >= 0 ? 0 : "auto",
                marginRight: b.shap >= 0 ? "auto" : 0,
              }}
            />
          </div>
        </div>
      ))}
      <div className="text-[11px] text-slate-400">{note}</div>
    </div>
  );

  return (
    <div className="grid md:grid-cols-2 gap-6">
      {group("Fixed (never an action)", fixed, "bg-slate-400",
        "History and context — cannot be changed this week.")}
      {group("Modifiable (can be acted on)", mod, "bg-teal-600",
        "Only these can make a patient eligible for an intervention.")}
    </div>
  );
}

function TimingStrip({ timing }) {
  const horizon = timing.horizon_days;
  const day = (d) => `${(d / horizon) * 100}%`;
  return (
    <div>
      <div className="flex justify-between text-[11px] text-slate-500 mb-1">
        <span>day 0 — discharge ({timing.day_zero})</span>
        <span>day {horizon}</span>
      </div>
      <div className="relative h-28 border border-slate-200 rounded bg-slate-50 overflow-hidden">
        {/* shaded early-heavy readmission window (visual only) */}
        <div
          className="absolute inset-y-0 left-0 bg-rose-100/70 border-r border-rose-200"
          style={{ width: day(timing.early_window_days) }}
        />
        <div
          className="absolute top-1 text-[10px] text-rose-500 px-1"
          style={{ width: day(timing.early_window_days) }}
        >
          early readmission window
        </div>
        {/* day gridlines */}
        {[5, 10, 15, 20, 25].map((d) => (
          <div
            key={d}
            className="absolute inset-y-0 border-l border-slate-200"
            style={{ left: day(d) }}
          />
        ))}
        {/* interventions drawn inside their timing windows */}
        {timing.items.map((it, i) => (
          <div
            key={it.name}
            className={`absolute h-5 rounded text-[10px] leading-5 px-1 truncate ${
              it.selected
                ? "bg-teal-600 text-white"
                : "bg-white border border-slate-300 text-slate-600"
            }`}
            style={{
              left: day(it.start_day),
              width: day(Math.max(it.end_day - it.start_day, 0.5)),
              top: 24 + i * 22,
            }}
            title={`${it.name}: days ${it.start_day}-${it.end_day} (${it.assumption_tag})`}
          >
            {it.name}
          </div>
        ))}
      </div>
      <div className="text-[11px] text-slate-500 mt-1">
        Visual only — this strip never changes any risk number. Windows are
        seeded assumptions. <AssumptionTag />
      </div>
    </div>
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
      .then((d) => {
        setP(d);
        setError(null);
      })
      .catch((e) => setError(e.message));
  };

  useEffect(load, [patientId]);

  const decide = async (action) => {
    if (!p?.plan) return;
    setBusy(true);
    try {
      await api(`/plan/${p.plan.id}/decision`, {
        method: "POST",
        body: { action, note: note || null },
      });
      setNote("");
      load();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  if (!p)
    return (
      <div className="space-y-3">
        <button onClick={onBack} className="text-sm text-teal-700">
          ← back to worklist
        </button>
        {error ? <ErrorBox message={error} /> : <Spinner label="Loading patient…" />}
      </div>
    );

  const pred = p.prediction;
  const canAct = role === "clinician" && p.plan;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <button onClick={onBack} className="text-sm text-teal-700">
          ← back to worklist
        </button>
        <h1 className="text-lg font-semibold">Patient #{p.patient_nbr}</h1>
        {p.plan && <StatusChip status={p.plan.status} />}
        {pred?.high_risk && (
          <span className="text-[11px] px-2 py-0.5 rounded-full bg-rose-50 text-rose-700 border border-rose-200">
            high-risk flag
          </span>
        )}
      </div>

      <ErrorBox message={error} />

      <div className="grid lg:grid-cols-3 gap-4">
        {/* risk */}
        <Card title="Calibrated risk (30-day)">
          {pred ? (
            <>
              <div className="text-4xl font-semibold text-slate-900">
                {pct(pred.risk_calibrated, 1)}
              </div>
              <div className="text-xs text-slate-500 mt-1">
                raw model {pct(pred.risk_raw, 1)} · high-risk cutoff{" "}
                {pct(pred.high_risk_cutoff, 1)}
              </div>
              <div className="mt-2">
                {pred.high_risk ? (
                  <span className="text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded px-2 py-1">
                    ≥ cutoff → needs clinician review
                  </span>
                ) : (
                  <span className="text-xs text-slate-500">below cutoff</span>
                )}
              </div>
            </>
          ) : (
            <div className="text-sm text-slate-500">
              Not in the held-out test split — no score exists for this patient.
            </div>
          )}
        </Card>

        {/* demographics */}
        <Card title="Record">
          <dl className="text-sm grid grid-cols-2 gap-x-4 gap-y-1">
            <dt className="text-slate-500">Age band</dt>
            <dd>{p.demographics.age}</dd>
            <dt className="text-slate-500">Gender / race</dt>
            <dd>
              {p.demographics.gender}, {p.demographics.race}
            </dd>
            <dt className="text-slate-500">Specialty</dt>
            <dd>{p.demographics.medical_specialty}</dd>
            <dt className="text-slate-500">Diagnosis group</dt>
            <dd>{p.demographics.diag_group}</dd>
            <dt className="text-slate-500">Stay / meds</dt>
            <dd>
              {p.demographics.time_in_hospital} d, {p.demographics.num_medications}{" "}
              meds
            </dd>
            <dt className="text-slate-500">Prior visits</dt>
            <dd>
              {p.demographics.number_inpatient} inpatient,{" "}
              {p.demographics.number_outpatient} outpatient
            </dd>
          </dl>
        </Card>

        {/* lookalike */}
        <Card title="Lookalike cohort" right={<AssumptionTag />}>
          {p.lookalike ? (
            <>
              <div className="text-sm font-medium text-slate-800">
                {p.lookalike.line}
              </div>
              <div className="mt-2 space-y-1">
                {p.lookalike.cards.map((c, i) => (
                  <div
                    key={i}
                    className="text-xs border border-slate-200 rounded p-2 flex justify-between gap-2"
                  >
                    <span className="text-slate-500">age {c.age}</span>
                    <span className="text-slate-700 flex-1">
                      {c.top_drivers.join(", ") || "—"}
                    </span>
                    <span
                      className={
                        c.outcome.startsWith("readmitted")
                          ? "text-rose-600"
                          : "text-slate-500"
                      }
                    >
                      {c.outcome}
                    </span>
                  </div>
                ))}
              </div>
              <div className="text-[11px] text-slate-500 mt-2">
                {p.lookalike.label} — similar history does not explain or predict
                this patient.
              </div>
            </>
          ) : (
            <div className="text-sm text-slate-500">Not available.</div>
          )}
        </Card>
      </div>

      {/* drivers + explanation */}
      <div className="grid lg:grid-cols-2 gap-4">
        <Card title="Why the model scored it this way (SHAP)">
          {p.concept_bars.length ? (
            <ConceptBars bars={p.concept_bars} />
          ) : (
            <div className="text-sm text-slate-500">No prediction.</div>
          )}
          <div className="text-[11px] text-slate-500 mt-2">{p.history_label}</div>
        </Card>

        <Card title="Risk explanation (3 lines, code-generated)">
          <ol className="space-y-2 text-sm">
            {p.explanation.map((l, i) => (
              <li
                key={i}
                className="border-l-2 border-teal-600 pl-3 text-slate-700"
              >
                {l.text}
              </li>
            ))}
          </ol>
          <div className="text-[11px] text-slate-500 mt-3">
            No LLM writes these lines: facts come from the record, actions from
            the catalog. Demographics never map to an action.
          </div>
        </Card>
      </div>

      {/* timing strip */}
      <Card title="30-day timing strip (visual only)">
        <TimingStrip timing={p.timing} />
      </Card>

      {/* interventions + decision */}
      <div className="grid lg:grid-cols-2 gap-4">
        <Card title="Matched interventions">
          {p.matched_interventions.length ? (
            <table className="compact w-full text-sm">
              <thead>
                <tr className="text-left text-[11px] uppercase text-slate-500 border-b border-slate-200">
                  <th className="py-1">Intervention</th>
                  <th>Target</th>
                  <th className="text-right">Effect</th>
                  <th className="text-right">Window</th>
                  <th className="text-right">Min</th>
                  <th className="text-right">Priority</th>
                </tr>
              </thead>
              <tbody>
                {p.matched_interventions.map((m) => (
                  <tr key={m.name} className="border-b border-slate-100">
                    <td className={m.is_best ? "text-teal-800 font-medium" : ""}>
                      {m.name}
                      {m.is_best && (
                        <span className="ml-1 text-[10px] text-teal-600">best</span>
                      )}
                    </td>
                    <td className="text-slate-600">{m.target_concept}</td>
                    <td className="text-right">
                      {m.effect_label} <AssumptionTag />
                    </td>
                    <td className="text-right text-slate-600">
                      d{m.window_start_day}–{m.window_end_day}
                    </td>
                    <td className="text-right text-slate-600">{m.minutes}</td>
                    <td className="text-right font-mono text-xs">
                      {m.priority.toFixed(4)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div className="text-sm text-slate-500">
              No eligible intervention — no positive modifiable driver.
            </div>
          )}
          <div className="text-[11px] text-slate-500 mt-2">
            priority = risk × mid effect × SHAP share ÷ minutes — a priority
            score, never a prediction.
          </div>
        </Card>

        <Card title="Clinician review">
          {p.plan ? (
            <div className="space-y-3">
              <div className="text-sm">
                Plan for <b>{p.plan.intervention.name}</b>{" "}
                <AssumptionTag />
                <div className="text-xs text-slate-500 mt-1">
                  status {p.plan.status} · priority{" "}
                  {p.plan.priority_score.toFixed(4)} · {p.plan.minutes} min ·
                  window d{p.plan.intervention.window_start_day}–
                  {p.plan.intervention.window_end_day}
                  {p.plan.note && <> · note: “{p.plan.note}”</>}
                </div>
              </div>

              <input
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Optional note (goes into the audit log)"
                className="w-full text-sm border border-slate-300 rounded px-2 py-1.5"
              />

              <div className="flex gap-2">
                <button
                  disabled={!canAct || busy}
                  onClick={() => decide("approve")}
                  className="px-3 py-1.5 rounded-md text-sm bg-emerald-600 text-white disabled:opacity-40"
                >
                  Approve
                </button>
                <button
                  disabled={!canAct || busy}
                  onClick={() => decide("edit")}
                  className="px-3 py-1.5 rounded-md text-sm bg-sky-600 text-white disabled:opacity-40"
                >
                  Edit
                </button>
                <button
                  disabled={!canAct || busy}
                  onClick={() => decide("reject")}
                  className="px-3 py-1.5 rounded-md text-sm bg-rose-600 text-white disabled:opacity-40"
                >
                  Reject
                </button>
              </div>
              {!canAct && (
                <div className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1.5">
                  {role === "coordinator"
                    ? "Only a clinician can approve, edit or reject — switch role in the header."
                    : "No plan exists for this patient."}
                </div>
              )}
            </div>
          ) : (
            <div className="text-sm text-slate-500">
              No plan — this patient has no eligible action (or was not flagged).
            </div>
          )}
        </Card>
      </div>

      {/* tasks + audit */}
      <div className="grid lg:grid-cols-2 gap-4">
        <Card title="Follow-up tasks">
          {p.tasks.length ? (
            <ul className="text-sm space-y-1">
              {p.tasks.map((t) => (
                <li
                  key={t.id}
                  className="flex justify-between border-b border-slate-100 py-1"
                >
                  <span>{t.title}</span>
                  <span className="text-xs text-slate-500 flex items-center gap-2">
                    due {t.due_date} <StatusChip status={t.status} />
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <div className="text-sm text-slate-500">
              None yet — tasks are created on approval (Discharge tab controls
              their status).
            </div>
          )}
        </Card>

        <Card title="Audit log (this patient)">
          {p.audit.length ? (
            <ul className="text-xs space-y-1 font-mono">
              {p.audit.slice(0, 12).map((a) => (
                <li key={a.id} className="text-slate-600">
                  {a.created_at.slice(0, 16).replace("T", " ")} {a.role}:{" "}
                  {a.entity}#{a.entity_id} {a.field}{" "}
                  {a.old_value ?? "∅"} → {a.new_value ?? "∅"}
                  {a.note ? ` (${a.note})` : ""}
                </li>
              ))}
            </ul>
          ) : (
            <div className="text-sm text-slate-500">No entries.</div>
          )}
        </Card>
      </div>
    </div>
  );
}
