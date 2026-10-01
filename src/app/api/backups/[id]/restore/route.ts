import { NextRequest, NextResponse } from "next/server";
import { db, BackupRow } from "@/lib/db";
import { requirePermission } from "@/lib/auth";
import { restoreBackup, RestoreTarget } from "@/lib/restore";

export const runtime = "nodejs";

// Restore a backup into a caller-specified TARGET database. Gated on runBackups.
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const guard = requirePermission("runBackups");
  if ("error" in guard) return guard.error;

  const row = db()
    .prepare(
      `SELECT b.*, c.engine AS engine FROM backups b
       JOIN connections c ON c.id=b.connection_id WHERE b.id=?`
    )
    .get(Number(params.id)) as (BackupRow & { engine: string }) | undefined;
  if (!row) return NextResponse.json({ error: "Backup not found" }, { status: 404 });

  let body: RestoreTarget;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (!body || !body.database) {
    return NextResponse.json({ error: "Target database is required" }, { status: 400 });
  }

  const result = await restoreBackup(row, {
    host: body.host,
    port: body.port != null ? Number(body.port) : null,
    user: body.user,
    database: body.database,
    password: body.password,
    create: !!body.create,
    createRoles: body.createRoles !== false,
  });

  return NextResponse.json(result, { status: result.ok ? 200 : 422 });
}
