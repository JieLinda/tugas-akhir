-- Collapse per-position duplicate technical competencies.
-- sync_technical_competencies stores one row per (employee, position, competency),
-- so a skill required by several of an employee's positions was inserted multiple
-- times into candidate_technical_competencies (the source_key embeds the position),
-- surfacing as duplicate skills in the UI and double-counting in scoring.
-- Keep exactly one synced row per (candidate_id, technical_id): the strongest by
-- current_score, then target score, then id. Manual rows (is_manual = true) are
-- left untouched.

DELETE FROM "candidate_technical_competencies" a
      USING "candidate_technical_competencies" b
 WHERE a."candidate_id" = b."candidate_id"
   AND a."technical_id"  = b."technical_id"
   AND a."id" <> b."id"
   AND a."is_manual" = false
   AND b."is_manual" = false
   AND (
        COALESCE(b."current_score", -1) > COALESCE(a."current_score", -1)
     OR (COALESCE(b."current_score", -1) = COALESCE(a."current_score", -1)
         AND COALESCE(b."score", -1) > COALESCE(a."score", -1))
     OR (COALESCE(b."current_score", -1) = COALESCE(a."current_score", -1)
         AND COALESCE(b."score", -1) = COALESCE(a."score", -1)
         AND b."id" > a."id")
   );
