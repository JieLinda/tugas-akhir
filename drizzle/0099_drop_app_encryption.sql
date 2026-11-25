-- Remove application-level encryption: drop the wrapped data key.
--
-- The `v1:<iv>:<tag>:<ct>` envelope (AES-256-GCM under a data key wrapped by the
-- master key in secrets/master.key) is removed from all three deployables. The
-- data key lives only in this table, so dropping it while ANY value is still
-- sealed would make that value permanently unreadable.
--
-- Order:
--   1. stop web, sync-service and scoring-service;
--   2. `npx tsx scripts/decrypt-all-sealed.ts --write` (needs the master key),
--      then run it again without --write: it must report "Total: 0 nilai";
--   3. deploy the new builds (they neither read nor write the envelope);
--   4. apply THIS migration;
--   5. only then delete secrets/master.key and its backups.
--
-- The guard below repeats step 2's check over every text/json column and
-- refuses to drop the table if a sealed value is found anywhere.

DO $$
DECLARE
  col record;
  found bigint;
BEGIN
  IF to_regclass('public.app_encryption_keys') IS NULL THEN
    RETURN;
  END IF;

  FOR col IN
    SELECT c.table_schema, c.table_name, c.column_name, c.data_type
      FROM information_schema.columns c
      JOIN information_schema.tables t
        ON t.table_schema = c.table_schema
       AND t.table_name = c.table_name
       AND t.table_type = 'BASE TABLE'
     WHERE c.table_schema NOT IN ('pg_catalog', 'information_schema')
       AND c.table_name <> 'app_encryption_keys'
       AND c.data_type IN ('text', 'character varying', 'character', 'json', 'jsonb')
  LOOP
    EXECUTE format(
      'SELECT count(*) FROM %I.%I WHERE %I::text ~ %L',
      col.table_schema, col.table_name, col.column_name,
      '(^|")v1:[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+:'
    ) INTO found;
    IF found > 0 THEN
      RAISE EXCEPTION
        'app_encryption_keys NOT dropped: % value(s) in %.%.% are still sealed. Run scripts/decrypt-all-sealed.ts --write first.',
        found, col.table_schema, col.table_name, col.column_name;
    END IF;
  END LOOP;

  DROP TABLE app_encryption_keys;
END $$;
