import { NextRequest, NextResponse } from "next/server";
import { db, ConnectionRow } from "@/lib/db";
import { encryptString } from "@/lib/crypto";
import { toConnectionDTO } from "@/lib/serialize";
import { scheduleConnection } from "@/lib/scheduler";
import { ENGINES, EngineId } from "@/lib/engines";
import { parseSchedule } from "@/lib/schedule";
import { requirePermission } from "@/lib/auth";

export const runtime = "nodejs";

export async function GET() {
  const guard = requirePermission("viewBackups");
  if ("error" in guard) return guard.error;
  const rows = db()
    .prepare(`SELECT * FROM connections ORDER BY name COLLATE NOCASE`)
    .all() as ConnectionRow[];
  return NextResponse.json(rows.map(toConnectionDTO));
}

export async function POST(req: NextRequest) {
  const guard = requirePermission("editConnections");
  if ("error" in guard) return guard.error;

  const body = await req.json();
  const { name, engine, host, port, database, username, password, options, schedule, retention } =
    body || {};

  if (!name || !engine || !database) {
    return NextResponse.json(
      { error: "name, engine and database are required" },
      { status: 400 }
    );
  }
  if (!ENGINES[engine as EngineId]) {
    return NextResponse.json({ error: `Unknown engine: ${engine}` }, { status: 400 });
  }

  // Accept friendly text ("every 2 minutes") or raw cron; store normalized cron.
  const parsedSchedule = parseSchedule(schedule || "");
  if (parsedSchedule.error) {
    return NextResponse.json({ error: parsedSchedule.error }, { status: 400 });
  }

  const now = new Date().toISOString();
  const info = db()
    .prepare(
      `INSERT INTO connections
        (name, engine, host, port, database, username, password_enc, options, schedule, retention, created_at, updated_at)
       VALUES (@name,@engine,@host,@port,@database,@username,@password_enc,@options,@schedule,@retention,@now,@now)`
    )
    .run({
      name,
      engine,
      host: host || "",
      port: port ? Number(port) : null,
      database,
      username: username || "",
      password_enc: password ? encryptString(password) : "",
      options: options || null,
      schedule: parsedSchedule.cron || null,
      retention: retention ? Number(retention) : 0,
      now,
    });

  const created = db()
    .prepare(`SELECT * FROM connections WHERE id=?`)
    .get(Number(info.lastInsertRowid)) as ConnectionRow;
  scheduleConnection(created);
  return NextResponse.json(toConnectionDTO(created), { status: 201 });
}
