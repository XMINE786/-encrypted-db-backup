import { NextRequest, NextResponse } from "next/server";
import { db, ConnectionRow } from "@/lib/db";
import { testConnection } from "@/lib/backup";
import { requirePermission } from "@/lib/auth";

export const runtime = "nodejs";

export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  const guard = requirePermission("runBackups");
  if ("error" in guard) return guard.error;
  const c = db()
    .prepare(`SELECT * FROM connections WHERE id=?`)
    .get(Number(params.id)) as ConnectionRow | undefined;
  if (!c) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const result = await testConnection(c);
  return NextResponse.json(result, { status: result.ok ? 200 : 502 });
}
