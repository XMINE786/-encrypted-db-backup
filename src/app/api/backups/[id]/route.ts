import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { db, BACKUP_DIR, BackupRow } from "@/lib/db";
import { requirePermission } from "@/lib/auth";

export const runtime = "nodejs";

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const guard = requirePermission("deleteBackups");
  if ("error" in guard) return guard.error;
  const b = db()
    .prepare(`SELECT * FROM backups WHERE id=?`)
    .get(Number(params.id)) as BackupRow | undefined;
  if (!b) return NextResponse.json({ error: "Not found" }, { status: 404 });

  if (b.filename) {
    try {
      fs.unlinkSync(path.join(BACKUP_DIR, b.filename));
    } catch {}
  }
  db().prepare(`DELETE FROM backups WHERE id=?`).run(b.id);
  return NextResponse.json({ ok: true });
}
