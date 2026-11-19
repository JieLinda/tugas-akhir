CREATE TABLE "sync_hav" (
	"id" serial PRIMARY KEY NOT NULL,
	"npk" varchar(20) NOT NULL,
	"nama" varchar(255),
	"quadrant" integer,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sync_mcu" (
	"id" serial PRIMARY KEY NOT NULL,
	"npk" varchar(20) NOT NULL,
	"nama" varchar(255),
	"status" varchar(20),
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "uq_sync_hav_npk" ON "sync_hav" USING btree ("npk");--> statement-breakpoint
CREATE INDEX "idx_sync_hav_quadrant" ON "sync_hav" USING btree ("quadrant");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_sync_mcu_npk" ON "sync_mcu" USING btree ("npk");--> statement-breakpoint
CREATE INDEX "idx_sync_mcu_status" ON "sync_mcu" USING btree ("status");