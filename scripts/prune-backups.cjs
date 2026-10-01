#!/usr/bin/env node
/*
 * prune-backups.cjs — apply a "keep newest N" retention to every connection.
 *
 *   node scripts/prune-backups.cjs            # dry-run, shows what would go
 *   node scripts/prune-backups.cjs --keep 3 --apply
 *
 * --keep N   how many newest SUCCESSFUL backups to keep per connection (default 3)
 * --set      also persist N as the connection's retention (so future backups auto-prune)
 * --apply    actually delete (otherwise dry-run)
 */
const fs = require("fs");
const path = require("path");
const ROOT = path.resolve(__dirname, "..");
const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(ROOT, "data"));
const BACKUP_DIR = path.join(DATA_DIR, "backups");

const argv = process.argv.slice(2);
const opt = (n, d) => {
  const i = argv.indexOf(n);
  return i >= 0 ? argv[i + 1] : d;
};
const has = (n) => argv.includes(n);
const KEEP = Number(opt("--keep", "3"));
const APPLY = has("--apply");
const SET = has("--set");

const Database = require(path.join(ROOT, "node_modules", "better-sqlite3"));
const db = new Database(path.join(DATA_DIR, "devgems.sqlite"), { readonly: !APPLY && !SET });

const conns = db.prepare("SELECT id, name FROM connections").all();
let deleted = 0;
for (const c of conns) {
  if (SET) db.prepare("UPDATE connections SET retention=? WHERE id=?").run(KEEP, c.id);
  const rows = db
    .prepare(
      "SELECT * FROM backups WHERE connection_id=? AND status='success' ORDER BY started_at DESC"
    )
    .all(c.id);
  const keep = rows.slice(0, KEEP);
  const stale = rows.slice(KEEP);
  console.log(`\n${c.name}: ${rows.length} success backup(s) — keep ${keep.length}, remove ${stale.length}`);
  for (const b of stale) {
    console.log(`  ${APPLY ? "deleting" : "would delete"}  #${b.id}  ${b.started_at}  ${b.filename}`);
    if (APPLY) {
      if (b.filename) {
        try {
          fs.unlinkSync(path.join(BACKUP_DIR, b.filename));
        } catch {}
      }
      db.prepare("DELETE FROM backups WHERE id=?").run(b.id);
      deleted++;
    }
  }
}
console.log(
  `\n${APPLY ? `Done — removed ${deleted} old backup(s).` : "(dry-run — pass --apply to delete)"}` +
    (SET ? `  Retention set to ${KEEP}.` : "")
);
