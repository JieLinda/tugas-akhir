-- Job Family: per-document "reason" enrichment on topic assignments.
-- The topic-service now computes, per job-profile document, WHY it landed in its
-- family (hybrid explanation): the family c-TF-IDF keywords that occur in the
-- document, its cosine closeness to the family centroid, and the nearest
-- ALTERNATIVE family (by centroid cosine). These power the Family Tree dropdown.
-- Idempotent (ADD COLUMN IF NOT EXISTS) — safe to re-run; older run rows keep
-- NULL/[] and the UI degrades gracefully.
ALTER TABLE "job_family_topic_assignments" ADD COLUMN IF NOT EXISTS "matched_keywords" jsonb;--> statement-breakpoint
ALTER TABLE "job_family_topic_assignments" ADD COLUMN IF NOT EXISTS "centroid_similarity" real;--> statement-breakpoint
ALTER TABLE "job_family_topic_assignments" ADD COLUMN IF NOT EXISTS "alt_topic_id" integer;--> statement-breakpoint
ALTER TABLE "job_family_topic_assignments" ADD COLUMN IF NOT EXISTS "alt_similarity" real;
