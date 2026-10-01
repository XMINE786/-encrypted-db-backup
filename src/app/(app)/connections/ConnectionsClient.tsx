"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { EngineChip, Spinner, EmptyState } from "@/components/ui";
import { ENGINE_META } from "@/lib/format";
import { describeCron } from "@/lib/schedule";
import { usePermissions } from "@/components/usePermissions";

interface Conn {
  id: number;
  name: string;
  engine: string;
  host: string;
  port: number | null;
  database: string;
  username: string;
  schedule: string | null;
  retention: number;
}

export function ConnectionsClient() {
  const [conns, setConns] = useState<Conn[] | null>(null);
  const [busy, setBusy] = useState<Record<number, string>>({});
  const [flash, setFlash] = useState<{ id: number; ok: boolean; msg: string } | null>(null);
  const { perms } = usePermissions();

  async function load() {
    const res = await fetch("/api/connections");
    setConns(await res.json());
  }
  useEffect(() => {
    load();
  }, []);

  async function runBackup(c: Conn) {
    setBusy((b) => ({ ...b, [c.id]: "backup" }));
    setFlash(null);
    try {
      const res = await fetch(`/api/connections/${c.id}/backup`, { method: "POST" });
      const row = await res.json();
      setFlash(
        row.status === "success"
          ? { id: c.id, ok: true, msg: "Backup completed and encrypted." }
          : { id: c.id, ok: false, msg: row.error || "Backup failed." }
      );
    } catch (e: any) {
      setFlash({ id: c.id, ok: false, msg: e.message });
    } finally {
      setBusy((b) => ({ ...b, [c.id]: "" }));
    }
  }

  async function testConn(c: Conn) {
    setBusy((b) => ({ ...b, [c.id]: "test" }));
    setFlash(null);
    try {
      const res = await fetch(`/api/connections/${c.id}/test`, { method: "POST" });
      const r = await res.json();
      setFlash({ id: c.id, ok: r.ok, msg: r.message });
    } finally {
      setBusy((b) => ({ ...b, [c.id]: "" }));
    }
  }

  async function remove(c: Conn) {
    if (!confirm(`Delete "${c.name}" and all its backups? This cannot be undone.`)) return;
    await fetch(`/api/connections/${c.id}`, { method: "DELETE" });
    load();
  }

  if (conns === null) {
    return (
      <div className="flex justify-center py-20 text-slate-500">
        <Spinner className="h-6 w-6" />
      </div>
    );
  }

  if (conns.length === 0) {
    return (
      <EmptyState
        title="No backup sources yet"
        subtitle="Add a database connection to start creating encrypted backups."
        action={
          perms.editConnections ? (
            <Link href="/connections/new" className="btn-primary">
              Add your first source
            </Link>
          ) : undefined
        }
      />
    );
  }

  return (
    <div className="grid gap-4 md:grid-cols-2">
      {conns.map((c) => {
        const meta = ENGINE_META[c.engine];
        return (
          <div key={c.id} className="card animate-fade-in p-5">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-3">
                <EngineChip engine={c.engine} />
                <div>
                  <div className="font-semibold text-white">{c.name}</div>
                  <div className="text-xs text-slate-500">{meta?.label ?? c.engine}</div>
                </div>
              </div>
              {c.schedule && (
                <span className="badge bg-brand-500/15 text-brand-200 ring-1 ring-brand-500/30">
                  <svg viewBox="0 0 24 24" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M12 6v6l4 2M22 12a10 10 0 11-20 0 10 10 0 0120 0z" />
                  </svg>
                  scheduled
                </span>
              )}
            </div>

            <dl className="mt-4 space-y-1.5 text-sm">
              {c.host && (
                <Row label="Host" value={`${c.host}${c.port ? ":" + c.port : ""}`} />
              )}
              <Row label="Database" value={c.database} mono />
              {c.username && <Row label="User" value={c.username} />}
              <Row
                label="Schedule"
                value={c.schedule ? describeCron(c.schedule) : "Manual only"}
              />
              <Row label="Retention" value={c.retention ? `keep ${c.retention}` : "keep all"} />
            </dl>

            {flash && flash.id === c.id && (
              <div
                className={`mt-3 rounded-lg px-3 py-2 text-xs ${
                  flash.ok
                    ? "bg-emerald-500/10 text-emerald-300"
                    : "bg-amber-500/10 text-amber-200"
                }`}
              >
                {flash.msg}
              </div>
            )}

            <div className="mt-4 flex flex-wrap gap-2">
              {perms.runBackups && (
                <button className="btn-primary !py-1.5 !px-3 text-xs" onClick={() => runBackup(c)} disabled={!!busy[c.id]}>
                  {busy[c.id] === "backup" ? <Spinner className="h-3.5 w-3.5" /> : null}
                  Backup now
                </button>
              )}
              {perms.runBackups && (
                <button className="btn-ghost !py-1.5 !px-3 text-xs" onClick={() => testConn(c)} disabled={!!busy[c.id]}>
                  {busy[c.id] === "test" ? <Spinner className="h-3.5 w-3.5" /> : null}
                  Test
                </button>
              )}
              <Link href={`/backups?connectionId=${c.id}`} className="btn-ghost !py-1.5 !px-3 text-xs">
                History
              </Link>
              {perms.editConnections && (
                <Link href={`/connections/${c.id}/edit`} className="btn-ghost !py-1.5 !px-3 text-xs">
                  Edit
                </Link>
              )}
              {perms.deleteBackups && (
                <button className="btn-danger !py-1.5 !px-3 text-xs" onClick={() => remove(c)}>
                  Delete
                </button>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="text-slate-500">{label}</dt>
      <dd className={`truncate text-slate-300 ${mono ? "font-mono text-xs" : ""}`}>{value}</dd>
    </div>
  );
}
