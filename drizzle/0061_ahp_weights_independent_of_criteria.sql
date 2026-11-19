-- AHP + TOPSIS no longer derives its weights from a program's "Kriteria & Bobot"
-- list. Every run now uses the program's own pairwise matrix, or the system
-- defaults (behavior 35, technical 25, HAV 20, PA 10, career 5, education 5)
-- when no matrix is set — see resolveAhpWeights in
-- scoring-service/src/ahp-topsis-engine.ts. That is a CODE change; nothing in the
-- database has to move for it to take effect.
--
-- This file only undoes an earlier, superseded version of migration 0061, which
-- edited default_criteria so the (now removed) criteria-derived tier would land
-- on those same numbers. If you never applied it, both statements are no-ops.
--
-- The marker is the 'Career Relevance' row: that name was only ever written by
-- the superseded migration, so its presence identifies exactly the rows it
-- touched. It is checked BEFORE being deleted — order matters here.

-- 1. Restore Behavior to the shipped AI Tournament weight of 40. Only where the
--    superseded migration set it to 35, so a program somebody deliberately tuned
--    to 35 by hand (no Career row) is left alone.
UPDATE program_templates t
   SET default_criteria = sub.next,
       updated_at = NOW()
  FROM (
        SELECT p.id,
               (
                 SELECT jsonb_agg(
                          CASE
                            WHEN elem->>'name' = 'Behavior Competency Assessment'
                              THEN jsonb_set(elem, '{weight}', '40'::jsonb)
                            ELSE elem
                          END
                          ORDER BY ord
                        )
                   FROM jsonb_array_elements(p.default_criteria) WITH ORDINALITY AS e(elem, ord)
               ) AS next
          FROM program_templates p
         WHERE p.is_system
           AND jsonb_typeof(p.default_criteria) = 'array'
           AND EXISTS (
                 SELECT 1 FROM jsonb_array_elements(p.default_criteria) x
                  WHERE x->>'name' = 'Career Relevance'
               )
           AND EXISTS (
                 SELECT 1 FROM jsonb_array_elements(p.default_criteria) x
                  WHERE x->>'name' = 'Behavior Competency Assessment'
                    AND (x->>'weight') ~ '^[0-9.]+$'
                    AND (x->>'weight')::numeric = 35
               )
       ) sub
 WHERE t.id = sub.id;
--> statement-breakpoint

-- 2. Drop the 'Career Relevance' row. Neither engine reads a weight under that
--    name any more: the LLM engine scores no career aspect and skips it, and AHP
--    stopped reading this list at all — so leaving it would show HR a weight that
--    reaches nothing, which is what the canonical-name picker exists to prevent.
--    Career's share is set in the AHP pairwise matrix (or left at its default).
UPDATE program_templates t
   SET default_criteria = COALESCE(sub.next, '[]'::jsonb),
       updated_at = NOW()
  FROM (
        SELECT p.id,
               (
                 SELECT jsonb_agg(elem ORDER BY ord)
                   FROM jsonb_array_elements(p.default_criteria) WITH ORDINALITY AS e(elem, ord)
                  WHERE elem->>'name' <> 'Career Relevance'
               ) AS next
          FROM program_templates p
         WHERE jsonb_typeof(p.default_criteria) = 'array'
           AND EXISTS (
                 SELECT 1 FROM jsonb_array_elements(p.default_criteria) x
                  WHERE x->>'name' = 'Career Relevance'
               )
       ) sub
 WHERE t.id = sub.id;
