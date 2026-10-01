import { spawn } from "child_process";
import zlib from "zlib";
import { Transform } from "stream";
import fs from "fs";
import path from "path";
import { db, BACKUP_DIR, ConnectionRow, BackupRow } from "./db";
import { decryptString, createEncryptStream } from "./crypto";
import { verifyEncryptedBackup } from "./verify";
import { startLiveLog, appendLiveLog, endLiveLog } from "./backup-logs";
import {
  buildDumpCommand,
  buildTestCommand,
  ConnParams,
  EngineId,
  ENGINES,
} from "./engines";

export function connParams(c: ConnectionRow): ConnParams {
  return {
    engine: c.engine as EngineId,
    host: c.host,
    port: c.port,
    database: c.database,
    username: c.username,
    password: c.password_enc ? decryptString(c.password_enc) : "",
    options: c.options,
    schema: c.schema,
  };
}

/** Test connectivity to a connection. Resolves with { ok, message }. */
export function testConnection(c: ConnectionRow): Promise<{ ok: boolean; message: string }> {
  return new Promise((resolve) => {
    let spec;
    try {
      spec = buildTestCommand(connParams(c));
    } catch (e: any) {
      return resolve({ ok: false, message: e.message });
    }
    const child = spawn(spec.cmd, spec.args, {
      env: { ...process.env, ...spec.env },
    });
    let stderr = "";
    child.stderr.on("data", (d) => (stderr += d.toString()));
    child.on("error", (err: any) => {
      resolve({
        ok: false,
        message:
          err.code === "ENOENT"
            ? `Tool "${spec!.cmd}" is not installed on this host. ${
                ENGINES[c.engine as EngineId]?.note ?? ""
              }`
            : err.message,
      });
    });
    child.on("close", (code) => {
      if (code === 0) resolve({ ok: true, message: "Connection succeeded." });
      else resolve({ ok: false, message: stderr.trim() || `Exited with code ${code}` });
    });
  });
}

/**
 * Run a backup for a connection. Spawns the dump tool, pipes its stdout
 * through an AES-256-GCM cipher into an encrypted file, and records the
 * result. Returns the backup row id.
 */
