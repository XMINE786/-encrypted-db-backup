import { spawn } from "child_process";
import zlib from "zlib";
import fs from "fs";
import path from "path";
import readline from "readline";
import { BACKUP_DIR, BackupRow } from "./db";
import { createDecryptStream } from "./crypto";
import { EngineId } from "./engines";

export interface RestoreTarget {
  host?: string;
  port?: number | null;
  user?: string;
  database: string; // for sqlite, this is the target file path
  password?: string;
  /** Drop (if present) and recreate the target database for a clean restore. */
  create?: boolean;
  /** Auto-create any roles the dump references (fixes "role ... does not exist"). */
  createRoles?: boolean;
}

export interface RestoreResult {
  ok: boolean;
  /** Combined tool output (stderr/stdout) — useful on success or failure. */
  output: string;
}

/** Run a tool with a small string on stdin (used for short control SQL). */
function run(
  cmd: string,
  args: string[],
  env: Record<string, string>,
  stdin: string
): Promise<RestoreResult> {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { env: { ...process.env, ...env } });
    let out = "";
    const grab = (d: Buffer) => {
      out += d.toString();
      if (out.length > 16000) out = out.slice(-16000);
    };
    child.stderr.on("data", grab);
    child.stdout.on("data", grab);
    child.on("error", (e: any) =>
      resolve({
        ok: false,
        output: e.code === "ENOENT" ? `"${cmd}" is not installed on this host.` : e.message,
      })
    );
    child.on("close", (code) => resolve({ ok: code === 0, output: out.trim() }));
    child.stdin.on("error", () => {});
    child.stdin.end(stdin);
  });
}

/**
 * Stream a decrypted backup straight into a tool's stdin. Never buffers the
 * whole dump in memory, so it handles multi-GB backups safely.
 */
function runStream(
  cmd: string,
  args: string[],
  env: Record<string, string>,
  row: BackupRow
): Promise<RestoreResult> {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { env: { ...process.env, ...env } });
    let out = "";
    const grab = (d: Buffer) => {
      out += d.toString();
      if (out.length > 16000) out = out.slice(-16000);
    };
    child.stderr.on("data", grab);
    child.stdout.on("data", grab);
    child.on("error", (e: any) =>
      resolve({
        ok: false,
        output: e.code === "ENOENT" ? `"${cmd}" is not installed on this host.` : e.message,
      })
    );
    child.on("close", (code) => resolve({ ok: code === 0, output: out.trim() }));

    const src = decryptStream(row);
    src.on("error", (e: any) => {
      out += `\n[decrypt error] ${e.message || e}`;
      child.stdin.destroy();
    });
    child.stdin.on("error", () => {}); // ignore EPIPE if the tool exits early
    src.pipe(child.stdin);
  });
}

/** file -> AES-GCM decipher -> [gunzip] (streaming). */
function decryptStream(row: BackupRow): NodeJS.ReadableStream {
  const decipher = fs
    .createReadStream(path.join(BACKUP_DIR, row.filename!))
    .pipe(createDecryptStream(row.iv!, row.auth_tag!));
  if (!row.compressed) return decipher;
  // pipe() doesn't forward errors, so a GCM auth failure on the decipher would
  // otherwise be lost once callers listen on the gunzip stream. Re-emit it.
  const gunzip = zlib.createGunzip();
  decipher.on("error", (e) => gunzip.emit("error", e));
  return decipher.pipe(gunzip);
}

const qIdent = (s: string) => `"${s.replace(/"/g, '""')}"`;

/** Stream the dump line-by-line and collect Postgres role names it references. */
function scanPgRoles(row: BackupRow, exclude: string[]): Promise<string[]> {
  return new Promise((resolve, reject) => {
    const skip = new Set(
      ["PUBLIC", "CURRENT_USER", "SESSION_USER", "CURRENT_ROLE", ...exclude].map((s) =>
        s.toUpperCase()
      )
    );
    const roles = new Set<string>();
    const add = (raw: string) => {
      let name = raw.trim().replace(/\s+WITH GRANT OPTION$/i, "").trim();
      name = name.replace(/^"(.*)"$/, "$1");
      if (!name || skip.has(name.toUpperCase())) return;
      roles.add(name);
    };
    const src = decryptStream(row);
    src.on("error", reject);
    const rl = readline.createInterface({ input: src, crlfDelay: Infinity });
    rl.on("line", (line) => {
      // cheap prefilter so we only regex the rare relevant lines
      if (line.indexOf("OWNER TO") >= 0) {
        const m = line.match(/OWNER TO\s+([^\s;]+);/i);
        if (m) add(m[1]);
        return;
      }
      if (/^\s*GRANT\b/i.test(line)) {
        const m = line.match(/\bTO\s+(.+?);\s*$/i);
        if (m) m[1].split(",").forEach(add);
      } else if (/^\s*REVOKE\b/i.test(line)) {
        const m = line.match(/\bFROM\s+(.+?);\s*$/i);
        if (m) m[1].split(",").forEach(add);
      }
    });
    rl.on("close", () => resolve([...roles]));
    rl.on("error", reject);
  });
}

