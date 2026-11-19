-- Job Family: pgvector store for kamus-kompetensi (competency dictionary)
-- documents — the pgvector counterpart to the ChromaDB `kamus_kompetensi`
-- collection, so embeddings can be persisted to Postgres when ChromaDB/Ollama
-- isn't available. Keyed by competency `code`; 768-dim to match the job-family
-- embedding model. Requires the pgvector extension.
CREATE EXTENSION IF NOT EXISTS vector;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "kamus_kompetensi_embed" (
	"id" serial PRIMARY KEY NOT NULL,
	"code" varchar(20) NOT NULL,
	"name" varchar(300),
	"document" text NOT NULL,
	"embedding" vector(768),
	"embedding_model" varchar(120),
	"content_hash" varchar(64),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uq_kamus_kompetensi_embed_code" ON "kamus_kompetensi_embed" USING btree ("code");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_kamus_kompetensi_embed_name" ON "kamus_kompetensi_embed" USING btree ("name");
