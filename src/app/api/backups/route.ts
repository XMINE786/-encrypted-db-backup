import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/auth";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const guard = requirePermission("viewBackups");
  if ("error" in guard) return guard.error;
  const connId = req.nextUrl.searchParams.get("connectionId");
  const limit = Number(req.nextUrl.searchParams.get("limit") || 100);

  const base = `
    SELECT b.*, c.name AS connectionName, c.engine AS engine
    FROM backups b JOIN connections c ON c.id = b.connection_id`;

  const rows = connId
    ? db()
        .prepare(`${base} WHERE b.connection_id=? ORDER BY b.started_at DESC LIMIT ?`)
        .all(Number(connId), limit)
    : db().prepare(`${base} ORDER BY b.started_at DESC LIMIT ?`).all(limit);

  return NextResponse.json(rows);
}
