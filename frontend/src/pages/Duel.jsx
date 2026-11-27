import React, { useEffect, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { api } from "../api.js";
import { AssumptionTag, Card, ErrorBox, Spinner, Stat } from "../components/bits.jsx";

const COLORS = {
  human: "#64748b",
  risk_only: "#2563eb",
  caretrace: "#0f766e",
};

export default function Duel() {
  const [session, setSession] = useState(null);
  const [error, setError] = useState(null);
  const [picked, setPicked] = useState([]);
  const [hours, setHours] = useState(4);
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = () => {
    api("/duel/session")
      .then((s) => {
        setSession(s);
        setPicked([]);
        setResult(null);
        setError(null);
      })
      .catch((e) => setError(e.message));
  };

  useEffect(load, []);

  if (error) return <ErrorBox message={error} />;
  if (!session) return <Spinner label="Loading duel…" />;

  const budget = hours * 60;
  const used = picked.reduce(
    (s, n) => s + session.patients.find((p) => p.patient_nbr === n).minutes,
    0
  );

  const toggle = (nbr) => {
    if (result) return;
    const p = session.patients.find((x) => x.patient_nbr === nbr);
    if (picked.includes(nbr)) {
      setPicked(picked.filter((x) => x !== nbr));
      return;
    }
    if (used + p.minutes > budget) return; // block over-budget
    setPicked([...picked, nbr]);
  };

  const reveal = async () => {
    setBusy(true);
    try {
      const r = await api("/duel/score", {
        method: "POST",
        body: { hours, picked_patient_nbrs: picked },
      });
      setResult(r);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const chartData = result
    ? [
        {
          name: "readmissions reached",
          human: result.strategies.human.readmissions_reached,
          risk_only: result.strategies.risk_only.readmissions_reached,
          caretrace: result.strategies.caretrace.readmissions_reached,
        },
        {
          name: "expected avoided",
          human: result.strategies.human.expected_avoided_readmissions,
          risk_only: result.strategies.risk_only.expected_avoided_readmissions,
          caretrace: result.strategies.caretrace.expected_avoided_readmissions,
        },
      ]
    : [];

  return (
    <div className="space-y-4">
      <ErrorBox message={error} />

      <Card title="Beat the AI — 15 patients, your budget vs two strategies">
        <p className="text-sm text-slate-600 mb-3">
          Risk is hidden. Each patient shows age band, top drivers and the matched
          intervention + minutes. Pick the patients you would call, staying inside
          the budget. Then press <b>Reveal</b> to score your picks against
          risk-only and CareTrace on both metrics. Nothing is rigged.
        </p>

        <div className="flex flex-wrap items-center gap-4 mb-3">
          <div className="flex items-center gap-2">
            <label className="text-sm font-medium text-slate-700">Budget</label>
            <select
              value={hours}
              onChange={(e) => {
                setHours(Number(e.target.value));
                setPicked([]);
                setResult(null);
              }}
              className="text-sm border border-slate-300 rounded px-2 py-1.5"
              disabled={!!result}
            >
              {[1, 2, 3, 4, 6, 8].map((h) => (
                <option key={h} value={h}>
                  {h} h ({h * 60} min)
                </option>
              ))}
            </select>
          </div>
          <div className="text-sm">
            <span className="text-slate-500">minutes used</span>{" "}
            <span
              className={`font-semibold ${
                used >= budget ? "text-rose-700" : "text-teal-800"
              }`}
            >
              {used} / {budget}
            </span>
          </div>
          <div className="text-sm text-slate-500">
            picked {picked.length} of {session.patients.length}
          </div>
        </div>

        <div className="grid md:grid-cols-3 gap-2">
          {session.patients.map((p) => {
            const isPicked = picked.includes(p.patient_nbr);
            const overBudget = !isPicked && used + p.minutes > budget;
            return (
              <button
                key={p.patient_nbr}
                disabled={!!result || overBudget}
                onClick={() => toggle(p.patient_nbr)}
                className={`text-left border rounded-lg p-3 transition ${
                  isPicked
                    ? "border-teal-500 bg-teal-50"
                    : overBudget
                    ? "border-slate-200 bg-slate-50 opacity-50 cursor-not-allowed"
                    : "border-slate-200 bg-white hover:bg-slate-50"
                }`}
              >
                <div className="flex justify-between items-center">
                  <span className="font-mono text-xs text-slate-500">
                    #{p.patient_nbr}
                  </span>
                  <span className="text-xs text-slate-500">{p.age}</span>
                </div>
                <div className="text-xs text-slate-700 mt-1">
                  {p.top_drivers.join(", ")}
                </div>
                <div className="text-xs text-teal-800 mt-1">
                  {p.action}{" "}
                  <span className="text-slate-400">({p.minutes} min)</span>
                </div>
              </button>
            );
          })}
        </div>

        <div className="flex gap-2 mt-4">
          <button
            onClick={reveal}
            disabled={busy || picked.length === 0 || !!result}
            className="px-4 py-2 rounded-md bg-teal-700 text-white text-sm disabled:opacity-40"
          >
            {busy ? "Scoring…" : "Reveal"}
          </button>
          <button
            onClick={() => {
              setPicked([]);
              setResult(null);
            }}
            className="px-4 py-2 rounded-md border border-slate-300 text-sm"
          >
            Reset
          </button>
        </div>
      </Card>

      {result && (
        <>
          <div
            className={`rounded-md px-3 py-2 text-sm font-medium ${
              result.human_wins.length
                ? "border border-emerald-300 bg-emerald-50 text-emerald-800"
                : "border border-slate-300 bg-slate-50 text-slate-700"
            }`}
          >
            {result.sentence}
          </div>

          <Card title="Scored on the same 15 patients and the same budget">
            <div className="grid md:grid-cols-2 gap-6">
              <ResponsiveContainer width="100%" height={240}>
                <BarChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} />
                  <Tooltip />
                  <Bar dataKey="human" name="you" fill={COLORS.human} />
                  <Bar dataKey="risk_only" name="risk-only" fill={COLORS.risk_only} />
                  <Bar dataKey="caretrace" name="CareTrace" fill={COLORS.caretrace} />
                </BarChart>
              </ResponsiveContainer>
              <div>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-[11px] uppercase text-slate-500 border-b border-slate-200">
                      <th className="py-1">strategy</th>
                      <th className="text-right">calls</th>
                      <th className="text-right">minutes</th>
                      <th className="text-right">reached</th>
                      <th className="text-right">avoided</th>
                    </tr>
                  </thead>
                  <tbody>
                    {Object.entries(result.strategies).map(([k, v]) => (
                      <tr key={k} className="border-b border-slate-100">
                        <td className="py-1 font-medium">{k.replace("_", " ")}</td>
                        <td className="text-right">{v.calls_made}</td>
                        <td className="text-right">{v.minutes_used}</td>
                        <td className="text-right">{v.readmissions_reached}</td>
                        <td className="text-right">
                          {v.expected_avoided_readmissions.toFixed(3)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <div className="text-[11px] text-slate-500 mt-2">
                  {result.note} <AssumptionTag />
                </div>
              </div>
            </div>
          </Card>
        </>
      )}
    </div>
  );
}
