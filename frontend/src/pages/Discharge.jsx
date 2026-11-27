import React, { useEffect, useState } from "react";
import { api } from "../api.js";
import { Card, ErrorBox, Spinner, StatusChip, AssumptionTag } from "../components/bits.jsx";

const TASK_STATUSES = ["Due", "Done", "Missed", "Escalated"];

export default function Discharge({ role, onOpenPatient }) {
  const [list, setList] = useState(null);
  const [patientId, setPatientId] = useState(null);
  const [d, setD] = useState(null);
  const [error, setError] = useState(null);
  const [flash, setFlash] = useState(null);

  useEffect(() => {
    api("/worklist?hours=4")
      .then((w) => {
        setList(w.ranking);
        if (w.ranking.length) setPatientId(w.ranking[0].patient_id);
      })
      .catch((e) => setError(e.message));
  }, []);

  useEffect(() => {
    if (!patientId) return;
    setD(null);
    api(`/discharge/${patientId}`)
      .then((x) => {
        setD(x);
        setError(null);
      })
      .catch((e) => setError(e.message));
  }, [patientId]);

  const patchTask = async (id, status) => {
    try {
      await api(`/tasks/${id}`, { method: "PATCH", body: { status } });
      setFlash(`task #${id} → ${status}`);
      const x = await api(`/discharge/${patientId}`);
      setD(x);
    } catch (e) {
      setError(e.message);
    }
  };

  const ins = d?.instructions;

  return (
    <div className="space-y-4">
      <ErrorBox message={error} />
      {flash && (
        <div className="text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 rounded px-3 py-1.5 w-fit">
          ✓ {flash} (logged in audit)
        </div>
      )}

      <Card title="Discharge instructions">
        <div className="flex flex-wrap items-center gap-3 mb-3">
          <label className="text-sm text-slate-600">Patient</label>
          <select
            value={patientId ?? ""}
            onChange={(e) => setPatientId(Number(e.target.value))}
            className="text-sm border border-slate-300 rounded px-2 py-1.5 font-mono"
          >
            {(list || []).map((r) => (
              <option key={r.patient_id} value={r.patient_id}>
                #{r.patient_nbr} — risk {(r.risk * 100).toFixed(1)}%
              </option>
            ))}
          </select>
          <button
            onClick={() => patientId && onOpenPatient(patientId)}
            className="text-xs text-teal-700"
          >
            open full patient page →
          </button>
        </div>

        {!d ? (
          <Spinner label="Generating instructions…" />
        ) : (
          <div className="grid lg:grid-cols-3 gap-4">
            <div className="lg:col-span-2">
              <div className="flex items-center gap-2 mb-2">
                {ins.verified ? (
                  <span className="text-[11px] px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200 font-medium">
                    ✓ verified — every slot filled from the record by code
                  </span>
                ) : (
                  <span className="text-[11px] px-2 py-0.5 rounded-full bg-rose-50 text-rose-700 border border-rose-200">
                    ⚠ unverified — slot missing
                  </span>
                )}
                <span className="text-[11px] px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 border border-slate-200">
                  source: {ins.source === "llm" ? "LLM (slots only)" : "fixed template (no LLM key)"}
                </span>
              </div>
              <pre className="whitespace-pre-wrap text-sm bg-slate-50 border border-slate-200 rounded p-3 leading-relaxed">
                {ins.text}
              </pre>
              <div className="text-[11px] text-slate-500 mt-2">
                The LLM only phrases placeholder text; code fills{" "}
                {Object.keys(ins.slots_used).join(", ")} from the patient record.
                It never writes a drug name, date, dose or number — invalid LLM
                output is discarded. {ins.note}
              </div>
            </div>

            <div>
              <div className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-1">
                Simulated reminder log
              </div>
              <div className="bg-slate-900 text-slate-200 rounded p-3 text-[11px] font-mospace space-y-2 max-h-64 overflow-y-auto">
                {d.reminders.map((r, i) => (
                  <div key={i}>{r}</div>
                ))}
              </div>
              <div className="text-[11px] text-slate-500 mt-1">
                Nothing is ever sent — text-only simulation.
              </div>
            </div>
          </div>
        )}
      </Card>

      <Card
        title="Follow-up tasks"
        right={
          <span className="text-xs text-slate-500">
            role: <b className="capitalize">{role}</b> · any role can update task
            status; decisions are clinician-only
          </span>
        }
      >
        {!d ? (
          <Spinner />
        ) : d.tasks.length ? (
          <table className="compact w-full text-sm">
            <thead>
              <tr className="text-left text-[11px] uppercase text-slate-500 border-b border-slate-200">
                <th className="py-1">Task</th>
                <th>Due</th>
                <th>Status</th>
                <th>Change to</th>
              </tr>
            </thead>
            <tbody>
              {d.tasks.map((t) => (
                <tr key={t.id} className="border-b border-slate-100">
                  <td>{t.title}</td>
                  <td className="text-slate-600">{t.due_date}</td>
                  <td>
                    <StatusChip status={t.status} />
                  </td>
                  <td>
                    <select
                      value={t.status}
                      onChange={(e) => patchTask(t.id, e.target.value)}
                      className="text-xs border border-slate-300 rounded px-1 py-1"
                    >
                      {TASK_STATUSES.map((s) => (
                        <option key={s}>{s}</option>
                      ))}
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <div className="text-sm text-slate-500">
            No tasks yet — approve a plan on the patient page first.
          </div>
        )}
        {d?.intervention && (
          <div className="text-[11px] text-slate-500 mt-2">
            Matched intervention: <b>{d.intervention.name}</b> (days{" "}
            {d.intervention.window_start_day}–{d.intervention.window_end_day},{" "}
            {d.intervention.minutes} min) <AssumptionTag />
          </div>
        )}
      </Card>
    </div>
  );
}
