#!/usr/bin/env node
/*
 * restore-backup.cjs — decrypt a DevGems backup and load it into a database.
 *
 * It decrypts the encrypted .enc backup (AES-256-GCM, key derived from
 * BACKUP_ENCRYPTION_KEY, IV/tag read from devgems.sqlite) and pipes the plain
 * dump into the matching client tool:
 *     postgres         -> psql   (with ON_ERROR_STOP so a bad restore fails)
 *     mysql / mariadb  -> mysql
 *     sqlite           -> sqlite3
 *
 * SAFETY: the TARGET is always something YOU specify — it never reuses the
 * source connection, so you can't accidentally overwrite the live DB. You are
 * asked to confirm before anything is written (skip with --yes).
 *
 * Pick a backup:
 *     (default)          newest successful backup
 *     --id 10            a specific backup id
 *     --file NAME.enc    by filename
 *
 * Target (any omitted flag is prompted for; password is hidden / or via env
 * PGPASSWORD | MYSQL_PWD):
 *     --to-host H  --to-port P  --to-user U  --to-db DB  --to-pass PASS
 *
 * Other:
 *     --create      create the target database first (postgres/mysql)
 *     --yes         don't ask for confirmation
 *     --out FILE    just decrypt to FILE, do NOT restore
 *
 * Examples:
 *   node scripts/restore-backup.cjs --out /tmp/aiou.sql
 *   node scripts/restore-backup.cjs --id 10 --to-host localhost --to-port 5432 \
 *        --to-user postgres --to-db aiou_restore --create --yes
 */

const fs = require("fs");
const zlib = require("zlib");
const path = require("path");
const crypto = require("crypto");
const readline = require("readline");
const { spawn } = require("child_process");

const ROOT = path.resolve(__dirname, "..");

// ---- env + args -------------------------------------------------------------
(function loadEnv() {
  for (const f of [".env.local", ".env"]) {
    const p = path.join(ROOT, f);
    if (!fs.existsSync(p)) continue;
    for (const line of fs.readFileSync(p, "utf8").split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
      if (m && process.env[m[1]] === undefined) {
        let v = m[2];
        if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'")))
          v = v.slice(1, -1);
        process.env[m[1]] = v;
      }
    }
  }
})();

const argv = process.argv.slice(2);
const opt = (n) => {
  const i = argv.indexOf(n);
  return i >= 0 ? argv[i + 1] : undefined;
};
const has = (n) => argv.includes(n);

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
const die = (m) => {
  console.error(C.r("ERROR: ") + m);
  process.exit(1);
};

// ---- prompts ----------------------------------------------------------------
function ask(question, { hidden = false, def } = {}) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const q = def ? `${question} [${def}]: ` : `${question}: `;
    if (hidden) {
      const onData = (ch) => {
        ch = ch.toString();
        if (ch === "\n" || ch === "\r" || ch === "") process.stdout.write("\n");
        else process.stdout.write("*");
      };
      process.stdin.on("data", onData);
      rl.question(q, (ans) => {
        process.stdin.removeListener("data", onData);
        rl.close();
        resolve(ans || def || "");
      });
    } else {
      rl.question(q, (ans) => {
        rl.close();
        resolve(ans || def || "");
      });
    }
  });
}

// ---- key + metadata ---------------------------------------------------------
function masterKey() {
  const secret = process.env.BACKUP_ENCRYPTION_KEY;
  if (!secret || secret.length < 8)
    die("BACKUP_ENCRYPTION_KEY not set (or <8 chars). Check .env.local.");
  return crypto.scryptSync(secret, "devgems.v1.salt", 32);
}

let Database;
try {
  Database = require(path.join(ROOT, "node_modules", "better-sqlite3"));
} catch {
  die("better-sqlite3 not found — run from the project root.");
}
if (!fs.existsSync(DB_PATH)) die(`metadata DB not found: ${DB_PATH}`);
const meta = new Database(DB_PATH, { readonly: true });

function pickBackup() {
  const id = opt("--id");
  const file = opt("--file");
  const sel = `SELECT b.*, c.name conn_name, c.engine engine FROM backups b
                 JOIN connections c ON c.id=b.connection_id`;
  let row;
  if (id) row = meta.prepare(`${sel} WHERE b.id=?`).get(Number(id));
  else if (file) row = meta.prepare(`${sel} WHERE b.filename=?`).get(file);
  else
    row = meta
      .prepare(`${sel} WHERE b.status='success' ORDER BY b.started_at DESC LIMIT 1`)
      .get();
  if (!row) die("no matching backup found.");
  if (row.status !== "success") die(`backup #${row.id} status is '${row.status}', not restorable.`);
  return row;
}

