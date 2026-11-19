-- Remove "Simulasi penempatan" (role-fit simulation) together with the table
-- only it used.
--
-- candidate_simulations (drizzle/0061): one sealed LLM note per (run,
-- candidate) projecting how that person would perform in the seat. Written
-- only by a click on a ranked row and the "Simulasikan semua" / "Simulasikan
-- ulang" buttons on the scoring results list, and read only by the note card
-- beside the ranking — all of which are deleted from the web app in the same
-- change. The note never fed a score, a weight or a rank, so no finished
-- ranking changes.
--
-- Data in this table is discarded.
--
-- Apply AFTER the new web app is running: the previous build still reads and
-- writes this table.
--
-- Idempotent.
--   tsx scripts/apply-sql.ts drizzle/0096_drop_candidate_simulations.sql

DROP TABLE IF EXISTS candidate_simulations;
