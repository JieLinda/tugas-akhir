-- User & Role management: manual per-user app role + editable role→permission
-- overrides. Additive and idempotent.
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "app_role" varchar(20);--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "last_login_at" timestamp;--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "role_permission_overrides" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"role" varchar(20) NOT NULL,
	"permission" varchar(40) NOT NULL,
	"allowed" boolean NOT NULL,
	"updated_by" uuid,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "role_permission_overrides_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "users"("id") ON DELETE SET NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uq_role_permission_overrides" ON "role_permission_overrides" USING btree ("role","permission");
