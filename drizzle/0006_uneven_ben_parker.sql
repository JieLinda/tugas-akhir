CREATE TABLE "agent_memories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"content" varchar(500) NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_recipes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"created_by" uuid NOT NULL,
	"name" varchar(120) NOT NULL,
	"description" varchar(500),
	"plan" jsonb NOT NULL,
	"source_run_id" uuid,
	"use_count" integer DEFAULT 0 NOT NULL,
	"last_used_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_run_steps" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"step_id" varchar(40) NOT NULL,
	"seq" integer NOT NULL,
	"tool_id" varchar(80) NOT NULL,
	"params" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"resolved_params" jsonb,
	"status" varchar(20) DEFAULT 'pending' NOT NULL,
	"gate" varchar(10) DEFAULT 'auto' NOT NULL,
	"external_ref" jsonb,
	"progress" text,
	"output" jsonb,
	"error" text,
	"attempt" integer DEFAULT 0 NOT NULL,
	"approved_at" timestamp,
	"started_at" timestamp,
	"finished_at" timestamp,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "agent_run_steps_status_check" CHECK (status IN ('pending', 'running', 'polling', 'done', 'failed', 'skipped'))
);
--> statement-breakpoint
CREATE TABLE "agent_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"tenant_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"query" text NOT NULL,
	"plan" jsonb,
	"planner_model" varchar(120),
	"status" varchar(30) DEFAULT 'awaiting_approval' NOT NULL,
	"answer" jsonb,
	"error" text,
	"budget" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"finished_at" timestamp,
	CONSTRAINT "agent_runs_status_check" CHECK (status IN ('awaiting_approval', 'running', 'completed', 'failed', 'cancelled', 'needs_clarification'))
);
--> statement-breakpoint
CREATE TABLE "agent_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"title" varchar(255),
	"scope" varchar(40),
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app_encryption_keys" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"label" varchar(80) DEFAULT 'default' NOT NULL,
	"wrapped_dek" text NOT NULL,
	"verifier" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app_role_permissions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"role_id" uuid NOT NULL,
	"permission" varchar(40) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app_roles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" varchar(50) NOT NULL,
	"name" varchar(100) NOT NULL,
	"description" text,
	"is_system" boolean DEFAULT false NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"sort_order" integer DEFAULT 100 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "candidate_aspect_scores" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"candidate_id" uuid NOT NULL,
	"position_id" uuid NOT NULL,
	"aspect" varchar(20) NOT NULL,
	"score" integer NOT NULL,
	"input_hash" varchar(64) NOT NULL,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
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
CREATE TABLE "candidate_simulations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"candidate_id" uuid NOT NULL,
	"position_id" uuid NOT NULL,
	"tenant_id" uuid NOT NULL,
	"rank_at_simulation" integer,
	"payload" text NOT NULL,
	"model" varchar(120),
	"without_job_profile" boolean DEFAULT false NOT NULL,
	"created_by" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
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
	"is_manual" boolean DEFAULT false NOT NULL,
	"source_key" varchar(220) NOT NULL,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "chat_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"run_id" uuid NOT NULL,
	"role" varchar(20) NOT NULL,
	"content" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "critical_position_holders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"position_id" uuid NOT NULL,
	"employee_id" varchar(100) NOT NULL,
	"name" varchar(255),
	"is_primary" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "critical_positions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"position_id" uuid,
	"title" varchar(255) NOT NULL,
	"department" varchar(255),
	"division" varchar(255),
	"status" varchar(50) DEFAULT 'active' NOT NULL,
	"program_template_id" uuid,
	"program_code" varchar(50) NOT NULL,
	"holder_name" varchar(255),
	"holder_employee_id" varchar(100),
	"education" varchar(500),
	"experience" varchar(500),
	"job_family" varchar(255),
	"min_grade_id" varchar(20),
	"max_grade_id" varchar(20),
	"required_competencies" jsonb DEFAULT '[]'::jsonb,
	"created_by" uuid NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "job_categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid,
	"topic_id" integer,
	"code" varchar(60),
	"name" varchar(300) NOT NULL,
	"description" text,
	"keywords" jsonb,
	"size" integer DEFAULT 0 NOT NULL,
	"status" varchar(20) DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "job_category_profiles" (
	"id" serial PRIMARY KEY NOT NULL,
	"category_id" uuid NOT NULL,
	"job_profile_id" integer NOT NULL,
	"position_name" varchar(300),
	"division_department" varchar(300),
	"probability" real,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "job_family_ai_match_cache" (
	"id" serial PRIMARY KEY NOT NULL,
	"title_key" varchar(400) NOT NULL,
	"title" text NOT NULL,
	"job_profile_id" integer,
	"confidence" real,
	"reason" text,
	"model" varchar(120),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "job_family_matches" (
	"id" serial PRIMARY KEY NOT NULL,
	"candidate_id" uuid NOT NULL,
	"candidate_name" varchar(255),
	"tenant_id" uuid,
	"company_id" varchar(20),
	"candidate_position" varchar(400),
	"position_id" varchar(40),
	"job_profile_id" integer NOT NULL,
	"job_profile_name" varchar(400),
	"match_type" varchar(20) NOT NULL,
	"similarity" real,
	"matched_code" varchar(60),
	"jd_number" varchar(60),
	"file_name" varchar(500),
	"matched_part" text,
	"reason" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "job_family_title_embed" (
	"id" serial PRIMARY KEY NOT NULL,
	"source" varchar(40) NOT NULL,
	"model" varchar(160) NOT NULL,
	"text_hash" varchar(32) NOT NULL,
	"text" text NOT NULL,
	"dims" integer NOT NULL,
	"embedding" "bytea" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "job_family_topic_assignments" (
	"id" serial PRIMARY KEY NOT NULL,
	"run_id" uuid NOT NULL,
	"job_profile_id" integer NOT NULL,
	"position_name" varchar(300),
	"division_department" varchar(300),
	"topic_id" integer NOT NULL,
	"probability" real,
	"x" real,
	"y" real,
	"matched_keywords" jsonb,
	"centroid_similarity" real,
	"alt_topic_id" integer,
	"alt_similarity" real,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "job_family_topic_configs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid,
	"name" varchar(120),
	"params" jsonb NOT NULL,
	"content_hash" varchar(64),
	"is_active" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "job_family_topic_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid,
	"status" varchar(20) DEFAULT 'pending' NOT NULL,
	"progress" jsonb,
	"config" jsonb,
	"hierarchy" jsonb,
	"num_documents" integer DEFAULT 0 NOT NULL,
	"num_topics" integer DEFAULT 0 NOT NULL,
	"embedding_model" varchar(120),
	"config_id" uuid,
	"diagnostics" jsonb,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "job_family_topics" (
	"id" serial PRIMARY KEY NOT NULL,
	"run_id" uuid NOT NULL,
	"topic_id" integer NOT NULL,
	"label" varchar(400),
	"keywords" jsonb,
	"size" integer DEFAULT 0 NOT NULL,
	"representative_doc_ids" jsonb,
	"x" real,
	"y" real,
	"general_title" varchar(300),
	"general_description" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "job_profile_similarity_calibration" (
	"id" serial PRIMARY KEY NOT NULL,
	"singleton" boolean DEFAULT true NOT NULL,
	"fingerprint" varchar(200) NOT NULL,
	"embedding_model" varchar(120),
	"sim_floor" real NOT NULL,
	"sim_ceil" real NOT NULL,
	"sample_count" integer NOT NULL,
	"doc_count" integer NOT NULL,
	"arbitrary_p50" real,
	"best_p50" real,
	"duplicate_pairs" integer,
	"estimators" jsonb,
	"estimator_sources" varchar(120),
	"computed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "job_profile_tenants" (
	"job_profile_id" integer NOT NULL,
	"tenant_id" uuid NOT NULL,
	"source" varchar(10) DEFAULT 'manual' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "job_profile_tenants_job_profile_id_tenant_id_pk" PRIMARY KEY("job_profile_id","tenant_id")
);
--> statement-breakpoint
CREATE TABLE "kamus_competency_match_cache" (
	"id" serial PRIMARY KEY NOT NULL,
	"name_key" varchar(400) NOT NULL,
	"name" text NOT NULL,
	"code" varchar(40),
	"tier" varchar(20) NOT NULL,
	"confidence" real,
	"reason" text,
	"model" varchar(120),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "kamus_similarity_calibration" (
	"id" serial PRIMARY KEY NOT NULL,
	"singleton" boolean DEFAULT true NOT NULL,
	"fingerprint" varchar(200) NOT NULL,
	"embedding_model" varchar(120),
	"sim_floor" real NOT NULL,
	"sim_ceil" real NOT NULL,
	"sample_count" integer NOT NULL,
	"code_count" integer NOT NULL,
	"p50" real,
	"p95" real,
	"computed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "position_picks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"position_id" uuid NOT NULL,
	"candidate_id" uuid NOT NULL,
	"program_code" varchar(50) NOT NULL,
	"notes" text,
	"score" integer,
	"readiness" varchar(20),
	"run_id" uuid,
	"rank" integer DEFAULT 0 NOT NULL,
	"created_by" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "program_contexts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"title" varchar(255) NOT NULL,
	"content" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "prompt_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"template_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"content" text NOT NULL,
	"summary" varchar(500),
	"created_by" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "qualified_employee_pool" (
	"id" serial PRIMARY KEY NOT NULL,
	"employee_id" varchar(20) NOT NULL,
	"candidate_id" uuid,
	"is_candidate" boolean DEFAULT false NOT NULL,
	"tenant_id" uuid,
	"company_id" varchar(20),
	"name" varchar(255),
	"current_position" varchar(400),
	"grade" varchar(20),
	"attributes" jsonb,
	"passed_rules" jsonb,
	"scope_tenant_ids" jsonb,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "scoring_run_exclusions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"run_id" uuid NOT NULL,
	"candidate_id" uuid NOT NULL,
	"reason" varchar(30) DEFAULT 'other' NOT NULL,
	"note" text,
	"excluded_by" uuid NOT NULL,
	"excluded_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "scoring_run_exclusions_reason_check" CHECK (reason IN ('retired', 'resigned', 'promoted', 'conflict_of_interest', 'other'))
);
--> statement-breakpoint
CREATE TABLE "scoring_run_feedback" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"run_id" uuid NOT NULL,
	"position_id" uuid NOT NULL,
	"program_template_id" uuid,
	"vote" varchar(4) NOT NULL,
	"reason" text,
	"scope" varchar(10) DEFAULT 'global' NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "scoring_run_feedback_vote_check" CHECK (vote IN ('up', 'down')),
	CONSTRAINT "scoring_run_feedback_scope_check" CHECK (scope IN ('position', 'program', 'global'))
);
--> statement-breakpoint
CREATE TABLE "scoring_run_pool_aspects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"candidate_id" uuid NOT NULL,
	"pool_rank" integer NOT NULL,
	"closeness" numeric(10, 6) NOT NULL,
	"is_finalist" boolean DEFAULT false NOT NULL,
	"aspects" jsonb NOT NULL,
	"details" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sync_assessment_center" (
	"id" serial PRIMARY KEY NOT NULL,
	"company_id" varchar(10),
	"employee_id" varchar(20) NOT NULL,
	"assessment_date" timestamp with time zone,
	"score" numeric(5, 2),
	"dimension" varchar(120),
	"rekomendasi_name" varchar(255),
	"source_table" varchar(120),
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sync_behavior_competencies" (
	"id" serial PRIMARY KEY NOT NULL,
	"company_id" varchar(10) NOT NULL,
	"employee_id" varchar(20) NOT NULL,
	"rekomendasi_name" varchar(255),
	"keterangan" text,
	"tgl_pelaksanaan" timestamp with time zone,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sync_employee_personal" (
	"id" serial PRIMARY KEY NOT NULL,
	"company_id" varchar(10) NOT NULL,
	"employee_id" varchar(20) NOT NULL,
	"display_name" varchar(200),
	"birth_date" date,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sync_grade_levels" (
	"id" serial PRIMARY KEY NOT NULL,
	"company_id" varchar(10) NOT NULL,
	"level_id" varchar(20) NOT NULL,
	"level_name" varchar(200),
	"grade_id" varchar(20) NOT NULL,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sync_kamus_kompetensi" (
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
CREATE TABLE "sync_rtc_history" (
	"id" serial PRIMARY KEY NOT NULL,
	"company_id" varchar(10),
	"employee_id" varchar(20) NOT NULL,
	"rtc_year" integer,
	"rtc_name" varchar(255),
	"rtc_status" varchar(50),
	"rtc_date" timestamp with time zone,
	"note" text,
	"source_table" varchar(120),
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sync_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"job_key" varchar(64) NOT NULL,
	"status" varchar(16) NOT NULL,
	"trigger_source" varchar(16) DEFAULT 'api' NOT NULL,
	"mode" varchar(16),
	"tenant_ids" text[],
	"company_ids" text[],
	"actor" varchar(200),
	"synced" integer,
	"total" integer,
	"message" text,
	"error" text,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"duration_ms" integer
);
--> statement-breakpoint
CREATE TABLE "sync_source_connections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_key" varchar(20) NOT NULL,
	"server" varchar(255) NOT NULL,
	"port" integer DEFAULT 1433 NOT NULL,
	"username" varchar(128) NOT NULL,
	"password_encrypted" text,
	"database_name" varchar(128) NOT NULL,
	"encrypt" boolean DEFAULT true NOT NULL,
	"trust_server_certificate" boolean DEFAULT true NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"updated_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sync_source_connections_key_check" CHECK (source_key IN ('MPMDS', 'MPMHRGA'))
);
--> statement-breakpoint
CREATE TABLE "sync_talent_mapping_history" (
	"id" serial PRIMARY KEY NOT NULL,
	"company_id" varchar(10),
	"employee_id" varchar(20) NOT NULL,
	"mapping_year" integer,
	"mapping_status" varchar(30),
	"note" text,
	"source_table" varchar(120),
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "talent_audit_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"employee_id" varchar(20) NOT NULL,
	"changed_by_user_id" uuid,
	"old_box" varchar(10),
	"new_box" varchar(10) NOT NULL,
	"justification_reason" text,
	"timestamp" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "talent_box_configs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"performance_high" numeric(5, 2) NOT NULL,
	"performance_medium" numeric(5, 2) NOT NULL,
	"potential_high" numeric(5, 2) NOT NULL,
	"potential_medium" numeric(5, 2) NOT NULL,
	"pa_weights" jsonb NOT NULL,
	"potential_weights" jsonb NOT NULL,
	"updated_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "talent_data_staging" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"employee_id" varchar(20) NOT NULL,
	"company_id" varchar(10),
	"name" varchar(200),
	"department" varchar(200),
	"division" varchar(200),
	"position_title" varchar(300),
	"grade_id" varchar(20),
	"entry_date" date,
	"pa_current_year" varchar(10),
	"pa_year1" varchar(10),
	"pa_year2" varchar(10),
	"past_talent_mapping" varchar(30),
	"past_talent_mapping_year" integer,
	"rtc_count" integer DEFAULT 0 NOT NULL,
	"rtc_history" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"assessment_center_score" numeric(5, 2),
	"assessment_center_date" timestamp with time zone,
	"competency_score" numeric(5, 2),
	"competency_count" integer DEFAULT 0 NOT NULL,
	"performance_score" numeric(5, 2),
	"potential_score" numeric(5, 2),
	"performance_level" varchar(10),
	"potential_level" varchar(10),
	"system_recommended_box" varchar(10),
	"missing_pa" boolean DEFAULT false NOT NULL,
	"missing_assessment" boolean DEFAULT false NOT NULL,
	"missing_competency" boolean DEFAULT false NOT NULL,
	"final_validated_box" varchar(10),
	"final_validated_by" uuid,
	"final_validated_at" timestamp with time zone,
	"justification_reason" text,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "talent_data_staging_box_check" CHECK (system_recommended_box IS NULL OR system_recommended_box IN ('TOP', 'STRONG', 'SOLID', 'BORDER', 'BOTTOM')),
	CONSTRAINT "talent_data_staging_validated_check" CHECK (final_validated_box IS NULL OR final_validated_box IN ('TOP', 'STRONG', 'SOLID', 'BORDER', 'BOTTOM'))
);
--> statement-breakpoint
CREATE TABLE "tournament_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"position_id" uuid NOT NULL,
	"program_template_id" uuid,
	"label" varchar(255),
	"target_finalists" integer DEFAULT 10 NOT NULL,
	"current_pool" jsonb NOT NULL,
	"pending_pool" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"scoring_method" varchar(20) DEFAULT 'sequential' NOT NULL,
	"carryover_losers" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"stages" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" varchar(20) DEFAULT 'running' NOT NULL,
	"final_ranked" jsonb,
	"run_id" uuid,
	"created_by" uuid NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "tournament_sessions_status_check" CHECK (status IN ('running', 'finalizing', 'completed', 'failed'))
);
--> statement-breakpoint
ALTER TABLE "evaluations" RENAME TO "agent_config_proposals";--> statement-breakpoint
ALTER TABLE "candidates" DROP CONSTRAINT "discipline_status_check";--> statement-breakpoint
ALTER TABLE "candidates" DROP CONSTRAINT "mcu_status_check";--> statement-breakpoint
ALTER TABLE "candidates" DROP CONSTRAINT "behavior_review_status_check";--> statement-breakpoint
ALTER TABLE "candidates" DROP CONSTRAINT "hav_quadrant_check";--> statement-breakpoint
ALTER TABLE "scoring_runs" DROP CONSTRAINT "scoring_runs_status_check";--> statement-breakpoint
ALTER TABLE "analysis_results" DROP CONSTRAINT "analysis_results_position_id_positions_id_fk";
--> statement-breakpoint
ALTER TABLE "criteria" DROP CONSTRAINT "criteria_position_id_positions_id_fk";
--> statement-breakpoint
ALTER TABLE "agent_config_proposals" DROP CONSTRAINT "evaluations_position_id_positions_id_fk";
--> statement-breakpoint
ALTER TABLE "agent_config_proposals" DROP CONSTRAINT "evaluations_candidate_id_candidates_id_fk";
--> statement-breakpoint
ALTER TABLE "agent_config_proposals" DROP CONSTRAINT "evaluations_criteria_id_criteria_id_fk";
--> statement-breakpoint
ALTER TABLE "agent_config_proposals" DROP CONSTRAINT "evaluations_evaluated_by_users_id_fk";
--> statement-breakpoint
ALTER TABLE "positions" DROP CONSTRAINT "positions_created_by_users_id_fk";
--> statement-breakpoint
ALTER TABLE "scoring_runs" DROP CONSTRAINT "scoring_runs_position_id_positions_id_fk";
--> statement-breakpoint
DROP INDEX "idx_evaluations_position";--> statement-breakpoint
DROP INDEX "idx_evaluations_candidate";--> statement-breakpoint
DROP INDEX "idx_evaluations_unique";--> statement-breakpoint
DROP INDEX "idx_positions_created_by";--> statement-breakpoint
DROP INDEX "idx_positions_status";--> statement-breakpoint
ALTER TABLE "audit_log" ALTER COLUMN "entity_id" SET DATA TYPE varchar(128);--> statement-breakpoint
ALTER TABLE "candidates" ALTER COLUMN "name" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "candidates" ALTER COLUMN "email" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "candidates" ALTER COLUMN "current_position" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "candidates" ALTER COLUMN "department" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "candidates" ALTER COLUMN "division" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "candidates" ALTER COLUMN "years_experience" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "candidates" ALTER COLUMN "photo_url" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "candidates" ALTER COLUMN "discipline_status" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "candidates" ALTER COLUMN "discipline_status" SET DEFAULT 'clear';--> statement-breakpoint
ALTER TABLE "candidates" ALTER COLUMN "mcu_status" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "candidates" ALTER COLUMN "mcu_status" SET DEFAULT 'fit';--> statement-breakpoint
ALTER TABLE "candidates" ALTER COLUMN "performance_grade" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "candidates" ALTER COLUMN "hav_quadrant" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "candidates" ALTER COLUMN "education" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "candidates" ALTER COLUMN "major" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "sync_hav" ALTER COLUMN "quadrant" SET DATA TYPE varchar(30);--> statement-breakpoint
ALTER TABLE "analysis_results" ADD COLUMN "manual_rank" integer;--> statement-breakpoint
ALTER TABLE "candidates" ADD COLUMN "grade" text;--> statement-breakpoint
ALTER TABLE "candidates" ADD COLUMN "behavior_recommendation" text;--> statement-breakpoint
ALTER TABLE "candidates" ADD COLUMN "behavior_notes" text;--> statement-breakpoint
ALTER TABLE "candidates" ADD COLUMN "birth_date" text;--> statement-breakpoint
ALTER TABLE "candidates" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "candidates" ADD COLUMN "deleted_by" uuid;--> statement-breakpoint
ALTER TABLE "candidates" ADD COLUMN "deleted_mode" varchar(10);--> statement-breakpoint
ALTER TABLE "agent_config_proposals" ADD COLUMN "tenant_id" uuid NOT NULL;--> statement-breakpoint
ALTER TABLE "agent_config_proposals" ADD COLUMN "run_id" uuid;--> statement-breakpoint
ALTER TABLE "agent_config_proposals" ADD COLUMN "created_by" uuid NOT NULL;--> statement-breakpoint
ALTER TABLE "agent_config_proposals" ADD COLUMN "domain" varchar(40) NOT NULL;--> statement-breakpoint
ALTER TABLE "agent_config_proposals" ADD COLUMN "target_id" varchar(120);--> statement-breakpoint
ALTER TABLE "agent_config_proposals" ADD COLUMN "patch" jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "agent_config_proposals" ADD COLUMN "base" jsonb;--> statement-breakpoint
ALTER TABLE "agent_config_proposals" ADD COLUMN "rationale" text NOT NULL;--> statement-breakpoint
ALTER TABLE "agent_config_proposals" ADD COLUMN "status" varchar(20) DEFAULT 'pending' NOT NULL;--> statement-breakpoint
ALTER TABLE "agent_config_proposals" ADD COLUMN "previous" jsonb;--> statement-breakpoint
ALTER TABLE "agent_config_proposals" ADD COLUMN "applied_by" uuid;--> statement-breakpoint
ALTER TABLE "agent_config_proposals" ADD COLUMN "applied_at" timestamp;--> statement-breakpoint
ALTER TABLE "agent_config_proposals" ADD COLUMN "updated_at" timestamp DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "positions" ADD COLUMN "sync_position_id" integer;--> statement-breakpoint
ALTER TABLE "positions" ADD COLUMN "position_id" varchar(40) NOT NULL;--> statement-breakpoint
ALTER TABLE "positions" ADD COLUMN "internal_title" varchar(300);--> statement-breakpoint
ALTER TABLE "positions" ADD COLUMN "external_title" varchar(300);--> statement-breakpoint
ALTER TABLE "positions" ADD COLUMN "summary" text;--> statement-breakpoint
ALTER TABLE "positions" ADD COLUMN "grade_id" varchar(20);--> statement-breakpoint
ALTER TABLE "program_templates" ADD COLUMN "system_prompt" text;--> statement-breakpoint
ALTER TABLE "program_templates" ADD COLUMN "target_finalists" integer DEFAULT 10 NOT NULL;--> statement-breakpoint
ALTER TABLE "program_templates" ADD COLUMN "enforce_filter_rules" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "program_templates" ADD COLUMN "ahp_config" jsonb;--> statement-breakpoint
ALTER TABLE "scoring_runs" ADD COLUMN "config_snapshot" jsonb;--> statement-breakpoint
ALTER TABLE "scoring_runs" ADD COLUMN "run_info" jsonb;--> statement-breakpoint
ALTER TABLE "scoring_runs" ADD COLUMN "parent_run_id" uuid;--> statement-breakpoint
ALTER TABLE "scoring_runs" ADD COLUMN "rerun_mode" varchar(32);--> statement-breakpoint
ALTER TABLE "sync_education" ADD COLUMN "source_key" varchar(32);--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "role_id" uuid;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "last_login_at" timestamp;--> statement-breakpoint
ALTER TABLE "agent_memories" ADD CONSTRAINT "agent_memories_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_memories" ADD CONSTRAINT "agent_memories_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_recipes" ADD CONSTRAINT "agent_recipes_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_recipes" ADD CONSTRAINT "agent_recipes_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_recipes" ADD CONSTRAINT "agent_recipes_source_run_id_agent_runs_id_fk" FOREIGN KEY ("source_run_id") REFERENCES "public"."agent_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_run_steps" ADD CONSTRAINT "agent_run_steps_run_id_agent_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."agent_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_runs" ADD CONSTRAINT "agent_runs_session_id_agent_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."agent_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_runs" ADD CONSTRAINT "agent_runs_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_runs" ADD CONSTRAINT "agent_runs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_sessions" ADD CONSTRAINT "agent_sessions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_sessions" ADD CONSTRAINT "agent_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_encryption_keys" ADD CONSTRAINT "app_encryption_keys_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_role_permissions" ADD CONSTRAINT "app_role_permissions_role_id_app_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."app_roles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "candidate_aspect_scores" ADD CONSTRAINT "candidate_aspect_scores_candidate_id_candidates_id_fk" FOREIGN KEY ("candidate_id") REFERENCES "public"."candidates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "candidate_aspect_scores" ADD CONSTRAINT "candidate_aspect_scores_position_id_critical_positions_id_fk" FOREIGN KEY ("position_id") REFERENCES "public"."critical_positions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "candidate_position_history" ADD CONSTRAINT "candidate_position_history_candidate_id_candidates_id_fk" FOREIGN KEY ("candidate_id") REFERENCES "public"."candidates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "candidate_position_history" ADD CONSTRAINT "candidate_position_history_sync_employee_position_id_sync_employee_positions_id_fk" FOREIGN KEY ("sync_employee_position_id") REFERENCES "public"."sync_employee_positions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "candidate_simulations" ADD CONSTRAINT "candidate_simulations_run_id_scoring_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."scoring_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "candidate_simulations" ADD CONSTRAINT "candidate_simulations_candidate_id_candidates_id_fk" FOREIGN KEY ("candidate_id") REFERENCES "public"."candidates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "candidate_simulations" ADD CONSTRAINT "candidate_simulations_position_id_critical_positions_id_fk" FOREIGN KEY ("position_id") REFERENCES "public"."critical_positions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "candidate_simulations" ADD CONSTRAINT "candidate_simulations_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "candidate_simulations" ADD CONSTRAINT "candidate_simulations_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "candidate_technical_competencies" ADD CONSTRAINT "candidate_technical_competencies_candidate_id_candidates_id_fk" FOREIGN KEY ("candidate_id") REFERENCES "public"."candidates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "candidate_technical_competencies" ADD CONSTRAINT "candidate_technical_competencies_sync_technical_competency_id_sync_technical_competencies_id_fk" FOREIGN KEY ("sync_technical_competency_id") REFERENCES "public"."sync_technical_competencies"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_run_id_scoring_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."scoring_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "critical_position_holders" ADD CONSTRAINT "critical_position_holders_position_id_critical_positions_id_fk" FOREIGN KEY ("position_id") REFERENCES "public"."critical_positions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "critical_positions" ADD CONSTRAINT "critical_positions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "critical_positions" ADD CONSTRAINT "critical_positions_position_id_positions_id_fk" FOREIGN KEY ("position_id") REFERENCES "public"."positions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "critical_positions" ADD CONSTRAINT "critical_positions_program_template_id_program_templates_id_fk" FOREIGN KEY ("program_template_id") REFERENCES "public"."program_templates"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "critical_positions" ADD CONSTRAINT "critical_positions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_categories" ADD CONSTRAINT "job_categories_run_id_job_family_topic_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."job_family_topic_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_category_profiles" ADD CONSTRAINT "job_category_profiles_category_id_job_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."job_categories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_family_ai_match_cache" ADD CONSTRAINT "job_family_ai_match_cache_job_profile_id_sync_job_profiles_id_fk" FOREIGN KEY ("job_profile_id") REFERENCES "public"."sync_job_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_family_matches" ADD CONSTRAINT "job_family_matches_candidate_id_candidates_id_fk" FOREIGN KEY ("candidate_id") REFERENCES "public"."candidates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_family_matches" ADD CONSTRAINT "job_family_matches_job_profile_id_sync_job_profiles_id_fk" FOREIGN KEY ("job_profile_id") REFERENCES "public"."sync_job_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_family_topic_assignments" ADD CONSTRAINT "job_family_topic_assignments_run_id_job_family_topic_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."job_family_topic_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_family_topic_configs" ADD CONSTRAINT "job_family_topic_configs_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_family_topic_runs" ADD CONSTRAINT "job_family_topic_runs_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_family_topics" ADD CONSTRAINT "job_family_topics_run_id_job_family_topic_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."job_family_topic_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_profile_tenants" ADD CONSTRAINT "job_profile_tenants_job_profile_id_sync_job_profiles_id_fk" FOREIGN KEY ("job_profile_id") REFERENCES "public"."sync_job_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_profile_tenants" ADD CONSTRAINT "job_profile_tenants_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "position_picks" ADD CONSTRAINT "position_picks_position_id_critical_positions_id_fk" FOREIGN KEY ("position_id") REFERENCES "public"."critical_positions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "position_picks" ADD CONSTRAINT "position_picks_candidate_id_candidates_id_fk" FOREIGN KEY ("candidate_id") REFERENCES "public"."candidates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "position_picks" ADD CONSTRAINT "position_picks_run_id_scoring_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."scoring_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "position_picks" ADD CONSTRAINT "position_picks_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "program_contexts" ADD CONSTRAINT "program_contexts_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prompt_versions" ADD CONSTRAINT "prompt_versions_template_id_program_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."program_templates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prompt_versions" ADD CONSTRAINT "prompt_versions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "qualified_employee_pool" ADD CONSTRAINT "qualified_employee_pool_candidate_id_candidates_id_fk" FOREIGN KEY ("candidate_id") REFERENCES "public"."candidates"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scoring_run_exclusions" ADD CONSTRAINT "scoring_run_exclusions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scoring_run_exclusions" ADD CONSTRAINT "scoring_run_exclusions_run_id_scoring_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."scoring_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scoring_run_exclusions" ADD CONSTRAINT "scoring_run_exclusions_candidate_id_candidates_id_fk" FOREIGN KEY ("candidate_id") REFERENCES "public"."candidates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scoring_run_exclusions" ADD CONSTRAINT "scoring_run_exclusions_excluded_by_users_id_fk" FOREIGN KEY ("excluded_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scoring_run_feedback" ADD CONSTRAINT "scoring_run_feedback_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scoring_run_feedback" ADD CONSTRAINT "scoring_run_feedback_run_id_scoring_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."scoring_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scoring_run_feedback" ADD CONSTRAINT "scoring_run_feedback_position_id_critical_positions_id_fk" FOREIGN KEY ("position_id") REFERENCES "public"."critical_positions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scoring_run_feedback" ADD CONSTRAINT "scoring_run_feedback_program_template_id_program_templates_id_fk" FOREIGN KEY ("program_template_id") REFERENCES "public"."program_templates"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scoring_run_feedback" ADD CONSTRAINT "scoring_run_feedback_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scoring_run_pool_aspects" ADD CONSTRAINT "scoring_run_pool_aspects_run_id_scoring_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."scoring_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scoring_run_pool_aspects" ADD CONSTRAINT "scoring_run_pool_aspects_candidate_id_candidates_id_fk" FOREIGN KEY ("candidate_id") REFERENCES "public"."candidates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync_source_connections" ADD CONSTRAINT "sync_source_connections_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "talent_audit_logs" ADD CONSTRAINT "talent_audit_logs_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "talent_audit_logs" ADD CONSTRAINT "talent_audit_logs_changed_by_user_id_users_id_fk" FOREIGN KEY ("changed_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "talent_box_configs" ADD CONSTRAINT "talent_box_configs_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "talent_box_configs" ADD CONSTRAINT "talent_box_configs_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "talent_data_staging" ADD CONSTRAINT "talent_data_staging_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "talent_data_staging" ADD CONSTRAINT "talent_data_staging_final_validated_by_users_id_fk" FOREIGN KEY ("final_validated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tournament_sessions" ADD CONSTRAINT "tournament_sessions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tournament_sessions" ADD CONSTRAINT "tournament_sessions_position_id_critical_positions_id_fk" FOREIGN KEY ("position_id") REFERENCES "public"."critical_positions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tournament_sessions" ADD CONSTRAINT "tournament_sessions_program_template_id_program_templates_id_fk" FOREIGN KEY ("program_template_id") REFERENCES "public"."program_templates"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tournament_sessions" ADD CONSTRAINT "tournament_sessions_run_id_scoring_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."scoring_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tournament_sessions" ADD CONSTRAINT "tournament_sessions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_agent_memories_tenant_user" ON "agent_memories" USING btree ("tenant_id","user_id");--> statement-breakpoint
CREATE INDEX "idx_agent_recipes_tenant" ON "agent_recipes" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_agent_run_steps_run_step" ON "agent_run_steps" USING btree ("run_id","step_id");--> statement-breakpoint
CREATE INDEX "idx_agent_run_steps_run_seq" ON "agent_run_steps" USING btree ("run_id","seq");--> statement-breakpoint
CREATE INDEX "idx_agent_runs_session" ON "agent_runs" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "idx_agent_runs_tenant_user" ON "agent_runs" USING btree ("tenant_id","user_id");--> statement-breakpoint
CREATE INDEX "idx_agent_runs_status" ON "agent_runs" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_agent_sessions_tenant_user" ON "agent_sessions" USING btree ("tenant_id","user_id");--> statement-breakpoint
CREATE INDEX "idx_agent_sessions_scope" ON "agent_sessions" USING btree ("tenant_id","user_id","scope");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_app_role_permissions" ON "app_role_permissions" USING btree ("role_id","permission");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_app_roles_key" ON "app_roles" USING btree ("key");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_candidate_aspect_scores" ON "candidate_aspect_scores" USING btree ("candidate_id","position_id","aspect");--> statement-breakpoint
CREATE INDEX "idx_candidate_aspect_scores_position" ON "candidate_aspect_scores" USING btree ("position_id");--> statement-breakpoint
CREATE INDEX "idx_candidate_position_history_candidate" ON "candidate_position_history" USING btree ("candidate_id");--> statement-breakpoint
CREATE INDEX "idx_candidate_position_history_position_id" ON "candidate_position_history" USING btree ("position_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_candidate_position_history_source" ON "candidate_position_history" USING btree ("candidate_id","source_key");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_candidate_simulations_run_candidate" ON "candidate_simulations" USING btree ("run_id","candidate_id");--> statement-breakpoint
CREATE INDEX "idx_candidate_simulations_tenant" ON "candidate_simulations" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "idx_candidate_simulations_candidate" ON "candidate_simulations" USING btree ("candidate_id");--> statement-breakpoint
CREATE INDEX "idx_candidate_technical_candidate" ON "candidate_technical_competencies" USING btree ("candidate_id");--> statement-breakpoint
CREATE INDEX "idx_candidate_technical_technical_id" ON "candidate_technical_competencies" USING btree ("technical_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_candidate_technical_source" ON "candidate_technical_competencies" USING btree ("candidate_id","source_key");--> statement-breakpoint
CREATE INDEX "idx_chat_messages_run" ON "chat_messages" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "idx_chat_messages_user_run" ON "chat_messages" USING btree ("user_id","run_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_critical_position_holders" ON "critical_position_holders" USING btree ("position_id","employee_id");--> statement-breakpoint
CREATE INDEX "idx_critical_position_holders_position" ON "critical_position_holders" USING btree ("position_id");--> statement-breakpoint
CREATE INDEX "idx_critical_positions_tenant" ON "critical_positions" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "idx_critical_positions_position" ON "critical_positions" USING btree ("position_id");--> statement-breakpoint
CREATE INDEX "idx_critical_positions_created_by" ON "critical_positions" USING btree ("created_by");--> statement-breakpoint
CREATE INDEX "idx_critical_positions_status" ON "critical_positions" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_critical_positions_program" ON "critical_positions" USING btree ("tenant_id","program_code");--> statement-breakpoint
CREATE INDEX "idx_job_categories_status" ON "job_categories" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_job_categories_run" ON "job_categories" USING btree ("run_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_job_category_profiles_cat_profile" ON "job_category_profiles" USING btree ("category_id","job_profile_id");--> statement-breakpoint
CREATE INDEX "idx_job_category_profiles_category" ON "job_category_profiles" USING btree ("category_id");--> statement-breakpoint
CREATE INDEX "idx_job_category_profiles_profile" ON "job_category_profiles" USING btree ("job_profile_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_job_family_ai_match_cache_title" ON "job_family_ai_match_cache" USING btree ("title_key");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_job_family_matches_candidate" ON "job_family_matches" USING btree ("candidate_id");--> statement-breakpoint
CREATE INDEX "idx_job_family_matches_job_profile" ON "job_family_matches" USING btree ("job_profile_id");--> statement-breakpoint
CREATE INDEX "idx_job_family_matches_match_type" ON "job_family_matches" USING btree ("match_type");--> statement-breakpoint
CREATE INDEX "idx_job_family_matches_position_id" ON "job_family_matches" USING btree ("position_id");--> statement-breakpoint
CREATE INDEX "idx_job_family_matches_tenant" ON "job_family_matches" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "idx_job_family_matches_company" ON "job_family_matches" USING btree ("company_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_job_family_title_embed" ON "job_family_title_embed" USING btree ("source","model","text_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_job_family_topic_assign_run_profile" ON "job_family_topic_assignments" USING btree ("run_id","job_profile_id");--> statement-breakpoint
CREATE INDEX "idx_job_family_topic_assign_run" ON "job_family_topic_assignments" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "idx_job_family_topic_assign_topic" ON "job_family_topic_assignments" USING btree ("run_id","topic_id");--> statement-breakpoint
CREATE INDEX "idx_job_family_topic_configs_active" ON "job_family_topic_configs" USING btree ("is_active");--> statement-breakpoint
CREATE INDEX "idx_job_family_topic_configs_created" ON "job_family_topic_configs" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "idx_job_family_topic_configs_tenant" ON "job_family_topic_configs" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "idx_job_family_topic_runs_status" ON "job_family_topic_runs" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_job_family_topic_runs_created" ON "job_family_topic_runs" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "idx_job_family_topic_runs_tenant" ON "job_family_topic_runs" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_job_family_topics_run_topic" ON "job_family_topics" USING btree ("run_id","topic_id");--> statement-breakpoint
CREATE INDEX "idx_job_family_topics_run" ON "job_family_topics" USING btree ("run_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_job_profile_similarity_calibration_singleton" ON "job_profile_similarity_calibration" USING btree ("singleton");--> statement-breakpoint
CREATE INDEX "idx_job_profile_tenants_tenant" ON "job_profile_tenants" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "idx_job_profile_tenants_source" ON "job_profile_tenants" USING btree ("source");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_kamus_competency_match_cache_key" ON "kamus_competency_match_cache" USING btree ("name_key");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_kamus_similarity_calibration_singleton" ON "kamus_similarity_calibration" USING btree ("singleton");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_position_picks_unique" ON "position_picks" USING btree ("position_id","program_code","candidate_id");--> statement-breakpoint
CREATE INDEX "idx_position_picks_position_program" ON "position_picks" USING btree ("position_id","program_code");--> statement-breakpoint
CREATE INDEX "idx_program_contexts_tenant" ON "program_contexts" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_prompt_versions_template_version" ON "prompt_versions" USING btree ("template_id","version");--> statement-breakpoint
CREATE INDEX "idx_prompt_versions_template_id" ON "prompt_versions" USING btree ("template_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_qualified_employee_pool_employee" ON "qualified_employee_pool" USING btree ("employee_id");--> statement-breakpoint
CREATE INDEX "idx_qualified_employee_pool_tenant" ON "qualified_employee_pool" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "idx_qualified_employee_pool_candidate" ON "qualified_employee_pool" USING btree ("candidate_id");--> statement-breakpoint
CREATE INDEX "idx_qualified_employee_pool_is_candidate" ON "qualified_employee_pool" USING btree ("is_candidate");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_scoring_run_exclusions_run_candidate" ON "scoring_run_exclusions" USING btree ("run_id","candidate_id");--> statement-breakpoint
CREATE INDEX "idx_scoring_run_exclusions_run" ON "scoring_run_exclusions" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "idx_scoring_run_exclusions_tenant" ON "scoring_run_exclusions" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_scoring_run_feedback_run" ON "scoring_run_feedback" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "idx_scoring_run_feedback_tenant" ON "scoring_run_feedback" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "idx_scoring_run_feedback_position" ON "scoring_run_feedback" USING btree ("position_id");--> statement-breakpoint
CREATE INDEX "idx_scoring_run_feedback_program" ON "scoring_run_feedback" USING btree ("program_template_id");--> statement-breakpoint
CREATE INDEX "idx_scoring_run_feedback_vote" ON "scoring_run_feedback" USING btree ("vote");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_scoring_run_pool_aspects_run_candidate" ON "scoring_run_pool_aspects" USING btree ("run_id","candidate_id");--> statement-breakpoint
CREATE INDEX "idx_scoring_run_pool_aspects_run" ON "scoring_run_pool_aspects" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "idx_sync_assessment_center_employee" ON "sync_assessment_center" USING btree ("employee_id");--> statement-breakpoint
CREATE INDEX "idx_sync_assessment_center_company_employee" ON "sync_assessment_center" USING btree ("company_id","employee_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_sync_behavior_company_employee" ON "sync_behavior_competencies" USING btree ("company_id","employee_id");--> statement-breakpoint
CREATE INDEX "idx_sync_behavior_company" ON "sync_behavior_competencies" USING btree ("company_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_sync_employee_personal" ON "sync_employee_personal" USING btree ("company_id","employee_id");--> statement-breakpoint
CREATE INDEX "idx_sync_employee_personal_employee" ON "sync_employee_personal" USING btree ("employee_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_sync_grade_levels" ON "sync_grade_levels" USING btree ("company_id","level_id","grade_id");--> statement-breakpoint
CREATE INDEX "idx_sync_grade_levels_company" ON "sync_grade_levels" USING btree ("company_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_sync_kamus_kompetensi_code" ON "sync_kamus_kompetensi" USING btree ("code");--> statement-breakpoint
CREATE INDEX "idx_sync_kamus_kompetensi_name" ON "sync_kamus_kompetensi" USING btree ("name");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_sync_rtc_history" ON "sync_rtc_history" USING btree ("company_id","employee_id","rtc_year","rtc_name");--> statement-breakpoint
CREATE INDEX "idx_sync_rtc_employee" ON "sync_rtc_history" USING btree ("employee_id");--> statement-breakpoint
CREATE INDEX "idx_sync_runs_job_started" ON "sync_runs" USING btree ("job_key","started_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "idx_sync_runs_started" ON "sync_runs" USING btree ("started_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "idx_sync_runs_status" ON "sync_runs" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_sync_source_connections_key" ON "sync_source_connections" USING btree ("source_key");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_sync_talent_mapping_history" ON "sync_talent_mapping_history" USING btree ("company_id","employee_id","mapping_year");--> statement-breakpoint
CREATE INDEX "idx_sync_talent_mapping_employee" ON "sync_talent_mapping_history" USING btree ("employee_id");--> statement-breakpoint
CREATE INDEX "idx_talent_audit_tenant_timestamp" ON "talent_audit_logs" USING btree ("tenant_id","timestamp");--> statement-breakpoint
CREATE INDEX "idx_talent_audit_employee" ON "talent_audit_logs" USING btree ("employee_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_talent_box_configs_tenant" ON "talent_box_configs" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_talent_data_staging_tenant_employee" ON "talent_data_staging" USING btree ("tenant_id","employee_id");--> statement-breakpoint
CREATE INDEX "idx_talent_data_staging_tenant_box" ON "talent_data_staging" USING btree ("tenant_id","system_recommended_box");--> statement-breakpoint
CREATE INDEX "idx_talent_data_staging_tenant_validated" ON "talent_data_staging" USING btree ("tenant_id","final_validated_box");--> statement-breakpoint
CREATE INDEX "idx_talent_data_staging_division" ON "talent_data_staging" USING btree ("division");--> statement-breakpoint
CREATE INDEX "idx_talent_data_staging_employee" ON "talent_data_staging" USING btree ("employee_id");--> statement-breakpoint
CREATE INDEX "idx_tournament_sessions_tenant" ON "tournament_sessions" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "idx_tournament_sessions_position" ON "tournament_sessions" USING btree ("position_id");--> statement-breakpoint
CREATE INDEX "idx_tournament_sessions_status" ON "tournament_sessions" USING btree ("status");--> statement-breakpoint
ALTER TABLE "analysis_results" ADD CONSTRAINT "analysis_results_position_id_critical_positions_id_fk" FOREIGN KEY ("position_id") REFERENCES "public"."critical_positions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "candidates" ADD CONSTRAINT "candidates_deleted_by_users_id_fk" FOREIGN KEY ("deleted_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "criteria" ADD CONSTRAINT "criteria_position_id_critical_positions_id_fk" FOREIGN KEY ("position_id") REFERENCES "public"."critical_positions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_config_proposals" ADD CONSTRAINT "agent_config_proposals_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_config_proposals" ADD CONSTRAINT "agent_config_proposals_run_id_agent_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."agent_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_config_proposals" ADD CONSTRAINT "agent_config_proposals_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_config_proposals" ADD CONSTRAINT "agent_config_proposals_applied_by_users_id_fk" FOREIGN KEY ("applied_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "positions" ADD CONSTRAINT "positions_sync_position_id_sync_positions_id_fk" FOREIGN KEY ("sync_position_id") REFERENCES "public"."sync_positions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scoring_runs" ADD CONSTRAINT "scoring_runs_position_id_critical_positions_id_fk" FOREIGN KEY ("position_id") REFERENCES "public"."critical_positions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_role_id_app_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."app_roles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_agent_config_proposals_tenant_status" ON "agent_config_proposals" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE INDEX "idx_agent_config_proposals_run" ON "agent_config_proposals" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "idx_positions_sync_position_id" ON "positions" USING btree ("sync_position_id");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_positions_tenant_position_id" ON "positions" USING btree ("tenant_id","position_id");--> statement-breakpoint
CREATE INDEX "idx_scoring_runs_parent" ON "scoring_runs" USING btree ("parent_run_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_sync_education_source_key" ON "sync_education" USING btree ("source_key");--> statement-breakpoint
ALTER TABLE "candidates" DROP COLUMN "behavior_review_status";--> statement-breakpoint
ALTER TABLE "candidates" DROP COLUMN "assessment_validity";--> statement-breakpoint
ALTER TABLE "agent_config_proposals" DROP COLUMN "position_id";--> statement-breakpoint
ALTER TABLE "agent_config_proposals" DROP COLUMN "candidate_id";--> statement-breakpoint
ALTER TABLE "agent_config_proposals" DROP COLUMN "criteria_id";--> statement-breakpoint
ALTER TABLE "agent_config_proposals" DROP COLUMN "score";--> statement-breakpoint
ALTER TABLE "agent_config_proposals" DROP COLUMN "notes";--> statement-breakpoint
ALTER TABLE "agent_config_proposals" DROP COLUMN "evaluated_by";--> statement-breakpoint
ALTER TABLE "positions" DROP COLUMN "title";--> statement-breakpoint
ALTER TABLE "positions" DROP COLUMN "level";--> statement-breakpoint
ALTER TABLE "positions" DROP COLUMN "description";--> statement-breakpoint
ALTER TABLE "positions" DROP COLUMN "status";--> statement-breakpoint
ALTER TABLE "positions" DROP COLUMN "holder_name";--> statement-breakpoint
ALTER TABLE "positions" DROP COLUMN "holder_employee_id";--> statement-breakpoint
ALTER TABLE "positions" DROP COLUMN "holder_since";--> statement-breakpoint
ALTER TABLE "positions" DROP COLUMN "created_by";--> statement-breakpoint
ALTER TABLE "candidates" ADD CONSTRAINT "candidates_deleted_mode_check" CHECK (deleted_mode IS NULL OR deleted_mode IN ('bulk', 'manual'));--> statement-breakpoint
ALTER TABLE "agent_config_proposals" ADD CONSTRAINT "agent_config_proposals_status_check" CHECK (status IN ('pending', 'applied', 'rejected', 'rolled_back'));--> statement-breakpoint
ALTER TABLE "agent_config_proposals" ADD CONSTRAINT "agent_config_proposals_domain_check" CHECK (domain IN ('bertopic', 'ahp_weights', 'readiness', 'scoring_prompt', 'program_criteria', 'program_filter_rules', 'restructure_template'));--> statement-breakpoint
ALTER TABLE "scoring_runs" ADD CONSTRAINT "scoring_runs_status_check" CHECK (status IN ('draft', 'in_progress', 'completed', 'archived'));