CREATE TABLE "user_deletions" (
  "user_id" text PRIMARY KEY,
  "requested_at" timestamptz NOT NULL DEFAULT now(),
  "delete_after" timestamptz NOT NULL,
  "phase" text NOT NULL DEFAULT 'scheduled',
  "started_at" timestamptz,
  "last_error" text
);--> statement-breakpoint
CREATE INDEX "user_deletions_due_idx" ON "user_deletions" ("delete_after") WHERE "phase" = 'scheduled';
