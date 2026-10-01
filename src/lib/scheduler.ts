import cron, { ScheduledTask } from "node-cron";
import { db, ConnectionRow } from "./db";
import { runBackup } from "./backup";

// The task registry and init flag are stashed on globalThis so they SURVIVE
// module reloads (Next.js dev HMR) and are shared across every import of this
// module in the same process. Without this, a reload would create a fresh empty
// Map, lose track of already-running cron tasks, and register duplicates — which
// caused the same connection to back up twice per tick.
const g = globalThis as unknown as {
  __devgemsTasks?: Map<number, ScheduledTask>;
  __devgemsSchedulerInit?: boolean;
};
const tasks: Map<number, ScheduledTask> = (g.__devgemsTasks ??= new Map());

export function scheduleConnection(c: ConnectionRow) {
  unscheduleConnection(c.id);
  if (!c.schedule || !cron.validate(c.schedule)) return;
  const task = cron.schedule(c.schedule, async () => {
    // Re-read the row so we use the latest credentials/settings.
    const fresh = db()
      .prepare(`SELECT * FROM connections WHERE id=?`)
      .get(c.id) as ConnectionRow | undefined;
    if (fresh) await runBackup(fresh, "scheduled");
  });
  tasks.set(c.id, task);
}

export function unscheduleConnection(id: number) {
  const t = tasks.get(id);
  if (t) {
    t.stop();
    tasks.delete(id);
  }
}

/** Load every connection with a schedule and register its cron task. */
export function initScheduler() {
  if (g.__devgemsSchedulerInit) return;
  g.__devgemsSchedulerInit = true;
  try {
    // Defensively clear any tasks left over from a previous module instance.
    for (const id of [...tasks.keys()]) unscheduleConnection(id);
    const rows = db()
      .prepare(`SELECT * FROM connections WHERE schedule IS NOT NULL AND schedule != ''`)
      .all() as ConnectionRow[];
    for (const c of rows) scheduleConnection(c);
    // eslint-disable-next-line no-console
    console.log(`[scheduler] registered ${rows.length} scheduled backup(s)`);
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error("[scheduler] init failed", e);
  }
}
