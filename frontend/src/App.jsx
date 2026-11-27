import React, { useEffect, useState } from "react";
import { api, getRole, setRole } from "./api.js";
import Worklist from "./pages/Worklist.jsx";
import Patient from "./pages/Patient.jsx";
import Discharge from "./pages/Discharge.jsx";
import Ops from "./pages/Ops.jsx";
import Duel from "./pages/Duel.jsx";
import { InfoBanner } from "./components/bits.jsx";

const TABS = [
  { id: "Worklist", label: "Care worklist", short: "Worklist", hint: "Prioritised patient queue", mark: "01", icon: "inbox" },
  { id: "Discharge", label: "Discharge", short: "Discharge", hint: "Instructions & follow-ups", mark: "02", icon: "clipboard" },
  { id: "Duel", label: "Strategy duel", short: "Duel", hint: "Compare call strategies", mark: "03", icon: "scale" },
  { id: "Ops", label: "Operations", short: "Ops", hint: "Model & service performance", mark: "04", icon: "activity" },
];

function NavIcon({ name }) {
  const common = { width: 19, height: 19, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": true };
  const paths = {
    inbox: <><path d="M4 4h16v16H4z" /><path d="M4 13h4l2 3h4l2-3h4" /></>,
    clipboard: <><rect x="5" y="4" width="14" height="17" rx="2" /><path d="M9 4.5h6M9 10h6M9 14h6M9 18h3" /><path d="M9 2.5h6v4H9z" /></>,
    scale: <><path d="M12 3v18M5 6h14M7 6l-4 8h8L7 6ZM17 6l-4 8h8l-4-8Z" /><path d="M8 21h8" /></>,
    activity: <><path d="M3 12h4l3-8 4 16 3-8h4" /></>,
  };
  return <svg {...common}>{paths[name] || paths.activity}</svg>;
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

  return (
    <div className="app-shell min-h-screen">
      <aside className="app-sidebar">
        <div className="brand-lockup">
          <div className="brand-mark" aria-hidden="true">
            <svg viewBox="0 0 32 32" width="25" height="25" fill="none">
              <path d="M16 3.5 27 8v7.1c0 7-4.6 11.3-11 13.4C9.6 26.4 5 22.1 5 15.1V8l11-4.5Z" stroke="currentColor" strokeWidth="2" />
              <path d="M9.5 16h4l2-4 3.2 8 2-4h2" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>
          <div>
            <div className="brand-name">CareTrace</div>
            <div className="brand-caption">Readmission risk before discharge</div>
          </div>
        </div>

        <div className="sidebar-section-label">WORKSPACE</div>
        <nav className="sidebar-nav" aria-label="Main navigation">
          {TABS.map((item) => {
            const selected = tab === item.id || (item.id === "Worklist" && tab === "Patient");
            return (
              <button key={item.id} onClick={() => goTab(item.id)} className={`nav-item ${selected ? "active" : ""}`} aria-current={selected ? "page" : undefined}>
                <span className="nav-icon"><NavIcon name={item.icon} /></span>
                <span className="nav-copy">
                  <span className="nav-label">{item.label}</span>
                  <span className="nav-hint">{item.hint}</span>
                </span>
              </button>
            );
          })}
        </nav>

        <div className="sidebar-spacer" />
        <section className="sidebar-note" aria-label="Clinical safety">
          <div className="sidebar-note-heading">
            <span className="safety-icon"><svg viewBox="0 0 20 20" width="15" height="15" fill="none"><path d="M10 2.2 16 4.7v4.1c0 4-2.5 6.5-6 8-3.5-1.5-6-4-6-8V4.7l6-2.5Z" stroke="currentColor" strokeWidth="1.5"/><path d="m7 9.8 2 2 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg></span>
            <span>Clinical safety</span>
          </div>
          <p>Decision support for care teams. Every high-risk flag requires clinician review.</p>
        </section>
        <div className="sidebar-footer"><span className="status-dot" /> Demo environment</div>
      </aside>

      <div className="app-main">
        <header className="topbar">
          <div className="breadcrumb" aria-label="Breadcrumb">
            <span>Care coordination</span><span className="breadcrumb-divider">/</span>
            <strong>{tab === "Patient" ? "Patient overview" : active?.short || "Workspace"}</strong>
          </div>
          <div className="topbar-actions">
            <div className="live-pill"><span className="status-dot" /> Live demo data</div>
            <div className="role-control">
              <span className="role-avatar" aria-hidden="true">{role === "coordinator" ? "CO" : "CL"}</span>
              <span className="role-caption">Viewing as</span>
              <div className="role-switch" aria-label="Select role">
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
              <div className="eyebrow">CARETRACE WORKSPACE</div>
              <h1>{tab === "Patient" ? "Patient overview" : active?.label}</h1>
              <p>{tab === "Patient" ? "Review patient context, care recommendations and clinician decisions." : active?.hint}</p>
            </div>
          </div>

          <div className="mb-4"><InfoBanner tone="warning">Intervention effect sizes and avoided-readmission estimates are assumptions for this demo, not clinical predictions or evidence of causal impact. Use the model output as decision support only; clinician review remains required.</InfoBanner></div>

          {tab === "Worklist" && <Worklist role={role} onOpenPatient={openPatient} />}
          {tab === "Patient" && <Patient patientId={patientId} role={role} onBack={() => goTab("Worklist")} />}
          {tab === "Discharge" && <Discharge role={role} onOpenPatient={openPatient} />}
          {tab === "Duel" && <Duel />}
          {tab === "Ops" && <Ops />}
        </main>

        <footer className="app-footer">
          Decision support only — not a diagnostic tool. Intervention effects are assumptions, not predictions. Dataset: UCI Diabetes 130-US Hospitals (1999–2008), diabetes drugs only. High-risk flags require clinician review; decisions are logged.
        </footer>
      </div>
    </div>
  );
}
