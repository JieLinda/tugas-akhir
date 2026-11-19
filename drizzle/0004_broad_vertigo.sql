CREATE TABLE "sync_company_tenant_map" (
	"id" serial PRIMARY KEY NOT NULL,
	"company_id" varchar(20) NOT NULL,
	"tenant_id" uuid NOT NULL,
	"label" varchar(100),
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sync_departments" (
	"id" serial PRIMARY KEY NOT NULL,
	"iddepartment" varchar(20) NOT NULL,
	"department_name" varchar(200) NOT NULL,
	"iddivision" varchar(20),
	"company_id" varchar(10),
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sync_disciplinary" (
	"id" serial PRIMARY KEY NOT NULL,
	"company_id" varchar(10) NOT NULL,
	"employee_id" varchar(20) NOT NULL,
	"display_name" varchar(200),
	"disciplinary_no" integer NOT NULL,
	"incident_date" timestamp with time zone,
	"violation" text,
	"violation_degree" integer,
	"violation_type" integer,
	"warning_level" integer,
	"effect_violation" text,
	"advice_given" varchar(200),
	"sanction_given" varchar(200),
	"letter_no" varchar(200),
	"date_issue" timestamp with time zone,
	"expiry_date" timestamp with time zone,
	"disciplinary_note" text,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sync_divisions" (
	"id" serial PRIMARY KEY NOT NULL,
	"iddivision" varchar(20) NOT NULL,
	"division_name" varchar(200) NOT NULL,
	"company_id" varchar(10),
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sync_education" (
	"id" serial PRIMARY KEY NOT NULL,
	"company_id" varchar(10) NOT NULL,
	"employee_id" varchar(20) NOT NULL,
	"display_name" varchar(200),
	"education_level" varchar(50),
	"education_level_rank" integer,
	"education_field" varchar(100),
	"institution_name" varchar(300),
	"institution_location" varchar(100),
	"start_year" integer,
	"end_year" integer,
	"gpa" numeric(4, 2),
	"achievement" text,
	"education_note" text,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sync_employee_positions" (
	"id" serial PRIMARY KEY NOT NULL,
	"company_id" varchar(10) NOT NULL,
	"employee_id" varchar(20) NOT NULL,
	"position_id" varchar(40) NOT NULL,
	"primary_position" boolean DEFAULT false NOT NULL,
	"valid_from" timestamp with time zone,
	"valid_to" timestamp with time zone,
	"create_by" varchar(100),
	"create_date" timestamp with time zone,
	"modi_by" varchar(100),
	"modi_date" timestamp with time zone,
	"source_key" varchar(220) NOT NULL,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sync_employees" (
	"id" serial PRIMARY KEY NOT NULL,
	"company_id" varchar(10),
	"employee_id" varchar(20) NOT NULL,
	"display_name" varchar(200),
	"grade_id" varchar(20),
	"internal_title" varchar(200),
	"company_office" varchar(100),
	"iddivision" varchar(20),
	"division" varchar(200),
	"iddepartment" varchar(20),
	"department" varchar(200),
	"is_branch_head" boolean DEFAULT false,
	"is_afc" boolean DEFAULT false,
	"is_homso" boolean DEFAULT false,
	"entry_date" date,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sync_job_profiles" (
	"id" serial PRIMARY KEY NOT NULL,
	"file_name" varchar(500) NOT NULL,
	"file_path" varchar(1000) NOT NULL,
	"source_folder" varchar(200),
	"file_hash" varchar(64),
	"job_profile_number" varchar(50),
	"position_name" varchar(300),
	"division_department" varchar(300),
	"supervisor" varchar(300),
	"job_purpose" text,
	"extracted_data" jsonb,
	"raw_text" text,
	"status" varchar(20) DEFAULT 'pending' NOT NULL,
	"error_message" text,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "sync_performance_appraisals" (
	"id" serial PRIMARY KEY NOT NULL,
	"company_id" varchar(10) NOT NULL,
	"employee_id" varchar(20) NOT NULL,
	"company_office" varchar(100),
	"cost_center" varchar(20),
	"org_id" varchar(20),
	"position_id" varchar(20),
	"grade_id" varchar(10),
	"seq" integer,
	"tahun" integer,
	"s1" varchar(10),
	"s2" varchar(10),
	"promosi" varchar(50),
	"is_print_report" boolean,
	"create_by" varchar(50),
	"create_date" timestamp with time zone,
	"modi_by" varchar(50),
	"modi_date" timestamp with time zone,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sync_position_hierarchy" (
	"id" serial PRIMARY KEY NOT NULL,
	"company_id" varchar(10) NOT NULL,
	"position_id" varchar(40) NOT NULL,
	"parent_position_id" varchar(40),
	"valid_from" timestamp with time zone,
	"valid_to" timestamp with time zone,
	"create_by" varchar(100),
	"create_date" timestamp with time zone,
	"modi_by" varchar(100),
	"modi_date" timestamp with time zone,
	"source_key" varchar(200) NOT NULL,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sync_positions" (
	"id" serial PRIMARY KEY NOT NULL,
	"company_id" varchar(10) NOT NULL,
	"position_id" varchar(40) NOT NULL,
	"internal_title" varchar(300),
	"external_title" varchar(300),
	"summary" text,
	"grade_id" varchar(20),
	"pos_level_no" integer,
	"valid_from" timestamp with time zone,
	"valid_to" timestamp with time zone,
	"create_by" varchar(100),
	"create_date" timestamp with time zone,
	"modi_by" varchar(100),
	"modi_date" timestamp with time zone,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sync_technical_competencies" (
	"id" serial PRIMARY KEY NOT NULL,
	"company_id" varchar(10) NOT NULL,
	"employee_id" varchar(20) NOT NULL,
	"company_office" varchar(100),
	"cost_center" varchar(20),
	"org_id" varchar(20),
	"position_id" varchar(40),
	"grade_id" varchar(20),
	"technical_id" varchar(40) NOT NULL,
	"technical_name" varchar(300),
	"proficiency_id" varchar(40),
	"proficiency_name" varchar(120),
	"score" integer,
	"current_proficiency_id" varchar(40),
	"current_proficiency_name" varchar(120),
	"current_score" integer,
	"gap" integer,
	"is_active" boolean DEFAULT true NOT NULL,
	"create_by" varchar(100),
	"create_date" timestamp with time zone,
	"modi_by" varchar(100),
	"modi_date" timestamp with time zone,
	"source_key" varchar(220) NOT NULL,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "sync_company_tenant_map" ADD CONSTRAINT "sync_company_tenant_map_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_sync_company_tenant_map_company_id" ON "sync_company_tenant_map" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "idx_sync_company_tenant_map_tenant_id" ON "sync_company_tenant_map" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "idx_sync_company_tenant_map_is_active" ON "sync_company_tenant_map" USING btree ("is_active");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_sync_departments_iddepartment" ON "sync_departments" USING btree ("iddepartment");--> statement-breakpoint
CREATE INDEX "idx_sync_departments_iddivision" ON "sync_departments" USING btree ("iddivision");--> statement-breakpoint
CREATE INDEX "idx_sync_departments_company_id" ON "sync_departments" USING btree ("company_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_disciplinary" ON "sync_disciplinary" USING btree ("company_id","employee_id","disciplinary_no");--> statement-breakpoint
CREATE INDEX "idx_sync_disciplinary_employee_id" ON "sync_disciplinary" USING btree ("employee_id");--> statement-breakpoint
CREATE INDEX "idx_sync_disciplinary_company_id" ON "sync_disciplinary" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "idx_sync_disciplinary_warning_level" ON "sync_disciplinary" USING btree ("warning_level");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_sync_divisions_iddivision" ON "sync_divisions" USING btree ("iddivision");--> statement-breakpoint
CREATE INDEX "idx_sync_divisions_company_id" ON "sync_divisions" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "idx_sync_education_employee_id" ON "sync_education" USING btree ("employee_id");--> statement-breakpoint
CREATE INDEX "idx_sync_education_company_id" ON "sync_education" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "idx_sync_education_level_rank" ON "sync_education" USING btree ("education_level_rank");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_sync_employee_positions_source_key" ON "sync_employee_positions" USING btree ("source_key");--> statement-breakpoint
CREATE INDEX "idx_sync_employee_positions_company_employee" ON "sync_employee_positions" USING btree ("company_id","employee_id");--> statement-breakpoint
CREATE INDEX "idx_sync_employee_positions_company_position" ON "sync_employee_positions" USING btree ("company_id","position_id");--> statement-breakpoint
CREATE INDEX "idx_sync_employee_positions_valid_to" ON "sync_employee_positions" USING btree ("valid_to");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_sync_employees_employee_id" ON "sync_employees" USING btree ("employee_id");--> statement-breakpoint
CREATE INDEX "idx_sync_employees_company_id" ON "sync_employees" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "idx_sync_employees_synced_at" ON "sync_employees" USING btree ("synced_at");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_sync_job_profiles_file_path" ON "sync_job_profiles" USING btree ("file_path");--> statement-breakpoint
CREATE INDEX "idx_sync_job_profiles_source_folder" ON "sync_job_profiles" USING btree ("source_folder");--> statement-breakpoint
CREATE INDEX "idx_sync_job_profiles_status" ON "sync_job_profiles" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_sync_job_profiles_position" ON "sync_job_profiles" USING btree ("position_name");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_perf_appraisal" ON "sync_performance_appraisals" USING btree ("company_id","employee_id","tahun","seq");--> statement-breakpoint
CREATE INDEX "idx_sync_performance_employee_id" ON "sync_performance_appraisals" USING btree ("employee_id");--> statement-breakpoint
CREATE INDEX "idx_sync_performance_company_id" ON "sync_performance_appraisals" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "idx_sync_performance_tahun" ON "sync_performance_appraisals" USING btree ("tahun");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_sync_position_hierarchy_source_key" ON "sync_position_hierarchy" USING btree ("source_key");--> statement-breakpoint
CREATE INDEX "idx_sync_position_hierarchy_company_position" ON "sync_position_hierarchy" USING btree ("company_id","position_id");--> statement-breakpoint
CREATE INDEX "idx_sync_position_hierarchy_parent" ON "sync_position_hierarchy" USING btree ("parent_position_id");--> statement-breakpoint
CREATE INDEX "idx_sync_position_hierarchy_valid_to" ON "sync_position_hierarchy" USING btree ("valid_to");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_sync_positions_company_position_valid_from" ON "sync_positions" USING btree ("company_id","position_id","valid_from");--> statement-breakpoint
CREATE INDEX "idx_sync_positions_company_position" ON "sync_positions" USING btree ("company_id","position_id");--> statement-breakpoint
CREATE INDEX "idx_sync_positions_valid_to" ON "sync_positions" USING btree ("valid_to");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_sync_technical_competencies_source_key" ON "sync_technical_competencies" USING btree ("source_key");--> statement-breakpoint
CREATE INDEX "idx_sync_technical_competencies_company_employee" ON "sync_technical_competencies" USING btree ("company_id","employee_id");--> statement-breakpoint
CREATE INDEX "idx_sync_technical_competencies_position" ON "sync_technical_competencies" USING btree ("position_id");--> statement-breakpoint
CREATE INDEX "idx_sync_technical_competencies_active" ON "sync_technical_competencies" USING btree ("is_active");