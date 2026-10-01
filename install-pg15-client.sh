#!/usr/bin/env bash
# Installs the PostgreSQL 15 client (pg_dump etc.) ALONGSIDE the existing v14.
# Nothing is removed/downgraded; the remote DB server is not touched.
set -euo pipefail

CODENAME="$(. /etc/os-release; echo "${VERSION_CODENAME:-jammy}")"

echo "==> Adding PGDG apt repository ($CODENAME) ..."
sudo install -d /usr/share/postgresql-common/pgdg
sudo curl -fsSL -o /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc \
  https://www.postgresql.org/media/keys/ACCC4CF8.asc
echo "deb [signed-by=/usr/share/postgresql-common/pgdg/apt.postgresql.org.asc] https://apt.postgresql.org/pub/repos/apt ${CODENAME}-pgdg main" \
  | sudo tee /etc/apt/sources.list.d/pgdg.list >/dev/null

echo "==> Installing postgresql-client-15 ..."
sudo apt-get update
sudo apt-get install -y postgresql-client-15

echo "==> Verifying ..."
ls -l /usr/lib/postgresql/15/bin/pg_dump
PGHOST=192.168.1.175 pg_dump --version   # should now report 15.x
echo "==> Done. The vault app's pg_dump will now auto-use v15 for the 15.3 server."
