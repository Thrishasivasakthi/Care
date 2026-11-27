import React, { useEffect, useState } from "react";
import { api, getRole, setRole } from "./api.js";
import Worklist from "./pages/Worklist.jsx";
import Patient from "./pages/Patient.jsx";
import Discharge from "./pages/Discharge.jsx";
import Ops from "./pages/Ops.jsx";
import Duel from "./pages/Duel.jsx";

const TABS = [
  { id: "Worklist", label: "Care worklist", short: "Worklist", hint: "Prioritised patient queue", mark: "01" },
  { id: "Discharge", label: "Discharge", short: "Discharge", hint: "Instructions & follow-ups", mark: "02" },
  { id: "Duel", label: "Strategy duel", short: "Duel", hint: "Compare call strategies", mark: "03" },
  { id: "Ops", label: "Operations", short: "Ops", hint: "Model & service performance", mark: "04" },
];

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
          <div className="brand-mark">CT</div>
          <div>
            <div className="brand-name">CareTrace</div>
            <div className="brand-caption">who to call first after discharge</div>
          </div>
        </div>

        <div className="sidebar-section-label">WORKSPACE</div>
        <nav className="sidebar-nav" aria-label="Main navigation">
          {TABS.map((item) => {
            const selected = tab === item.id || (item.id === "Worklist" && tab === "Patient");
            return (
              <button key={item.id} onClick={() => goTab(item.id)} className={`nav-item ${selected ? "active" : ""}`}>
                <span className="nav-index">{item.mark}</span>
                <span className="nav-copy">
                  <span className="nav-label">{item.label}</span>
                  <span className="nav-hint">{item.hint}</span>
                </span>
                {selected && <span className="nav-indicator" />}
              </button>
            );
          })}
        </nav>

        <div className="sidebar-spacer" />
        <div className="sidebar-note">
          <div className="sidebar-note-kicker">CLINICAL SAFETY</div>
          <p>Decision support for care teams. Every high-risk flag requires clinician review.</p>
        </div>
        <div className="sidebar-footer">
          <span className="status-dot" /> Demo environment
        </div>
      </aside>

      <div className="app-main">
        <header className="topbar">
          <div className="topbar-context">
            <div className="eyebrow">CARE COORDINATION / {active?.short || "PATIENT"}</div>
            <div className="topbar-title">{tab === "Patient" ? "Patient overview" : active?.label}</div>
          </div>
          <div className="role-control">
            <span className="role-caption">Viewing as</span>
            <div className="role-switch" aria-label="Select role">
              {["coordinator", "clinician"].map((r) => (
                <button key={r} onClick={() => switchRole(r)} className={role === r ? "selected" : ""}>
                  {r === "coordinator" ? "Coordinator" : "Clinician"}
                </button>
              ))}
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
            <div className="page-date"><span className="status-dot" /> Live demo data</div>
          </div>

          {tab === "Worklist" && <Worklist role={role} onOpenPatient={openPatient} />}
          {tab === "Patient" && <Patient patientId={patientId} role={role} onBack={() => goTab("Worklist")} />}
          {tab === "Discharge" && <Discharge role={role} onOpenPatient={openPatient} />}
          {tab === "Duel" && <Duel />}
          {tab === "Ops" && <Ops />}
        </main>

        <footer className="app-footer">
          <div className="footer-rule">
            {meta?.system_rule || "ML scores. Rules recommend. The optimizer prioritizes. The LLM only phrases. A clinician approves."}
          </div>
          <div>Decision support only — not a diagnostic tool. Intervention effects are assumptions, not predictions. Dataset: UCI Diabetes 130-US Hospitals (1999–2008), diabetes drugs only. Every high-risk flag requires clinician review; every decision is logged.</div>
        </footer>
      </div>
    </div>
  );
}
