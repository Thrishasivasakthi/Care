import React, { useEffect, useState } from "react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { api } from "../api.js";
import { AssumptionTag, Card, ErrorBox, Spinner } from "../components/bits.jsx";

const COLORS = { human: "#64748b", risk_only: "#2563eb", caretrace: "#0f766e" };

export default function Duel() {
  const [session, setSession] = useState(null);
  const [error, setError] = useState(null);
  const [picked, setPicked] = useState([]);
  const [hours, setHours] = useState(4);
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = () => {
    api("/duel/session").then((s) => { setSession(s); setPicked([]); setResult(null); setError(null); }).catch((e) => setError(e.message));
  };
  useEffect(load, []);
  if (error) return <ErrorBox message={error} />;
  if (!session) return <Spinner label="Loading duel…" />;

  const budget = hours * 60;
  const used = picked.reduce((sum, nbr) => sum + session.patients.find((p) => p.patient_nbr === nbr).minutes, 0);
  const remaining = Math.max(0, budget - used);
  const utilization = budget ? Math.min(100, used / budget * 100) : 0;
  const tone = utilization >= 100 ? "danger" : utilization >= 80 ? "warning" : "safe";

  const toggle = (nbr) => {
    if (result) return;
    const p = session.patients.find((x) => x.patient_nbr === nbr);
    if (picked.includes(nbr)) { setPicked(picked.filter((x) => x !== nbr)); return; }
    if (used + p.minutes > budget) return;
    setPicked([...picked, nbr]);
  };

  const reveal = async () => {
    setBusy(true);
    try {
      const r = await api("/duel/score", { method: "POST", body: { hours, picked_patient_nbrs: picked } });
      setResult(r);
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  };

  const chartData = result ? [
    { name: "Reached", human: result.strategies.human.readmissions_reached, risk_only: result.strategies.risk_only.readmissions_reached, caretrace: result.strategies.caretrace.readmissions_reached },
    { name: "Expected avoided", human: result.strategies.human.expected_avoided_readmissions, risk_only: result.strategies.risk_only.expected_avoided_readmissions, caretrace: result.strategies.caretrace.expected_avoided_readmissions },
  ] : [];

  return <div className="duel-page">
    <ErrorBox message={error} />
    <div className="duel-heading-row">
      <div><div className="duel-eyebrow">HUMAN JUDGMENT VS OPTIMIZATION</div><h2>Strategy Duel</h2><p>Choose who gets a care-team call. Stay within the same time budget, then compare the outcomes.</p></div>
      <div className="duel-patient-count"><strong>{session.patients.length}</strong><span>patients in this round</span></div>
    </div>

    <Card title="Your care-team budget" right={<span className="duel-live-label"><i /> SELECTION ROUND</span>}>
      <div className="duel-budget-controls">
        <div><label htmlFor="duel-budget">Available time</label><select id="duel-budget" value={hours} onChange={(e) => { setHours(Number(e.target.value)); setPicked([]); setResult(null); }} disabled={!!result} className="duel-budget-select">{[1, 2, 3, 4, 6, 8].map((h) => <option key={h} value={h}>{h} hour{h > 1 ? "s" : ""} · {h * 60} min</option>)}</select></div>
        <div className="duel-budget-numbers"><div><span>Time used</span><strong>{used}<small> / {budget} min</small></strong></div><div><span>Remaining</span><strong>{remaining}<small> min</small></strong></div><div><span>Patients picked</span><strong>{picked.length}<small> / {session.patients.length}</small></strong></div></div>
      </div>
      <div className="duel-progress-track"><div className={"duel-progress-fill " + tone} style={{ width: utilization + "%" }} /></div>
      <div className="duel-progress-caption"><span>{Math.round(utilization)}% of available time allocated</span><span className={"duel-budget-state " + tone}>{tone === "danger" ? "Budget fully used" : tone === "warning" ? "Approaching limit" : "Within budget"}</span></div>
    </Card>

    <div className="duel-selection-header"><div><h3>Select your patients</h3><p>Risk scores are hidden. Choose based on the visible patient context and matched intervention.</p></div><span>{picked.length} selected</span></div>
    <div className="duel-patient-grid">
      {session.patients.map((p) => {
        const isPicked = picked.includes(p.patient_nbr);
        const overBudget = !isPicked && used + p.minutes > budget;
        return <button key={p.patient_nbr} disabled={!!result || overBudget} title={overBudget ? "Not enough minutes remaining for this intervention" : isPicked ? "Remove from your selection" : "Add patient to your selection"} onClick={() => toggle(p.patient_nbr)} className={"duel-patient-card " + (isPicked ? "selected" : "") + (overBudget ? " over-budget" : "")}>
          <div className="duel-patient-card-top"><span className="duel-patient-id">PATIENT #{p.patient_nbr}</span><span className="duel-age">{p.age}</span></div>
          <div className="duel-driver-label">TOP MODIFIABLE DRIVERS</div>
          <div className="duel-drivers">{p.top_drivers.map((driver) => <span key={driver}>{driver}</span>)}</div>
          <div className="duel-action-row"><div><small>MATCHED INTERVENTION</small><b>{p.action}</b></div><div className="duel-minutes">{p.minutes}<small>min</small></div></div>
          <div className="duel-card-select-state">{isPicked ? <><span>✓</span> Added to your calls</> : overBudget ? "Over remaining budget" : "＋ Add patient"}</div>
        </button>;
      })}
    </div>

    <div className="duel-action-bar">
      <div className="duel-action-hint">{result ? "Round scored. Reset to try a different strategy." : "Your selections stay private until you reveal the score."}</div>
      <div className="duel-action-buttons">
        <button className="duel-reset-button" onClick={() => { setPicked([]); setResult(null); }}>Reset picks</button>
        <button className="duel-reveal-button" onClick={reveal} disabled={busy || picked.length === 0 || !!result}>{busy ? "Scoring…" : result ? "Results revealed" : "Reveal results"} <span>↗</span></button>
      </div>
    </div>

    {result && <>
      <div className="duel-result-banner"><div className="duel-result-icon">✦</div><div><div className="duel-eyebrow">ROUND COMPLETE</div><strong>{result.sentence}</strong></div></div>
      <Card title="Same patients. Same time budget. Three strategies." right={<AssumptionTag />}>
        <div className="duel-result-legend"><span><i style={{background:COLORS.human}} /> Your picks</span><span><i style={{background:COLORS.risk_only}} /> Risk-only</span><span><i style={{background:COLORS.caretrace}} /> CareTrace</span></div>
        <div className="duel-results-layout">
          <div className="duel-result-chart"><ResponsiveContainer width="100%" height={270}><BarChart data={chartData} margin={{top:10,right:8,left:0,bottom:5}}><CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E8EDF2" /><XAxis dataKey="name" tick={{fontSize:10,fill:"#64748B"}} axisLine={false} tickLine={false} /><YAxis tick={{fontSize:10,fill:"#94A3B8"}} axisLine={false} tickLine={false} /><Tooltip contentStyle={{borderRadius:12,border:"1px solid #E2E8F0",fontSize:11}} /><Bar dataKey="human" name="Your picks" fill={COLORS.human} radius={[5,5,0,0]} /><Bar dataKey="risk_only" name="Risk-only" fill={COLORS.risk_only} radius={[5,5,0,0]} /><Bar dataKey="caretrace" name="CareTrace" fill={COLORS.caretrace} radius={[5,5,0,0]} /></BarChart></ResponsiveContainer></div>
          <div className="duel-result-table-wrap"><table className="duel-result-table"><thead><tr><th>Strategy</th><th>Calls</th><th>Minutes</th><th>Reached</th><th>Avoided*</th></tr></thead><tbody>{Object.entries(result.strategies).map(([key,v]) => <tr key={key}><td><span className={"duel-strategy-dot " + key} />{key === "human" ? "Your picks" : key.replace("_"," ")}</td><td>{v.calls_made}</td><td>{v.minutes_used}</td><td>{v.readmissions_reached}</td><td>{v.expected_avoided_readmissions.toFixed(3)}</td></tr>)}</tbody></table><p className="duel-result-note">{result.note} Expected avoided readmissions use assumed intervention effects, not causal evidence.</p></div>
        </div>
      </Card>
    </>}
  </div>;
}
