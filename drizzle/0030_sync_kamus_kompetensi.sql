-- Kamus Kompetensi Teknis: competency dictionary parsed from the
-- "Dictionary Technical Competency for MPM" PDF (kamus-kompetensi folder).
CREATE TABLE IF NOT EXISTS "sync_kamus_kompetensi" (
	"id" serial PRIMARY KEY NOT NULL,
	"code" varchar(20) NOT NULL,
	"name" varchar(300) NOT NULL,
	"description" text,
	"level_basic" text,
	"level_intermediate" text,
	"level_advance" text,
	"level_mastery" text,
	"source_file" varchar(500),
	"file_hash" varchar(64),
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uq_sync_kamus_kompetensi_code" ON "sync_kamus_kompetensi" USING btree ("code");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_sync_kamus_kompetensi_name" ON "sync_kamus_kompetensi" USING btree ("name");
