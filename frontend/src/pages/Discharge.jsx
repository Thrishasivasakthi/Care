import React, { useEffect, useState } from "react";
import { api } from "../api.js";
import { Card, ErrorBox, Spinner, StatusChip, AssumptionTag } from "../components/bits.jsx";

const TASK_STATUSES = ["Due", "Done", "Missed", "Escalated"];

export default function Discharge({ role, onOpenPatient }) {
  const [list, setList] = useState(null);
  const [patientId, setPatientId] = useState(null);
  const [d, setD] = useState(null);
  const [regionalLang, setRegionalLang] = useState("");
  const [regional, setRegional] = useState(null);
  const [error, setError] = useState(null);
  const [flash, setFlash] = useState(null);

  const [view, setView] = useState("instructions"); // instructions | checkin
  const [chatInput, setChatInput] = useState("");
  const [chat, setChat] = useState([]);
  const [chatBusy, setChatBusy] = useState(false);
  const [escalations, setEscalations] = useState([]);

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
    setRegional(null);
    setChat([]);
    api(`/discharge/${patientId}`)
      .then((x) => {
        setD(x);
        setError(null);
      })
      .catch((e) => setError(e.message));
    api("/escalations")
      .then((e) => setEscalations(e.escalations || []))
      .catch(() => {});
  }, [patientId]);

  useEffect(() => {
    if (!patientId || !regionalLang) {
      setRegional(null);
      return;
    }
    api(`/discharge/${patientId}?lang=${regionalLang}`)
      .then((x) => setRegional(x.regional_instructions))
      .catch((e) => setError(e.message));
  }, [patientId, regionalLang]);

  const patchTask = async (id, status) => {
    try {
      await api(`/tasks/${id}`, { method: "PATCH", body: { status } });
      setFlash(`task #${id} → ${status} (logged in audit)`);
      const x = await api(`/discharge/${patientId}`);
      setD(x);
    } catch (e) {
      setError(e.message);
    }
  };

  const sendChat = async () => {
    if (!chatInput.trim() || !patientId) return;
    const msg = chatInput.trim();
    setChatInput("");
    setChat((c) => [...c, { role: "patient", text: msg }]);
    setChatBusy(true);
    try {
      const r = await api(`/checkin/${patientId}/message`, {
        method: "POST",
        body: { message: msg },
      });
      setChat((c) => [
        ...c,
        { role: "agent", text: r.reply, barrier: r.barrier, escalationId: r.escalation_id },
      ]);
      api("/escalations")
        .then((e) => setEscalations(e.escalations || []))
        .catch(() => {});
    } catch (e) {
      setError(e.message);
    } finally {
      setChatBusy(false);
    }
  };

  const decideEscalation = async (id, action) => {
    try {
      await api(`/escalation/${id}/decision`, {
        method: "POST",
        body: { action, note: "reviewed in demo" },
      });
      const e = await api("/escalations");
      setEscalations(e.escalations || []);
      setFlash(`escalation #${id} → ${action === "approve" ? "Approved" : "Rejected"}`);
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

        <div className="flex gap-1 mb-3">
          {["instructions", "checkin"].map((v) => (
            <button
              key={v}
              onClick={() => setView(v)}
              className={`px-3 py-1.5 rounded-md text-sm capitalize ${
                view === v
                  ? "bg-teal-700 text-white"
                  : "bg-slate-100 text-slate-600 hover:bg-slate-200"
              }`}
            >
              {v === "checkin" ? "Check-in agent" : "Instructions"}
            </button>
          ))}
        </div>

        {view === "instructions" ? (
          !d ? (
            <Spinner label="Generating instructions…" />
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-2 mb-2">
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
                {Object.keys(ins.slots_used).join(", ") || "—"} from the patient record.
                It never writes a drug name, date, dose or number — invalid LLM
                output is discarded. {ins.note}
              </div>

              {/* regional language toggle */}
              <div className="mt-4 border-t border-slate-100 pt-3">
                <div className="flex flex-wrap items-center gap-2 mb-2">
                  <span className="text-xs font-semibold text-slate-600">
                    Regional language
                  </span>
                  <select
                    value={regionalLang}
                    onChange={(e) => setRegionalLang(e.target.value)}
                    className="text-sm border border-slate-300 rounded px-2 py-1.5"
                  >
                    <option value="">English only</option>
                    <option value="hi">Hindi (hi)</option>
                    <option value="mr">Marathi (mr)</option>
                    <option value="ta">Tamil (ta)</option>
                  </select>
                  {regional && (
                    <span
                      className={`text-[11px] px-2 py-0.5 rounded-full border ${
                        regional.verified
                          ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                          : "bg-rose-50 text-rose-700 border-rose-200"
                      }`}
                    >
                      {regional.verified ? "✓ verified" : "⚠ unverified"}
                    </span>
                  )}
                  {regional?.needs_native_review && (
                    <span className="text-[11px] px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 border border-amber-200">
                      template pending native review
                    </span>
                  )}
                </div>
                {regional && (
                  <>
                    <pre className="whitespace-pre-wrap text-sm bg-slate-50 border border-slate-200 rounded p-3 leading-relaxed">
                      {regional.text}
                    </pre>
                    <div className="text-[11px] text-slate-500 mt-2">
                      {regional.back_translation}
                    </div>
                    <div className="text-[10px] text-amber-700 mt-1">
                      Back-translation is a readability aid only, not clinically
                      verified. {regional.note}
                    </div>
                  </>
                )}
              </div>
            </>
          )
        ) : (
          <div className="space-y-3">
            <div className="text-xs text-slate-500">
              Simulated post-discharge check-in. You play the patient. The agent
              never changes medication, never gives a dose, never gives medical
              advice — it only flags barriers to your care team.
            </div>
            <div className="bg-slate-50 border border-slate-200 rounded p-3 h-64 overflow-y-auto space-y-2">
              {chat.length === 0 && (
                <div className="text-xs text-slate-400">
                  Try: "I skipped my dose because it costs too much" or "can I
                  double my insulin dose?"
                </div>
              )}
              {chat.map((m, i) => (
                <div
                  key={i}
                  className={`text-sm rounded px-3 py-2 max-w-[85%] ${
                    m.role === "patient"
                      ? "bg-sky-100 text-sky-900 ml-auto"
                      : "bg-white border border-slate-200 text-slate-800"
                  }`}
                >
                  {m.role === "agent" && m.barrier && (
                    <div className="text-[10px] text-slate-500 mb-1">
                      barrier: {m.barrier}
                      {m.escalationId ? ` · escalation #${m.escalationId}` : ""}
                    </div>
                  )}
                  {m.text}
                </div>
              ))}
              {chatBusy && (
                <div className="text-xs text-slate-400 animate-pulse">
                  agent thinking…
                </div>
              )}
            </div>
            <div className="flex gap-2">
              <input
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && sendChat()}
                placeholder="Type as the patient…"
                className="flex-1 text-sm border border-slate-300 rounded px-3 py-2"
              />
              <button
                onClick={sendChat}
                disabled={chatBusy || !chatInput.trim()}
                className="px-4 py-2 rounded-md bg-teal-700 text-white text-sm disabled:opacity-40"
              >
                Send
              </button>
            </div>

            {/* escalation queue for this page */}
            <Card title="Clinician escalation queue">
              {escalations.length === 0 ? (
                <div className="text-sm text-slate-500">No escalations yet.</div>
              ) : (
                <ul className="text-sm space-y-2">
                  {escalations.map((e) => (
                    <li
                      key={e.id}
                      className="border border-slate-200 rounded p-2"
                    >
                      <div className="flex justify-between">
                        <span className="font-mono text-xs text-slate-500">
                          #{e.id} patient #{e.patient_nbr}
                        </span>
                        <StatusChip status={e.status} />
                      </div>
                      <div className="text-xs text-slate-600 mt-1">
                        barrier: <b>{e.barrier}</b> · "{e.message}"
                      </div>
                      {e.status === "Pending" && role === "clinician" && (
                        <div className="flex gap-2 mt-2">
                          <button
                            onClick={() => decideEscalation(e.id, "approve")}
                            className="px-2 py-1 rounded text-xs bg-emerald-600 text-white"
                          >
                            Approve
                          </button>
                          <button
                            onClick={() => decideEscalation(e.id, "reject")}
                            className="px-2 py-1 rounded text-xs bg-rose-600 text-white"
                          >
                            Reject
                          </button>
                        </div>
                      )}
                      {e.status === "Pending" && role !== "clinician" && (
                        <div className="text-xs text-amber-700 mt-1">
                          clinician only
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>
        )}
      </Card>

      <Card
        title="Follow-up tasks"
        right={
          <span className="text-xs text-slate-500">
            role: <b className="capitalize">{role}</b>
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
