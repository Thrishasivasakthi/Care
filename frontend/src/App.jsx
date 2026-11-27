import React, { useEffect, useState } from "react";
import { api, getRole, setRole } from "./api.js";
import Worklist from "./pages/Worklist.jsx";
import Patient from "./pages/Patient.jsx";
import Discharge from "./pages/Discharge.jsx";
import Ops from "./pages/Ops.jsx";
import Duel from "./pages/Duel.jsx";

const TABS = [
  { id: "Worklist", label: "Worklist" },
  { id: "Discharge", label: "Discharge" },
  { id: "Duel", label: "Duel" },
  { id: "Ops", label: "Ops" },
];

const ASSUMPTION_TEXT =
  "Intervention effect sizes and avoided-readmission estimates are assumptions for this demo, not clinical predictions or evidence of causal impact. The model estimates 30-day readmission risk from historical data. It does not establish that an intervention will prevent a readmission. Use outputs as decision support only; clinician review remains required.";

function Icon({ name, size = 18 }) {
  const paths = {
    search: <><circle cx="10.8" cy="10.8" r="6.8" /><path d="m16 16 4.5 4.5" /></>,
    bell: <><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9" /><path d="M10 21h4" /></>,
  };
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>;
}

function BrandMark() {
  return <span className="brand-mark" aria-hidden="true">
    <svg viewBox="0 0 32 32" width="24" height="24" fill="none">
      <path d="M16 3.5 27 8v7.1c0 7-4.6 11.3-11 13.4C9.6 26.4 5 22.1 5 15.1V8l11-4.5Z" stroke="currentColor" strokeWidth="2" />
      <path d="M9.5 16h4l2-4 3.2 8 2-4h2" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  </span>;
}

export default function App() {
  const [role, setRoleState] = useState(getRole());
  const [tab, setTab] = useState("Worklist");
  const [patientId, setPatientId] = useState(null);
  const [meta, setMeta] = useState(null);

  useEffect(() => {
    api("/meta").then(setMeta).catch(() => {});
  }, []);

  const switchRole = (r) => {
    setRole(r);
    setRoleState(r);
  };
  const openPatient = (id) => {
    setPatientId(id);
    setTab("Patient");
    window.scrollTo({ top: 0, behavior: "smooth" });
  };
  const goTab = (t) => {
    setTab(t);
    if (t !== "Patient") setPatientId(null);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };
  const active = TABS.find((t) => t.id === (tab === "Patient" ? "Worklist" : tab));
  const pageTitle = tab === "Patient" ? "Patient overview" : active?.label || "CareTrace";
  const pageDescription = tab === "Patient"
    ? "Review patient context, care recommendations and clinician decisions."
    : ({
        Worklist: "Prioritise 30-day readmission risk within the care team's available time.",
        Discharge: "Prepare clear discharge instructions and coordinate follow-up.",
        Duel: "Compare patient selections within a shared care-coordination budget.",
        Ops: "Review model performance, replay results and operating assumptions.",
      }[tab] || "");

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand-lockup">
          <BrandMark />
          <div className="brand-copy">
            <div className="brand-name">CareTrace</div>
            <div className="brand-caption">Readmission risk before discharge</div>
          </div>
        </div>

        <nav className="top-nav" aria-label="Main navigation">
          {TABS.map((item) => (
            <button key={item.id} onClick={() => goTab(item.id)} className={tab === item.id || (item.id === "Worklist" && tab === "Patient") ? "active" : ""} aria-current={tab === item.id || (item.id === "Worklist" && tab === "Patient") ? "page" : undefined}>
              {item.label}
            </button>
          ))}
        </nav>

        <div className="topbar-actions">
          <button className="icon-button" type="button" aria-label="Search" title="Search (demo)">
            <Icon name="search" />
          </button>
          <button className="icon-button notification-button" type="button" aria-label="Notifications" title="Notifications (demo)">
            <Icon name="bell" />
            <span className="notification-dot" />
          </button>
          <div className="role-control" aria-label="Select role">
            <span className="role-avatar" aria-hidden="true">{role === "coordinator" ? "CO" : "CL"}</span>
            <div className="role-switch">
              {["coordinator", "clinician"].map((r) => (
                <button key={r} onClick={() => switchRole(r)} className={role === r ? "selected" : ""} aria-pressed={role === r}>
                  {r === "coordinator" ? "Coordinator" : "Clinician"}
                </button>
              ))}
            </div>
          </div>
        </div>
      </header>

      <main className="page-content">
        <div className="page-intro">
          <div>
            <h1>{pageTitle}</h1>
            <p>{pageDescription}</p>
          </div>
          <details className="assumptions-popover">
            <summary><span className="info-mark">i</span> Assumptions</summary>
            <div className="assumptions-content">{ASSUMPTION_TEXT}</div>
          </details>
        </div>

        {tab === "Worklist" && <Worklist role={role} onOpenPatient={openPatient} />}
        {tab === "Patient" && <Patient patientId={patientId} role={role} onBack={() => goTab("Worklist")} />}
        {tab === "Discharge" && <Discharge role={role} onOpenPatient={openPatient} />}
        {tab === "Duel" && <Duel />}
        {tab === "Ops" && <Ops />}
      </main>

      <footer className="app-footer">
        <span>Clinical safety: decision support only, not a diagnostic tool. High-risk flags require clinician review; decisions are logged.</span>
        <span>{ASSUMPTION_TEXT}</span>
      </footer>
    </div>
  );
}
