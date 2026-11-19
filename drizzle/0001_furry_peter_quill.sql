CREATE TABLE "scoring_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"position_id" uuid NOT NULL,
	"tenant_id" uuid NOT NULL,
	"method" varchar(50) NOT NULL,
	"label" varchar(255),
	"candidate_count" integer NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "analysis_results" ADD COLUMN "run_id" uuid;--> statement-breakpoint
ALTER TABLE "scoring_runs" ADD CONSTRAINT "scoring_runs_position_id_positions_id_fk" FOREIGN KEY ("position_id") REFERENCES "public"."positions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scoring_runs" ADD CONSTRAINT "scoring_runs_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scoring_runs" ADD CONSTRAINT "scoring_runs_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_scoring_runs_position" ON "scoring_runs" USING btree ("position_id");--> statement-breakpoint
CREATE INDEX "idx_scoring_runs_tenant" ON "scoring_runs" USING btree ("tenant_id");--> statement-breakpoint
ALTER TABLE "analysis_results" ADD CONSTRAINT "analysis_results_run_id_scoring_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."scoring_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_analysis_run" ON "analysis_results" USING btree ("run_id");