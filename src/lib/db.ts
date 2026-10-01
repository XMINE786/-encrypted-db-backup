import Database from "better-sqlite3";
import fs from "fs";
import path from "path";

export const DATA_DIR = path.resolve(process.env.DATA_DIR || "./data");
export const BACKUP_DIR = path.join(DATA_DIR, "backups");

// Ensure storage directories exist before opening the DB.
fs.mkdirSync(BACKUP_DIR, { recursive: true });

let _db: Database.Database | null = null;

export function db(): Database.Database {
  if (_db) return _db;
  _db = new Database(path.join(DATA_DIR, "devgems.sqlite"));
  _db.pragma("journal_mode = WAL");
  _db.pragma("foreign_keys = ON");
  migrate(_db);
  return _db;
}

function migrate(d: Database.Database) {
  d.exec(`
    CREATE TABLE IF NOT EXISTS connections (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      name         TEXT NOT NULL,
      engine       TEXT NOT NULL,
      host         TEXT NOT NULL DEFAULT '',
      port         INTEGER,
      database     TEXT NOT NULL,
      username     TEXT NOT NULL DEFAULT '',
      password_enc TEXT NOT NULL DEFAULT '',
      options      TEXT,
      schedule     TEXT,               -- cron expression, nullable
      retention    INTEGER DEFAULT 0,  -- keep N newest backups (0 = keep all)
      created_at   TEXT NOT NULL,
      updated_at   TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS backups (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      connection_id INTEGER NOT NULL REFERENCES connections(id) ON DELETE CASCADE,
      status        TEXT NOT NULL,       -- running | success | failed
      trigger       TEXT NOT NULL,       -- manual | scheduled
      filename      TEXT,
      iv            TEXT,
      auth_tag      TEXT,
      size_bytes    INTEGER DEFAULT 0,
      duration_ms   INTEGER DEFAULT 0,
      error         TEXT,
      started_at    TEXT NOT NULL,
      finished_at   TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_backups_conn ON backups(connection_id);
    CREATE INDEX IF NOT EXISTS idx_backups_started ON backups(started_at DESC);

    CREATE TABLE IF NOT EXISTS users (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      username      TEXT NOT NULL UNIQUE,
      public_key    TEXT,               -- ECDSA P-256 public key, SPKI base64
      key_id        TEXT,               -- client-generated id linking to the key file
      fingerprint   TEXT,               -- sha256 of the public key (display)
      is_admin      INTEGER NOT NULL DEFAULT 0,
      permissions   TEXT NOT NULL DEFAULT '{}',  -- JSON booleans
      created_at    TEXT NOT NULL,
      last_login_at TEXT
    );

    CREATE TABLE IF NOT EXISTS sessions (
      token       TEXT PRIMARY KEY,      -- random opaque token
      user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at  TEXT NOT NULL,
      expires_at  TEXT NOT NULL,
      user_agent  TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

    -- Short-lived login challenges (nonces) for key-based auth.
    CREATE TABLE IF NOT EXISTS auth_challenges (
      id          TEXT PRIMARY KEY,
      username    TEXT NOT NULL,
      nonce       TEXT NOT NULL,         -- base64 random bytes
      expires_at  TEXT NOT NULL
    );
  `);

  // --- Migration for databases created before key-based auth ---
  const cols = (d.prepare(`PRAGMA table_info(users)`).all() as { name: string }[]).map(
    (c) => c.name
  );
  const addCol = (name: string, def: string) => {
    if (!cols.includes(name)) d.exec(`ALTER TABLE users ADD COLUMN ${name} ${def}`);
  };
  addCol("public_key", "TEXT");
  addCol("key_id", "TEXT");
  addCol("fingerprint", "TEXT");
  addCol("is_admin", "INTEGER NOT NULL DEFAULT 0");
  addCol("permissions", "TEXT NOT NULL DEFAULT '{}'");

  // --- Migration: post-backup verification results ---
  const bcols = (d.prepare(`PRAGMA table_info(backups)`).all() as { name: string }[]).map(
    (c) => c.name
  );
  // verified: NULL = not checked, 1 = passed, 0 = failed
  if (!bcols.includes("verified")) d.exec(`ALTER TABLE backups ADD COLUMN verified INTEGER`);
  if (!bcols.includes("verify_error")) d.exec(`ALTER TABLE backups ADD COLUMN verify_error TEXT`);
  // compressed: 1 = payload was gzipped before encryption, 0 = raw. Drives
  // whether readers gunzip after decrypt. Old backups default to 0 (raw).
  if (!bcols.includes("compressed"))
    d.exec(`ALTER TABLE backups ADD COLUMN compressed INTEGER NOT NULL DEFAULT 0`);
  // log: human-readable, per-stage account of the dump → gzip → encrypt →
  // verify pipeline, shown in the UI. Null for backups taken before this column.
  if (!bcols.includes("log")) d.exec(`ALTER TABLE backups ADD COLUMN log TEXT`);
  // Legacy password-only accounts can no longer authenticate; drop them so the
  // first key-based admin setup can run cleanly, then remove the NOT NULL
  // password column that would otherwise block key-only inserts.
  if (cols.includes("password_hash")) {
    d.exec(`DELETE FROM users WHERE public_key IS NULL`);
    d.exec(`ALTER TABLE users DROP COLUMN password_hash`);
  }
}

// ---- Types ----
export interface UserRow {
  id: number;
  username: string;
  public_key: string | null;
  key_id: string | null;
  fingerprint: string | null;
  is_admin: number;
  permissions: string; // JSON
  created_at: string;
  last_login_at: string | null;
}

export interface ChallengeRow {
  id: string;
  username: string;
  nonce: string;
  expires_at: string;
}

export interface SessionRow {
  token: string;
  user_id: number;
  created_at: string;
  expires_at: string;
  user_agent: string | null;
}

export interface ConnectionRow {
  id: number;
  name: string;
  engine: string;
  host: string;
  port: number | null;
  database: string;
  username: string;
  password_enc: string;
  options: string | null;
  schedule: string | null;
  retention: number;
  created_at: string;
  updated_at: string;
}

export interface BackupRow {
  id: number;
  connection_id: number;
  status: "running" | "success" | "failed";
  trigger: "manual" | "scheduled";
  filename: string | null;
  iv: string | null;
  auth_tag: string | null;
  size_bytes: number;
  duration_ms: number;
  error: string | null;
  started_at: string;
  finished_at: string | null;
  /** Post-backup verification: null = not checked, 1 = passed, 0 = failed. */
  verified: number | null;
  verify_error: string | null;
  /** 1 = payload was gzipped before encryption and must be gunzipped on read. */
  compressed: number;
  /** Per-stage pipeline log (dump → gzip → encrypt → verify). Null if not recorded. */
  log: string | null;
}
