# syntax=docker/dockerfile:1
# =====================================================================
#  DevGems — container image (Podman / Docker)
#
#  IMPORTANT: the app shells out to the DB dump/restore CLIs, so those
#  tools must live INSIDE this image. We install:
#    - postgresql-client-16  (pg_dump/psql; dumps servers <= 16, incl. 15.x)
#    - default-mysql-client  (mysqldump/mysql — MariaDB client, works for MySQL)
#    - sqlite3
#  (MongoDB/SQL Server/Oracle tools are optional — see the commented block.)
#
#  Secrets (BACKUP_ENCRYPTION_KEY, AUTH_SECRET) are NOT baked in — pass them
#  at runtime with --env-file or -e. Persistent data lives in /app/data,
#  declared as a VOLUME.
# =====================================================================

# ---------- Stage 1: build ----------
FROM node:20-bookworm-slim AS builder
WORKDIR /app

# Toolchain for compiling the native better-sqlite3 module.
RUN apt-get update && apt-get install -y --no-install-recommends \
      python3 make g++ ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Install deps first (better layer caching).
COPY package.json package-lock.json ./
RUN npm ci

# Build the Next.js app.
COPY . .
RUN npm run build \
    && npm prune --omit=dev   # drop devDeps; keeps next/react/better-sqlite3 etc.

# ---------- Stage 2: runtime ----------
FROM node:20-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production \
    PORT=3000 \
    HOSTNAME=0.0.0.0 \
    DATA_DIR=/app/data

# Runtime DB client tools (from PGDG for an up-to-date pg_dump).
RUN apt-get update && apt-get install -y --no-install-recommends \
      ca-certificates curl gnupg \
    && install -d /usr/share/postgresql-common/pgdg \
    && curl -fsSL https://www.postgresql.org/media/keys/ACCC4CF8.asc \
         -o /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc \
    && echo "deb [signed-by=/usr/share/postgresql-common/pgdg/apt.postgresql.org.asc] https://apt.postgresql.org/pub/repos/apt bookworm-pgdg main" \
         > /etc/apt/sources.list.d/pgdg.list \
    && apt-get update && apt-get install -y --no-install-recommends \
      postgresql-client-16 \
      default-mysql-client \
      sqlite3 \
    && rm -rf /var/lib/apt/lists/*

# --- Optional extra engines (uncomment if you back these up) ---
# MongoDB:
#   RUN curl -fsSL https://pgp.mongodb.com/server-7.0.asc | gpg --dearmor -o /usr/share/keyrings/mongodb.gpg \
#     && echo "deb [signed-by=/usr/share/keyrings/mongodb.gpg] https://repo.mongodb.org/apt/debian bookworm/mongodb-org/7.0 main" > /etc/apt/sources.list.d/mongodb.list \
#     && apt-get update && apt-get install -y --no-install-recommends mongodb-database-tools && rm -rf /var/lib/apt/lists/*

# Copy the built app + production node_modules from the builder.
COPY --from=builder /app/.next            ./.next
COPY --from=builder /app/node_modules     ./node_modules
COPY --from=builder /app/package.json     ./package.json
COPY --from=builder /app/next.config.js   ./next.config.js
COPY --from=builder /app/scripts          ./scripts

# Persistent storage: SQLite metadata DB + encrypted backups.
RUN mkdir -p /app/data && chown -R node:node /app
VOLUME ["/app/data"]

USER node
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD curl -fsS http://127.0.0.1:3000/login >/dev/null || exit 1

CMD ["npm", "start"]
