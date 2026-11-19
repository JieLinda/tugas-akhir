-- Fully custom in-app roles (Keycloak = SSO only). Replaces the fixed-enum
-- app_role + role_permission_overrides with user-defined roles + granted
-- permissions. Additive/idempotent; drops the prior (empty) 0028 artifacts.

CREATE TABLE IF NOT EXISTS "app_roles" (
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
CREATE UNIQUE INDEX IF NOT EXISTS "uq_app_roles_key" ON "app_roles" USING btree ("key");--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "app_role_permissions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"role_id" uuid NOT NULL,
	"permission" varchar(40) NOT NULL,
	CONSTRAINT "app_role_permissions_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "app_roles"("id") ON DELETE CASCADE
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uq_app_role_permissions" ON "app_role_permissions" USING btree ("role_id","permission");--> statement-breakpoint

ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "role_id" uuid;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "users" ADD CONSTRAINT "users_role_id_app_roles_id_fkey" FOREIGN KEY ("role_id") REFERENCES "app_roles"("id") ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint

ALTER TABLE "users" DROP COLUMN IF EXISTS "app_role";--> statement-breakpoint
DROP TABLE IF EXISTS "role_permission_overrides";
