-- Normalize legacy descriptive HAV quadrant values to their canonical number.
-- Some rows were stored as "Kuadran #6" / "Kuadran #15" (before the sync
-- normalized them and while candidate-populate copied the value verbatim). The
-- filter engine compares HAV with strict equality, so mixed forms never matched
-- and the governance value picker showed duplicates. Extract the first digit run
-- so every value becomes "1".."16". Idempotent: already-numeric rows are skipped.

UPDATE "sync_hav"
   SET "quadrant" = substring("quadrant" FROM '[0-9]+')
 WHERE "quadrant" IS NOT NULL
   AND "quadrant" !~ '^[0-9]+$'
   AND substring("quadrant" FROM '[0-9]+') IS NOT NULL;

UPDATE "candidates"
   SET "hav_quadrant" = substring("hav_quadrant" FROM '[0-9]+')
 WHERE "hav_quadrant" IS NOT NULL
   AND "hav_quadrant" !~ '^[0-9]+$'
   AND substring("hav_quadrant" FROM '[0-9]+') IS NOT NULL;
