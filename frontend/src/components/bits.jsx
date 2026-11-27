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


export function InfoBanner({ children, tone = "info" }) {
  const tones = {
    info: "border-sky-200 bg-sky-50 text-sky-900",
    warning: "border-amber-200 bg-amber-50 text-amber-900",
    success: "border-emerald-200 bg-emerald-50 text-emerald-900",
  };
  return <div role="note" className={`rounded-lg border px-4 py-3 text-sm leading-relaxed ${tones[tone] || tones.info}`}>{children}</div>;
}

export function PageHeader({ title, description, action }) {
  return <div className="flex flex-wrap items-end justify-between gap-3 mb-4">
    <div><h1 className="text-2xl font-bold tracking-tight text-slate-900">{title}</h1>
      {description && <p className="mt-1 text-sm text-slate-600">{description}</p>}</div>
    {action}
  </div>;
}

export function KpiCard({ label, value, detail, tone = "default" }) {
  const colors = { default: "text-slate-900", teal: "text-teal-800", amber: "text-amber-700", red: "text-rose-700" };
  return <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm min-w-0">
    <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</div>
    <div className={`mt-1 text-2xl font-bold tracking-tight ${colors[tone] || colors.default}`}>{value}</div>
    {detail && <div className="mt-1 text-xs text-slate-500">{detail}</div>}
  </div>;
}

export function RiskBar({ value, label = "Readmission risk" }) {
  const n = Math.max(0, Math.min(1, Number(value) || 0));
  const tone = n >= .3 ? "bg-rose-600" : n >= .15 ? "bg-amber-500" : "bg-emerald-600";
  return <div className="min-w-20">
    <div className="mb-1 flex justify-between gap-2 text-xs"><span className="text-slate-500">{label}</span><strong className="text-slate-800">{(n * 100).toFixed(1)}%</strong></div>
    <div className="h-2 overflow-hidden rounded-full bg-slate-100"><div className={`h-full rounded-full ${tone}`} style={{ width: `${n * 100}%` }} /></div>
  </div>;
}

export function EmptyState({ title, description }) {
  return <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 px-5 py-9 text-center">
    <div className="text-sm font-semibold text-slate-800">{title}</div>
    {description && <p className="mx-auto mt-1 max-w-md text-sm text-slate-500">{description}</p>}
  </div>;
}

export function Skeleton({ lines = 3 }) {
  return <div aria-label="Loading" className="animate-pulse space-y-3 rounded-xl border border-slate-200 bg-white p-5">
    {Array.from({ length: lines }, (_, i) => <div key={i} className={`h-3 rounded bg-slate-100 ${i === 0 ? "w-1/3" : i === lines - 1 ? "w-2/3" : "w-full"}`} />)}
  </div>;
}
