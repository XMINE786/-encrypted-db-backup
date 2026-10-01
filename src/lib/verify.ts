import fs from "fs";
import zlib from "zlib";
import { createDecryptStream } from "./crypto";
import { EngineId } from "./engines";

export interface DumpCheck {
  ok: boolean;
  /** Short human summary, stored/shown when a check fails or for logging. */
  summary: string;
}

/**
 * Decide whether a dump looks complete/well-formed from just its head and tail.
 * We only need the boundaries: a valid dump has the tool's header near the start
 * and its completion marker near the end (proving it wasn't truncated). This
 * avoids scanning the whole payload, so it works for multi-GB backups.
 */
export function inspectDumpParts(engine: string, head: string, tail: string): DumpCheck {
  switch (engine as EngineId) {
    case "postgres": {
      const header = /PostgreSQL database dump/.test(head);
      const footer = /PostgreSQL database dump complete/.test(tail);
      if (!header) return { ok: false, summary: "missing pg_dump header" };
      if (!footer)
        return { ok: false, summary: "missing completion footer — dump likely truncated" };
      return { ok: true, summary: "pg_dump OK (header + completion footer present)" };
    }
    case "mysql":
    case "mariadb": {
      const header = /-- MySQL dump|-- MariaDB dump|-- Server version/.test(head);
      const footer = /Dump completed/.test(tail);
      if (!header) return { ok: false, summary: "missing mysqldump header" };
      return {
        ok: true,
        summary: `mysqldump OK${footer ? " (header + footer present)" : " (no footer marker)"}`,
      };
    }
    case "sqlite": {
      const ok = /PRAGMA |BEGIN TRANSACTION|CREATE TABLE/.test(head);
      return ok
        ? { ok: true, summary: "sqlite dump OK" }
        : { ok: false, summary: "missing sqlite dump markers" };
    }
    default:
      // mongodb (bson archive), sqlserver, oracle, etc. — no reliable text
      // markers, so integrity (GCM) + non-empty is the best we can assert here.
      return { ok: true, summary: "binary payload (integrity-only check)" };
  }
}

/**
 * Verify an encrypted backup file: streams it through the GCM decipher (which
 * authenticates the whole file — a bad tag / corruption throws), while keeping
 * only the first and last few KB in memory for the engine completeness check.
 * Constant memory, so it scales to arbitrarily large backups.
 */
export function verifyEncryptedBackup(
  filePath: string,
  iv: string,
  authTag: string,
  engine: string,
  compressed = false
): Promise<DumpCheck> {
  const CAP = 8192; // bytes of head/tail to retain for marker checks
  return new Promise((resolve) => {
    let head = Buffer.alloc(0);
    let tail = Buffer.alloc(0);
    let total = 0;
    let stream: NodeJS.ReadableStream;
    const fail = (e: any) =>
      resolve({ ok: false, summary: `integrity check failed: ${e.message || e}` });
    try {
      // file -> GCM decipher -> [gunzip] -> plaintext dump. A GCM auth failure
      // throws on the decipher, so attach the handler there too — pipe() does
      // not forward error events downstream to the gunzip stream.
      const decipher = fs.createReadStream(filePath).pipe(createDecryptStream(iv, authTag));
      decipher.on("error", fail);
      stream = compressed ? decipher.pipe(zlib.createGunzip()) : decipher;
    } catch (e: any) {
      return resolve({ ok: false, summary: `could not open backup: ${e.message || e}` });
    }
    stream.on("data", (chunk: Buffer) => {
      total += chunk.length;
      if (head.length < CAP) {
        head = Buffer.concat([head, chunk]);
        if (head.length > CAP) head = head.subarray(0, CAP);
      }
      tail = Buffer.concat([tail, chunk]);
      if (tail.length > CAP) tail = tail.subarray(tail.length - CAP);
    });
    stream.on("end", () => {
      if (total === 0) return resolve({ ok: false, summary: "empty payload (0 bytes)" });
      resolve(inspectDumpParts(engine, head.toString("utf8"), tail.toString("utf8")));
    });
    // A gunzip failure (corrupt payload) surfaces here; GCM failures above.
    stream.on("error", fail);
  });
}
