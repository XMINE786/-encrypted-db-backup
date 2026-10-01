#!/usr/bin/env node
/*
 * verify-backup.cjs — verify a DevGems encrypted backup is correct & restorable.
 *
 * It reuses the app's exact scheme:
 *   key = scrypt(BACKUP_ENCRYPTION_KEY, "devgems.v1.salt", 32)
 *   file = raw AES-256-GCM ciphertext;  IV + auth tag stored in devgems.sqlite.
 *
 * Checks performed:
 *   1. Metadata lookup   — finds the backup row (latest success, or --id/--file).
 *   2. Integrity (GCM)   — authenticated decryption; if the tag verifies, the
 *                          file is byte-for-byte intact and matches your key.
 *   3. Size match        — on-disk file size vs size_bytes recorded at dump time.
 *   4. Content sanity    — engine-specific markers (pg_dump header/footer, etc.)
 *                          + object counts (CREATE TABLE / COPY / INSERT).
 *
 * Usage:
 *   node scripts/verify-backup.cjs                 # newest successful backup
 *   node scripts/verify-backup.cjs --id 3
 *   node scripts/verify-backup.cjs --file aiou-transport-uat-....sql.enc
 *   node scripts/verify-backup.cjs --out /tmp/restore.sql   # also write plaintext
 *   node scripts/verify-backup.cjs --all           # verify every success backup
 *   node scripts/verify-backup.cjs --all --write    # + backfill verified flag in DB
 */

const fs = require("fs");
const zlib = require("zlib");
const path = require("path");
const crypto = require("crypto");
const readline = require("readline");

const ROOT = path.resolve(__dirname, "..");

// ---- tiny .env loader (.env.local then .env) --------------------------------
function loadEnv() {
  for (const f of [".env.local", ".env"]) {
    const p = path.join(ROOT, f);
    if (!fs.existsSync(p)) continue;
    for (const line of fs.readFileSync(p, "utf8").split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
      if (m && process.env[m[1]] === undefined) {
        let v = m[2];
        if (
          (v.startsWith('"') && v.endsWith('"')) ||
          (v.startsWith("'") && v.endsWith("'"))
        )
          v = v.slice(1, -1);
        process.env[m[1]] = v;
      }
    }
  }
}
loadEnv();

// ---- args -------------------------------------------------------------------
const argv = process.argv.slice(2);
const opt = (name) => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
};
const has = (name) => argv.includes(name);

const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(ROOT, "data"));
const BACKUP_DIR = path.join(DATA_DIR, "backups");
const DB_PATH = path.join(DATA_DIR, "devgems.sqlite");

const C = {
  g: (s) => `\x1b[32m${s}\x1b[0m`,
  r: (s) => `\x1b[31m${s}\x1b[0m`,
  y: (s) => `\x1b[33m${s}\x1b[0m`,
  b: (s) => `\x1b[1m${s}\x1b[0m`,
  dim: (s) => `\x1b[2m${s}\x1b[0m`,
};

function die(msg) {
  console.error(C.r("ERROR: ") + msg);
  process.exit(1);
}

// ---- key derivation (must match src/lib/crypto.ts) --------------------------
function masterKey() {
  const secret = process.env.BACKUP_ENCRYPTION_KEY;
  if (!secret || secret.length < 8)
    die("BACKUP_ENCRYPTION_KEY not set (or <8 chars). Check .env.local.");
  return crypto.scryptSync(secret, "devgems.v1.salt", 32);
}

// ---- open metadata DB -------------------------------------------------------
let Database;
try {
  Database = require(path.join(ROOT, "node_modules", "better-sqlite3"));
} catch {
  die("better-sqlite3 not found — run this from the project (npm install done).");
}
if (!fs.existsSync(DB_PATH)) die(`metadata DB not found: ${DB_PATH}`);
const WRITE = has("--write");
const db = new Database(DB_PATH, { readonly: !WRITE });

if (WRITE) {
  // Ensure the verification columns exist (mirrors the app migration) so a
  // backfill works even before the app has restarted with the new schema.
  const bcols = db
    .prepare(`PRAGMA table_info(backups)`)
    .all()
    .map((c) => c.name);
  if (!bcols.includes("verified")) db.exec(`ALTER TABLE backups ADD COLUMN verified INTEGER`);
  if (!bcols.includes("verify_error")) db.exec(`ALTER TABLE backups ADD COLUMN verify_error TEXT`);
}