/**
 * Decrypt a backup and load it into a caller-specified TARGET database.
 * Streams the payload, so multi-GB dumps restore without exhausting memory.
 */
export async function restoreBackup(
  row: BackupRow & { engine: string },
  target: RestoreTarget
): Promise<RestoreResult> {
  if (row.status !== "success" || !row.filename || !row.iv || !row.auth_tag)
    return { ok: false, output: "Backup is not available/complete." };
  if (!fs.existsSync(path.join(BACKUP_DIR, row.filename)))
    return { ok: false, output: "Backup file missing on disk." };
  if (!target.database) return { ok: false, output: "Target database is required." };

  const engine = row.engine as EngineId;
  const host = target.host || "localhost";
  const port = target.port ?? (engine === "postgres" ? 5432 : 3306);
  const user = target.user || (engine === "postgres" ? "postgres" : "root");
  const pass = target.password || "";
  const log: string[] = [];

  // ---- PostgreSQL ----
  if (engine === "postgres") {
    const pgEnv = { PGPASSWORD: pass };
    // 1. (optional) recreate target database via the maintenance db.
    if (target.create) {
      const r = await run(
        "psql",
        ["-h", host, "-p", String(port), "-U", user, "-d", "postgres", "-v", "ON_ERROR_STOP=1"],
        pgEnv,
        `DROP DATABASE IF EXISTS ${qIdent(target.database)};\nCREATE DATABASE ${qIdent(target.database)};`
      );
      log.push("[recreate db]\n" + (r.output || "ok"));
      if (!r.ok) return { ok: false, output: log.join("\n\n") };
    }
    // 2. (optional) create roles the dump references (streaming scan).
    if (target.createRoles !== false) {
      let roles: string[] = [];
      try {
        roles = await scanPgRoles(row, [user]);
      } catch (e: any) {
        return { ok: false, output: `[scan roles] failed: ${e.message || e}` };
      }
      if (roles.length) {
        const doBlocks = roles
          .map(
            (rname) =>
              `DO $$ BEGIN CREATE ROLE ${qIdent(rname)}; EXCEPTION WHEN duplicate_object THEN NULL; END $$;`
          )
          .join("\n");
        const r = await run(
          "psql",
          ["-h", host, "-p", String(port), "-U", user, "-d", target.database, "-v", "ON_ERROR_STOP=1"],
          pgEnv,
          doBlocks
        );
        log.push(`[create roles: ${roles.join(", ")}]\n` + (r.output || "ok"));
        if (!r.ok) return { ok: false, output: log.join("\n\n") };
      }
    }
    // 3. apply the dump (streamed).
    const r = await runStream(
      "psql",
      ["-h", host, "-p", String(port), "-U", user, "-d", target.database, "-v", "ON_ERROR_STOP=1"],
      pgEnv,
      row
    );
    log.push("[restore]\n" + (r.output || "ok"));
    return { ok: r.ok, output: log.join("\n\n") };
  }

  // ---- MySQL / MariaDB ----
  if (engine === "mysql" || engine === "mariadb") {
    const myEnv = { MYSQL_PWD: pass };
    if (target.create) {
      const r = await run(
        "mysql",
        [`-h${host}`, `-P${String(port)}`, `-u${user}`],
        myEnv,
        `DROP DATABASE IF EXISTS \`${target.database}\`; CREATE DATABASE \`${target.database}\`;`
      );
      log.push("[recreate db]\n" + (r.output || "ok"));
      if (!r.ok) return { ok: false, output: log.join("\n\n") };
    }
    const r = await runStream(
      "mysql",
      [`-h${host}`, `-P${String(port)}`, `-u${user}`, target.database],
      myEnv,
      row
    );
    log.push("[restore]\n" + (r.output || "ok"));
    return { ok: r.ok, output: log.join("\n\n") };
  }

  // ---- SQLite ----
  if (engine === "sqlite") {
    return runStream("sqlite3", [target.database], {}, row);
  }

  return { ok: false, output: `Restore for engine '${engine}' is not supported.` };
}
