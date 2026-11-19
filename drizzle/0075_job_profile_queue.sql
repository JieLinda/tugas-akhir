-- Job profile ingestion: make the QUEUE visible.
--
-- The "Dalam Proses" card on the Job Profiles page could only ever show 1.
-- `processOneFile` marks exactly one row `status = 'processing'` and flips it to
-- `completed` before touching the next file, and a file that has not been
-- reached yet has no row at all (first ingest) or still carries its previous
-- `completed` row (re-ingest). So the backlog was never represented anywhere:
-- the count cycled 1 → 1 → 1 for an hour with no way to tell how much was left.
--
-- Why a separate column instead of just marking the batch `status = 'pending'`:
-- nine call sites select job profiles with `status = 'completed'` (job-family
-- matching, `resolveJobProfileIdentifier`, the scoring engine's career/technical
-- corpus, `getJobProfileByPosition`). Flipping a 280-file batch to `pending` up
-- front would empty the job-profile corpus for the entire duration of the run —
-- silently, since every one of those readers would simply find nothing and fall
-- back. `status` therefore keeps meaning "state of the extracted CONTENT" (the
-- previous extraction stays valid and readable until it is replaced), and
-- `queued_at` means "this file is waiting for (re)extraction".
--
-- Cleared when a file reaches a terminal state, and cleared wholesale at the
-- start of every run, so a crashed run cannot leave a phantom backlog behind.

ALTER TABLE sync_job_profiles
  ADD COLUMN IF NOT EXISTS queued_at timestamptz;
--> statement-breakpoint

-- Partial: the queue is empty almost all the time, and every reader of this
-- column asks the same question ("what is still waiting").
CREATE INDEX IF NOT EXISTS idx_sync_job_profiles_queued
  ON sync_job_profiles (queued_at)
  WHERE queued_at IS NOT NULL;
