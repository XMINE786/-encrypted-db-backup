"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { EngineChip, StatusBadge, Spinner, EmptyState } from "@/components/ui";
import { formatBytes, formatDuration, formatDateTime, timeAgo } from "@/lib/format";
import { usePermissions } from "@/components/usePermissions";

interface Backup {
  id: number;
  connection_id: number;
  connectionName: string;
  engine: string;
  status: string;
  trigger: string;
  size_bytes: number;
  duration_ms: number;
  error: string | null;
  started_at: string;
  filename: string | null;
  verified: number | null;
  verify_error: string | null;
}

/** Small badge showing the auto-verification result of a successful backup. */
function VerifyBadge({ b }: { b: Backup }) {
  if (b.status !== "success") return null;
  if (b.verified === 1)
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-xs font-medium text-emerald-400">
        ✓ Verified
      </span>
    );
  if (b.verified === 0)
    return (
      <span
        title={b.verify_error || "verification failed"}
        className="inline-flex items-center gap-1 rounded-full bg-red-500/10 px-2 py-0.5 text-xs font-medium text-red-400"
      >
        ✕ Unverified
      </span>
    );
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-slate-500/10 px-2 py-0.5 text-xs font-medium text-slate-400">
      — not checked
    </span>
  );
}

/** Modal to restore a backup into a caller-specified TARGET database. */
function RestoreModal({ backup, onClose }: { backup: Backup; onClose: () => void }) {
  const isSqlite = backup.engine === "sqlite";
  const [host, setHost] = useState("localhost");
  const [port, setPort] = useState(backup.engine === "postgres" ? "5432" : "3306");
  const [user, setUser] = useState(backup.engine === "postgres" ? "postgres" : "root");
  const [database, setDatabase] = useState("");
  const [password, setPassword] = useState("");
  const [create, setCreate] = useState(true);
  const [createRoles, setCreateRoles] = useState(true);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; output: string } | null>(null);

  async function submit() {
    setBusy(true);
    setResult(null);
    try {
      const res = await fetch(`/api/backups/${backup.id}/restore`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ host, port, user, database, password, create, createRoles }),
      });
      const text = await res.text();
      let data: { ok?: boolean; output?: string; error?: string } = {};
      try {
        data = text ? JSON.parse(text) : {};
      } catch {
        // Empty/non-JSON response — usually the server ran out of memory or the
        // request was interrupted mid-restore.
        setResult({
          ok: false,
          output:
            `Server returned no response (HTTP ${res.status}). The restore was likely ` +
            `interrupted (e.g. the dev server reloaded). Check the target database, then retry.`,
        });
        return;
      }
      setResult({ ok: res.ok && !!data.ok, output: data.output || data.error || "(no output)" });
    } catch (e: any) {
      setResult({ ok: false, output: String(e.message || e) });
    } finally {
      setBusy(false);
    }
  }

  const inputCls =
    "w-full rounded-lg border border-white/10 bg-slate-900/60 px-3 py-2 text-sm text-slate-200 outline-none focus:border-indigo-400/50";

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
    >
      <div
        className="card w-full max-w-lg animate-fade-in p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-lg font-semibold text-slate-100">
          Restore <span className="text-indigo-300">{backup.connectionName}</span>
        </h2>
        <p className="mt-1 text-xs text-amber-300/90">
          Loads this backup into the TARGET database below. It writes schema + data into
          that target — pick a restore/scratch database, not your live source.
        </p>

        <div className="mt-4 space-y-3">
          {isSqlite ? (
            <label className="block">
              <span className="mb-1 block text-xs text-slate-400">Target SQLite file path</span>
              <input className={inputCls} value={database} onChange={(e) => setDatabase(e.target.value)} placeholder="/path/to/restore.db" />
            </label>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-3">
                <label className="block">
                  <span className="mb-1 block text-xs text-slate-400">Host</span>
                  <input className={inputCls} value={host} onChange={(e) => setHost(e.target.value)} />
                </label>
                <label className="block">
                  <span className="mb-1 block text-xs text-slate-400">Port</span>
                  <input className={inputCls} value={port} onChange={(e) => setPort(e.target.value)} />
                </label>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <label className="block">
                  <span className="mb-1 block text-xs text-slate-400">User</span>
                  <input className={inputCls} value={user} onChange={(e) => setUser(e.target.value)} />
                </label>
                <label className="block">
                  <span className="mb-1 block text-xs text-slate-400">Password</span>
                  <input className={inputCls} type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
                </label>
              </div>
              <label className="block">
                <span className="mb-1 block text-xs text-slate-400">Target database</span>
                <input className={inputCls} value={database} onChange={(e) => setDatabase(e.target.value)} placeholder="e.g. aiou_restore" />
              </label>
              <label className="flex items-center gap-2 text-sm text-slate-300">
                <input type="checkbox" checked={create} onChange={(e) => setCreate(e.target.checked)} />
                Recreate the target database first (drops it if it exists → clean restore)
              </label>
              <label className="flex items-center gap-2 text-sm text-slate-300">
                <input type="checkbox" checked={createRoles} onChange={(e) => setCreateRoles(e.target.checked)} />
                Auto-create roles the dump references (fixes &quot;role … does not exist&quot;)
              </label>
            </>
          )}
        </div>

        {result && (
          <pre
            className={`mt-4 max-h-48 overflow-auto whitespace-pre-wrap rounded-lg p-3 text-xs ${
              result.ok ? "bg-emerald-500/10 text-emerald-300" : "bg-red-500/10 text-red-300"
            }`}
          >
            {result.ok ? "✓ RESTORE SUCCEEDED\n" : "✕ RESTORE FAILED\n"}
            {result.output}
          </pre>
        )}

        <div className="mt-5 flex justify-end gap-2">
          <button className="btn-ghost text-sm" onClick={onClose} disabled={busy}>
            {result?.ok ? "Close" : "Cancel"}
          </button>
          <button
            className="btn-primary text-sm"
            onClick={submit}
            disabled={busy || !database}
          >
            {busy ? "Restoring…" : "Restore now"}
          </button>
        </div>
      </div>
    </div>
  );
}

