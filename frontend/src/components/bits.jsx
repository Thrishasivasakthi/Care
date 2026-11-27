import React from "react";

export function Card({ title, children, right, className = "" }) {
  return (
    <section className={`bg-white border border-slate-200 rounded-xl shadow-sm ${className}`}>
      {(title || right) && (
        <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4 border-b border-slate-100">
          <h2 className="text-sm font-semibold text-slate-800">{title}</h2>
          {right}
        </div>
      )}
      <div className="p-5">{children}</div>
    </section>
  );
}

export function AssumptionTag({ className = "" }) {
  return (
    <span className={`inline-flex items-center text-[9px] font-bold uppercase tracking-wide px-2 py-1 rounded-full bg-amber-50 text-amber-800 border border-amber-200 ${className}`}
      title="Synthetic, seeded effect size — an assumption, not a prediction">
      Assumption · not a prediction
    </span>
  );
}

const STATUS_STYLES = {
  Pending: "bg-amber-50 text-amber-700 border-amber-200",
  Approved: "bg-emerald-50 text-emerald-700 border-emerald-200",
  Edited: "bg-sky-50 text-sky-700 border-sky-200",
  Rejected: "bg-rose-50 text-rose-700 border-rose-200",
  Due: "bg-slate-50 text-slate-700 border-slate-200",
  Done: "bg-emerald-50 text-emerald-700 border-emerald-200",
  Missed: "bg-rose-50 text-rose-700 border-rose-200",
  Escalated: "bg-purple-50 text-purple-700 border-purple-200",
  "Not flagged": "bg-slate-50 text-slate-500 border-slate-200",
  "No modifiable driver": "bg-slate-50 text-slate-500 border-slate-200",
};

export function StatusChip({ status }) {
  const cls = STATUS_STYLES[status] || "bg-slate-50 text-slate-600 border-slate-200";
  return <span className={`inline-flex items-center text-[10px] font-semibold px-2.5 py-1 rounded-full border ${cls}`}>{status}</span>;
}

export function Delta({ value }) {
  if (value > 0) return <span className="text-emerald-700 text-xs font-semibold">↑ {value}</span>;
  if (value < 0) return <span className="text-rose-700 text-xs font-semibold">↓ {Math.abs(value)}</span>;
  return <span className="text-slate-400 text-xs">—</span>;
}

export function Stat({ label, value, sub, accent = "text-slate-900" }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="text-[10px] uppercase tracking-wider font-semibold text-slate-500">{label}</div>
      <div className={`text-2xl font-bold tracking-tight mt-1 ${accent}`}>{value}</div>
      {sub && <div className="text-[11px] text-slate-500 mt-1 leading-relaxed">{sub}</div>}
    </div>
  );
}

export function ErrorBox({ message }) {
  if (!message) return null;
  return <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 text-rose-800 px-4 py-3 text-sm">{message}</div>;
}

export function Spinner({ label = "Loading…" }) {
  return <div className="rounded-xl border border-slate-200 bg-white text-sm text-slate-500 animate-pulse py-10 text-center">{label}</div>;
}
