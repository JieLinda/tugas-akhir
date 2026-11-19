CREATE TABLE IF NOT EXISTS "chat_messages" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "run_id" uuid NOT NULL REFERENCES "scoring_runs"("id") ON DELETE CASCADE,
  "role" varchar(20) NOT NULL,
  "content" text NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "idx_chat_messages_run" ON "chat_messages" ("run_id");
CREATE INDEX IF NOT EXISTS "idx_chat_messages_user_run" ON "chat_messages" ("user_id", "run_id");