export function BackupsClient() {
  const params = useSearchParams();
  const connectionId = params.get("connectionId");
  const [rows, setRows] = useState<Backup[] | null>(null);
  const [openError, setOpenError] = useState<number | null>(null);
  const [restoreOf, setRestoreOf] = useState<Backup | null>(null);
  const { perms } = usePermissions();

  async function load() {
    const qs = connectionId ? `?connectionId=${connectionId}` : "";
    const res = await fetch(`/api/backups${qs}`);
    setRows(await res.json());
  }
  useEffect(() => {
    load();
    // Poll while any backup is running so status updates live.
    const t = setInterval(load, 4000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connectionId]);

  async function del(id: number) {
    if (!confirm("Delete this backup file permanently?")) return;
    await fetch(`/api/backups/${id}`, { method: "DELETE" });
    load();
  }

  if (rows === null) {
    return (
      <div className="flex justify-center py-20 text-slate-500">
        <Spinner className="h-6 w-6" />
      </div>
    );
  }
  if (rows.length === 0) {
    return <EmptyState title="No backups yet" subtitle="Run a backup from the Connections page." />;
  }

  return (
    <div className="animate-fade-in space-y-6">
      {/* ===== Table 1: Backup details (info only) ===== */}
      <div className="card overflow-hidden">
        <div className="border-b border-white/5 px-5 py-3">
          <h2 className="text-sm font-semibold text-slate-200">Backup details</h2>
          <p className="text-xs text-slate-500">Each backup, when it was taken, its file and integrity.</p>
        </div>
        <div className="hidden overflow-x-auto md:block">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/5 text-left text-xs uppercase tracking-wide text-slate-500">
                <th className="px-5 py-3 font-medium">Source</th>
                <th className="px-5 py-3 font-medium">File</th>
                <th className="px-5 py-3 font-medium">Date &amp; time</th>
                <th className="px-5 py-3 font-medium">Size</th>
                <th className="px-5 py-3 font-medium">Status</th>
                <th className="px-5 py-3 font-medium">Integrity</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((b) => (
                <tr key={b.id} className="border-b border-white/5 last:border-0 hover:bg-white/[0.02]">
                  <td className="px-5 py-3">
                    <div className="flex items-center gap-2.5">
                      <EngineChip engine={b.engine} size="sm" />
                      <span className="font-medium text-slate-200">{b.connectionName}</span>
                    </div>
                  </td>
                  <td className="px-5 py-3">
                    {b.filename ? (
                      <span
                        className="block max-w-[260px] truncate font-mono text-xs text-slate-400"
                        title={b.filename}
                      >
                        {b.filename}
                      </span>
                    ) : (
                      <span className="text-slate-600">—</span>
                    )}
                  </td>
                  <td className="px-5 py-3">
                    <div className="text-slate-300">{formatDateTime(b.started_at)}</div>
                    <div className="text-xs text-slate-500">
                      {timeAgo(b.started_at)} · {formatDuration(b.duration_ms)}
                    </div>
                  </td>
                  <td className="px-5 py-3 text-slate-300">
                    {b.status === "success" ? formatBytes(b.size_bytes) : "—"}
                  </td>
                  <td className="px-5 py-3">
                    <button
                      onClick={() => b.error && setOpenError(openError === b.id ? null : b.id)}
                      className={b.error ? "cursor-pointer" : "cursor-default"}
                    >
                      <StatusBadge status={b.status} />
                    </button>
                    {openError === b.id && b.error && (
                      <pre className="mt-2 max-w-md whitespace-pre-wrap rounded-lg bg-red-500/10 p-2 text-xs text-red-300">
                        {b.error}
                      </pre>
                    )}
                  </td>
                  <td className="px-5 py-3">
                    <VerifyBadge b={b} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* ===== Table 2: Restore & files (actions) ===== */}
      <div className="card overflow-hidden">
        <div className="border-b border-white/5 px-5 py-3">
          <h2 className="text-sm font-semibold text-slate-200">Restore &amp; files</h2>
          <p className="text-xs text-slate-500">Download, decrypt, restore into a database, or delete.</p>
        </div>
        <div className="hidden overflow-x-auto md:block">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/5 text-left text-xs uppercase tracking-wide text-slate-500">
                <th className="px-5 py-3 font-medium">Source</th>
                <th className="px-5 py-3 font-medium">Date &amp; time</th>
                <th className="px-5 py-3 font-medium">Trigger</th>
                <th className="px-5 py-3 text-right font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((b) => (
                <tr key={b.id} className="border-b border-white/5 last:border-0 hover:bg-white/[0.02]">
                  <td className="px-5 py-3">
                    <div className="flex items-center gap-2.5">
                      <EngineChip engine={b.engine} size="sm" />
                      <span className="font-medium text-slate-200">{b.connectionName}</span>
                    </div>
                  </td>
                  <td className="px-5 py-3 text-slate-400">{formatDateTime(b.started_at)}</td>
                  <td className="px-5 py-3">
                    <span className="text-xs text-slate-500">{b.trigger}</span>
                  </td>
                  <td className="px-5 py-3">
                    <div className="flex justify-end gap-2">
                      {b.status === "success" ? (
                        <>
                          <a className="btn-ghost !py-1 !px-2.5 text-xs" href={`/api/backups/${b.id}/download`}>
                            .enc
                          </a>
                          <a className="btn-ghost !py-1 !px-2.5 text-xs" href={`/api/backups/${b.id}/download?decrypt=1`}>
                            Decrypted
                          </a>
                          {perms.runBackups && (
                            <button className="btn-ghost !py-1 !px-2.5 text-xs" onClick={() => setRestoreOf(b)}>
                              Restore
                            </button>
                          )}
                        </>
                      ) : (
                        <span className="text-xs text-slate-600">no file</span>
                      )}
                      {perms.deleteBackups && (
                        <button className="btn-danger !py-1 !px-2.5 text-xs" onClick={() => del(b.id)}>
                          Delete
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Mobile cards (combined view) */}
      <div className="card divide-y divide-white/5 md:hidden">
        {rows.map((b) => (
          <div key={b.id} className="p-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <EngineChip engine={b.engine} size="sm" />
                <span className="font-medium text-slate-200">{b.connectionName}</span>
              </div>
              <div className="flex items-center gap-2">
                <VerifyBadge b={b} />
                <StatusBadge status={b.status} />
              </div>
            </div>
            {b.filename && (
              <div className="mt-2 truncate font-mono text-[11px] text-slate-500" title={b.filename}>
                {b.filename}
              </div>
            )}
            <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-slate-400">
              <span>{formatDateTime(b.started_at)}</span>
              <span className="text-right">{b.status === "success" ? formatBytes(b.size_bytes) : "—"}</span>
              <span>{formatDuration(b.duration_ms)}</span>
              <span className="text-right">{b.trigger}</span>
            </div>
            {b.error && (
              <pre className="mt-2 whitespace-pre-wrap rounded-lg bg-red-500/10 p-2 text-xs text-red-300">{b.error}</pre>
            )}
            <div className="mt-3 flex flex-wrap gap-2">
              {b.status === "success" && (
                <>
                  <a className="btn-ghost !py-1 !px-2.5 text-xs" href={`/api/backups/${b.id}/download`}>
                    .enc
                  </a>
                  <a className="btn-ghost !py-1 !px-2.5 text-xs" href={`/api/backups/${b.id}/download?decrypt=1`}>
                    Decrypted
                  </a>
                  {perms.runBackups && (
                    <button className="btn-ghost !py-1 !px-2.5 text-xs" onClick={() => setRestoreOf(b)}>
                      Restore
                    </button>
                  )}
                </>
              )}
              {perms.deleteBackups && (
                <button className="btn-danger !py-1 !px-2.5 text-xs" onClick={() => del(b.id)}>
                  Delete
                </button>
              )}
            </div>
          </div>
        ))}
      </div>

      {restoreOf && <RestoreModal backup={restoreOf} onClose={() => setRestoreOf(null)} />}
    </div>
  );
}
