-- MSSQL source-database connection settings, editable from the Sinkronisasi page.
--
-- Two rows, keyed 'MPMDS' and 'MPMHRGA', mirroring config.dbMPMDS / config.dbMPMHRGA
-- in sync-service/src/config.ts. When a row is absent or inactive the service
-- falls back to the DB_MPMDS_* / DB_MPMHRGA_* environment variables exactly as
-- today, so an untouched deployment keeps working unchanged.
--
-- WHY THIS TABLE AND NOT A JSON FILE
-- The readiness-config.json / scoring-prompts.json pattern requires bind-mounting
-- repo files into the sibling container (docker-compose.yml:66-67). The sync
-- container mounts only its uploads volume, so a file would be invisible to it.
-- Postgres is already shared by all three services.
--
-- WHY POSTGRES ITSELF STAYS IN ENV
-- POSTGRES_URL cannot live here: this table IS in Postgres, so making the
-- Postgres connection UI-editable would be a bootstrap cycle.
--
-- The password is stored SEALED (lib/crypto/envelope.ts, v1:iv:tag:ct). It is
-- never returned to the browser — the read path reports only whether one is set.

CREATE TABLE IF NOT EXISTS "sync_source_connections" (
  "id"            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- 'MPMDS' | 'MPMHRGA'
  "source_key"    varchar(20) NOT NULL,
  "server"        varchar(255) NOT NULL,
  "port"          integer NOT NULL DEFAULT 1433,
  "username"      varchar(128) NOT NULL,
  -- Ciphertext, or NULL meaning "no password configured here — use the env var".
  "password_encrypted" text,
  "database_name" varchar(128) NOT NULL,
  -- Mirrors the mssql driver options the service already hardcodes, so they stop
  -- being a code change.
  "encrypt"                  boolean NOT NULL DEFAULT true,
  "trust_server_certificate" boolean NOT NULL DEFAULT true,
  -- Inactive rows are ignored and the env fallback applies, which gives an
  -- operator a way back without deleting what they configured.
  "is_active"     boolean NOT NULL DEFAULT true,
  "updated_by"    uuid,
  "created_at"    timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at"    timestamp with time zone NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'sync_source_connections_updated_by_users_id_fk'
  ) THEN
    ALTER TABLE "sync_source_connections"
      ADD CONSTRAINT "sync_source_connections_updated_by_users_id_fk"
      FOREIGN KEY ("updated_by") REFERENCES "users"("id") ON DELETE set null ON UPDATE no action;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'sync_source_connections_key_check'
  ) THEN
    ALTER TABLE "sync_source_connections"
      ADD CONSTRAINT "sync_source_connections_key_check"
      CHECK ("source_key" IN ('MPMDS', 'MPMHRGA'));
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "uq_sync_source_connections_key"
  ON "sync_source_connections" ("source_key");
