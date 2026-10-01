import { NextRequest, NextResponse } from "next/server";
import { db, ConnectionRow } from "@/lib/db";
import { encryptString } from "@/lib/crypto";
import { toConnectionDTO } from "@/lib/serialize";
import { scheduleConnection, unscheduleConnection } from "@/lib/scheduler";
import { parseSchedule } from "@/lib/schedule";
import { requirePermission } from "@/lib/auth";

export const runtime = "nodejs";

function getConn(id: number): ConnectionRow | undefined {
  return db().prepare(`SELECT * FROM connections WHERE id=?`).get(id) as
    | ConnectionRow
    | undefined;
}

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const guard = requirePermission("viewBackups");
  if ("error" in guard) return guard.error;
  const c = getConn(Number(params.id));
  if (!c) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(toConnectionDTO(c));
}

export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  const guard = requirePermission("editConnections");
  if ("error" in guard) return guard.error;
  const id = Number(params.id);
  const existing = getConn(id);
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const b = await req.json();
  // Only overwrite the password when a new one is explicitly provided.
  const password_enc =
    typeof b.password === "string" && b.password.length > 0
      ? encryptString(b.password)
      : existing.password_enc;

  // Normalize the schedule (friendly text or cron) if one was provided.
  let schedule = existing.schedule;
  if (b.schedule !== undefined) {
    const parsed = parseSchedule(b.schedule || "");
    if (parsed.error) return NextResponse.json({ error: parsed.error }, { status: 400 });
    schedule = parsed.cron || null;
  }

  db()
    .prepare(
      `UPDATE connections SET
        name=@name, engine=@engine, host=@host, port=@port, database=@database,
        username=@username, password_enc=@password_enc, options=@options,
        schedule=@schedule, retention=@retention, updated_at=@now
       WHERE id=@id`
    )
    .run({
      id,
      name: b.name ?? existing.name,
      engine: b.engine ?? existing.engine,
      host: b.host ?? existing.host,
      port: b.port !== undefined ? (b.port ? Number(b.port) : null) : existing.port,
      database: b.database ?? existing.database,
      username: b.username ?? existing.username,
      password_enc,
      options: b.options !== undefined ? b.options || null : existing.options,
      schedule,
      retention: b.retention !== undefined ? Number(b.retention) || 0 : existing.retention,
      now: new Date().toISOString(),
    });

  const updated = getConn(id)!;
  scheduleConnection(updated);
  return NextResponse.json(toConnectionDTO(updated));
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const guard = requirePermission("deleteBackups");
  if ("error" in guard) return guard.error;
  const id = Number(params.id);
  unscheduleConnection(id);
  db().prepare(`DELETE FROM connections WHERE id=?`).run(id);
  return NextResponse.json({ ok: true });
}
