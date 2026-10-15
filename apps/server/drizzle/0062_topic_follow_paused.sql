SET lock_timeout = '5s';--> statement-breakpoint
ALTER TABLE "topics" ADD COLUMN "follow_paused_at" timestamptz;