// ---- select backup row(s) ---------------------------------------------------
function rowsToCheck() {
  if (has("--all"))
    return db
      .prepare(
        `SELECT b.*, c.name conn_name, c.engine engine
           FROM backups b JOIN connections c ON c.id=b.connection_id
          WHERE b.status='success' ORDER BY b.started_at DESC`
      )
      .all();

  const id = opt("--id");
  const file = opt("--file");
  let row;
  if (id)
    row = db
      .prepare(
        `SELECT b.*, c.name conn_name, c.engine engine FROM backups b
           JOIN connections c ON c.id=b.connection_id WHERE b.id=?`
      )
      .get(Number(id));
  else if (file)
    row = db
      .prepare(
        `SELECT b.*, c.name conn_name, c.engine engine FROM backups b
           JOIN connections c ON c.id=b.connection_id WHERE b.filename=?`
      )
      .get(file);
  else
    row = db
      .prepare(
        `SELECT b.*, c.name conn_name, c.engine engine FROM backups b
           JOIN connections c ON c.id=b.connection_id
          WHERE b.status='success' ORDER BY b.started_at DESC LIMIT 1`
      )
      .get();
  if (!row) die("no matching backup row found.");
  return [row];
}

// ---- streaming decrypt + content scan (constant memory) ---------------------
// Streams the file through the GCM decipher (authenticates the whole payload)
// while scanning line-by-line, so it works for multi-GB backups.
function scanStream(row, key, outStream) {
  return new Promise((resolve) => {
    const decipher = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(row.iv, "hex"));
    decipher.setAuthTag(Buffer.from(row.auth_tag, "hex"));
    // file -> GCM decipher -> [gunzip] -> plaintext dump. Forward decipher
    // errors onto the gunzip stream since pipe() doesn't propagate them.
    let src = fs.createReadStream(path.join(BACKUP_DIR, row.filename)).pipe(decipher);
    if (row.compressed) {
      const gunzip = zlib.createGunzip();
      decipher.on("error", (e) => gunzip.emit("error", e));
      src = src.pipe(gunzip);
    }

    const s = {
      bytes: 0,
      header: false,
      footer: false,
      createTable: 0,
      copy: 0,
      insert: 0,
      createIndex: 0,
      sequence: 0,
      sqliteMarkers: false,
    };
    src.on("data", (chunk) => (s.bytes += chunk.length));
    if (outStream) src.pipe(outStream);

    const rl = readline.createInterface({ input: src, crlfDelay: Infinity });
    rl.on("line", (line) => {
      if (!s.header && /PostgreSQL database dump|-- MySQL dump|-- MariaDB dump|-- Server version/.test(line))
        s.header = true;
      if (/PostgreSQL database dump complete|Dump completed/.test(line)) s.footer = true;
      if (/^CREATE TABLE /.test(line)) s.createTable++;
      else if (/^COPY .* FROM stdin;/.test(line)) s.copy++;
      else if (/^INSERT INTO /.test(line)) s.insert++;
      else if (/^CREATE INDEX /.test(line)) s.createIndex++;
      if (/CREATE SEQUENCE /.test(line)) s.sequence++;
      if (/PRAGMA foreign_keys|BEGIN TRANSACTION|CREATE TABLE/.test(line)) s.sqliteMarkers = true;
    });
    rl.on("close", () => resolve({ ok: true, stats: s }));
    src.on("error", (e) => resolve({ ok: false, error: e.message }));
  });
}