export async function runBackup(
  c: ConnectionRow,
  trigger: "manual" | "scheduled"
): Promise<number> {
  const d = db();
  const startedAt = new Date().toISOString();
  const info = d
    .prepare(
      `INSERT INTO backups (connection_id, status, trigger, started_at)
       VALUES (?, 'running', ?, ?)`
    )
    .run(c.id, trigger, startedAt);
  const backupId = Number(info.lastInsertRowid);

  const started = Date.now();
  const engine = ENGINES[c.engine as EngineId];
  const ext = engine?.ext ?? "dump";
  const stamp = startedAt.replace(/[:.]/g, "-");
  const filename = `${c.name.replace(/[^a-z0-9_-]/gi, "_")}-${stamp}.${ext}.enc`;
  const filePath = path.join(BACKUP_DIR, filename);
  // Gzip the dump before encrypting — SQL text compresses heavily. MongoDB is
  // skipped because mongodump already emits a gzipped archive (--gzip), so a
  // second pass would only waste CPU for no gain.
  const compress = c.engine !== "mongodb";

  // Human-readable, timestamped account of each pipeline stage, surfaced in the
  // UI so you can see the dump → gzip → encrypt → verify flow. Each line is also
  // published to the live-log registry so the UI can tail it in real time.
  // Never logs the command args (they can embed the DB password).
  startLiveLog(backupId);
  const logLines: string[] = [];
  const log = (msg: string) => {
    const line = `[+${((Date.now() - started) / 1000).toFixed(1)}s] ${msg}`;
    logLines.push(line);
    appendLiveLog(backupId, line);
  };
  const num = (n: number) => n.toLocaleString("en-US");
  log(`Starting backup of "${c.name}" [${c.engine}] · trigger: ${trigger}`);

  try {
    const spec = buildDumpCommand(connParams(c));
    log(`Dumping with ${spec.cmd}`);
    if (c.schema?.trim()) log(`Schema filter: ${c.schema.trim()}`);
    log(
      compress
        ? "Compressing stream with gzip"
        : "Compression skipped (mongodump already gzips its archive)"
    );
    log(`Encrypting with AES-256-GCM → ${filename}`);
    await new Promise<void>((resolve, reject) => {
      const child = spawn(spec.cmd, spec.args, {
        env: { ...process.env, ...spec.env },
      });

      const cipher = createEncryptStream();
      const out = fs.createWriteStream(filePath);

      let stderr = "";
      child.stderr.on("data", (chunk) => {
        stderr += chunk.toString();
        if (stderr.length > 8000) stderr = stderr.slice(-8000);
      });

      child.on("error", (err: any) => {
        reject(
          err.code === "ENOENT"
            ? new Error(
                `Tool "${spec.cmd}" is not installed on this host. ${engine?.note ?? ""}`
              )
            : err
        );
      });

      // Count raw dump bytes with a pass-through Transform (keeps backpressure
      // intact, unlike a bare 'data' listener) so the log can show the
      // compression ratio.
      let rawBytes = 0;
      const counter = new Transform({
        transform(chunk, _enc, cb) {
          rawBytes += chunk.length;
          cb(null, chunk);
        },
      });
      counter.on("error", reject);

      // dump stdout -> counter -> [gzip] -> cipher -> file
      if (compress) {
        const gzip = zlib.createGzip();
        gzip.on("error", reject);
        child.stdout.pipe(counter).pipe(gzip).pipe(cipher.stream).pipe(out);
      } else {
        child.stdout.pipe(counter).pipe(cipher.stream).pipe(out);
      }

      out.on("finish", async () => {
        // Persist IV + auth tag needed to decrypt later.
        const size = fs.statSync(filePath).size;
        // A zero-byte dump means the tool produced no output — almost always a
        // misconfiguration (wrong path/db). Treat it as a failure, not success.
        if (size === 0) {
          try {
            fs.unlinkSync(filePath);
          } catch {}
          log("Dump produced 0 bytes — treating as failure");
          reject(
            new Error(
              stderr.trim() ||
                "Dump produced no output (0 bytes). Check the database name/path and credentials."
            )
          );
          return;
        }
        log(`Dump read ${num(rawBytes)} bytes from ${spec.cmd}`);
        log(
          `Stored ${num(size)} bytes on disk` +
            (compress && rawBytes
              ? ` (${((size / rawBytes) * 100).toFixed(1)}% of dump after gzip + AES-256-GCM)`
              : "")
        );
        const authTag = cipher.getTag();
        // Auto-verify: stream-decrypt what we just wrote (proves integrity + key)
        // and sanity-check the dump is complete for this engine. Streaming keeps
        // memory constant, so multi-GB backups verify fine. Never let a
        // verification hiccup fail an otherwise-successful backup.
        let verified: number | null = null;
        let verifyError: string | null = null;
        try {
          const check = await verifyEncryptedBackup(
            filePath,
            cipher.iv,
            authTag,
            c.engine,
            compress
          );
          verified = check.ok ? 1 : 0;
          if (!check.ok) verifyError = check.summary;
          log(check.ok ? `Verified: ${check.summary}` : `Verify FAILED: ${check.summary}`);
        } catch (e: any) {
          verified = 0;
          verifyError = `verification error: ${e.message || e}`;
          log(`Verify error: ${e.message || e}`);
        }
        if (stderr.trim()) log(`${spec.cmd} messages:\n${stderr.trim()}`);
        log(`Backup finished in ${((Date.now() - started) / 1000).toFixed(1)}s`);
        d.prepare(
          `UPDATE backups SET status='success', filename=?, iv=?, auth_tag=?,
             size_bytes=?, duration_ms=?, finished_at=?, verified=?, verify_error=?,
             compressed=?, log=?
           WHERE id=?`
        ).run(
          filename,
          cipher.iv,
          authTag,
          size,
          Date.now() - started,
          new Date().toISOString(),
          verified,
          verifyError,
          compress ? 1 : 0,
          logLines.join("\n"),
          backupId
        );
        resolve();
      });
      out.on("error", reject);

      child.on("close", (code) => {
        if (code !== 0) {
          out.destroy();
          reject(new Error(stderr.trim() || `Dump exited with code ${code}`));
        }
      });
    });

    applyRetention(c);
    endLiveLog(backupId);
    return backupId;
  } catch (err: any) {
    // Clean up partial file and mark failed.
    try {
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    } catch {}
    log(`FAILED: ${String(err.message || err)}`);
    d.prepare(
      `UPDATE backups SET status='failed', error=?, duration_ms=?, finished_at=?, log=? WHERE id=?`
    ).run(
      String(err.message || err),
      Date.now() - started,
      new Date().toISOString(),
      logLines.join("\n"),
      backupId
    );
    endLiveLog(backupId);
    return backupId;
  }
}

/** Enforce the connection's retention policy (keep N newest successful backups). */
export function applyRetention(c: ConnectionRow) {
  if (!c.retention || c.retention <= 0) return;
  const d = db();
  const rows = d
    .prepare(
      `SELECT * FROM backups WHERE connection_id=? AND status='success'
       ORDER BY started_at DESC`
    )
    .all(c.id) as BackupRow[];
  const stale = rows.slice(c.retention);
  for (const b of stale) {
    if (b.filename) {
      try {
        fs.unlinkSync(path.join(BACKUP_DIR, b.filename));
      } catch {}
    }
    d.prepare(`DELETE FROM backups WHERE id=?`).run(b.id);
  }
}
