-- Envelope-encryption key material.
--
-- Holds the DATA key (DEK), sealed under the MASTER key that the user holds and
-- which is never stored anywhere — not in this table, not in .env, not on disk.
-- Losing the master key makes every value encrypted under this DEK permanently
-- unreadable; that is the intended property, and the UI says so before the key
-- is generated.
--
-- Two columns, both ciphertext:
--   wrapped_dek — the 32-byte DEK sealed under the master key.
--   verifier    — a fixed known string sealed under the DEK. Unlock decrypts
--                 this and compares; without it a wrong master key could hand
--                 back a plausible 32 bytes and the first symptom would be data
--                 written under a key nobody has.
--
-- Rows are append-only in practice: rotating the master key inserts a new row
-- wrapping the SAME DEK and deactivates the old one, so no column data has to
-- be rewritten.

CREATE TABLE IF NOT EXISTS "app_encryption_keys" (
  "id"          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Human label so an operator can tell two rows apart in a rotation.
  "label"       varchar(80) NOT NULL DEFAULT 'default',
  "wrapped_dek" text NOT NULL,
  "verifier"    text NOT NULL,
  "is_active"   boolean NOT NULL DEFAULT true,
  "created_by"  uuid,
  "created_at"  timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at"  timestamp with time zone NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'app_encryption_keys_created_by_users_id_fk'
  ) THEN
    ALTER TABLE "app_encryption_keys"
      ADD CONSTRAINT "app_encryption_keys_created_by_users_id_fk"
      FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE set null ON UPDATE no action;
  END IF;
END $$;

-- At most one active key. A second active row would mean unlock could pick
-- either one, so half the processes would hold a different DEK than the other
-- half and rows would decrypt or not depending on which server answered.
CREATE UNIQUE INDEX IF NOT EXISTS "uq_app_encryption_keys_active"
  ON "app_encryption_keys" (("is_active")) WHERE "is_active";
