-- AHP becomes the ONLY place a scoring weight is configured.
--
-- The AI Tournament (LLM) engine used to weight its five aspects from the
-- program's own "Kriteria & Bobot" numbers, while AHP + TOPSIS weighted the same
-- six from the pairwise matrix. One program, two weighting surfaces, nothing
-- forcing them to agree — and in this database they did not: Mulia's Emergency
-- carried PA 10 / education 5 in that list while ERRO's and MSO's carried
-- PA 20 / education 0, for what is nominally the same system program.
--
-- The editor is gone and `loadProgramCriteria` (scoring-service) now reads the
-- weights from `resolveAhpWeights` for BOTH engines. What that list still
-- decides is WHICH aspects a program assesses; `career` is never in it, so its
-- AHP share is redistributed over the five scored aspects on an LLM run — the
-- same rule the AHP engine already applies to a criterion nobody could be
-- scored on.
--
-- Two statements, and the ORDER matters: the weight-0 rows must be deleted
-- BEFORE the weights are stripped, or the evidence of which rows they were is
-- gone.
--
-- `scoring_runs.config_snapshot` is deliberately NOT touched. Those runs really
-- were weighted by those numbers, and a frozen copy that no longer says so would
-- make a finished ranking unexplainable — the same reason drizzle/0071 left
-- snapshots alone when MCU stopped being a knockout.

-- 1. A criterion used to be excluded by setting its weight to 0 — that is how
--    Emergency dropped education in two tenants (`loadProgramCriteria` filtered
--    on `weight > 0`). With weights gone, a listed criterion always carries its
--    AHP share, so a weight-0 row left in place would silently START counting.
--    Deleting it preserves exactly what whoever zeroed it asked for.
UPDATE program_templates t
   SET default_criteria = COALESCE(sub.next, '[]'::jsonb),
       updated_at = NOW()
  FROM (
        SELECT p.id,
               (
                 SELECT jsonb_agg(elem ORDER BY ord)
                   FROM jsonb_array_elements(p.default_criteria) WITH ORDINALITY AS e(elem, ord)
                  WHERE NOT (
                          elem ? 'weight'
                      AND (elem->>'weight') ~ '^[0-9]+(\.[0-9]+)?$'
                      AND (elem->>'weight')::numeric = 0
                        )
               ) AS next
          FROM program_templates p
         WHERE jsonb_typeof(p.default_criteria) = 'array'
           AND EXISTS (
                 SELECT 1 FROM jsonb_array_elements(p.default_criteria) x
                  WHERE x ? 'weight'
                    AND (x->>'weight') ~ '^[0-9]+(\.[0-9]+)?$'
                    AND (x->>'weight')::numeric = 0
               )
       ) sub
 WHERE t.id = sub.id;
--> statement-breakpoint

-- 2. Strip the `weight` key from every remaining row. Nothing reads it any more,
--    and a number sitting in live configuration that reaches no engine is the
--    "looks configured, does nothing" trap the canonical-name picker exists to
--    prevent — here it would be worse, because the number is plausible and used
--    to be true.
UPDATE program_templates t
   SET default_criteria = COALESCE(sub.next, '[]'::jsonb),
       updated_at = NOW()
  FROM (
        SELECT p.id,
               (
                 SELECT jsonb_agg((elem - 'weight') ORDER BY ord)
                   FROM jsonb_array_elements(p.default_criteria) WITH ORDINALITY AS e(elem, ord)
               ) AS next
          FROM program_templates p
         WHERE jsonb_typeof(p.default_criteria) = 'array'
           AND EXISTS (
                 SELECT 1 FROM jsonb_array_elements(p.default_criteria) x
                  WHERE x ? 'weight'
               )
       ) sub
 WHERE t.id = sub.id;
