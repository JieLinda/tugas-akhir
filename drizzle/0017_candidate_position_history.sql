CREATE TABLE "candidate_position_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"candidate_id" uuid NOT NULL,
	"sync_employee_position_id" integer,
	"company_id" varchar(10) NOT NULL,
	"position_id" varchar(40) NOT NULL,
	"internal_title" varchar(300),
	"external_title" varchar(300),
	"summary" text,
	"grade_id" varchar(20),
	"primary_position" boolean DEFAULT false NOT NULL,
	"valid_from" timestamp with time zone,
	"valid_to" timestamp with time zone,
	"source_key" varchar(220) NOT NULL,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "candidate_position_history" ADD CONSTRAINT "candidate_position_history_candidate_id_candidates_id_fk" FOREIGN KEY ("candidate_id") REFERENCES "public"."candidates"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "candidate_position_history" ADD CONSTRAINT "candidate_position_history_sync_employee_position_id_sync_employee_positions_id_fk" FOREIGN KEY ("sync_employee_position_id") REFERENCES "public"."sync_employee_positions"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "idx_candidate_position_history_candidate" ON "candidate_position_history" USING btree ("candidate_id");
--> statement-breakpoint
CREATE INDEX "idx_candidate_position_history_position_id" ON "candidate_position_history" USING btree ("position_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "uq_candidate_position_history_source" ON "candidate_position_history" USING btree ("candidate_id","source_key");
