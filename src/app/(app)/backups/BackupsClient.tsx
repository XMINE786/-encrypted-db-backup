"use client";

import { Fragment, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { EngineChip, StatusBadge, Spinner, EmptyState } from "@/components/ui";
import { formatBytes, formatDuration, formatDateTime, timeAgo } from "@/lib/format";
import { usePermissions } from "@/components/usePermissions";
import { useRestore } from "@/components/RestoreManager";

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
  log: string | null;
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

/**
 * Tails a backup's log in real time. Polls the logs endpoint ~1s while the
 * backup is running (appending new lines like `tail -f`) and stops once done.
 */
function LiveLog({ backupId }: { backupId: number }) {
  const [lines, setLines] = useState<string[]>([]);
  const [done, setDone] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const boxRef = useRef<HTMLPreElement>(null);

  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    async function tick() {
      try {
        const res = await fetch(`/api/backups/${backupId}/logs`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        if (!active) return;
        setLines(data.lines || []);
        setDone(!!data.done);
        setErr(null);
        if (!data.done) timer = setTimeout(tick, 1000);
      } catch (e: any) {
        if (!active) return;
        setErr(String(e.message || e));
        timer = setTimeout(tick, 2000);
      }
    }
    tick();
    return () => {
      active = false;
      if (timer) clearTimeout(timer);
    };
  }, [backupId]);

  // Keep the newest line in view, like a terminal.
  useEffect(() => {
    if (boxRef.current) boxRef.current.scrollTop = boxRef.current.scrollHeight;
  }, [lines]);

  return (
    <div>
      <div className="mb-1 flex items-center gap-2 text-xs">
        {done ? (
          <span className="text-slate-500">log complete</span>
        ) : (
          <span className="flex items-center gap-1.5 text-emerald-400">
            <span className="h-2 w-2 animate-pulse rounded-full bg-emerald-400" />
            live
          </span>
        )}
        {err && <span className="text-amber-400">reconnecting…</span>}
      </div>
      <pre
        ref={boxRef}
        className="max-h-64 overflow-auto whitespace-pre-wrap rounded-lg bg-slate-900/70 p-3 font-mono text-xs leading-relaxed text-slate-300"
      >
        {lines.length ? lines.join("\n") : "waiting for output…"}
        {!done && <span className="animate-pulse"> ▋</span>}
      </pre>
    </div>
  );
}

export function BackupsClient() {
  const params = useSearchParams();
  const connectionId = params.get("connectionId");
  const [rows, setRows] = useState<Backup[] | null>(null);
  const [openError, setOpenError] = useState<number | null>(null);
  const [openLog, setOpenLog] = useState<number | null>(null);
  const { perms } = usePermissions();
  const { startRestore } = useRestore();

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
                <th className="px-5 py-3 font-medium">Logs</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((b) => (
                <Fragment key={b.id}>
                <tr className="border-b border-white/5 last:border-0 hover:bg-white/[0.02]">
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
                  <td className="px-5 py-3">
                    {b.log || b.status === "running" ? (
                      <button
                        onClick={() => setOpenLog(openLog === b.id ? null : b.id)}
                        className="btn-ghost !py-1 !px-2.5 text-xs"
                      >
                        {openLog === b.id
                          ? "Hide"
                          : b.status === "running"
                          ? "Live ●"
                          : "View"}
                      </button>
                    ) : (
                      <span className="text-slate-600">—</span>
                    )}
                  </td>
                </tr>
                {openLog === b.id && (b.log || b.status === "running") && (
                  <tr key={`${b.id}-log`} className="border-b border-white/5 last:border-0">
                    <td colSpan={7} className="px-5 pb-3">
                      {b.status === "running" ? (
                        <LiveLog backupId={b.id} />
                      ) : (
                        <pre className="max-h-64 overflow-auto whitespace-pre-wrap rounded-lg bg-slate-900/70 p-3 font-mono text-xs leading-relaxed text-slate-300">
                          {b.log}
                        </pre>
                      )}
                    </td>
                  </tr>
                )}
                </Fragment>
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
                            <button className="btn-ghost !py-1 !px-2.5 text-xs" onClick={() => startRestore({ id: b.id, connectionName: b.connectionName, engine: b.engine })}>
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
            {(b.log || b.status === "running") && (
              <div className="mt-2">
                <button
                  onClick={() => setOpenLog(openLog === b.id ? null : b.id)}
                  className="btn-ghost !py-1 !px-2.5 text-xs"
                >
                  {openLog === b.id
                    ? "Hide logs"
                    : b.status === "running"
                    ? "Live logs ●"
                    : "View logs"}
                </button>
                {openLog === b.id &&
                  (b.status === "running" ? (
                    <div className="mt-2">
                      <LiveLog backupId={b.id} />
                    </div>
                  ) : (
                    <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap rounded-lg bg-slate-900/70 p-2 font-mono text-xs text-slate-300">
                      {b.log}
                    </pre>
                  ))}
              </div>
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
                    <button className="btn-ghost !py-1 !px-2.5 text-xs" onClick={() => startRestore({ id: b.id, connectionName: b.connectionName, engine: b.engine })}>
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
    </div>
  );
}
