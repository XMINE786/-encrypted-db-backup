import { NextRequest, NextResponse } from "next/server";
import { db, ConnectionRow } from "@/lib/db";
import { runBackup } from "@/lib/backup";
import { requirePermission } from "@/lib/auth";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  const guard = requirePermission("runBackups");
  if ("error" in guard) return guard.error;
  const c = db()
    .prepare(`SELECT * FROM connections WHERE id=?`)
    .get(Number(params.id)) as ConnectionRow | undefined;
  if (!c) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const backupId = await runBackup(c, "manual");
  const row = db().prepare(`SELECT * FROM backups WHERE id=?`).get(backupId);
  return NextResponse.json(row, { status: 201 });
}
