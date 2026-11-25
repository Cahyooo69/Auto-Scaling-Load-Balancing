#!/bin/sh
set -e

# Allow streaming replication & password auth inside the isolated overlay network
cat >> "$PGDATA/pg_hba.conf" <<'EOF'
host replication replicator all scram-sha-256
host all all all scram-sha-256
EOF

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-EOSQL
  DO \$\$
  BEGIN
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'replicator') THEN
      CREATE ROLE replicator WITH REPLICATION LOGIN PASSWORD '${DB_REPLICATOR_PASSWORD:-replicator_secret_2026}';
    END IF;
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'app_writer') THEN
      CREATE ROLE app_writer WITH LOGIN PASSWORD '${DB_WRITE_PASSWORD:-writer_secret_2026}';
    END IF;
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'app_reader') THEN
      CREATE ROLE app_reader WITH LOGIN PASSWORD '${DB_READ_PASSWORD:-reader_secret_2026}';
    END IF;
  END
  \$\$;

  REVOKE CREATE ON SCHEMA public FROM PUBLIC;
  GRANT CONNECT ON DATABASE ${POSTGRES_DB} TO app_writer, app_reader;
  GRANT USAGE ON SCHEMA public TO app_writer, app_reader;

  -- Least privilege: future tables created by admin inherit scoped DML/read grants automatically
  ALTER DEFAULT PRIVILEGES FOR ROLE ${POSTGRES_USER} IN SCHEMA public
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_writer;
  ALTER DEFAULT PRIVILEGES FOR ROLE ${POSTGRES_USER} IN SCHEMA public
    GRANT USAGE, SELECT ON SEQUENCES TO app_writer;
  ALTER DEFAULT PRIVILEGES FOR ROLE ${POSTGRES_USER} IN SCHEMA public
    GRANT SELECT ON TABLES TO app_reader;
EOSQL