function evaluate(engine, s) {
  if (engine === "postgres") {
    return {
      ok: s.header && s.footer,
      details: [
        `header marker ......... ${s.header ? C.g("found") : C.r("MISSING")}`,
        `footer marker ......... ${s.footer ? C.g("found") : C.r("MISSING (dump may be truncated)")}`,
        `CREATE TABLE .......... ${s.createTable}`,
        `COPY blocks ........... ${s.copy}`,
        `INSERT rows ........... ${s.insert}`,
        `CREATE INDEX .......... ${s.createIndex}`,
        `sequences ............. ${s.sequence}`,
      ],
    };
  }
  if (engine === "mysql" || engine === "mariadb") {
    return {
      ok: s.header,
      details: [
        `header marker ......... ${s.header ? C.g("found") : C.r("MISSING")}`,
        `footer marker ......... ${s.footer ? C.g("found") : C.y("not present")}`,
        `CREATE TABLE .......... ${s.createTable}`,
        `INSERT rows ........... ${s.insert}`,
      ],
    };
  }
  if (engine === "sqlite") {
    return {
      ok: s.sqliteMarkers,
      details: [
        `SQL dump markers ...... ${s.sqliteMarkers ? C.g("found") : C.r("MISSING")}`,
        `CREATE TABLE .......... ${s.createTable}`,
      ],
    };
  }
  return { ok: s.bytes > 0, details: [`binary payload ........ ${s.bytes} bytes (no text checks)`] };
}

// ---- verify one row ---------------------------------------------------------
async function verify(row, key) {
  const label = `#${row.id}  ${row.conn_name}  [${row.engine}]`;
  console.log("\n" + C.b("── " + label + " ──"));
  console.log(C.dim(`  file: ${row.filename}`));
  console.log(C.dim(`  taken: ${row.started_at}   recorded size: ${row.size_bytes} bytes`));

  if (!row.filename || !row.iv || !row.auth_tag) {
    console.log(C.r("  FAIL: missing filename/iv/auth_tag in metadata."));
    return false;
  }
  const fp = path.join(BACKUP_DIR, row.filename);
  if (!fs.existsSync(fp)) {
    console.log(C.r(`  FAIL: file missing on disk: ${fp}`));
    return false;
  }

  const outPath = opt("--out");
  const outStream = outPath ? fs.createWriteStream(outPath) : null;

  const r = await scanStream(row, key, outStream);
  if (!r.ok) {
    console.log(C.r("  FAIL: GCM authentication FAILED — file corrupt or wrong key."));
    console.log(C.dim(`        (${r.error})`));
    if (WRITE)
      db.prepare(`UPDATE backups SET verified=0, verify_error=? WHERE id=?`).run(
        "integrity check failed",
        row.id
      );
    return false;
  }
  console.log("  integrity (GCM tag) ... " + C.g("VERIFIED — file intact & key correct"));

  // size_bytes records the on-disk (encrypted, possibly gzipped) file size, so
  // compare against the actual file — not the decrypted stream length, which is
  // larger once a compressed payload is inflated.
  const diskBytes = fs.statSync(fp).size;
  const sizeOk = !row.size_bytes || diskBytes === row.size_bytes;
  console.log(
    "  on-disk size .......... " +
      (sizeOk ? C.g(`OK (${diskBytes} bytes)`) : C.y(`on disk ${diskBytes} vs meta ${row.size_bytes}`))
  );
  if (row.compressed)
    console.log(C.dim(`  decompressed .......... ${r.stats.bytes} bytes (gzip)`));

  const res = evaluate(row.engine, r.stats);
  for (const d of res.details) console.log("  " + d);
  if (outPath) console.log("  wrote plaintext ....... " + C.g(outPath));

  console.log(
    "  " +
      C.b(
        res.ok
          ? C.g("PASS - backup is valid and restorable")
          : C.r("SUSPECT - decrypted OK but content looks off")
      )
  );

  if (WRITE) {
    db.prepare(`UPDATE backups SET verified=?, verify_error=? WHERE id=?`).run(
      res.ok ? 1 : 0,
      res.ok ? null : "content check failed during verification",
      row.id
    );
    console.log("  " + C.dim("(wrote verified flag to metadata DB)"));
  }
  return res.ok;
}

// ---- run --------------------------------------------------------------------
(async () => {
  const key = masterKey();
  console.log(C.dim(`key fingerprint: ${crypto.createHash("sha256").update(key).digest("hex").slice(0, 12)}`));
  const rows = rowsToCheck();
  let allOk = true;
  for (const row of rows) allOk = (await verify(row, key)) && allOk;
  console.log();
  process.exit(allOk ? 0 : 2);
})();
