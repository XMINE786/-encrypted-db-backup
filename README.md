# DevGems

**Encrypted, multi-engine database backup manager.**

A web app to connect your databases, create **AES-256-GCM encrypted** backups,
schedule them, verify them, and restore them — all from one dashboard.

Works with **PostgreSQL · MySQL/MariaDB · SQL Server · Oracle · MongoDB · SQLite**.

![Next.js](https://img.shields.io/badge/Next.js-14-black) ![TypeScript](https://img.shields.io/badge/TypeScript-5-blue) ![License](https://img.shields.io/badge/license-MIT-green)

---

## Why DevGems?

- 🔒 **Encrypted by default** — every backup file and stored DB password is encrypted with AES-256-GCM. Plaintext never touches the disk.
- 🧩 **One tool for every engine** — like DBeaver, pick the engine per connection and DevGems shells out to the right native dump tool.
- ⏰ **Schedule or run on demand** — cron-based automatic backups with retention policies.
- ✅ **Self-verifying** — each backup is auto-checked to prove it's intact and complete.
- 🔑 **Passwordless login** — sign in with a key file (ECDSA); your private key never leaves your device.
- 👥 **Team-ready** — role-based access control with fine-grained permissions.

---

## Quick start

```bash
# 1. Install dependencies
npm install

# 2. Configure your secret
cp .env.example .env.local      # then set BACKUP_ENCRYPTION_KEY to a long random value

# 3. Run it
npm run dev                     # → http://localhost:3000
```

For production:

```bash
npm run build
npm start
```

> **First visit** redirects you to `/setup`. Enter a username — your browser generates an
> ECDSA key pair, downloads your **private key file**, and registers the public key.
> Keep that key file safe: it's the only way to sign in.

---

## Requirements

- **Node.js 18+**
- The native dump CLI for each engine you use, installed **on the host running DevGems**:

| Engine        | Tool needed      | Install (Debian/Ubuntu)                       |
|---------------|------------------|-----------------------------------------------|
| PostgreSQL    | `pg_dump`        | `apt install postgresql-client`               |
| MySQL/MariaDB | `mysqldump`      | `apt install mysql-client` / `mariadb-client` |
| SQL Server    | `mssql-scripter` | `pip install mssql-scripter`                  |
| Oracle        | `sql` (SQLcl)    | Download Oracle SQLcl                         |
| MongoDB       | `mongodump`      | `apt install mongodb-database-tools`          |
| SQLite        | `sqlite3`        | `apt install sqlite3`                         |

---

## How it works

**1. Back up** — DevGems runs the database's native dump tool and streams the output through
an AES-256-GCM cipher straight into an encrypted `.enc` file. Because it streams, multi-GB
databases never need to fit in memory.

**2. Verify** — every backup is automatically decrypted and checked. Decryption proves the
file is intact and the key is correct; header/footer markers prove the dump isn't truncated.
Shown as a ✓ Verified badge.

**3. Restore** — decrypt and load a backup into a **target** database you choose (never the
live source), with options to recreate the database and auto-create missing roles.

---

## Everyday use

| Task | How |
|---|---|
| **Add a source** | Connections → New → enter engine, host, port, database, user, password → **Test** → Save |
| **Back up now** | Open the connection → **Backup now** |
| **Schedule backups** | Set a cron schedule on the connection (presets or custom) |
| **Keep only the latest N** | Set **Retention** on the connection; older backups are pruned automatically |
| **Restore** | Backups → **Restore** → pick a target DB → tick *recreate* + *auto-create roles* → **Restore now** |
| **Download** | Backups → download the raw `.enc` blob or a decrypted copy on the fly |

### Command-line helpers (optional)

```bash
./dbbackup.sh                                          # guided, version-aware backup
node scripts/verify-backup.cjs --all                   # verify every backup
node scripts/restore-backup.cjs --out dump.sql         # decrypt a backup to a .sql file
node scripts/prune-backups.cjs --keep 3 --set --apply  # keep newest 3
```

---

## Configuration

| Variable                | Required | Description |
|-------------------------|----------|-------------|
| `BACKUP_ENCRYPTION_KEY` | ✅       | Master passphrase used to derive the AES-256 key for all backups and stored passwords. Use a long, random value. **Lose it and your backups cannot be decrypted** — keep a copy in a password manager. |
| `AUTH_SECRET`           | ❌       | Secret for signing login session cookies. Falls back to a value derived from `BACKUP_ENCRYPTION_KEY`. If you set it, do so **before `npm run build`**. |
| `DATA_DIR`              | ❌       | Where the SQLite metadata DB and encrypted backups live (default `./data`). |

---

## Security

- Backup files and DB credentials are encrypted at rest with **AES-256-GCM**; the key is
  derived via scrypt and never persisted.
- **Key-based login** gates the whole app via middleware (pages → `/login`, APIs → `401`).
  Login is rate-limited (10 failed attempts / IP / 15 min).
- **RBAC** — admins manage users; members get any combination of `viewBackups`, `runBackups`,
  `editConnections`, `deleteBackups`, `manageUsers`. Both the UI and API enforce permissions.
- Keep `.env.local` and `data/` out of version control (already in `.gitignore`).
- Put DevGems behind **HTTPS / a reverse proxy** when exposing it publicly so session cookies
  stay confidential.

> ⚠️ A user's key file **cannot be recovered** if lost — but an admin can always issue a
> replacement account or key.

---

## Troubleshooting

| Problem | Fix |
|---|---|
| `pg_dump: server version mismatch` | Your client is older than the DB. Install a matching client on the app host (`bash install-pg15-client.sh`). |
| Restore: `role "..." does not exist` | Keep **Auto-create roles** ticked. |
| Restore: `database already exists` | Tick **Recreate target database**. |
| Backup **failed**, 0 bytes | Wrong DB name or credentials — DevGems refuses to save an empty dump. Fix and retry. |

---

## Project layout

```
src/
  app/                     # Next.js App Router pages + API routes
    (app)/                 # Authenticated dashboard pages
    login/  setup/         # Auth flows
    api/connections/...    # CRUD, test, run-backup
    api/backups/...        # list, delete, download (raw/decrypted)
  components/              # Sidebar, ConnectionForm, shared UI
  lib/
    crypto.ts              # AES-256-GCM helpers (string + stream)
    db.ts                  # SQLite schema + accessors
    engines.ts             # per-engine dump/test command builders
    backup.ts              # runs dumps, encrypts, retention
    scheduler.ts           # node-cron scheduling
```

---

## Documentation

- **[OVERVIEW.md](OVERVIEW.md)** — a 2-minute quick guide.
- **[DOCUMENTATION.md](DOCUMENTATION.md)** — full reference.

---

## License

MIT
