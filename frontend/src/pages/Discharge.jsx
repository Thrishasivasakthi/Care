import React, { useEffect, useState } from "react";
import { api } from "../api.js";
import { Card, ErrorBox, Spinner, StatusChip, AssumptionTag } from "../components/bits.jsx";

const TASK_STATUSES = ["Due", "Done", "Missed", "Escalated"];
const LANGUAGES = [{ value: "", label: "English" }, { value: "hi", label: "Hindi" }, { value: "mr", label: "Marathi" }, { value: "ta", label: "Tamil" }];

function TaskTimeline({ tasks, demoDate, onPatch }) {
  if (!tasks?.length) return <div className="discharge-empty">No follow-up tasks yet. Approve a care plan on the patient page first.</div>;
  return <div className="discharge-task-list">
    {tasks.map((task, index) => {
      const future = Boolean(task.due_date && demoDate && task.due_date > demoDate);
      return <div className="discharge-task-row" key={task.id}>
        <div className="discharge-task-marker"><span>{index + 1}</span></div>
        <div className="discharge-task-main"><div className="discharge-task-title">{task.title}</div><div className="discharge-task-meta"><span>{task.due_date || "Date not set"}</span>{future && <span className="discharge-future-tag">Upcoming</span>}</div></div>
        <div className="discharge-task-state"><StatusChip status={task.status} /></div>
        <select aria-label={"Update status for " + task.title} value={task.status} onChange={(e) => onPatch(task.id, e.target.value)} className="discharge-task-select">
          {TASK_STATUSES.map((status) => <option key={status} value={status} disabled={future && status === "Done"}>{status}</option>)}
        </select>
      </div>;
    })}
  </div>;
}


