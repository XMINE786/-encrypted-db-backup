"use client";

import { ENGINE_META } from "@/lib/format";

export function EngineChip({ engine, size = "md" }: { engine: string; size?: "sm" | "md" }) {
  const meta = ENGINE_META[engine] ?? { color: "#64748b", glyph: "?", label: engine };
  const dim = size === "sm" ? "h-6 w-6 text-[10px]" : "h-8 w-8 text-xs";
  return (
    <span className="inline-flex items-center gap-2">
      <span
        className={`grid ${dim} place-items-center rounded-lg font-semibold text-white`}
        style={{ backgroundColor: meta.color + "22", color: meta.color, boxShadow: `inset 0 0 0 1px ${meta.color}55` }}
      >
        {meta.glyph}
      </span>
    </span>
  );
}

export function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    success: "bg-emerald-500/15 text-emerald-300 ring-1 ring-emerald-500/30",
    failed: "bg-red-500/15 text-red-300 ring-1 ring-red-500/30",
    running: "bg-amber-500/15 text-amber-300 ring-1 ring-amber-500/30",
  };
  const dot: Record<string, string> = {
    success: "bg-emerald-400",
    failed: "bg-red-400",
    running: "bg-amber-400 animate-pulsebar",
  };
  return (
    <span className={`badge ${map[status] ?? "bg-white/10 text-slate-300"}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${dot[status] ?? "bg-slate-400"}`} />
      {status}
    </span>
  );
}

export function Spinner({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={`animate-spin ${className}`} fill="none">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="3" opacity="0.25" />
      <path d="M21 12a9 9 0 00-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

export function EmptyState({
  title,
  subtitle,
  action,
}: {
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="card flex flex-col items-center justify-center gap-3 py-16 text-center">
      <div className="grid h-14 w-14 place-items-center rounded-2xl bg-white/5 text-slate-500">
        <svg viewBox="0 0 24 24" className="h-7 w-7" fill="none" stroke="currentColor" strokeWidth="1.5">
          <path d="M4 7h16v13H4zM4 7l2-3h12l2 3M9 12h6" strokeLinejoin="round" />
        </svg>
      </div>
      <div>
        <p className="font-semibold text-slate-200">{title}</p>
        {subtitle && <p className="mt-1 text-sm text-slate-500">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}
