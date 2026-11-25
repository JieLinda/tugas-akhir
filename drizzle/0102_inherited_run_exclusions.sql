-- Exclusion marks ("Ditandai dikecualikan") are INHERITED by a
-- "Tambah Kandidat Pembanding" child.
--
-- A mark is a forum decision about a person ("resigned", "conflict of
-- interest"), recorded per run in scoring_run_exclusions. A child carries its
-- parent's whole pool, so the person reappeared there unmarked: counted as
-- ready, pickable without the extra confirmation, and with nothing saying the
-- forum had already set them aside. The web app now copies the parent's marks
-- into the child in the same transaction that creates the child run
-- (startRerunAction), keeping the original actor, time, reason and note, and
-- naming the run where the mark was ORIGINALLY made here — the origin, not the
-- immediate parent, so a grandchild still names it.
--
-- Nothing else changes: a mark still never touches a number, and it can be
-- undone on the child alone (audited) without touching the parent's.
-- Existing children are NOT backfilled: their marks were never decided for
-- them, and inventing them now would rewrite what the forum saw.
--
-- Apply BEFORE deploying the web app: the Drizzle schema selects the column.

ALTER TABLE scoring_run_exclusions
  ADD COLUMN IF NOT EXISTS inherited_from_run_id uuid
    REFERENCES scoring_runs(id) ON DELETE SET NULL;