function HandoutPaper({ patientNbr, demoDate, content, language }) {
  const rawLines = String(content?.text || "").split(/\\r?\\n/).map((line) => line.replace(/^\\s*[-•]\\s*/, "").trim()).filter(Boolean);
  let heading = "After your hospital stay";
  if (rawLines.length && rawLines[0].length < 65 && !/[.!?।]$/.test(rawLines[0])) heading = rawLines.shift();
  let lines = rawLines;
  if (lines.length === 1) {
    const split = lines[0].split(/(?<=[.!?।])\\s+/).filter(Boolean);
    if (split.length > 1) lines = split;
  }
  const helpIndex = lines.findIndex((line) => /emergency|much worse|worse|urgent|आपातकाल|बिगड़|அவசர|மோசமட|आपत्कालीन|बिघड/i.test(line));
  const helpText = helpIndex >= 0 ? lines[helpIndex] : null;
  const steps = lines.filter((_, index) => index !== helpIndex);
  const filled = Object.keys(content?.slots_used || {}).length;
  return (
    <div className="discharge-printable" lang={language || "en"}>
      <header className="discharge-paper-header">
        <div>
          <span className="discharge-paper-kicker">CARETRACE · CARE COORDINATION</span>
          <h2>Patient #{patientNbr}</h2>
          <p>Prepared {demoDate || "Date not supplied"}</p>
        </div>
        <span className={content?.verified ? "discharge-verified-pill verified" : "discharge-verified-pill unverified"}>
          {content?.verified ? "✓ Verified: every value filled from the record" : "⚠ Verification needed"}
        </span>
      </header>
      <div className="discharge-paper-rule" />
      <h3>{heading}</h3>
      <ol className="discharge-paper-steps">
        {steps.map((line, index) => <li key={index}><span>{index + 1}</span><p>{line}</p></li>)}
      </ol>
      {helpText && <aside className="discharge-paper-help"><strong>When to get help</strong><p>{helpText}</p></aside>}
      <div className="discharge-paper-verification">{filled} of 3 record slots filled · {content?.verified ? "No unfilled placeholders remain." : "Some record values could not be filled."}</div>
      <footer className="discharge-paper-footer">Decision support, reviewed by your care team.</footer>
    </div>
  );
}
\nexport default function Discharge({ role, onOpenPatient }) {
  const [list, setList] = useState(null);
  const [patientId, setPatientId] = useState(null);
  const [d, setD] = useState(null);
  const [regionalLang, setRegionalLang] = useState("");
  const [regional, setRegional] = useState(null);
  const [error, setError] = useState(null);
  const [flash, setFlash] = useState(null);
  const [view, setView] = useState("instructions");
  const [chatInput, setChatInput] = useState("");
  const [chat, setChat] = useState([]);
  const [chatBusy, setChatBusy] = useState(false);
  const [escalations, setEscalations] = useState([]);

  useEffect(() => {
    api("/worklist?hours=4").then((w) => { setList(w.ranking); if (w.ranking.length) setPatientId(w.ranking[0].patient_id); }).catch((e) => setError(e.message));
  }, []);

  useEffect(() => {
    if (!patientId) return;
    setD(null); setRegional(null); setChat([]);
    api("/discharge/" + patientId).then((x) => { setD(x); setError(null); }).catch((e) => setError(e.message));
    api("/escalations").then((e) => setEscalations(e.escalations || [])).catch(() => {});
  }, [patientId]);

  useEffect(() => {
    if (!patientId || !regionalLang) { setRegional(null); return; }
    api("/discharge/" + patientId + "?lang=" + regionalLang).then((x) => setRegional(x.regional_instructions)).catch((e) => setError(e.message));
  }, [patientId, regionalLang]);

  const patchTask = async (id, status) => {
    try {
      await api("/tasks/" + id, { method: "PATCH", body: { status } });
      setFlash("Task #" + id + " updated to " + status + " and logged in audit.");
      setD(await api("/discharge/" + patientId));
    } catch (e) { setError(e.message); }
  };

  const sendChat = async () => {
    if (!chatInput.trim() || !patientId) return;
    const msg = chatInput.trim();
    setChatInput("");
    setChat((c) => [...c, { role: "patient", text: msg }]);
    setChatBusy(true);
    try {
      const r = await api("/checkin/" + patientId + "/message", { method: "POST", body: { message: msg } });
      setChat((c) => [...c, { role: "agent", text: r.reply, barrier: r.barrier, escalationId: r.escalation_id }]);
      api("/escalations").then((e) => setEscalations(e.escalations || [])).catch(() => {});
    } catch (e) { setError(e.message); } finally { setChatBusy(false); }
  };

  const decideEscalation = async (id, action) => {
    try {
      await api("/escalation/" + id + "/decision", { method: "POST", body: { action, note: "reviewed in demo" } });
      const e = await api("/escalations");
      setEscalations(e.escalations || []);
      setFlash("Escalation #" + id + (action === "approve" ? " approved." : " rejected."));
    } catch (e) { setError(e.message); }
  };

  const selected = (list || []).find((item) => item.patient_id === patientId);
  const ins = d?.instructions;

  return <div className="discharge-page">
    <ErrorBox message={error} />
    {flash && <div className="discharge-flash"><span>✓</span>{flash}<button onClick={() => setFlash(null)} aria-label="Dismiss notification">×</button></div>}
    <div className="discharge-workspace">
      <aside className="discharge-patient-panel">
        <div className="discharge-panel-eyebrow">CARE COORDINATION</div>
        <h2>Discharge workspace</h2>
        <p className="discharge-panel-copy">Prepare a clear handoff and keep post-discharge follow-up visible.</p>
        <div className="discharge-field-label">SELECTED PATIENT</div>
        <select value={patientId ?? ""} onChange={(e) => setPatientId(Number(e.target.value))} className="discharge-patient-select">
          {(list || []).map((r) => <option key={r.patient_id} value={r.patient_id}>Patient #{r.patient_nbr} · {(r.risk * 100).toFixed(1)}% risk</option>)}
        </select>
        {selected && <div className="discharge-patient-summary">
          <div className="discharge-patient-avatar">#{String(selected.patient_nbr).slice(-2)}</div>
          <div><div className="discharge-patient-number">Patient #{selected.patient_nbr}</div><div className="discharge-patient-id">Record ID {selected.patient_id}</div></div>
          <span className="discharge-risk-pill">{(selected.risk * 100).toFixed(1)}% risk</span>
        </div>}
        <button className="discharge-open-patient" onClick={() => patientId && onOpenPatient(patientId)}>Open full patient record <span>↗</span></button>
        <div className="discharge-panel-divider" />
        <div className="discharge-panel-label">WORKFLOW</div>
        <button onClick={() => setView("instructions")} className={"discharge-workflow-item " + (view === "instructions" ? "active" : "")}><span className="discharge-workflow-icon">▤</span><span><b>Discharge handout</b><small>Instructions and language</small></span><span className="discharge-workflow-arrow">›</span></button>
        <button onClick={() => setView("checkin")} className={"discharge-workflow-item " + (view === "checkin" ? "active" : "")}><span className="discharge-workflow-icon">◌</span><span><b>Post-discharge check-in</b><small>Patient barriers and escalation</small></span><span className="discharge-workflow-arrow">›</span></button>
        <div className="discharge-panel-foot"><span className="discharge-live-dot" /> Demo environment · changes are audit logged</div>
      </aside>

      <div className="discharge-main-column">
        {!d ? <Spinner label="Loading discharge record…" /> : view === "instructions" ? <>
          <Card title="Discharge handout" right={<button type="button" className="discharge-print-button" onClick={() => window.print()}>Print or save as PDF</button>}>
            <div className="discharge-handout-head"><div><div className="discharge-section-eyebrow">AFTER YOUR HOSPITAL STAY</div><h2>Care instructions</h2><p>Review the information below with the patient before discharge.</p></div><span className={"discharge-verified-pill " + (ins.verified ? "verified" : "unverified")}>{ins.verified ? "✓ Record-verified slots" : "⚠ Verification needed"}</span></div>
            <HandoutPaper patientNbr={d.patient_nbr} demoDate={d.demo_date} content={ins} language="en" />
            <div className="discharge-source-note"><span>ⓘ</span><div><b>{ins.source === "llm" ? "LLM phrasing · record-filled slots" : "Fixed template · no LLM key"}</b><p>The LLM only phrases placeholder text. Code fills {Object.keys(ins.slots_used).join(", ") || "—"} from the patient record; it does not write drug names, dates, doses or numbers. {ins.note}</p></div></div>
            <div className="discharge-language-row"><div><b>Language</b><small>Choose a patient-facing language</small></div><div className="discharge-language-tabs">{LANGUAGES.map((lang) => <button type="button" key={lang.value} className={regionalLang === lang.value ? "active" : ""} onClick={() => setRegionalLang(lang.value)}>{lang.label}</button>)}</div>
              {regional && <span className={"discharge-verified-pill " + (regional.verified ? "verified" : "unverified")}>{regional.verified ? "✓ Verified" : "⚠ Unverified"}</span>}</div>
            {regional && <><HandoutPaper patientNbr={d.patient_nbr} demoDate={d.demo_date} content={regional} language={regionalLang} />{regional.needs_native_review && <div className="discharge-review-note">Regional text needs native-speaker review before clinical use.</div>}
              <details className="discharge-back-translation"><summary>View back-translation</summary><p>{regional.back_translation}</p><small>Readability aid only — not clinically verified. {regional.note}</small></details></>}
          </Card>
          {d.intervention && <Card title="Matched follow-up intervention" right={<AssumptionTag />}><div className="discharge-intervention"><div><b>{d.intervention.name}</b><p>Suggested window: day {d.intervention.window_start_day}–{d.intervention.window_end_day}</p></div><strong>{d.intervention.minutes}<small>min</small></strong></div></Card>}
        </> : <>
          <Card title="Post-discharge check-in agent" right={<span className="discharge-card-context">SIMULATED CONVERSATION</span>}>
            <div className="discharge-agent-note"><span>ⓘ</span><p>This simulation identifies barriers and routes them to the care team. The agent does not change medication, provide doses or give medical advice.</p></div>
            <div className="discharge-chat-window">
              {chat.length === 0 && <div className="discharge-chat-empty"><div>◌</div><b>Start a patient check-in</b><p>Try: “I skipped my dose because it costs too much” or “Can I double my insulin dose?”</p></div>}
              {chat.map((message, i) => <div key={i} className={"discharge-chat-message " + (message.role === "patient" ? "patient" : "agent")}>{message.role === "agent" && message.barrier && <div className="discharge-barrier-tag">BARRIER · {message.barrier}{message.escalationId ? " · ESCALATION #" + message.escalationId : ""}</div>}{message.text}</div>)}
              {chatBusy && <div className="discharge-agent-typing"><i /><i /><i /> Agent is responding…</div>}
            </div>
            <div className="discharge-chat-compose"><input value={chatInput} onChange={(e) => setChatInput(e.target.value)} onKeyDown={(e) => e.key === "Enter" && sendChat()} placeholder="Type a message as the patient…" /><button onClick={sendChat} disabled={chatBusy || !chatInput.trim()}>Send <span>↑</span></button></div>
          </Card>
          <Card title="Clinician escalation queue" right={<span className="discharge-card-context">{escalations.length} TOTAL</span>}>
            {escalations.length === 0 ? <div className="discharge-empty">No escalations yet. Patient barriers identified during check-in will appear here.</div> : <div className="discharge-escalations">{escalations.map((e) => <div className="discharge-escalation-row" key={e.id}>
              <div className="discharge-escalation-top"><b>Escalation #{e.id} · Patient #{e.patient_nbr}</b><StatusChip status={e.status} /></div><p><b>{e.barrier}</b> · “{e.message}”</p>
              {e.status === "Pending" && (role === "clinician" ? <div className="discharge-decision-actions"><button onClick={() => decideEscalation(e.id, "approve")}>Approve</button><button onClick={() => decideEscalation(e.id, "reject")}>Reject</button></div> : <small>Clinician review required</small>)}
            </div>)}</div>}
          </Card>
        </>}
      </div>
    </div>

    <Card title="Follow-up task timeline" right={<span className="discharge-card-context">ROLE · {role.toUpperCase()}</span>}>
      <div className="discharge-timeline-intro"><p>Track the planned care touchpoints after discharge. Status changes are recorded in the audit log.</p>{d?.demo_date && <span>Demo date · {d.demo_date}</span>}</div>
      {!d ? <Spinner /> : <div className="discharge-task-list">
        {!d.tasks?.length ? <div className="discharge-empty">No follow-up tasks yet. Approve a care plan on the patient page first.</div> : d.tasks.map((task, index) => {
          const future = Boolean(task.due_date && d.demo_date && task.due_date > d.demo_date);
          const displayStatus = future && task.status === "Done" ? "Due" : task.status;
          return <div className="discharge-task-row" key={task.id}>
            <div className="discharge-task-marker"><span>{index + 1}</span></div>
            <div className="discharge-task-main"><div className="discharge-task-title">{task.title}</div><div className="discharge-task-meta"><span>{task.due_date || "Date not set"}</span>{future && <span className="discharge-future-tag">Upcoming</span>}</div></div>
            <div className="discharge-task-state"><StatusChip status={task.status} /></div>
            <select aria-label={"Update status for " + task.title} value={task.status} onChange={(e) => patchTask(task.id, e.target.value)} className="discharge-task-select">{TASK_STATUSES.map((status) => <option key={status} value={status} disabled={future && status === "Done"}>{status}</option>)}</select>
          </div>;
        })}
      </div>}
      {d?.intervention && <div className="discharge-task-assumption">Tasks are matched to <b>{d.intervention.name}</b> · {d.intervention.minutes} minutes <AssumptionTag /></div>}
    </Card>
  </div>;
}