function decrypt(row) {
  if (!row.filename || !row.iv || !row.auth_tag)
    die("backup row is missing filename/iv/auth_tag.");
  const fp = path.join(BACKUP_DIR, row.filename);
  if (!fs.existsSync(fp)) die(`backup file missing on disk: ${fp}`);
  try {
    const d = crypto.createDecipheriv("aes-256-gcm", masterKey(), Buffer.from(row.iv, "hex"));
    d.setAuthTag(Buffer.from(row.auth_tag, "hex"));
    const plain = Buffer.concat([d.update(fs.readFileSync(fp)), d.final()]);
    // Backups written with compressed=1 were gzipped before encryption.
    return row.compressed ? zlib.gunzipSync(plain) : plain;
  } catch (e) {
    die(
      "decryption/authentication FAILED — file is corrupt or BACKUP_ENCRYPTION_KEY is wrong."
    );
  }
}

// ---- restore per engine -----------------------------------------------------
function runPiped(cmd, args, env, payload) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { env: { ...process.env, ...env } });
    let stderr = "";
    child.stderr.on("data", (d) => (stderr += d.toString()));
    child.on("error", (e) =>
      resolve({ code: -1, stderr: e.code === "ENOENT" ? `"${cmd}" is not installed.` : e.message })
    );
    child.on("close", (code) => resolve({ code, stderr }));
    child.stdin.on("error", () => {}); // ignore EPIPE if the tool exits early
    child.stdin.end(payload);
  });
}

async function main() {
  const row = pickBackup();
  const engine = row.engine;
  console.log(C.b(`\nBackup #${row.id}  ${row.conn_name}  [${engine}]`));
  console.log(C.dim(`  file: ${row.filename}  taken: ${row.started_at}`));

  const plain = decrypt(row);
  console.log(C.g(`  decrypted OK (${plain.length} bytes)`));

  // decrypt-only mode
  const out = opt("--out");
  if (out) {
    fs.writeFileSync(out, plain);
    console.log(C.g(`  wrote plaintext dump -> ${out}`));
    console.log(C.dim("  (no restore performed; --out given)"));
    return;
  }

  // gather target
  let host = opt("--to-host");
  let port = opt("--to-port");
  let user = opt("--to-user");
  let dbname = opt("--to-db");
  let pass = opt("--to-pass");

  if (engine === "sqlite") {
    if (!dbname) dbname = await ask("Target SQLite file path");
  } else {
    if (!host) host = await ask("Target host", { def: "localhost" });
    if (!port)
      port = await ask("Target port", { def: engine === "postgres" ? "5432" : "3306" });
    if (!user) user = await ask("Target user", { def: engine === "postgres" ? "postgres" : "root" });
    if (!dbname) dbname = await ask("Target database (will receive the data)");
    if (pass === undefined)
      pass =
        process.env[engine === "postgres" ? "PGPASSWORD" : "MYSQL_PWD"] ||
        (await ask("Target password", { hidden: true }));
  }
  if (!dbname) die("target database is required.");

  // confirm
  const dest = engine === "sqlite" ? dbname : `${user}@${host}:${port}/${dbname}`;
  console.log(C.y(`\n  About to RESTORE backup #${row.id} INTO: ${C.b(dest)}`));
  console.log(C.y("  This writes the dump's schema+data into that target."));
  if (!has("--yes")) {
    const ans = await ask("  Type 'yes' to proceed");
    if (ans.trim().toLowerCase() !== "yes") die("aborted.");
  }

  // optionally create the target db first
  if (has("--create") && engine !== "sqlite") {
    console.log(C.dim("  creating target database (ignored if it exists) ..."));
    if (engine === "postgres") {
      await runPiped(
        "createdb",
        ["-h", host, "-p", String(port), "-U", user, dbname],
        { PGPASSWORD: pass },
        ""
      );
    } else {
      await runPiped(
        "mysql",
        [`-h${host}`, `-P${port}`, `-u${user}`],
        { MYSQL_PWD: pass },
        `CREATE DATABASE IF NOT EXISTS \`${dbname}\`;`
      );
    }
  }

  // restore
  console.log(C.dim("  restoring ...\n"));
  let res;
  if (engine === "postgres") {
    res = await runPiped(
      "psql",
      ["-h", host, "-p", String(port), "-U", user, "-d", dbname, "-v", "ON_ERROR_STOP=1"],
      { PGPASSWORD: pass },
      plain
    );
  } else if (engine === "mysql" || engine === "mariadb") {
    res = await runPiped(
      "mysql",
      [`-h${host}`, `-P${port}`, `-u${user}`, dbname],
      { MYSQL_PWD: pass },
      plain
    );
  } else if (engine === "sqlite") {
    res = await runPiped("sqlite3", [dbname], {}, plain);
  } else {
    die(`restore for engine '${engine}' is not supported by this script.`);
  }

  if (res.code === 0) {
    console.log(C.g(`\n  RESTORE SUCCEEDED -> ${dest}`));
    if (res.stderr.trim()) console.log(C.dim(res.stderr.trim()));
  } else {
    console.log(C.r(`\n  RESTORE FAILED (exit ${res.code})`));
    if (res.stderr.trim()) console.log(res.stderr.trim());
    process.exit(2);
  }
}

main();
