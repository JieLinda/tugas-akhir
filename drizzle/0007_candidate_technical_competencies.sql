CREATE TABLE "candidate_technical_competencies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"candidate_id" uuid NOT NULL,
	"sync_technical_competency_id" integer,
	"technical_id" varchar(40) NOT NULL,
	"technical_name" varchar(300),
	"proficiency_id" varchar(40),
	"proficiency_name" varchar(120),
	"score" integer,
	"current_proficiency_id" varchar(40),
	"current_proficiency_name" varchar(120),
	"current_score" integer,
	"gap" integer,
	"source_key" varchar(220) NOT NULL,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "candidate_technical_competencies" ADD CONSTRAINT "candidate_technical_competencies_candidate_id_candidates_id_fk" FOREIGN KEY ("candidate_id") REFERENCES "public"."candidates"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "candidate_technical_competencies" ADD CONSTRAINT "candidate_technical_competencies_sync_technical_competency_id_sync_technical_competencies_id_fk" FOREIGN KEY ("sync_technical_competency_id") REFERENCES "public"."sync_technical_competencies"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "idx_candidate_technical_candidate" ON "candidate_technical_competencies" USING btree ("candidate_id");
--> statement-breakpoint
CREATE INDEX "idx_candidate_technical_technical_id" ON "candidate_technical_competencies" USING btree ("technical_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "uq_candidate_technical_source" ON "candidate_technical_competencies" USING btree ("candidate_id","source_key");