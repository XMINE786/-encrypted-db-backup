import { spawn } from "child_process";
import zlib from "zlib";
import fs from "fs";
import path from "path";
import { db, BACKUP_DIR, ConnectionRow, BackupRow } from "./db";
import { decryptString, createEncryptStream } from "./crypto";
import { verifyEncryptedBackup } from "./verify";
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

  try {
    const spec = buildDumpCommand(connParams(c));
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

      // dump stdout -> [gzip] -> cipher -> file
      if (compress) {
        const gzip = zlib.createGzip();
        gzip.on("error", reject);
        child.stdout.pipe(gzip).pipe(cipher.stream).pipe(out);
      } else {
        child.stdout.pipe(cipher.stream).pipe(out);
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
          reject(
            new Error(
              stderr.trim() ||
                "Dump produced no output (0 bytes). Check the database name/path and credentials."
            )
          );
          return;
        }
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
        } catch (e: any) {
          verified = 0;
          verifyError = `verification error: ${e.message || e}`;
        }
        d.prepare(
          `UPDATE backups SET status='success', filename=?, iv=?, auth_tag=?,
             size_bytes=?, duration_ms=?, finished_at=?, verified=?, verify_error=?,
             compressed=?
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
    return backupId;
  } catch (err: any) {
    // Clean up partial file and mark failed.
    try {
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    } catch {}
    d.prepare(
      `UPDATE backups SET status='failed', error=?, duration_ms=?, finished_at=? WHERE id=?`
    ).run(String(err.message || err), Date.now() - started, new Date().toISOString(), backupId);
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
