import React, { useEffect, useState } from "react";
import { api, getRole, setRole } from "./api.js";
import Worklist from "./pages/Worklist.jsx";
import Patient from "./pages/Patient.jsx";
import Discharge from "./pages/Discharge.jsx";
import Ops from "./pages/Ops.jsx";
import Duel from "./pages/Duel.jsx";

const TABS = ["Worklist", "Discharge", "Duel", "Ops"];

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
  };

  const goTab = (t) => {
    setTab(t);
    if (t !== "Patient") setPatientId(null);
  };

  return (
    <div className="min-h-full flex flex-col">
      {/* ------------------------------------------------ header */}
      <header className="bg-white border-b border-slate-200 sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 py-3 flex items-center gap-4">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-md bg-teal-700 text-white grid place-items-center font-bold text-sm">
              CT
            </div>
            <div>
              <div className="font-semibold leading-tight">CareTrace</div>
              <div className="text-[11px] text-slate-500 leading-tight">
                who to call first after discharge
              </div>
            </div>
          </div>

          <nav className="ml-4 flex gap-1">
            {TABS.map((t) => (
              <button
                key={t}
                onClick={() => goTab(t)}
                className={`px-3 py-1.5 rounded-md text-sm ${
                  tab === t || (t === "Worklist" && tab === "Patient")
                    ? "bg-teal-50 text-teal-800 font-medium"
                    : "text-slate-600 hover:bg-slate-100"
                }`}
              >
                {t}
              </button>
            ))}
          </nav>

          {/* role switcher */}
          <div className="ml-auto flex items-center gap-2">
            <span className="text-xs text-slate-500">Role</span>
            <div className="flex rounded-md border border-slate-300 overflow-hidden text-sm">
              {["coordinator", "clinician"].map((r) => (
                <button
                  key={r}
                  onClick={() => switchRole(r)}
                  className={`px-3 py-1.5 capitalize ${
                    role === r
                      ? "bg-teal-700 text-white"
                      : "bg-white text-slate-600 hover:bg-slate-50"
                  }`}
                >
                  {r}
                </button>
              ))}
            </div>
          </div>
        </div>
      </header>

      {/* ------------------------------------------------ body */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 py-5">
        {tab === "Worklist" && <Worklist role={role} onOpenPatient={openPatient} />}
        {tab === "Patient" && (
          <Patient patientId={patientId} role={role} onBack={() => goTab("Worklist")} />
        )}
        {tab === "Discharge" && (
          <Discharge role={role} onOpenPatient={openPatient} />
        )}
        {tab === "Duel" && <Duel />}
        {tab === "Ops" && <Ops />}
      </main>

      {/* ------------------------------------------------ footer */}
      <footer className="bg-white border-t border-slate-200 mt-8">
        <div className="max-w-7xl mx-auto px-4 py-3 text-xs text-slate-600 space-y-1">
          <div className="font-medium text-slate-800">
            {meta?.system_rule ||
              "ML scores. Rules recommend. The optimizer prioritizes. The LLM only phrases. A clinician approves."}
          </div>
          <div className="text-slate-500">
            Decision support only. Not a diagnostic tool. Intervention effects are
            assumptions, not predictions. Dataset: UCI Diabetes 130-US Hospitals
            (1999-2008), diabetes drugs only. Every high-risk flag requires
            clinician review; every decision is logged.
          </div>
        </div>
      </footer>
    </div>
  );
}
