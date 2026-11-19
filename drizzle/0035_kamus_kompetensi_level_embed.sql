-- Job Family: per-LEVEL cumulative embeddings of the competency dictionary.
-- The existing kamus_kompetensi_embed holds ONE vector per competency (the full
-- 4-level document). The AHP technical-competency matcher needs the embedding of
-- "levels 1..L concatenated" — e.g. a candidate at level 3 (Advance) is
-- represented by the Basic+Intermediate+Advance descriptors embedded together.
-- One row per (code, level) with level ∈ 1..4; `document` is the cumulative text
-- of levels 1..level and `embedding` its 768-dim vector (same job-family model
-- as kamus_kompetensi_embed). Requires the pgvector extension.
CREATE EXTENSION IF NOT EXISTS vector;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "kamus_kompetensi_level_embed" (
	"id" serial PRIMARY KEY NOT NULL,
	"code" varchar(20) NOT NULL,
	"name" varchar(300),
	"level" integer NOT NULL,
	"document" text NOT NULL,
	"embedding" vector(768),
	"embedding_model" varchar(120),
	"content_hash" varchar(64),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uq_kamus_kompetensi_level_embed_code_level" ON "kamus_kompetensi_level_embed" USING btree ("code","level");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_kamus_kompetensi_level_embed_code" ON "kamus_kompetensi_level_embed" USING btree ("code");
