"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ENGINE_LIST } from "@/lib/engines";
import {
  describeCron,
  buildCronFromParts,
  partsFromCron,
  SCHED_TYPES,
  WEEKDAYS,
  SchedParts,
  SchedType,
} from "@/lib/schedule";
import { Spinner } from "./ui";

export interface ConnectionFormValues {
  id?: number;
  name: string;
  engine: string;
  host: string;
  port: string;
  database: string;
  username: string;
  password: string;
  options: string;
  schedule: string;
  retention: string;
  hasPassword?: boolean;
}

const SCHEDULE_PRESETS = [
  { label: "No schedule", value: "" },
  { label: "Every hour", value: "0 * * * *" },
  { label: "Every 6 hours", value: "0 */6 * * *" },
  { label: "Daily at 02:00", value: "0 2 * * *" },
  { label: "Weekly (Sun 03:00)", value: "0 3 * * 0" },
];

export function ConnectionForm({ initial }: { initial?: Partial<ConnectionFormValues> }) {
  const router = useRouter();
  const isEdit = !!initial?.id;

  const [v, setV] = useState<ConnectionFormValues>({
    name: "",
    engine: "postgres",
    host: "",
    port: "",
    database: "",
    username: "",
    password: "",
    options: "",
    schedule: "",
    retention: "0",
    ...initial,
  } as ConnectionFormValues);

  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [customSchedule, setCustomSchedule] = useState(
    !!v.schedule && !SCHEDULE_PRESETS.some((p) => p.value === v.schedule)
  );
  // Structured custom schedule (fully dynamic): a type + its fields.
  const [parts, setParts] = useState<SchedParts>(partsFromCron(v.schedule || ""));

  // Merge a change into parts and recompute the cron stored in v.schedule.
  function updateParts(patch: Partial<SchedParts>) {
    const next = { ...parts, ...patch };
    setParts(next);
    set("schedule", buildCronFromParts(next));
  }

  const engineDef = ENGINE_LIST.find((e) => e.id === v.engine)!;
  const set = (k: keyof ConnectionFormValues, val: string) => setV((s) => ({ ...s, [k]: val }));

  function onEngineChange(engine: string) {
    const def = ENGINE_LIST.find((e) => e.id === engine)!;
    setV((s) => ({
      ...s,
      engine,
      port: def.defaultPort ? String(def.defaultPort) : "",
    }));
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const payload = {
        ...v,
        port: v.port ? Number(v.port) : null,
        retention: Number(v.retention) || 0,
      };
      const res = await fetch(
        isEdit ? `/api/connections/${initial!.id}` : "/api/connections",
        {
          method: isEdit ? "PUT" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        }
      );
      if (!res.ok) throw new Error((await res.json()).error || "Failed to save");
      router.push("/connections");
      router.refresh();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  // Test needs a saved connection; for new ones we save-then-test would be surprising,
  // so we test the persisted record only when editing. For new, we save first.
  async function test() {
    if (!isEdit) {
      setTestResult({ ok: false, message: "Save the connection first, then test it." });
      return;
    }
    setTesting(true);
    setTestResult(null);
    try {
      const res = await fetch(`/api/connections/${initial!.id}/test`, { method: "POST" });
      setTestResult(await res.json());
    } catch (err: any) {
      setTestResult({ ok: false, message: err.message });
    } finally {
      setTesting(false);
    }
  }

  return (
    <form onSubmit={save} className="space-y-6">
      <div className="card p-6">
        <h2 className="text-sm font-semibold text-slate-300">Source</h2>
        <p className="mb-5 text-xs text-slate-500">Identify the database you want to back up.</p>

        <div className="grid gap-5 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <label className="label">Display name</label>
            <input
              className="input"
              placeholder="Production Postgres"
              value={v.name}
              onChange={(e) => set("name", e.target.value)}
              required
            />
          </div>

          <div>
            <label className="label">Engine</label>
            <select className="input" value={v.engine} onChange={(e) => onEngineChange(e.target.value)}>
              {ENGINE_LIST.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="label">{engineDef.network ? "Port" : "Port (n/a)"}</label>
            <input
              className="input"
              type="number"
              placeholder={engineDef.defaultPort ? String(engineDef.defaultPort) : "—"}
              value={v.port}
              onChange={(e) => set("port", e.target.value)}
              disabled={!engineDef.network}
            />
          </div>

          {engineDef.network && (
            <div>
              <label className="label">Host / IP</label>
              <input
                className="input"
                placeholder="10.0.0.5 or db.example.com"
                value={v.host}
                onChange={(e) => set("host", e.target.value)}
                required
              />
            </div>
          )}

          <div className={engineDef.network ? "" : "sm:col-span-2"}>
            <label className="label">{v.engine === "sqlite" ? "Database file path" : "Database name"}</label>
            <input
              className="input"
              placeholder={v.engine === "sqlite" ? "/var/data/app.db" : "app_production"}
              value={v.database}
              onChange={(e) => set("database", e.target.value)}
              required
            />
          </div>
        </div>

        <p className="mt-4 rounded-lg border border-white/5 bg-base-900/60 px-3 py-2 text-xs text-slate-500">
          <span className="text-slate-400">Requires:</span> {engineDef.note}
        </p>
      </div>

      {engineDef.network && (
        <div className="card p-6">
          <h2 className="text-sm font-semibold text-slate-300">Credentials</h2>
          <p className="mb-5 text-xs text-slate-500">
            Encrypted with AES-256-GCM before being written to disk.
          </p>
          <div className="grid gap-5 sm:grid-cols-2">
            <div>
              <label className="label">Username</label>
              <input
                className="input"
                placeholder="backup_user"
                value={v.username}
                onChange={(e) => set("username", e.target.value)}
              />
            </div>
            <div>
              <label className="label">
                Password {isEdit && initial?.hasPassword && "(leave blank to keep)"}
              </label>
              <input
                className="input"
                type="password"
                placeholder="••••••••"
                value={v.password}
                onChange={(e) => set("password", e.target.value)}
              />
            </div>
          </div>
        </div>
      )}

      <div className="card p-6">
        <h2 className="text-sm font-semibold text-slate-300">Automation</h2>
        <p className="mb-5 text-xs text-slate-500">Schedule recurring backups and control retention.</p>
        <div className="grid gap-5 sm:grid-cols-2">
          <div>
            <label className="label">Schedule</label>
            {!customSchedule ? (
              <select
                className="input"
                value={v.schedule}
                onChange={(e) => {
                  if (e.target.value === "__custom") {
                    setCustomSchedule(true);
                    set("schedule", buildCronFromParts(parts));
                  } else set("schedule", e.target.value);
                }}
              >
                {SCHEDULE_PRESETS.map((p) => (
                  <option key={p.label} value={p.value}>
                    {p.label}
                  </option>
                ))}
                <option value="__custom">Custom…</option>
              </select>
            ) : (
              <div>
                <div className="flex items-center gap-2">
                  <select
                    className="input flex-1"
                    value={parts.type}
                    onChange={(e) => updateParts({ type: e.target.value as SchedType })}
                  >
                    {SCHED_TYPES.map((t) => (
                      <option key={t.value} value={t.value}>
                        {t.label}
                      </option>
                    ))}
                  </select>
                  <button type="button" className="btn-ghost" onClick={() => setCustomSchedule(false)}>
                    Presets
                  </button>
                </div>

                {/* Dynamic fields per type */}
                <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-slate-400">
                  {parts.type === "minutes" && (
                    <>
                      <span>Every</span>
                      <input className="input w-20" type="number" min={1} max={60} value={parts.count}
                        onChange={(e) => updateParts({ count: Number(e.target.value) })} />
                      <span>minute(s) — max 60</span>
                    </>
                  )}
                  {parts.type === "hours" && (
                    <>
                      <span>Every</span>
                      <input className="input w-20" type="number" min={1} max={24} value={parts.count}
                        onChange={(e) => updateParts({ count: Number(e.target.value) })} />
                      <span>hour(s) — max 24</span>
                    </>
                  )}
                  {parts.type === "weekly" && (
                    <>
                      <span>On</span>
                      <select className="input w-40" value={parts.weekday}
                        onChange={(e) => updateParts({ weekday: Number(e.target.value) })}>
                        {WEEKDAYS.map((d) => (
                          <option key={d.v} value={d.v}>{d.l}</option>
                        ))}
                      </select>
                    </>
                  )}
                  {(parts.type === "monthly" || parts.type === "quarterly") && (
                    <>
                      <span>On day</span>
                      <input className="input w-20" type="number" min={1} max={31} value={parts.day}
                        onChange={(e) => updateParts({ day: Number(e.target.value) })} />
                    </>
                  )}
                  {(parts.type === "daily" || parts.type === "weekly" || parts.type === "monthly" || parts.type === "quarterly") && (
                    <>
                      <span>at</span>
                      <input className="input w-20" type="number" min={0} max={23} value={parts.hour}
                        onChange={(e) => updateParts({ hour: Number(e.target.value) })} />
                      <span>:</span>
                      <input className="input w-20" type="number" min={0} max={59} value={parts.minute}
                        onChange={(e) => updateParts({ minute: Number(e.target.value) })} />
                      <span>(hh:mm, 24h)</span>
                    </>
                  )}
                  {parts.type === "advanced" && (
                    <input className="input flex-1 font-mono" placeholder="*/5 * * * *  (raw cron, 5 or 6 fields)"
                      value={parts.cron}
                      onChange={(e) => updateParts({ cron: e.target.value })} />
                  )}
                </div>

                <p className="mt-2 text-xs text-emerald-400">
                  ✓ {describeCron(v.schedule)}
                  {v.schedule && (
                    <span className="text-slate-500"> — cron: <code>{v.schedule}</code></span>
                  )}
                </p>
              </div>
            )}
          </div>
          <div>
            <label className="label">Retention (keep newest N, 0 = all)</label>
            <input
              className="input"
              type="number"
              min={0}
              value={v.retention}
              onChange={(e) => set("retention", e.target.value)}
            />
          </div>
          <div className="sm:col-span-2">
            <label className="label">Extra CLI flags (optional)</label>
            <input
              className="input font-mono"
              placeholder="--exclude-table=logs"
              value={v.options}
              onChange={(e) => set("options", e.target.value)}
            />
          </div>
        </div>
      </div>

      {error && (
        <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
          {error}
        </div>
      )}
      {testResult && (
        <div
          className={`rounded-xl border px-4 py-3 text-sm ${
            testResult.ok
              ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
              : "border-amber-500/30 bg-amber-500/10 text-amber-200"
          }`}
        >
          {testResult.message}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" className="btn-primary" disabled={saving}>
          {saving && <Spinner className="h-4 w-4" />}
          {isEdit ? "Save changes" : "Create backup source"}
        </button>
        {isEdit && (
          <button type="button" className="btn-ghost" onClick={test} disabled={testing}>
            {testing && <Spinner className="h-4 w-4" />}
            Test connection
          </button>
        )}
        <button type="button" className="btn-ghost" onClick={() => router.back()}>
          Cancel
        </button>
      </div>
    </form>
  );
}
