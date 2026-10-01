import { NextRequest, NextResponse } from "next/server";
import { db, BackupRow } from "@/lib/db";
import { getLiveLog } from "@/lib/backup-logs";
import { requirePermission } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Returns a backup's log for live tailing: `{ lines, done }`. While a backup is
 * running, the lines come from the in-memory live registry (poll this ~1s for a
 * `tail -f` feel). Once finished (or after the live buffer is freed), it falls
 * back to the log persisted on the backup row.
 */
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const guard = requirePermission("viewBackups");
  if ("error" in guard) return guard.error;
  const id = Number(params.id);

  const live = getLiveLog(id);
  if (live) {
    return NextResponse.json({ lines: live.lines, done: live.done });
  }

  const row = db()
    .prepare(`SELECT log, status FROM backups WHERE id=?`)
    .get(id) as Pick<BackupRow, "log" | "status"> | undefined;
  if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });

  return NextResponse.json({
    lines: row.log ? row.log.split("\n") : [],
    done: row.status !== "running",
  });
}
