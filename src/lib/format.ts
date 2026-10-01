export function formatBytes(bytes: number): string {
  if (!bytes || bytes < 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  const val = bytes / Math.pow(1024, i);
  return `${val.toFixed(val >= 100 || i === 0 ? 0 : 1)} ${units[i]}`;
}

export function formatDuration(ms: number): string {
  if (!ms) return "—";
  if (ms < 1000) return `${ms} ms`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(1)} s`;
  const m = Math.floor(s / 60);
  return `${m}m ${Math.round(s % 60)}s`;
}

/** Absolute local date + time, e.g. "30 Sep 2026, 10:45". */
export function formatDateTime(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function timeAgo(iso: string | null): string {
  if (!iso) return "—";
  const then = new Date(iso).getTime();
  const diff = Date.now() - then;
  const min = Math.floor(diff / 60000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const d = Math.floor(hr / 24);
  if (d < 30) return `${d}d ago`;
  return new Date(iso).toLocaleDateString();
}

// Brand color + short glyph per engine, used across the UI.
export const ENGINE_META: Record<string, { color: string; glyph: string; label: string }> = {
  postgres: { color: "#3b82f6", glyph: "Pg", label: "PostgreSQL" },
  mysql: { color: "#f59e0b", glyph: "My", label: "MySQL" },
  mariadb: { color: "#a855f7", glyph: "Ma", label: "MariaDB" },
  sqlserver: { color: "#ef4444", glyph: "MS", label: "SQL Server" },
  oracle: { color: "#f97316", glyph: "Or", label: "Oracle" },
  mongodb: { color: "#22c55e", glyph: "Mo", label: "MongoDB" },
  sqlite: { color: "#14b8a6", glyph: "Li", label: "SQLite" },
};
