# DevGems — Quick Guide

**DevGems** is a web app to back up databases (PostgreSQL, MySQL/MariaDB, SQL Server,
Oracle, MongoDB, SQLite), keep the backups **encrypted**, **verify** them, and
**restore** them — on demand or on a schedule.

---

## The 3 things it does

| Step | What happens |
|---|---|
| **1. Back up** | Runs the DB's native dump tool and streams the output through **AES-256-GCM** straight into an encrypted `.enc` file. Plaintext never hits the disk. |
| **2. Verify** | Every backup is auto-checked: decryption proves it's **intact + key is correct**, and header/footer markers prove the dump is **complete** (not truncated). Shown as ✓ Verified. |
| **3. Restore** | Decrypts and loads a backup into a **target** database you choose (never the live source). |

---

## Key ideas in 60 seconds

- **One secret protects everything:** `BACKUP_ENCRYPTION_KEY` (in `.env.local`) is
  turned into an AES-256 key that encrypts **all backup files** and **all stored DB
  passwords**. Steal the files → useless without the key. **Lose the key → backups
  are gone forever.** Keep a copy in a password manager.
- **Login is passwordless:** you sign in with a key file (ECDSA). The private key
  never leaves your device.
- **Permissions:** admins do everything; members get fine-grained rights
  (view / run / edit / delete / manage users).
- **Everything streams:** dumps, verification, and restores never load the whole DB
  into memory — so multi-GB databases work fine.

---

## Everyday use

**Add a source:** Connections → New → enter engine, host, port, database, user,
password → Save. Hit **Test** to confirm it connects.

**Back up:** open the connection → **Backup now**, or set a **cron schedule** for
automatic backups.

**Keep only the latest few:** set **Retention = 2 or 3** on the connection; older
backups are pruned automatically.

**Check a backup:** the Backups page shows the file name, date/time, size, status,
and a ✓ Verified / ✕ Unverified badge.

**Restore:** Backups → **Restore** → enter a *target* DB (e.g. `localhost` / a
scratch database) → tick "recreate" + "auto-create roles" → **Restore now**.

---

## Common gotchas

| Problem | Fix |
|---|---|
| `pg_dump: server version mismatch` | Your dump tool is older than the DB. Install a matching client on the app host (`bash install-pg15-client.sh`). Nothing on the DB server changes. |
| Restore: `role "..." does not exist` | Keep **Auto-create roles** ticked (creates it for you). |
| Restore: `database already exists` | Tick **Recreate target database** (drops & recreates for a clean restore). |
| Backup **failed**, 0 bytes | Wrong DB name / credentials — the app refuses to save an empty dump. Fix and retry. |

---

## Command-line helpers (optional)

```bash
./dbbackup.sh                              # guided, version-aware backup
node scripts/verify-backup.cjs --all       # verify every backup
node scripts/restore-backup.cjs --out d.sql   # just decrypt a backup to a .sql file
node scripts/prune-backups.cjs --keep 3 --set --apply  # keep newest 3
```

---

*Full details: see **DOCUMENTATION.md**.*
