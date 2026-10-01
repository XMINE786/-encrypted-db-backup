"use client";

import { createContext, useContext, useState, ReactNode } from "react";
import { Spinner } from "@/components/ui";

/** Minimal backup shape the restore dialog needs. */
export interface RestoreBackup {
  id: number;
  connectionName: string;
  engine: string;
}

interface RestoreCtx {
  /** Open the restore dialog for a backup. */
  startRestore: (backup: RestoreBackup) => void;
}

const Ctx = createContext<RestoreCtx | null>(null);

/** Trigger restores from anywhere under <RestoreProvider>. */
export function useRestore(): RestoreCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error("useRestore must be used within <RestoreProvider>");
  return c;
}

/**
 * Hosts the restore dialog + its minimized dock at the app-shell level, so a
 * running restore survives page navigation: the pill stays visible and the
 * in-flight request keeps going because this provider never unmounts.
 */
export function RestoreProvider({ children }: { children: ReactNode }) {
  const [backup, setBackup] = useState<RestoreBackup | null>(null);

  return (
    <Ctx.Provider value={{ startRestore: setBackup }}>
      {children}
      {backup && (
        // key by id so switching to a different backup resets the dialog state.
        <RestoreDialog key={backup.id} backup={backup} onClose={() => setBackup(null)} />
      )}
    </Ctx.Provider>
  );
}

/** Dialog to restore a backup into a caller-specified TARGET database. */
function RestoreDialog({ backup, onClose }: { backup: RestoreBackup; onClose: () => void }) {
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
  // Docked (minimized) view: hide the big dialog but keep this component mounted
  // so the in-flight restore request keeps running in the background.
  const [minimized, setMinimized] = useState(false);

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

  // Minimized: a compact pill docked bottom-right. The restore keeps running;
  // clicking the pill re-opens the full dialog to show the live status/result.
  if (minimized) {
    return (
      <div className="fixed bottom-4 right-4 z-50 animate-fade-in">
        <button
          onClick={() => setMinimized(false)}
          className="flex items-center gap-3 rounded-xl border border-white/10 bg-slate-900/95 px-4 py-3 text-left shadow-2xl backdrop-blur transition hover:border-indigo-400/40"
        >
          {busy ? (
            <Spinner className="h-4 w-4 text-indigo-300" />
          ) : result?.ok ? (
            <span className="text-emerald-400">✓</span>
          ) : (
            <span className="text-red-400">✕</span>
          )}
          <span className="block">
            <span className="block text-sm font-medium text-slate-200">
              {busy ? "Restoring…" : result?.ok ? "Restore complete" : "Restore failed"}
            </span>
            <span className="block text-xs text-slate-500">{backup.connectionName}</span>
          </span>
          <span className="ml-2 text-xs text-slate-500">Expand ↗</span>
        </button>
      </div>
    );
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={() => (busy ? setMinimized(true) : onClose())}
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

        <div className="mt-5 flex items-center justify-between gap-2">
          {busy || result ? (
            <button className="btn-ghost text-sm" onClick={() => setMinimized(true)}>
              Minimize ↘
            </button>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
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
    </div>
  );
}
