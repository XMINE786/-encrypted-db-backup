// In-memory registry of live backup logs, so the UI can "tail -f" a running
// backup. runBackup publishes each stage line here as it happens; the
// /api/backups/[id]/logs endpoint reads it. Entries are kept briefly after a
// backup finishes so a late subscriber still gets the tail, then freed.
//
// Stashed on globalThis so Next.js dev HMR (which reloads modules) doesn't lose
// the in-flight buffers.

interface LiveLog {
  lines: string[];
  done: boolean;
}

const g = globalThis as unknown as { __backupLiveLogs?: Map<number, LiveLog> };
const registry: Map<number, LiveLog> = g.__backupLiveLogs ?? (g.__backupLiveLogs = new Map());

/** Begin capturing a backup's live log (call once, at the start). */
export function startLiveLog(id: number): void {
  registry.set(id, { lines: [], done: false });
}

/** Append one line to a running backup's live log. */
export function appendLiveLog(id: number, line: string): void {
  registry.get(id)?.lines.push(line);
}

/** Mark a backup's log complete and schedule the buffer for cleanup. */
export function endLiveLog(id: number): void {
  const l = registry.get(id);
  if (!l) return;
  l.done = true;
  setTimeout(() => registry.delete(id), 60_000).unref?.();
}

/** Current live buffer for a backup, or undefined once it's been freed. */
export function getLiveLog(id: number): LiveLog | undefined {
  return registry.get(id);
}
