-- Discipline levels, as HR set them on 2026-11-25 (lightest → heaviest):
--
--   CLEAR → ST → SP_OVER_2_YEARS → SP_UNDER_2_YEARS → ACTIVE_SP → SP3 / SP_FIRST_LAST
--
-- The candidate sync (sync-service candidate-populate.ts, DISCIPLINE_STATUS_SQL)
-- now reads the HR source codes as the source writes them — 1 = SP1, 2 = SP2,
-- 3 = SP3, 4 = ST, 5 = SP Pertama & Terakhir — and SP1 is judged like SP2.
-- One status is NEW: SP_OVER_2_YEARS, an SP1/SP2 that ended two or more years
-- ago. Until now that person was stored as CLEAR.
--
-- 1. Stored discipline RULES keep the verdict they gave that person. Any
--    disciplineStatus rule whose value list names CLEAR also gets
--    SP_OVER_2_YEARS (`in` admits them as before, `notIn` turns them away as
--    before); `eq`/`neq` CLEAR become `in`/`notIn` [CLEAR, SP_OVER_2_YEARS].
--    Idempotent per rule. Who is admitted can be changed afterwards on the
--    Talent Pool page or in Tata Kelola like any other value.
--    scoring_runs.config_snapshot is NOT touched: a finished run was judged by
--    the rules it froze (I-1).
--
-- 2. candidates.discipline_status is stored upper-case and trimmed. The column
--    default was a lower-case 'clear', which failed every rule listing 'CLEAR'
--    while its label still read "Bersih" (docs/metodologi-laporan-scoring.md
--    §29.1). The default becomes 'CLEAR'.
--
-- Apply BEFORE the new sync-service runs its first candidate sync: that sync
-- writes SP_OVER_2_YEARS, which rules not yet migrated would reject.
CREATE OR REPLACE FUNCTION discipline_levels_0101(node jsonb)
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  result jsonb;
  item   jsonb;
  k      text;
  vals   jsonb;
  op     text;
BEGIN
  IF node IS NULL THEN
    RETURN node;
  END IF;

  IF jsonb_typeof(node) = 'object' THEN
    IF node ? 'field' AND node->>'field' = 'disciplineStatus' THEN
      op := node->>'operator';
      IF op IN ('in', 'notIn') AND jsonb_typeof(node->'value') = 'array' THEN
        IF EXISTS (SELECT 1 FROM jsonb_array_elements_text(node->'value') v WHERE upper(btrim(v)) = 'CLEAR')
           AND NOT (node->'value') ? 'SP_OVER_2_YEARS' THEN
          RETURN jsonb_set(node, '{value}', (node->'value') || '["SP_OVER_2_YEARS"]'::jsonb);
        END IF;
      ELSIF op IN ('eq', 'neq') AND upper(btrim(coalesce(node->>'value', ''))) = 'CLEAR' THEN
        vals := jsonb_build_array(node->>'value', 'SP_OVER_2_YEARS');
        RETURN jsonb_set(
          jsonb_set(node, '{operator}', to_jsonb(CASE WHEN op = 'eq' THEN 'in' ELSE 'notIn' END)),
          '{value}', vals);
      END IF;
      RETURN node;
    END IF;

    result := '{}'::jsonb;
    FOR k IN SELECT jsonb_object_keys(node) LOOP
      result := result || jsonb_build_object(k, discipline_levels_0101(node -> k));
    END LOOP;
    RETURN result;
  END IF;

  IF jsonb_typeof(node) = 'array' THEN
    result := '[]'::jsonb;
    FOR item IN SELECT * FROM jsonb_array_elements(node) LOOP
      result := result || jsonb_build_array(discipline_levels_0101(item));
    END LOOP;
    RETURN result;
  END IF;

  RETURN node;
END;
$$;
--> statement-breakpoint
UPDATE program_templates
   SET filter_rules = discipline_levels_0101(filter_rules)
 WHERE filter_rules::text LIKE '%disciplineStatus%'
   AND filter_rules IS DISTINCT FROM discipline_levels_0101(filter_rules);
--> statement-breakpoint
DROP FUNCTION IF EXISTS discipline_levels_0101(jsonb);
--> statement-breakpoint
UPDATE candidates
   SET discipline_status = upper(btrim(discipline_status))
 WHERE discipline_status IS DISTINCT FROM upper(btrim(discipline_status));
--> statement-breakpoint
ALTER TABLE candidates ALTER COLUMN discipline_status SET DEFAULT 'CLEAR';
