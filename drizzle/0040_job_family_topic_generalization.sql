-- Job Family: per-cluster "general topic recognition".
-- The topic-service now generalizes every leaf cluster (and every internal
-- sub-family level) into a readable title + description — hybrid of aggregated
-- c-TF-IDF keywords + centroid representatives + an optional Gemini summary.
-- Leaf clusters store their generalization here; internal (sub-family) nodes
-- store theirs inside job_family_topic_runs.hierarchy (parentTitle/…) — no new
-- column needed for those. Idempotent; older runs keep NULL and degrade to the
-- keyword label in the UI.
ALTER TABLE "job_family_topics" ADD COLUMN IF NOT EXISTS "general_title" varchar(300);--> statement-breakpoint
ALTER TABLE "job_family_topics" ADD COLUMN IF NOT EXISTS "general_description" text;
