#!/bin/sh
set -e

PRIMARY_HOST="${PRIMARY_HOST:-db-primary}"
PRIMARY_PORT="${PRIMARY_PORT:-5432}"
REPLICATOR_USER="${DB_REPLICATOR_USER:-replicator}"
REPLICATOR_PASS="${DB_REPLICATOR_PASSWORD:-replicator_secret_2026}"

if [ "$(id -u)" = "0" ]; then
  mkdir -p "$PGDATA"
  chown -R postgres:postgres "$PGDATA"
  chmod 0700 "$PGDATA"
  exec su-exec postgres /bin/sh "$0" "$@"
fi

echo "[Replica] Waiting for primary ${PRIMARY_HOST}:${PRIMARY_PORT}..."
until pg_isready -h "$PRIMARY_HOST" -p "$PRIMARY_PORT" -U "$REPLICATOR_USER" >/dev/null 2>&1; do
  sleep 2
done

if [ ! -s "$PGDATA/PG_VERSION" ]; then
  attempt=1
  while [ "$attempt" -le 5 ]; do
    echo "[Replica] Cloning base backup from ${PRIMARY_HOST} (attempt ${attempt}/5)..."
    rm -rf "${PGDATA:?}/"*
    if PGPASSWORD="$REPLICATOR_PASS" pg_basebackup \
      -h "$PRIMARY_HOST" \
      -p "$PRIMARY_PORT" \
      -U "$REPLICATOR_USER" \
      -D "$PGDATA" \
      -Fp -Xs -P -R; then
      chmod 0700 "$PGDATA"
      break
    fi
    attempt=$((attempt + 1))
    sleep 3
  done
fi

echo "[Replica] Starting PostgreSQL Hot Standby (Read-Only Replica)..."
exec postgres -c hot_standby=on -c max_connections=150 -c shared_buffers=64MB
