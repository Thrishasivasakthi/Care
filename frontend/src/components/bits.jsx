import React from "react";

export function Card({ title, children, right, className = "" }) {
  return (
    <section className={`bg-white border border-slate-200 rounded-lg ${className}`}>
      {(title || right) && (
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100">
          <h2 className="text-sm font-semibold text-slate-800">{title}</h2>
          {right}
        </div>
      )}
      <div className="p-4">{children}</div>
    </section>
  );
}

export function AssumptionTag({ className = "" }) {
  return (
    <span
      className={`inline-block text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded bg-amber-50 text-amber-700 border border-amber-200 ${className}`}
      title="Synthetic, seeded effect size — an assumption, not a prediction"
    >
      assumption, not a prediction
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
  return (
    <span className={`text-[11px] px-2 py-0.5 rounded-full border ${cls}`}>
      {status}
    </span>
  );
}

export function Delta({ value }) {
  if (value > 0)
    return <span className="text-emerald-600 text-xs font-medium">▲ {value}</span>;
  if (value < 0)
    return <span className="text-rose-600 text-xs font-medium">▼ {Math.abs(value)}</span>;
  return <span className="text-slate-400 text-xs">—</span>;
}

export function Stat({ label, value, sub, accent = "text-slate-900" }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-3">
      <div className="text-[11px] uppercase tracking-wide text-slate-500">
        {label}
      </div>
      <div className={`text-xl font-semibold ${accent}`}>{value}</div>
      {sub && <div className="text-[11px] text-slate-500 mt-0.5">{sub}</div>}
    </div>
  );
}

export function ErrorBox({ message }) {
  if (!message) return null;
  return (
    <div className="rounded-md border border-rose-200 bg-rose-50 text-rose-700 px-3 py-2 text-sm">
      {message}
    </div>
  );
}

export function Spinner({ label = "Loading…" }) {
  return (
    <div className="text-sm text-slate-500 animate-pulse py-6 text-center">
      {label}
    </div>
  );
}
