"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { EngineChip, StatusBadge, Spinner, EmptyState } from "@/components/ui";
import { formatBytes, timeAgo } from "@/lib/format";

interface Conn {
  id: number;
  name: string;
  engine: string;
  schedule: string | null;
}
interface Backup {
  id: number;
  connectionName: string;
  engine: string;
  status: string;
  size_bytes: number;
  started_at: string;
}

export function DashboardClient() {
  const [conns, setConns] = useState<Conn[] | null>(null);
  const [backups, setBackups] = useState<Backup[] | null>(null);

  useEffect(() => {
    fetch("/api/connections").then((r) => r.json()).then(setConns);
    fetch("/api/backups?limit=200").then((r) => r.json()).then(setBackups);
  }, []);

  if (!conns || !backups) {
    return (
      <div className="flex justify-center py-20 text-slate-500">
        <Spinner className="h-6 w-6" />
      </div>
    );
  }

  const succeeded = backups.filter((b) => b.status === "success");
  const failed = backups.filter((b) => b.status === "failed");
  const totalBytes = succeeded.reduce((a, b) => a + (b.size_bytes || 0), 0);
  const scheduled = conns.filter((c) => c.schedule).length;

  const stats = [
    { label: "Backup sources", value: conns.length, hint: `${scheduled} scheduled`, hintClass: "text-brand-300" },
    { label: "Successful backups", value: succeeded.length, hint: "stored & encrypted", hintClass: "text-emerald-400" },
    { label: "Encrypted on disk", value: formatBytes(totalBytes), hint: "AES-256-GCM", hintClass: "text-accent-400" },
    { label: "Failures", value: failed.length, hint: failed.length ? "needs attention" : "all healthy", hintClass: failed.length ? "text-red-400" : "text-slate-500" },
  ];

  return (
    <div className="space-y-8">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {stats.map((s) => (
          <div key={s.label} className="card animate-fade-in p-5">
            <div className="text-xs uppercase tracking-wide text-slate-500">{s.label}</div>
            <div className="mt-2 text-3xl font-semibold text-white">{s.value}</div>
            <div className={`mt-1 text-xs ${s.hintClass}`}>{s.hint}</div>
          </div>
        ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Recent activity */}
        <div className="lg:col-span-2">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-slate-300">Recent activity</h2>
            <Link href="/backups" className="text-xs text-brand-300 hover:text-brand-200">
              View all →
            </Link>
          </div>
          {succeeded.length === 0 && failed.length === 0 && backups.length === 0 ? (
            <EmptyState title="Nothing backed up yet" subtitle="Add a source and run your first backup." />
          ) : (
            <div className="card divide-y divide-white/5">
              {backups.slice(0, 8).map((b) => (
                <div key={b.id} className="flex items-center justify-between gap-3 px-4 py-3">
                  <div className="flex min-w-0 items-center gap-3">
                    <EngineChip engine={b.engine} size="sm" />
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium text-slate-200">{b.connectionName}</div>
                      <div className="text-xs text-slate-500">{timeAgo(b.started_at)}</div>
                    </div>
                  </div>
                  <div className="flex items-center gap-4">
                    <span className="hidden text-xs text-slate-400 sm:inline">
                      {b.status === "success" ? formatBytes(b.size_bytes) : ""}
                    </span>
                    <StatusBadge status={b.status} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Sources */}
        <div>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-slate-300">Sources</h2>
            <Link href="/connections" className="text-xs text-brand-300 hover:text-brand-200">
              Manage →
            </Link>
          </div>
          {conns.length === 0 ? (
            <div className="card p-5 text-sm text-slate-500">
              No sources yet.{" "}
              <Link href="/connections/new" className="text-brand-300">
                Add one
              </Link>
              .
            </div>
          ) : (
            <div className="card divide-y divide-white/5">
              {conns.slice(0, 8).map((c) => (
                <Link
                  key={c.id}
                  href={`/backups?connectionId=${c.id}`}
                  className="flex items-center gap-3 px-4 py-3 hover:bg-white/[0.02]"
                >
                  <EngineChip engine={c.engine} size="sm" />
                  <span className="flex-1 truncate text-sm text-slate-200">{c.name}</span>
                  {c.schedule && (
                    <span className="h-1.5 w-1.5 rounded-full bg-brand-400" title="scheduled" />
                  )}
                </Link>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
