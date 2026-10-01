#!/usr/bin/env bash
#
# dbbackup.sh — version-aware DB backup helper
#
# What it does (ALL local — the remote server is only READ from, never changed):
#   1. You pick the engine (PostgreSQL or MySQL/MariaDB) + connection details.
#   2. It connects and detects the SERVER version.
#   3. It checks whether a matching local client (pg_dump/mysqldump) exists.
#        - Postgres rule: pg_dump major version MUST be >= server major.
#   4. If no matching client is installed LOCALLY, it installs one
#      (PGDG repo for PG) *alongside* your existing client — nothing is
#      downgraded, replaced, or removed. It then calls that exact binary
#      by full path, so your default PATH/version is untouched.
#   5. Runs the dump into this folder.
#
# The remote server gets NO installs and NO changes.

set -euo pipefail

BACKUP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TS="$(date +%F_%H%M%S)"

say()  { printf '\n\033[1;36m==>\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[warn]\033[0m %s\n' "$*"; }
die()  { printf '\033[1;31m[err]\033[0m %s\n' "$*" >&2; exit 1; }

# ---------------------------------------------------------------------------
# 1. choose engine + connection
# ---------------------------------------------------------------------------
say "Which database engine?"
select ENGINE in "PostgreSQL" "MySQL/MariaDB" "Quit"; do
  case "$ENGINE" in
    PostgreSQL|MySQL/MariaDB) break ;;
    Quit) exit 0 ;;
    *) echo "pick 1, 2 or 3" ;;
  esac
done

read -rp "Host [192.168.1.175]: "  DBHOST;  DBHOST="${DBHOST:-192.168.1.175}"
read -rp "Port: "                  DBPORT
read -rp "User [appadmin]: "       DBUSER;  DBUSER="${DBUSER:-appadmin}"
read -rp "Database name: "         DBNAME
read -rsp "Password (leave blank to be prompted by the tool): " DBPASS; echo

# ===========================================================================
# PostgreSQL
# ===========================================================================
if [[ "$ENGINE" == "PostgreSQL" ]]; then
  DBPORT="${DBPORT:-5432}"
  export PGPASSWORD="$DBPASS"

  command -v psql >/dev/null || die "no psql on this machine to probe the server"

  say "Detecting server version at ${DBHOST}:${DBPORT} ..."
  SRV_NUM="$(psql -h "$DBHOST" -p "$DBPORT" -U "$DBUSER" -d "$DBNAME" -tAX \
              -c 'SHOW server_version_num;')" \
      || die "could not connect (check host/port/user/password/pg_hba)"
  SRV_NUM="$(echo "$SRV_NUM" | tr -dc '0-9')"
  SRV_MAJOR=$(( SRV_NUM / 10000 ))
  say "Server is PostgreSQL major version: $SRV_MAJOR"

  # find the best already-installed pg_dump (major >= server major)
  PGDUMP=""
  for d in $(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -Vr); do
    v="$(basename "$(dirname "$d")")"
    if [[ -x "$d/pg_dump" && "$v" -ge "$SRV_MAJOR" ]]; then
      PGDUMP="$d/pg_dump"; CLIENT_MAJOR="$v"; break
    fi
  done

  if [[ -z "$PGDUMP" ]]; then
    warn "No installed pg_dump >= $SRV_MAJOR found LOCALLY."
    warn "Will install postgresql-client-${SRV_MAJOR} alongside your existing client."
    warn "(Your current PG client and the remote server are NOT modified.)"
    read -rp "Proceed with apt install (needs sudo)? [y/N]: " ok
    [[ "$ok" =~ ^[Yy]$ ]] || die "aborted by user"

    # add PGDG repo if the package isn't available yet
    if ! apt-cache show "postgresql-client-${SRV_MAJOR}" >/dev/null 2>&1; then
      say "Adding PGDG apt repository ..."
      CODENAME="$(. /etc/os-release; echo "${VERSION_CODENAME:-jammy}")"
      sudo install -d /usr/share/postgresql-common/pgdg
      sudo curl -fsSL -o /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc \
        https://www.postgresql.org/media/keys/ACCC4CF8.asc
      echo "deb [signed-by=/usr/share/postgresql-common/pgdg/apt.postgresql.org.asc] https://apt.postgresql.org/pub/repos/apt ${CODENAME}-pgdg main" \
        | sudo tee /etc/apt/sources.list.d/pgdg.list >/dev/null
      sudo apt-get update
    fi
    sudo apt-get install -y "postgresql-client-${SRV_MAJOR}"
    PGDUMP="/usr/lib/postgresql/${SRV_MAJOR}/bin/pg_dump"
    CLIENT_MAJOR="$SRV_MAJOR"
    [[ -x "$PGDUMP" ]] || die "install finished but $PGDUMP not found"
  fi

  say "Using client pg_dump v${CLIENT_MAJOR}  (server v${SRV_MAJOR}) — match OK"
  OUT="${BACKUP_DIR}/${DBNAME}_pg${SRV_MAJOR}_${TS}.dump"
  say "Dumping to: $OUT"
  "$PGDUMP" -h "$DBHOST" -p "$DBPORT" -U "$DBUSER" -d "$DBNAME" -Fc -v -f "$OUT"
  say "Done. $(du -h "$OUT" | cut -f1)  ->  $OUT"
  echo "Restore with: pg_restore -d <targetdb> \"$OUT\"   (target server must be >= $SRV_MAJOR)"

# ===========================================================================
# MySQL / MariaDB
# ===========================================================================
else
  DBPORT="${DBPORT:-3306}"
  MYSQL_PWARG=(); [[ -n "$DBPASS" ]] && MYSQL_PWARG=(-p"$DBPASS")

  if ! command -v mysql >/dev/null; then
    warn "mysql client not installed locally."
    read -rp "Install mysql-client via apt (needs sudo)? [y/N]: " ok
    [[ "$ok" =~ ^[Yy]$ ]] || die "aborted by user"
    sudo apt-get update && sudo apt-get install -y mysql-client
  fi

  say "Detecting server version at ${DBHOST}:${DBPORT} ..."
  SRV_VER="$(mysql -h "$DBHOST" -P "$DBPORT" -u "$DBUSER" "${MYSQL_PWARG[@]}" \
              -N -B -e 'SELECT VERSION();')" \
      || die "could not connect (check host/port/user/password/grants)"
  say "Server reports: $SRV_VER"

  DUMP_VER="$(mysqldump --version 2>/dev/null)"
  say "Local mysqldump: $DUMP_VER"
  warn "mysqldump is generally forward/backward tolerant; if you hit a"
  warn "specific-version error, install the matching mysql-client-<ver> or"
  warn "mariadb-client and re-run."

  OUT="${BACKUP_DIR}/${DBNAME}_mysql_${TS}.sql.gz"
  say "Dumping to: $OUT"
  mysqldump -h "$DBHOST" -P "$DBPORT" -u "$DBUSER" "${MYSQL_PWARG[@]}" \
    --single-transaction --routines --triggers --events "$DBNAME" \
    | gzip > "$OUT"
  say "Done. $(du -h "$OUT" | cut -f1)  ->  $OUT"
  echo "Restore with: gunzip -c \"$OUT\" | mysql -h <host> -u <user> -p <targetdb>"
fi
